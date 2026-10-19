'use strict';
// Host-only mount plane. PID 1 owns mounts; the reconciler keeps its private
// mount namespace. No nsenter, arbitrary unit properties or application socket.
const fs=require('node:fs');
const path=require('node:path').posix;
const {execFileSync}=require('node:child_process');
const storage=require('../persistent-restore/storage.cjs');
const OPTIONS='loop,nodev,nosuid,noexec';
const fail=()=>{throw Object.assign(new Error('Systemd recovery mount verification refused.'),{code:'operator-mount-unverified'});};
function approvedTarget(profiles,file,mountpoint){
  const id=path.basename(file,'.ext4');
  if(!/^[a-f0-9]{24}$/.test(id)||!profiles.some(p=>file===path.join(p.images,id+'.ext4')&&mountpoint===path.join(p.view,id)))fail();
  return id;
}
function parseMountInfo(text,mountpoint){
  const decode=value=>value.replace(/\\(040|011|012|134)/g,(_,octal)=>String.fromCharCode(parseInt(octal,8)));
  const matches=[];
  for(const line of text.trim().split('\n')){
    const [left,right,...extra]=line.split(' - '),parts=left.split(' ');
    if(decode(parts[4]||'')!==mountpoint)continue;
    const tail=(right||'').split(' ');
    if(extra.length||parts.length<6||tail.length!==3||!/^\d+:\d+$/.test(parts[2]))fail();
    matches.push({device:parts[2],root:decode(parts[3]),target:decode(parts[4]),
      options:parts[5].split(','),propagation:parts.slice(6),fstype:tail[0],source:decode(tail[1])});
  }
  if(matches.length>1)fail(); // Never silently select the top of an overmount.
  return matches[0]||null;
}
function assertViews(views,readonly=false){
  const first=views[0];
  if(views.length!==3||!first)fail();
  for(const view of views){
    if(!view||view.device!==first.device||view.root!=='/'||view.source!==first.source||
      view.fstype!=='ext4'||!/^\/dev\/loop\d+$/.test(view.source)||
      ['nodev','nosuid','noexec'].some(option=>!view.options.includes(option))||(readonly&&!view.options.includes('ro')))fail();
  }
}
function assertPrivateSeedClone(local,source,selfNamespace,hostNamespace){
  if(!source||selfNamespace===hostNamespace)fail();
  assertViews([local,local,local],true);
  if(local.device!==source.device||local.source!==source.source)fail();
}
function assertAnchorShape(anchor,containing,local,shared,groups){
  if(!anchor||!containing||!local||anchor.target===containing.target||
    !anchor.target.startsWith(containing.target==='/'?'/':containing.target+'/')||
    anchor.device!==containing.device||anchor.source!==containing.source||anchor.fstype!==containing.fstype||
    anchor.root!==path.join(containing.root,path.relative(containing.target,anchor.target))||
    ['device','source','fstype','root'].some(key=>anchor[key]!==local[key])||
    !anchor.options.includes('rw')||anchor.propagation.some(p=>/^master:|^propagate_from:/.test(p)))fail();
  const peers=anchor.propagation.filter(p=>/^shared:\d+$/.test(p));
  if(shared){
    if(peers.length!==1||groups.has(peers[0])||containing.propagation.includes(peers[0]))fail();
    groups.add(peers[0]);
  }else if(anchor.propagation.length)fail();
}
function validateUnit(unit,file,mountpoint,id,backingFile,readonlySource,kind='readonly'){
  const options=String(unit.Options||'').split(',').sort().join(',');
  // systemd updates What/Options from mountinfo once active. A loop device is
  // accepted ONLY with independent exact backing-file proof, never by its name.
  const source=unit.What===(readonlySource||file)||(/^\/dev\/loop\d+$/.test(unit.What)&&backingFile===file);
  const requestOptions=readonlySource?(kind==='readonly-seed'?'bind,ro,nodev,nosuid,noexec':'bind'):OPTIONS;
  const kernelOptions=readonlySource?'ro,nosuid,nodev,noexec,relatime':'rw,nosuid,nodev,noexec,relatime';
  if(unit.LoadState!=='loaded'||unit.Transient!=='yes'||!source||unit.Where!==mountpoint||
    !(unit.Type==='ext4'||(readonlySource&&unit.Type==='none'))||
    unit.Description!=='Pluton owned recovery '+(readonlySource?kind+' ':'ext4 ')+id||
    ![requestOptions.split(',').sort().join(','),kernelOptions.split(',').sort().join(',')].includes(options))fail();
}
function createSystemdStorage(profiles,{dockerUnit='docker.service'}={}){
  if(!Array.isArray(profiles)||profiles.length!==2||!profiles.every(p=>
    p&&path.isAbsolute(p.images)&&path.isAbsolute(p.view)&&path.normalize(p.images)===p.images&&
    path.normalize(p.view)===p.view&&!/[\s\0]/.test(p.images+p.view)&&(!p.readonlyView||
      (path.isAbsolute(p.readonlyView)&&path.normalize(p.readonlyView)===p.readonlyView&&!/[\s\0]/.test(p.readonlyView)&&
        path.isAbsolute(p.readonlyStage)&&path.normalize(p.readonlyStage)===p.readonlyStage&&!/[\s\0]/.test(p.readonlyStage))))||
    !/^[a-zA-Z0-9_-]+\.service$/.test(dockerUnit))fail();
  const run=(binary,args,timeout=10000)=>execFileSync(binary,args,{encoding:'utf8',timeout,killSignal:'SIGKILL',maxBuffer:262144,
    env:{PATH:'/usr/sbin:/usr/bin:/sbin:/bin',LANG:'C',LC_ALL:'C',SYSTEMD_PAGER:'cat'},stdio:['ignore','pipe','pipe']}).trim();
  const name=mountpoint=>run('/usr/bin/systemd-escape',['--path','--suffix=mount','--',mountpoint]);
  function environment(){
    if(process.platform!=='linux'||process.getuid()!==0||fs.readFileSync('/proc/1/comm','utf8').trim()!=='systemd'||
      fs.readlinkSync('/proc/self/ns/user')!==fs.readlinkSync('/proc/1/ns/user')||fs.existsSync('/.dockerenv'))fail();
    const pid=dockerPid();
    // A private daemon namespace could retain a private seed after host unmount.
    // Refuse that topology; never relax or enter the daemon's namespace.
    if(fs.readlinkSync('/proc/'+pid+'/ns/mnt')!==fs.readlinkSync('/proc/1/ns/mnt'))fail();
  }
  function assertAnchors(){
    if(process.platform!=='linux'||process.getuid()!==0||fs.readFileSync('/proc/1/comm','utf8').trim()!=='systemd'||
      fs.readlinkSync('/proc/self/ns/user')!==fs.readlinkSync('/proc/1/ns/user')||fs.existsSync('/.dockerenv'))fail();
    const info=fs.readFileSync('/proc/1/mountinfo','utf8'),localInfo=fs.readFileSync('/proc/self/mountinfo','utf8'),groups=new Set();
    for(const profile of profiles){
      for(const [point,shared] of [[profile.view,true],[profile.readonlyView,true],[profile.readonlyStage,false]]){
        storage.rootParent(point);storage.directory(point,0,shared?10001:0,shared?0o750:0o700);
        const anchor=parseMountInfo(info,point),local=parseMountInfo(localInfo,point);
        // Every plane must be an independent self bind, not a peer of its
        // containing filesystem or another plane. Never change propagation at boot.
        const containing=info.trim().split('\n').map(line=>line.split(' - ')[0].split(' '))
          .filter(parts=>parts[4]!==point&&(point.startsWith(parts[4]+'/')||parts[4]==='/'))
          .sort((a,b)=>b[4].length-a[4].length)[0];
        assertAnchorShape(anchor,containing?parseMountInfo(info,containing[4]):null,local,shared,groups);
      }
    }
  }
  function target(file,mountpoint){
    const id=approvedTarget(profiles,file,mountpoint);
    storage.rootParent(file);storage.rootParent(mountpoint);environment();
    return id;
  }
  function properties(mountpoint){
    const output=run('/usr/bin/systemctl',['--no-ask-password','--no-pager','show',name(mountpoint),
      '--property=LoadState,Transient,What,Where,Type,Options,Description,ActiveState']);
    return Object.fromEntries(output.split('\n').filter(Boolean).map(line=>{
      const index=line.indexOf('=');if(index<1)fail();return [line.slice(0,index),line.slice(index+1)];
    }));
  }
  function ownedUnit(unit,file,mountpoint,id,readonlySource,kind){
    let backingFile;
    if(/^\/dev\/loop\d+$/.test(unit.What)){
      const loops=JSON.parse(run('/usr/sbin/losetup',['--json','--list','--output','NAME,BACK-FILE'])).loopdevices;
      if(!Array.isArray(loops))fail();
      backingFile=loops.find(loop=>loop.name===unit.What)?.['back-file'];
    }
    validateUnit(unit,file,mountpoint,id,backingFile,readonlySource,kind);
  }
  function dockerPid(){
    const pid=run('/usr/bin/systemctl',['--no-ask-password','--no-pager','show',dockerUnit,'--property=MainPID','--value']);
    if(!/^[1-9]\d*$/.test(pid)||Number(pid)<=1||fs.readFileSync('/proc/'+pid+'/comm','utf8').trim()!=='dockerd')fail();
    return pid;
  }
  function views(mountpoint){
    const pid=dockerPid();
    // Read mount tables, never enter another namespace or execute code in it.
    return ['/proc/1/mountinfo','/proc/self/mountinfo','/proc/'+pid+'/mountinfo']
      .map(file=>parseMountInfo(fs.readFileSync(file,'utf8'),mountpoint));
  }
  function visible(file,mountpoint){
    const id=target(file,mountpoint);ownedUnit(properties(mountpoint),file,mountpoint,id);assertViews(views(mountpoint));
    readonlyView(file,mountpoint,id);
  }
  function waitFor(predicate){
    const end=Date.now()+45000;
    while(Date.now()<end){if(predicate())return;Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,100);}
    fail(); // A timed-out PID-1 job may still exist. Never format/recreate/fallback.
  }
  function mount(file,mountpoint,fresh){
    const id=target(file,mountpoint),unit=properties(mountpoint);
    if(unit.LoadState!=='not-found'){
      if(fresh)fail();
      ownedUnit(unit,file,mountpoint,id);
      if(unit.ActiveState!=='active')fail();
    }else{
      if(views(mountpoint).some(Boolean))fail();
      run('/usr/bin/systemd-mount',['--no-ask-password','--no-pager','--quiet','--no-block','--collect',
        '--automount=no','--type=ext4','--options='+OPTIONS,'--description=Pluton owned recovery ext4 '+id,
        '--property=TimeoutSec=30s','--',file,mountpoint]);
    }
    waitFor(()=>{
      const current=properties(mountpoint);
      if(current.LoadState==='not-found'||current.ActiveState==='failed')fail();
      ownedUnit(current,file,mountpoint,id);
      return current.ActiveState==='active'&&views(mountpoint).every(Boolean);
    });
    // create() has not written the identity anchor yet. The read-only view is
    // published only by verify(), after that anchor has passed its checks.
    ownedUnit(properties(mountpoint),file,mountpoint,id);assertViews(views(mountpoint));
  }
  function initializeViews(onlySeeds=false){
    environment();
    if(fs.readlinkSync('/proc/self/ns/mnt')!==fs.readlinkSync('/proc/1/ns/mnt'))fail();
    for(const profile of profiles.filter(p=>p.readonlyView)){
      for(const [point,shared] of [[profile.readonlyStage,false],...(!onlySeeds?[[profile.readonlyView,true]]:[])]){
        storage.rootParent(point);const mode=shared?0o750:0o700,gid=shared?10001:0;
        if(!fs.existsSync(point)){fs.mkdirSync(point,{mode});fs.chownSync(point,0,gid);fs.chmodSync(point,mode);}
        storage.directory(point,0,gid,mode);
        if(storage.mounted(point))fail(); // Installation only; never adopt an existing anchor.
        if(fs.readdirSync(point).length)fail();
        run('/usr/bin/mount',['--bind',point,point]);run('/usr/bin/mount',['--make-private',point]);
        if(shared)run('/usr/bin/mount',['--make-rshared',point]);
      }
    }
  }
  function readonlyView(file,mountpoint,id){
    const profile=profiles.find(p=>file===path.join(p.images,id+'.ext4')&&mountpoint===path.join(p.view,id));
    if(!profile.readonlyView)return;
    storage.directory(profile.readonlyView,0,10001,0o750);
    storage.directory(profile.readonlyStage,0,0,0o700);
    const seed=path.join(profile.readonlyStage,id);storage.rootParent(seed);
    if(properties(seed).LoadState==='not-found'){
      if(parseMountInfo(fs.readFileSync('/proc/1/mountinfo','utf8'),seed))fail();
      if(!fs.existsSync(seed)){fs.mkdirSync(seed,{mode:0o755});fs.chmodSync(seed,0o755);}
      storage.directory(seed,0,0,0o755);if(fs.readdirSync(seed).length)fail();
      run('/usr/bin/systemd-mount',['--no-ask-password','--no-pager','--quiet','--no-block','--collect','--automount=no',
        '--type=none','--options=bind,ro,nodev,nosuid,noexec','--description=Pluton owned recovery readonly-seed '+id,
        '--property=TimeoutSec=30s','--',mountpoint,seed]);
    }
    // Remount flags are not propagated. Prepare a host-private RO seed first,
    // then clone it with bind ONLY: the initial propagated mount is already RO.
    waitFor(()=>{
      const state=properties(seed);ownedUnit(state,file,seed,id,mountpoint,'readonly-seed');
      if(state.ActiveState!=='active')return false;
      const view=parseMountInfo(fs.readFileSync('/proc/1/mountinfo','utf8'),seed);
      if(!view)return false;assertViews([view,view,view],true);
      if(view.device!==views(mountpoint)[0].device)fail();return true;
    });
    const point=path.join(profile.readonlyView,id);storage.rootParent(point);
    let unit=properties(point);
    if(unit.LoadState==='not-found'){
      if(views(point).some(Boolean))fail();
      if(!fs.existsSync(point)){fs.mkdirSync(point,{mode:0o755});fs.chmodSync(point,0o755);}
      storage.directory(point,0,0,0o755);if(fs.readdirSync(point).length)fail();
      run('/usr/bin/systemd-mount',['--no-ask-password','--no-pager','--quiet','--no-block','--collect','--automount=no',
        '--type=none','--options=bind','--description=Pluton owned recovery readonly '+id,
        '--property=TimeoutSec=30s','--',seed,point]);
    }
    waitFor(()=>{
      unit=properties(point);if(unit.LoadState==='not-found'||unit.ActiveState==='failed')fail();
      ownedUnit(unit,file,point,id,seed);return unit.ActiveState==='active'&&views(point).every(Boolean);
    });
    const readonlyViews=views(point);assertViews(readonlyViews,true);
    if(readonlyViews[0].device!==views(mountpoint)[0].device)fail();
  }
  function unmount(file,mountpoint){
    visible(file,mountpoint);
    const id=path.basename(file,'.ext4'),profile=profiles.find(p=>file===path.join(p.images,id+'.ext4')&&mountpoint===path.join(p.view,id));
    if(profile.readonlyView){
      const seed=path.join(profile.readonlyStage,id),point=path.join(profile.readonlyView,id);ownedUnit(properties(point),file,point,id,seed);
      run('/usr/bin/systemctl',['--no-ask-password','--no-pager','--no-block','stop',name(point)]);
      waitFor(()=>views(point).every(view=>view===null));
      storage.directory(point,0,0,0o755);if(fs.readdirSync(point).length)fail();fs.rmdirSync(point);
      const seedUnit=properties(seed);
      if(seedUnit.LoadState!=='not-found'){
        ownedUnit(seedUnit,file,seed,id,mountpoint,'readonly-seed');
        run('/usr/bin/systemctl',['--no-ask-password','--no-pager','--no-block','stop',name(seed)]);
      }else if(parseMountInfo(fs.readFileSync('/proc/1/mountinfo','utf8'),seed))fail();
      waitFor(()=>!parseMountInfo(fs.readFileSync('/proc/1/mountinfo','utf8'),seed));
      const localSeed=parseMountInfo(fs.readFileSync('/proc/self/mountinfo','utf8'),seed);
      if(localSeed){
        // A new sandbox inherits an existing private seed at service start;
        // unmounting that host-private seed does not propagate into the copy.
        // Detach ONLY our verified stale clone inside our own namespace, AFTER
        // PID 1 proves host absence. This is not nsenter or a host-mount escape.
        assertPrivateSeedClone(localSeed,views(mountpoint)[0],fs.readlinkSync('/proc/self/ns/mnt'),fs.readlinkSync('/proc/1/ns/mnt'));
        run('/usr/bin/umount',['--',seed]);
        if(parseMountInfo(fs.readFileSync('/proc/self/mountinfo','utf8'),seed))fail();
      }
      storage.directory(seed,0,0,0o755);if(fs.readdirSync(seed).length)fail();fs.rmdirSync(seed);
    }
    run('/usr/bin/systemctl',['--no-ask-password','--no-pager','--no-block','stop',name(mountpoint)]);
    waitFor(()=>{
      const unit=properties(mountpoint);
      if(unit.LoadState!=='not-found'&&unit.ActiveState!=='inactive')ownedUnit(unit,file,mountpoint,path.basename(file,'.ext4'));
      return ['inactive','failed',undefined].includes(unit.ActiveState)&&views(mountpoint).every(view=>view===null);
    });
  }
  return {...storage.createStorage({target,mount,unmount,visible}),assertEnvironment:environment,assertAnchors,initializeViews};
}
module.exports={createSystemdStorage,approvedTarget,parseMountInfo,assertViews,assertPrivateSeedClone,assertAnchorShape,validateUnit};
