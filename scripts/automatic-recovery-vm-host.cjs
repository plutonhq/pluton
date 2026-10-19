'use strict';
// Root-only disposable VM fixture; never installed in the application image.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const fixture=process.argv[2],action=process.argv[3];
assert.match(fixture,/^\/srv\/pluton-fixture\/lifecycle-lab-[a-f0-9]{32}$/);
assert.equal(fs.realpathSync(fixture),fixture);assert.equal(process.getuid(),0);
const manifest=JSON.parse(fs.readFileSync(fixture+'/manifest.json','utf8'));
assert.equal(manifest.purpose,'disposable-lifecycle-rehearsal');assert.equal(manifest.scope,fixture.split('-').at(-1));
const tag=manifest.scope,env={PATH:'/usr/sbin:/usr/bin:/sbin:/bin',LANG:'C',LC_ALL:'C',DOCKER_HOST:'unix://'+fixture+'/docker.sock',DOCKER_CONFIG:fixture+'/docker-client'};
const run=(bin,args,timeout=60000)=>execFileSync(bin,args,{encoding:'utf8',timeout,killSignal:'SIGKILL',maxBuffer:1048576,env,stdio:['ignore','pipe','pipe']}).trim();
const lifecycle=require('../deploy/automatic-recovery/operator.cjs');
const persistent=require('../deploy/persistent-restore/operator.cjs');
const {createSystemdStorage}=require('../deploy/automatic-recovery/systemdStorage.cjs');
const {directory,rootParent}=require('../deploy/persistent-restore/storage.cjs');
const options={root:fixture+'/automatic/config',data:fixture+'/automatic/data',requests:fixture+'/automatic/requests',
  persistent:{root:fixture+'/retained/config',data:fixture+'/retained/data',requests:fixture+'/retained/requests',network:'pluton-lab-retained-'+tag},
  dockerSocket:fixture+'/docker.sock',dockerUnit:manifest.dockerUnit,disposableNetwork:'pluton-lab-tests-'+tag,lock:'pluton-lab-lock-'+tag};
const op=lifecycle.createLifecycleOperator(options);
function write(file,value,gid=0,mode=0o600){persistent.write(file,value,gid,mode);}
function event(name,values={}){
  const output=JSON.stringify({event:name,...values})+'\n';
  fs.appendFileSync(fixture+'/evidence.ndjson',output,{mode:0o600});process.stdout.write(output);
}
function sandbox(){
  assert.notEqual(fs.readlinkSync('/proc/self/ns/mnt'),fs.readlinkSync('/proc/1/ns/mnt'));
  const info=fs.readFileSync('/proc/self/mountinfo','utf8');assert.match(info,/ \/home /);assert.match(info,/ \/tmp /);
  assert.match(fs.readFileSync('/proc/self/status','utf8'),/^NoNewPrivs:\s+1$/m);
}
function request(){
  let req=JSON.parse(fs.readFileSync(fixture+'/case-request.json','utf8'));
  const mailbox=op.REQUESTS+'/'+req.binding.id+'.json';
  if(fs.existsSync(mailbox)){
    const actual=lifecycle.validate(JSON.parse(fs.readFileSync(mailbox,'utf8')));
    assert.equal(JSON.stringify(actual.binding),JSON.stringify(req.binding));req=actual;write(fixture+'/case-request.json',req);
  }
  return req;
}
function journal(req=request()){return JSON.parse(fs.readFileSync(op.ROOT+'/journal/'+req.binding.id+'.json','utf8'));}
function meta(req=request()){return op.engineDriver(req).metadata(req.binding.id);}
function replaceMailbox(req){
  lifecycle.validate(req);
  const file=op.REQUESTS+'/'+req.binding.id+'.json',temporary=file+'.'+crypto.randomBytes(8).toString('hex');
  const fd=fs.openSync(temporary,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY|fs.constants.O_NOFOLLOW,0o600);
  try{fs.writeFileSync(fd,JSON.stringify(req));fs.fchownSync(fd,10001,10001);fs.fchmodSync(fd,0o600);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  fs.renameSync(temporary,file);
}
try{
  rootParent(fixture+'/manifest.json');
  assert.equal(run('/usr/bin/systemd-detect-virt',['--vm']),'kvm');
  assert.equal(run('/usr/bin/docker',['info','--format','{{.DockerRootDir}}']),fixture+'/docker');
  if(action==='init-readonly-views'||action==='init-readonly-seeds'){
    op.initializeViews(action==='init-readonly-seeds');event('dedicated_readonly_views_initialized');
  }else if(action==='init'){
    assert.equal(fs.readlinkSync('/proc/self/ns/mnt'),fs.readlinkSync('/proc/1/ns/mnt'));
    for(const item of ['automatic','retained'])directory(fixture+'/'+item,0,0,0o755);
    op.init();
    write(op.ROOT+'/policy.json',{version:1,enabled:true,maxSqlBytes:128*1024**2,maxRetentionSeconds:86400});
    event('host_initialized');
  }else if(action==='cleanup-partial-volume'){
    const req=request(),engine=op.engineDriver(req),id=req.binding.id,privateDir=engine.ROOT+'/private/'+id;
    const intent=JSON.parse(fs.readFileSync(privateDir+'/intent.json','utf8'));
    assert.equal(journal(req).bindingHash,lifecycle.hash(req));assert.equal(intent.request.snapshotId,req.binding.snapshotId);
    assert.equal(intent.request.sha256,req.binding.artifacts[0].sha256);assert.equal(intent.request.engine,req.binding.engine);
    assert.deepEqual(fs.readdirSync(privateDir),['intent.json']);
    assert.equal(run('docker',['container','ls','--all','--filter','label=org.pluton.persistent.restore='+id,'--format','{{.ID}}']),'');
    const point=engine.DATA+'/view/'+id,file=engine.DATA+'/images/'+id+'.ext4',publicPoint=engine.DATA+'/app-view/'+id;
    const identity=JSON.parse(fs.readFileSync(point+'/identity.json','utf8'));
    assert.equal(identity.restoreId,id);assert.equal(identity.activationId,intent.activation);
    require('../deploy/persistent-restore/storage.cjs').verify(file,point,identity);
    for(const [target,ro] of [[publicPoint,true],[point,false]]){
      const name=run('/usr/bin/systemd-escape',['--path','--suffix=mount','--',target]);
      const output=run('/usr/bin/systemctl',['show',name,'--property=LoadState,Transient,What,Where,Type,Options,Description']);
      const values=Object.fromEntries(output.split('\n').map(line=>{const i=line.indexOf('=');return [line.slice(0,i),line.slice(i+1)];}));
      const backing=JSON.parse(run('/usr/sbin/losetup',['--json','--list','--output','NAME,BACK-FILE'])).loopdevices.find(x=>x.name===values.What)?.['back-file'];
      require('../deploy/automatic-recovery/systemdStorage.cjs').validateUnit(values,file,target,id,backing,ro?point:undefined);
      run('/usr/bin/systemctl',['stop',name]);
      assert(!require('../deploy/automatic-recovery/systemdStorage.cjs').parseMountInfo(fs.readFileSync('/proc/1/mountinfo','utf8'),target));
      assert.equal(fs.readdirSync(target).length,0);fs.rmdirSync(target);
    }
    assert.equal(run('/usr/sbin/losetup',['--associated',file]),'');
    require('../deploy/persistent-restore/storage.cjs').imageStat(file,identity);fs.unlinkSync(file);
    fs.unlinkSync(privateDir+'/intent.json');fs.rmdirSync(privateDir);event('identified_partial_fixture_storage_removed');
  }else if(action==='cleanup-probe'){
    const intent=JSON.parse(fs.readFileSync(fixture+'/probe-intent.json','utf8'));
    assert.match(intent.id,/^[a-f0-9]{24}$/);assert.equal(intent.file,options.persistent.data+'/images/'+intent.id+'.ext4');
    assert.equal(intent.mountpoint,options.persistent.data+'/view/'+intent.id);
    const anchor=intent.mountpoint+'/identity.json',stat=fs.lstatSync(anchor),identity=JSON.parse(fs.readFileSync(anchor,'utf8'));
    assert.equal(stat.uid,0);assert.equal(stat.nlink,1);assert([0o400,0o444].includes(stat.mode&0o777));
    assert.equal(identity.restoreId,intent.id);assert.equal(identity.activationId,intent.activation);
    // Only this recorded synthetic probe's known umask failure; never repair a production resource.
    fs.chmodSync(anchor,0o444);
    const store=createSystemdStorage([{images:options.persistent.data+'/images',view:options.persistent.data+'/view'},
      {images:op.DATA+'/disposable/images',view:op.DATA+'/disposable/view'}],{dockerUnit:manifest.dockerUnit});
    store.remove({file:intent.file,mountpoint:intent.mountpoint,identity},true);event('identified_probe_removed');
  }else if(action==='probe'){
    sandbox();
    const store=createSystemdStorage([
      {images:options.persistent.data+'/images',view:options.persistent.data+'/view'},
      {images:op.DATA+'/disposable/images',view:op.DATA+'/disposable/view'}],{dockerUnit:manifest.dockerUnit});
    const id=crypto.randomBytes(12).toString('hex');
    const activation=crypto.randomBytes(16).toString('hex');
    write(fixture+'/probe-intent.json',{id,activation,file:options.persistent.data+'/images/'+id+'.ext4',mountpoint:options.persistent.data+'/view/'+id});
    const volume=store.create(options.persistent.data+'/images',options.persistent.data+'/view',id,activation);
    write(fixture+'/probe-volume.json',volume);
    const checked=store.verify(volume.file,volume.mountpoint,volume.identity);
    assert.equal(fs.lstatSync(volume.file).size,2147483648);assert(checked.bytes<=2147483648);
    assert.equal(fs.lstatSync(volume.file).mode&0o777,0o600);assert.equal(fs.statSync(volume.mountpoint+'/data').uid,999);
    event('private_namespace_host_docker_mount_verified',{quotaBytes:2147483648,filesystemBytes:checked.bytes});
    store.remove(volume,true);event('probe_storage_removed');
  }else if(action==='case'){
    const engine=process.argv[4],mode=process.argv[5];assert(['mariadb','postgresql'].includes(engine));assert(['persistent','disposable'].includes(mode));
    const variant=process.argv[6]||'normal';assert(['normal','cancel'].includes(variant));
    const sql="CREATE TABLE fixture_entries(value VARCHAR(100)); INSERT INTO fixture_entries VALUES ('synthetic native lifecycle content');\n"+
      (variant==='cancel'?(engine==='mariadb'?'DO SLEEP(5);\n':'SELECT pg_sleep(5);\n'):'');
    const req={version:1,binding:{id:crypto.randomBytes(12).toString('hex'),mode,engine,snapshotId:'a'.repeat(64),
      artifacts:[{databaseId:'db_example',database:'example_db',sha256:crypto.createHash('sha256').update(sql).digest('hex'),bytes:Buffer.byteLength(sql)}],
      createdAt:Date.now()-1000,expiresAt:0},ownerToken:crypto.randomBytes(24).toString('hex'),action:'provision',cleanupReady:false};
    req.binding.expiresAt=req.binding.createdAt+(mode==='disposable'?7200000:3600000);
    lifecycle.validate(req);write(fixture+'/case-request.json',req);
    write(fixture+'/case-source.json',{sql,variant});
    const publicDir=fixture+'/app-public';
    if(!fs.existsSync(publicDir)){fs.mkdirSync(publicDir,{mode:0o750});fs.chownSync(publicDir,0,10001);fs.chmodSync(publicDir,0o750);}
    write(publicDir+'/context.json',{id:req.binding.id,engine,mode,binding:req.binding,sql,variant},10001,0o640);
    const state=fixture+'/app-state-'+req.binding.id;fs.mkdirSync(state,{mode:0o700});fs.chownSync(state,10001,10001);
    event('synthetic_case_seeded',{engine,mode});
  }else if(action==='capability'){
    sandbox();op.tick();event('operator_capability_refreshed');
  }else if(action==='tick'){
    sandbox();op.tick();event('sandbox_tick_completed',{state:journal().state});
  }else if(action==='finish-delete'){
    sandbox();const req=request();assert.equal(req.action,'delete');assert.equal(req.cleanupReady,true);assert.equal(journal().deleting,true);
    op.driver(req).remove();event('exact_owned_deletion_finished');
  }else if(action==='cancel-provision'){
    sandbox();const req=request(),unit='pluton-lab-race-'+tag.slice(0,8)+'-'+req.binding.id+'.service';
    assert.equal(req.action,'provision');assert(!fs.existsSync(op.ROOT+'/journal/'+req.binding.id+'.json'));
    run('/usr/bin/systemd-run',['--quiet','--no-block','--collect','--unit='+unit,'--property=Type=oneshot',
      '--property=PrivateTmp=yes','--property=ProtectHome=yes','--property=NoNewPrivileges=yes','--property=UMask=0077',
      '--property=RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6','--property=LockPersonality=yes',
      '--property=TimeoutStartSec=240','--property=TimeoutStopSec=10','--property=KillMode=control-group',
      process.execPath,__filename,fixture,'tick']);
    let attempted=false;const deadline=Date.now()+60000;
    while(Date.now()<deadline){
      const file=op.ROOT+'/journal/'+req.binding.id+'.json';
      if(fs.existsSync(file)&&journal(req).attempted){attempted=true;break;}
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,20);
    }
    assert(attempted);assert.notEqual(journal(req).state,'ready');
    const output=run(process.execPath,[__filename,fixture,'app','cancel'],30000);process.stdout.write(output+'\n');
    const active=run('/usr/bin/systemctl',['show',unit,'--property=ActiveState','--value']);
    assert(['activating','active'].includes(active),'Cancellation did not overlap provisioning.');
    assert.equal(JSON.parse(fs.readFileSync(op.REQUESTS+'/'+req.binding.id+'.json','utf8')).action,'delete');
    let finished=false;
    while(Date.now()<deadline){
      const state=run('/usr/bin/systemctl',['show',unit,'--property=ActiveState','--value']);
      if(['inactive','failed'].includes(state)){finished=true;break;}
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,100);
    }
    assert(finished);assert.equal(journal(req).state,'ready');
    event('cancellation_overlapped_real_provisioning',{engine:req.binding.engine,mode:req.binding.mode,importStarted:false});
  }else if(action==='context'){
    const req=request(),m=meta(req);assert.equal(journal(req).state,'ready');
    const directory=fixture+'/app-public';if(!fs.existsSync(directory)){fs.mkdirSync(directory,{mode:0o750});fs.chownSync(directory,0,10001);}
    write(directory+'/ca.pem',fs.readFileSync(op.engineDriver(req).ROOT+'/public/'+m.id+'-ca.pem','utf8'),10001,0o640);
    write(directory+'/context.json',{id:m.id,engine:m.engine,mode:req.binding.mode,binding:req.binding,...JSON.parse(fs.readFileSync(fixture+'/case-source.json','utf8')),target:m.approval.target,
      activationId:m.approval.activationId,storageId:m.approval.storage.id,caSha256:m.approval.caSha256},10001,0o640);
    event('authorized_context_prepared',{engine:m.engine,mode:req.binding.mode});
  }else if(action==='interrupt-cleanup'){
    sandbox();const req=request(),m=meta(req),unit='pluton-lab-cleanup-'+tag.slice(0,8)+'-'+req.binding.id+'.service';
    assert.equal(req.action,'delete');assert.equal(req.cleanupReady,true);assert.equal(journal(req).state,'ready');
    run('/usr/bin/systemd-run',['--quiet','--no-block','--collect','--unit='+unit,'--property=Type=oneshot',
      '--property=PrivateTmp=yes','--property=ProtectHome=yes','--property=NoNewPrivileges=yes','--property=UMask=0077',
      '--property=RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6','--property=LockPersonality=yes',
      '--property=TimeoutStartSec=240','--property=TimeoutStopSec=10','--property=KillMode=control-group',
      process.execPath,__filename,fixture,'tick']);
    let deletion=false;const deadline=Date.now()+30000;
    while(Date.now()<deadline){
      if(meta(req).deleteIntent){deletion=true;break;}
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,1);
    }
    assert(deletion);
    const mainPid=run('/usr/bin/systemctl',['show',unit,'--property=MainPID','--value']);assert.match(mainPid,/^[1-9]\d*$/);
    run('/usr/bin/systemctl',['kill','--signal=SIGSTOP','--kill-whom=all',unit]);
    assert.match(fs.readFileSync('/proc/'+mainPid+'/status','utf8'),/^State:\s+T/m);
    assert.equal(journal(req).deleting,true);assert.notEqual(journal(req).state,'removed');
    let dispatchRace=false;
    try{run('/usr/bin/systemctl',['kill','--signal=SIGKILL','--kill-whom=all',unit]);}
    catch(error){assert.equal(error.status,1);dispatchRace=true;}
    let ended=false;
    while(Date.now()<deadline){
      const active=run('/usr/bin/systemctl',['show',unit,'--property=ActiveState','--value']);
      if(['inactive','failed'].includes(active)){ended=true;break;}
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,20);
    }
    assert(ended);assert(!fs.existsSync('/proc/'+mainPid));assert.equal(meta(req).containerId,m.containerId);
    assert.equal(run('/usr/bin/systemctl',['show',unit,'--property=MainPID','--value']),'0');
    // systemd may observe an already-killed secondary process while dispatching
    // SIGKILL to all. A nonzero dispatch is accepted ONLY with positive frozen
    // main-PID-before / absent-PID-after / inactive-unit proof, never by an error string.
    event('real_cleanup_operator_interrupted',{engine:req.binding.engine,mode:req.binding.mode,durableDeletionPreserved:true,dispatchRace});
  }else if(action==='app'){
    const phase=process.argv[4];assert(['request','import','inspect','cleanup','receipt','cancel','cancel-import','resume','stop'].includes(phase));
    const req=request(),name='pluton-lab-app-'+tag.slice(0,8)+'-'+phase;
    const mounts=[
      [fixture+'/app-public','/fixture/public','readonly'],[fixture+'/app-state-'+req.binding.id,'/fixture/state',''],
      [op.PUBLIC,'/run/pluton-automatic-recovery','readonly'],[op.REQUESTS,'/run/pluton-automatic-recovery-requests',''],
      [options.persistent.root+'/public','/run/pluton-persistent-restores','readonly'],
      [options.persistent.data+'/app-view','/run/pluton-persistent-storage','readonly,bind-propagation=rslave'],
      [op.DATA+'/disposable/app-view','/run/pluton-automatic-storage','readonly,bind-propagation=rslave'],
      [fixture+'/code/backend/dist','/app/backend/dist','readonly'],[fixture+'/code/backend/drizzle','/app/drizzle','readonly'],
      [fixture+'/code/backend/__tests__/integration/automaticRecoveryVm.smoke.mjs','/fixture-code/automaticRecoveryVm.smoke.mjs','readonly']];
    const args=['run','--rm','--init','--pull','never','--name',name,'--network',req.binding.mode==='persistent'?options.persistent.network:options.disposableNetwork,
      '--user','10001:10001','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--memory','1536m','--memory-swap','1536m',
      '--label','org.pluton.fixture='+tag,'--tmpfs','/tmp:rw,noexec,nosuid,nodev,uid=10001,gid=10001,mode=700,size=32m',
      '--tmpfs','/data:rw,noexec,nosuid,nodev,uid=10001,gid=10001,mode=700,size=16m'];
    for(const [source,target,flags] of mounts)args.push('--mount','type=bind,source='+source+',target='+target+(flags?','+flags:''));
    args.push('--entrypoint','node','pluton-persistent-ci:local','--loader','./backend/loader.mjs','/fixture-code/automaticRecoveryVm.smoke.mjs',phase);
    event('app_phase_result',{phase,result:run('docker',args,120000)});
  }else if(action==='checkpoint'){
    const m=meta();write(fixture+'/retention-checkpoint.json',{containerId:m.containerId,file:m.volume.file,identity:m.volume.identity});
    event('retained_identity_checkpointed');
  }else if(action==='verify-checkpoint'){
    const m=meta(),old=JSON.parse(fs.readFileSync(fixture+'/retention-checkpoint.json','utf8'));
    assert.deepEqual({containerId:m.containerId,file:m.volume.file,identity:m.volume.identity},old);
    op.driver(request()).inspect();event('retained_identity_unchanged');
  }else if(action==='restart-daemon'){
    assert.equal(manifest.dockerUnit,'pluton-lab-docker-'+tag+'.service');
    const m=meta(),before={containerId:m.containerId,identity:m.volume.identity};
    assert.equal(op.driver(request()).inspect().running,true);
    const command=run('/usr/bin/systemctl',['show',manifest.dockerUnit,'--property=ExecStart','--value']);
    assert(command.includes('/usr/bin/dockerd --config-file='+fixture+'/daemon.json'));
    run('/usr/bin/systemctl',['restart',manifest.dockerUnit],60000);
    assert.equal(run('/usr/bin/docker',['info','--format','{{.DockerRootDir}}']),fixture+'/docker');
    const after=meta();assert.deepEqual({containerId:after.containerId,identity:after.volume.identity},before);
    assert.equal(op.driver(request()).inspect().running,false);
    event('private_docker_restart_verified',{engine:m.engine,sameIdentity:true,explicitResumeRequired:true});
  }else if(action==='observer-start'){
    const name='pluton-lab-observer-'+tag.slice(0,8);
    const id=run('docker',['create','--pull','never','--name',name,'--network','none','--read-only','--user','10001:10001',
      '--cap-drop','ALL','--security-opt','no-new-privileges:true','--memory','128m','--memory-swap','128m','--pids-limit','32',
      '--tmpfs','/data:rw,noexec,nosuid,nodev,uid=10001,gid=10001,mode=700,size=16m',
      '--label','org.pluton.fixture='+tag,
      '--mount','type=bind,source='+options.persistent.data+'/app-view,target=/observe-retained,readonly,bind-propagation=rslave',
      '--mount','type=bind,source='+op.DATA+'/disposable/app-view,target=/observe-disposable,readonly,bind-propagation=rslave',
      '--entrypoint','node','pluton-persistent-ci:local','-e','setInterval(()=>{},1000)']);
    assert.match(id,/^[a-f0-9]{64}$/);write(fixture+'/observer.json',{id});run('docker',['start',id]);event('preexisting_app_observer_started');
  }else if(action==='observer-check'||action==='observer-remove'){
    const {id}=JSON.parse(fs.readFileSync(fixture+'/observer.json','utf8'));
    const info=JSON.parse(run('docker',['inspect',id]))[0];assert.equal(info.Id,id);assert.equal(info.Config.Labels['org.pluton.fixture'],tag);
    assert.equal(info.Config.User,'10001:10001');assert.equal(info.HostConfig.Privileged,false);
    if(action==='observer-remove'){run('docker',['stop','--time','5',id]);run('docker',['rm',id]);event('owned_observer_removed');}
    else{
      const req=request(),target=(req.binding.mode==='persistent'?'/observe-retained/':'/observe-disposable/')+req.binding.id;
      const output=run('docker',['exec','--user','10001:10001',id,'node','-e',
        'const fs=require("fs"),assert=require("assert/strict"),p=process.argv[1],a=JSON.parse(fs.readFileSync(p+"/identity.json"));assert.equal(a.restoreId,process.argv[2]);const line=fs.readFileSync("/proc/self/mountinfo","utf8").split("\\n").filter(l=>l.split(" ")[4]===p);assert.equal(line.length,1);let code;try{fs.writeFileSync(p+"/.app-write-probe","synthetic",{flag:"wx"});}catch(e){code=e.code;}assert(["EROFS","EACCES"].includes(code));console.log(JSON.stringify({anchorVisible:true,appWriteBlocked:true,kernelReadonly:line[0].split(" ")[5].split(",").includes("ro")}));',target,req.binding.id]);
      const proof=JSON.parse(output);assert.equal(proof.kernelReadonly,true);event('dynamic_app_mount_observed',proof);
    }
  }else if(action==='quota'){
    sandbox();const req=request(),m=meta(req),io=op.driver(req);io.inspect();io.stop(m);
    const filler=m.volume.mountpoint+'/data/.pluton-fixture-fill';assert(!fs.existsSync(filler));
    const before=fs.statfsSync(fixture),args=['run','--rm','--pull','never','--name','pluton-lab-enospc-'+tag.slice(0,8),
      '--network','none','--read-only','--user','999:999','--cap-drop','ALL','--security-opt','no-new-privileges:true',
      '--memory','256m','--memory-swap','256m','--cpus','1','--pids-limit','16','--label','org.pluton.fixture='+tag,
      '--mount','type=bind,source='+m.volume.mountpoint+',target=/fixture-data',
      '--mount','type=bind,source='+fixture+'/node/bin/node,target=/fixture-node,readonly',
      '--mount','type=bind,source='+fixture+'/code/scripts/automatic-recovery-vm-enospc.cjs,target=/fixture-enospc.cjs,readonly',
      '--entrypoint','/fixture-node',persistent.images[m.engine],'/fixture-enospc.cjs',m.id,m.volume.identity.storageId];
    write(fixture+'/quota-intent.json',{id:m.id,file:filler,storageId:m.volume.identity.storageId});
    const proof=JSON.parse(run('docker',args,120000));assert.equal(proof.enospc,true);
    const fileStat=fs.lstatSync(filler),disk=fs.statfsSync(m.volume.mountpoint),after=fs.statfsSync(fixture);
    assert(fileStat.isFile()&&!fileStat.isSymbolicLink());assert.equal(fileStat.uid,999);assert.equal(fileStat.nlink,1);
    assert(fileStat.size>1024**3&&fileStat.size<2147483648);assert.equal(proof.filledBytes,fileStat.size);assert(disk.bavail*disk.bsize<4096);
    assert(before.bavail*before.bsize-after.bavail*after.bsize<64*1024**2);assert(after.bavail*after.bsize>1024**3);
    fs.unlinkSync(filler);io.resume(m);
    event('real_ext4_enospc_verified',{engine:m.engine,quotaBytes:2147483648,filesystemBytes:disk.blocks*disk.bsize,
      filledBytes:fileStat.size,hostReserveProtected:true});
  }else if(action==='delete'){
    const req=request();req.action='delete';req.cleanupReady=process.argv[4]==='sql-clean';write(fixture+'/case-request.json',req);
    const tmp=op.REQUESTS+'/'+req.binding.id+'.replace';fs.writeFileSync(tmp,JSON.stringify(req),{mode:0o600,flag:'wx'});fs.chownSync(tmp,10001,10001);fs.renameSync(tmp,op.REQUESTS+'/'+req.binding.id+'.json');
    event('physical_cleanup_requested',{sqlCleanupConfirmed:req.cleanupReady});
  }else if(action==='inspect'){
    sandbox();const req=request(),m=meta(req);const checked=op.driver(req).inspect();assert.equal(checked.meta.containerId,m.containerId);
    event('exact_owned_target_inspected',{running:checked.running,state:journal().state});
  }else if(action==='ownership'){
    sandbox();const req=request(),m=meta(req),journalFile=op.ROOT+'/journal/'+m.id+'.json',receiptFile=op.PUBLIC+'/'+m.id+'.receipt.json';
    assert.equal(journal(req).state,'ready');
    const before={journal:fs.readFileSync(journalFile),receipt:fs.readFileSync(receiptFile),metadata:JSON.stringify(m)};
    const mutations=[{...req,ownerToken:crypto.randomBytes(24).toString('hex')},
      {...req,binding:{...req.binding,snapshotId:'b'.repeat(64)}},
      {...req,binding:{...req.binding,artifacts:req.binding.artifacts.map(a=>({...a,sha256:'c'.repeat(64)}))}},
      {...req,binding:{...req.binding,mode:req.binding.mode==='persistent'?'disposable':'persistent'}}];
    try{
      for(const altered of mutations){
        assert.notEqual(lifecycle.hash(altered),lifecycle.hash(req));replaceMailbox(altered);op.tick();
        assert.deepEqual(fs.readFileSync(journalFile),before.journal);assert.deepEqual(fs.readFileSync(receiptFile),before.receipt);
        assert.equal(JSON.stringify(op.engineDriver(req).metadata(req.binding.id)),before.metadata);
        assert.equal(op.driver(req).inspect().meta.containerId,m.containerId);
      }
    }finally{replaceMailbox(req);}
    event('real_ownership_substitution_refused',{engine:m.engine,mode:req.binding.mode,cases:mutations.length,originalIdentityPreserved:true});
  }else if(action==='inventory'){
    const containers=run('docker',['container','ls','--all','--no-trunc','--format','{{.ID}}']).split('\n').filter(Boolean);
    const loops=JSON.parse(run('/usr/sbin/losetup',['--json','--list','--output','NAME,BACK-FILE'])).loopdevices||[];
    const ownedLoops=loops.filter(l=>l['back-file'].startsWith(fixture+'/'));
    const mounts=fs.readFileSync('/proc/1/mountinfo','utf8').split('\n').filter(l=>l.includes(fixture+'/'));
    event('fixture_inventory',{containers:containers.length,ownedLoops:ownedLoops.length,mounts:mounts.length});
  }else throw new Error('Unsupported fixture action');
}catch(error){
  // Never print child stderr/stdout, SQL, target configs or passwords.
  const codes=new Set(['fixture-assertion-failed','lifecycle-unavailable','lifecycle-unsafe','lifecycle-binding-mismatch',
    'lifecycle-storage-unverified','lifecycle-target-not-ready','database-target-unavailable','database-tls-failed',
    'database-authentication-failed','database-client-missing','database-client-incompatible','database-import-failed',
    'database-cleanup-failed','internal-target-unsafe','recovery-target-unsafe','cancelled']);
  let childFailure;
  for(const line of String(error.stdout||'').split('\n').concat(String(error.stderr||'').split('\n'))){
    try{const item=JSON.parse(line);if(item.status==='failed'&&codes.has(item.code))childFailure={code:item.code,
      stage:['setup','request','import','inspect','cleanup','receipt','cancel','cancel-import'].includes(item.stage)?item.stage:'fixture',
      nativeStage:['database-target-preflight','database-import','database-import-validation','database-cleanup'].includes(item.nativeStage)?item.nativeStage:undefined,
      nativeKind:['query','artifact-stream'].includes(item.nativeKind)?item.nativeKind:undefined,
      ...(item.nativeFailure?{nativeFailure:{exitCode:Number.isInteger(item.nativeFailure.exitCode)?item.nativeFailure.exitCode:null,
        numericCode:/^\d{3,5}$/.test(item.nativeFailure.numericCode||'')?item.nativeFailure.numericCode:null,
        category:['client-option','missing-object','access','syntax','other'].includes(item.nativeFailure.category)?item.nativeFailure.category:'other'}}:{})};}catch{}
  }
  event('fixture_failed',{action,code:/^[a-z][a-z0-9-]{0,79}$/.test(error.code||'')?error.code:'fixture-assertion-failed',
    ...(childFailure?{childFailure}:{}),
    locations:String(error.stack||'').split('\n').filter(line=>/^\s+at /.test(line)&&/\.cjs:\d+:\d+/.test(line))
      .slice(0,5).map(line=>line.trim().replaceAll(fixture,'<fixture>'))});
  process.exitCode=1;
}
