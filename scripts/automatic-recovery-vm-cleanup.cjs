'use strict';
// Root-only cleanup for the dedicated, positively identified disposable VM.
// Never a production operator action, Docker prune, or wildcard host deletion.
const fs=require('node:fs'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const fixture=process.argv[2],phase=process.argv[3];
assert.equal(process.getuid(),0);assert.equal(process.platform,'linux');
assert.match(fixture,/^\/srv\/pluton-fixture\/lifecycle-lab-[a-f0-9]{32}$/);
assert.equal(fs.realpathSync(fixture),fixture);
const rootStat=fs.lstatSync(fixture);assert.equal(rootStat.uid,0);assert.equal(rootStat.mode&0o777,0o755);
assert.equal(fs.readlinkSync('/proc/self/ns/mnt'),fs.readlinkSync('/proc/1/ns/mnt'));
const env={PATH:'/usr/sbin:/usr/bin:/sbin:/bin',LANG:'C',LC_ALL:'C',
  DOCKER_HOST:'unix://'+fixture+'/docker.sock',DOCKER_CONFIG:fixture+'/docker-client'};
const run=(file,args,timeout=60000)=>execFileSync(file,args,{env,encoding:'utf8',timeout,killSignal:'SIGKILL',
  maxBuffer:1048576,stdio:['ignore','pipe','pipe']}).trim();
function read(file){
  const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try{const st=fs.fstatSync(fd);assert(st.isFile());assert.equal(st.uid,0);assert.equal(st.nlink,1);assert.equal(st.mode&0o777,0o600);
    assert(st.size<65536);return JSON.parse(fs.readFileSync(fd,'utf8'));}finally{fs.closeSync(fd);}
}
const manifest=read(fixture+'/manifest.json'),tag=manifest.scope;
// Config digest in the checksum-verified docker-save manifest.json. The source
// containerd store exposes its OCI index ID instead; the VM classic store uses
// this config ID. Verify the exact config, never accept the mutable tag alone.
const runtimeConfigId='sha256:12f4747e4c563b01a2ce974cd9829a9f704335480583da8994be0b20e612b44a';
assert.equal(manifest.version,1);assert.equal(manifest.purpose,'disposable-lifecycle-rehearsal');assert.equal(fixture.split('-').at(-1),tag);
assert.equal(manifest.dockerUnit,'pluton-lab-docker-'+tag+'.service');
if(manifest.containerdUnit)assert.equal(manifest.containerdUnit,'pluton-lab-containerd-'+tag+'.service');
function record(name,values={}){
  const line=JSON.stringify({event:name,...values})+'\n';fs.appendFileSync(fixture+'/evidence.ndjson',line,{mode:0o600});process.stdout.write(line);
}
function mounts(){
  const decode=value=>value.replace(/\\(040|011|012|134)/g,(_,x)=>String.fromCharCode(parseInt(x,8)));
  return fs.readFileSync('/proc/1/mountinfo','utf8').trim().split('\n').map(line=>{
    const [left,right]=line.split(' - '),fields=left.split(' ');
    return {target:decode(fields[4]),root:decode(fields[3]),device:fields[2],fstype:right.split(' ')[0]};
  });
}
function noLoops(){
  const loops=JSON.parse(run('/usr/sbin/losetup',['--json','--list','--output','NAME,BACK-FILE'])).loopdevices||[];
  assert(!loops.some(value=>String(value['back-file']).startsWith(fixture+'/')));
}
function stopped(unit){
  const output=run('/usr/bin/systemctl',['show',unit,'--property=MainPID,ActiveState,LoadState']);
  const properties=Object.fromEntries(output.split('\n').map(line=>{const i=line.indexOf('=');return [line.slice(0,i),line.slice(i+1)];}));
  assert(['inactive','failed'].includes(properties.ActiveState));assert.equal(properties.MainPID,'0');
}
function bootUnits(){
  const file=fixture+'/boot-units.json';if(!fs.existsSync(file))return null;
  const units=read(file),prefix='pluton-lab-boot-'+tag;
  const allowed=new Set([manifest.dockerUnit,manifest.containerdUnit,...['anchors.service','application.service','lifecycle.service','lifecycle.timer'].map(n=>prefix+'-'+n),
    manifest.dockerUnit+'.d/50-'+prefix+'.conf']);
  for(const root of [fixture+'/retained/data',fixture+'/automatic/data/disposable'])
    for(const plane of ['view','app-view','readonly-stage'])allowed.add(run('/usr/bin/systemd-escape',['--path','--suffix=mount','--',root+'/'+plane]));
  assert.deepEqual(Object.keys(units).sort(),[...allowed].sort());
  for(const [name,hash] of Object.entries(units)){
    const p='/etc/systemd/system/'+name,stat=fs.lstatSync(p);assert(stat.isFile()&&!stat.isSymbolicLink());
    assert.equal(stat.uid,0);assert.equal(stat.mode&0o777,0o644);assert.equal(crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'),hash);
  }
  return units;
}
function removeApiFixture(){
  const api=fixture+'/api';if(!fs.existsSync(api))return;
  const ids=read(api+'/containers.json'),volume=read(api+'/volume.json').name,prefix='pluton-lab-boot-'+tag;
  assert.equal(volume,'pluton-lab-api-'+tag);bootUnits();
  // Read-only SQLite assertion inside the genuine application UID; never dump
  // credentials or mark rows/leases clean from a host assumption.
  const proof=JSON.parse(execFileSync('docker',['exec','--interactive',ids.app,'node','-'],{env,encoding:'utf8',timeout:15000,
    stdio:['pipe','pipe','pipe'],input:"const D=require('node:module').createRequire('/app/backend/package.json')('better-sqlite3');const d=new D('/data/db/pluton.db',{readonly:true,fileMustExist:true});d.pragma('query_only=ON');console.log(JSON.stringify({retained:d.prepare(\"SELECT count(*) n FROM persistent_database_restores WHERE status!='deleted'\").get().n,recovery:d.prepare(\"SELECT count(*) n FROM recovery_tests WHERE status NOT IN ('passed','passed_with_warning','failed','cancelled')\").get().n,leases:d.prepare('SELECT count(*) n FROM recovery_import_leases').get().n+persistent(),lifecycle:d.prepare(\"SELECT count(*) n FROM automatic_recovery_lifecycle WHERE state!='removed'\").get().n}));function persistent(){return d.prepare('SELECT count(*) n FROM persistent_restore_import_leases').get().n}d.close();"}));
  assert.deepEqual(proof,{retained:0,recovery:0,leases:0,lifecycle:0});
  if(fs.existsSync(api+'/browser-unit.json')){
    const unit=read(api+'/browser-unit.json').unit;assert.equal(unit,prefix+'-browser.service');
    const command=run('/usr/bin/systemctl',['show',unit,'--property=ExecStart','--value']);
    assert(command.includes(fixture+'/code/scripts/automatic-recovery-vm-browser.cjs '+fixture));
    run('/usr/bin/systemctl',['stop',unit]);stopped(unit);
  }
  run('/usr/bin/systemctl',['stop',prefix+'-lifecycle.timer',prefix+'-application.service',prefix+'-lifecycle.service']);
  for(const id of Object.values(ids)){
    assert.match(id,/^[a-f0-9]{64}$/);const c=JSON.parse(run('docker',['inspect',id]))[0];
    assert.equal(c.Config.Labels['org.pluton.fixture'],tag);assert.equal(c.Image,runtimeConfigId);
    assert.equal(c.Config.User,'10001:10001');assert.equal(c.HostConfig.Privileged,false);assert.equal(c.State.Running,false);
    const data=c.Mounts.find(m=>m.Destination==='/data');assert.equal(data.Type,'volume');
    if(id===ids.app)assert.equal(data.Name,volume);
    else{
      assert.match(data.Name,/^[a-f0-9]{64}$/);const v=JSON.parse(run('docker',['volume','inspect',data.Name]))[0];
      assert.deepEqual(v.Labels,{'com.docker.volume.anonymous':''});
      assert.equal(v.Mountpoint,fixture+'/docker/volumes/'+data.Name+'/_data');
      assert.deepEqual(fs.readdirSync(v.Mountpoint).sort(),['config','db','logs','progress','rescue','stats','sync']);
      for(const n of fs.readdirSync(v.Mountpoint))assert.deepEqual(fs.readdirSync(v.Mountpoint+'/'+n),[]);
    }
    run('docker',['rm',id]);
    if(id===ids.sftp)run('docker',['volume','rm',data.Name]);
  }
  const v=JSON.parse(run('docker',['volume','inspect',volume]))[0];assert.equal(v.Labels['org.pluton.fixture'],tag);
  assert.equal(v.Mountpoint,fixture+'/docker/volumes/'+volume+'/_data');run('docker',['volume','rm',volume]);
  run('/usr/bin/systemctl',['disable',manifest.dockerUnit,prefix+'-lifecycle.timer']);
  record('api_fixture_removed_after_verified_cleanup',{retained:0,recoveryActive:0,leases:0,lifecycleActive:0,containers:0});
}
try{
  assert.equal(run('/usr/bin/systemd-detect-virt',['--vm']),'kvm');
  if(phase==='resources'){
    assert.equal(run('docker',['info','--format','{{.DockerRootDir}}']),fixture+'/docker');
    const roots=[fixture+'/retained/data',fixture+'/automatic/data/disposable'];
    const journals=fs.readdirSync(fixture+'/automatic/config/journal');
    for(const name of journals){assert.match(name,/^[a-f0-9]{24}\.json$/);assert.equal(read(fixture+'/automatic/config/journal/'+name).state,'removed');}
    assert.equal(fs.readdirSync(fixture+'/automatic/requests').length,0);
    removeApiFixture();
    for(const root of roots)for(const directory of ['images','view','app-view','readonly-stage'])assert.deepEqual(fs.readdirSync(root+'/'+directory),[]);
    // Only the recorded non-root observer may still exist; never force-remove a database.
    const ids=run('docker',['container','ls','--all','--no-trunc','--format','{{.ID}}']).split('\n').filter(Boolean);
    if(ids.length){
      assert.equal(ids.length,1);const observer=read(fixture+'/observer.json');assert.equal(ids[0],observer.id);
      const c=JSON.parse(run('docker',['inspect',observer.id]))[0];
      assert.equal(c.Config.Labels['org.pluton.fixture'],tag);assert.equal(c.Config.User,'10001:10001');assert.equal(c.HostConfig.Privileged,false);
      if(c.State.Running)run('docker',['stop','--time','5',observer.id]);run('docker',['rm',observer.id]);
    }
    assert.equal(run('docker',['container','ls','--all','--quiet']),'');
    const volume='pluton-lab-lock-'+tag,volumes=run('docker',['volume','ls','--quiet']).split('\n').filter(Boolean);
    const anonymous=volumes.filter(name=>name!==volume);
    if(anonymous.length){
      // Earlier observer versions inherited the runtime image's VOLUME /data.
      // Prove the isolated fresh daemon, exact observer count, automatic-volume
      // label, creation window and untouched image skeleton; never adopt data.
      const events=fs.readFileSync(fixture+'/evidence.ndjson','utf8').trim().split('\n').map(line=>JSON.parse(line));
      assert.equal(anonymous.length,events.filter(e=>e.event==='preexisting_app_observer_started').length);
      const image=JSON.parse(run('docker',['image','inspect','pluton-persistent-ci:local']))[0];
      assert.equal(image.Id,runtimeConfigId);
      assert.deepEqual(Object.keys(image.Config.Volumes),['/data']);
      for(const name of anonymous){
        assert.match(name,/^[a-f0-9]{64}$/);const a=JSON.parse(run('docker',['volume','inspect',name]))[0];
        assert.equal(a.Driver,'local');assert.deepEqual(a.Labels,{'com.docker.volume.anonymous':''});assert(!a.Options);
        assert.equal(a.Mountpoint,fixture+'/docker/volumes/'+name+'/_data');assert.equal(fs.realpathSync(a.Mountpoint),a.Mountpoint);
        assert(Date.parse(a.CreatedAt)>=fs.statSync(fixture+'/manifest.json').mtimeMs-1000);
        assert(Date.parse(a.CreatedAt)<=Date.now());
        assert.deepEqual(fs.readdirSync(a.Mountpoint).sort(),['config','db','logs','progress','rescue','stats','sync']);
        for(const entry of fs.readdirSync(a.Mountpoint)){
          const p=a.Mountpoint+'/'+entry,s=fs.lstatSync(p);assert(s.isDirectory()&&!s.isSymbolicLink());
          assert.equal(s.uid,10001);assert.equal(s.gid,10001);assert.equal(s.mode&0o777,0o755);assert.deepEqual(fs.readdirSync(p),[]);
        }
      }
      fs.writeFileSync(fixture+'/teardown-anonymous-volumes.json',JSON.stringify({scope:tag,volumes:anonymous}),{mode:0o600,flag:'wx'});
      for(const name of anonymous)run('docker',['volume','rm',name]);
      record('untouched_observer_image_volumes_removed',{count:anonymous.length});
    }
    assert.deepEqual(run('docker',['volume','ls','--quiet']).split('\n').filter(Boolean),[volume]);
    const v=JSON.parse(run('docker',['volume','inspect',volume]))[0];
    assert.equal(v.Driver,'local');assert.equal(v.Labels['org.pluton.automatic.installation'],read(fixture+'/automatic/config/installation.json').installationId);
    assert(!v.Options||Object.keys(v.Options).length===0);assert.equal(v.Mountpoint,fixture+'/docker/volumes/'+volume+'/_data');
    run('docker',['volume','rm',volume]);
    for(const [network,purpose] of [['pluton-lab-retained-'+tag,'pluton-persistent-database-restore-v1'],['pluton-lab-tests-'+tag,'pluton-phase6-recovery-only']]){
      const n=JSON.parse(run('docker',['network','inspect',network]))[0];assert.equal(n.Internal,true);assert.equal(n.Labels['org.pluton.purpose'],purpose);
      assert.equal(Object.keys(n.Containers||{}).length,0);run('docker',['network','rm',network]);
    }
    assert(run('docker',['network','ls','--format','{{.Name}}']).split('\n').every(name=>['none','host','bridge'].includes(name)));
    const {images}=require('../deploy/persistent-restore/operator.cjs');
    const expected=[...new Set(Object.values(images).map(image=>JSON.parse(run('docker',['image','inspect',image]))[0].Id))];
    const runtime=JSON.parse(run('docker',['image','inspect','pluton-persistent-ci:local']))[0];
    assert.equal(runtime.Id,runtimeConfigId);expected.push(runtime.Id);
    const actual=[...new Set(run('docker',['image','ls','--all','--quiet','--no-trunc']).split('\n').filter(Boolean))];
    assert.deepEqual(actual.sort(),expected.sort());for(const id of expected)run('docker',['image','rm','--force',id]);
    assert.equal(run('docker',['image','ls','--all','--quiet']),'');assert.equal(run('docker',['volume','ls','--quiet']),'');noLoops();
    const anchors=roots.flatMap(root=>['readonly-stage','app-view','view'].map(name=>root+'/'+name));
    const owned=mounts().filter(m=>m.target===fixture||m.target.startsWith(fixture+'/'));
    assert.deepEqual(owned.map(m=>m.target).sort(),[...anchors].sort());
    const disk=mounts().filter(m=>m.target==='/srv/pluton-fixture');assert.equal(disk.length,1);assert.equal(disk[0].fstype,'ext4');
    for(const target of anchors){
      const found=owned.filter(m=>m.target===target);assert.equal(found.length,1);assert.equal(found[0].fstype,'ext4');
      assert.equal(found[0].device,disk[0].device);assert.equal(found[0].root,target.slice('/srv/pluton-fixture'.length));
      run('/usr/bin/umount',['--',target]);
    }
    assert.equal(mounts().filter(m=>m.target.startsWith(fixture+'/')).length,0);noLoops();
    fs.writeFileSync(fixture+'/teardown-proof.json',JSON.stringify({version:1,scope:tag,resourcesRemoved:true,journals:journals.length}),{mode:0o600,flag:'wx'});
    record('test_resources_removed',{journals:journals.length,containers:0,volumes:0,networks:0,images:0,mounts:0,loops:0,diskImages:0});
  }else if(phase==='boot-units'){
    const proof=read(fixture+'/teardown-proof.json');assert.equal(proof.scope,tag);assert.equal(proof.resourcesRemoved,true);
    stopped(manifest.dockerUnit);stopped(manifest.containerdUnit);
    const units=bootUnits();assert(units);assert.equal(mounts().filter(m=>m.target.startsWith(fixture+'/')).length,0);noLoops();
    run('/usr/bin/systemctl',['stop','pluton-lab-boot-'+tag+'-anchors.service']);
    for(const name of Object.keys(units))fs.unlinkSync('/etc/systemd/system/'+name);
    const dropin='/etc/systemd/system/'+manifest.dockerUnit+'.d';assert.deepEqual(fs.readdirSync(dropin),[]);fs.rmdirSync(dropin);
    run('/usr/bin/systemctl',['daemon-reload']);
    for(const name of Object.keys(units))assert(!fs.existsSync('/etc/systemd/system/'+name));
    writeBootProof();record('owned_persistent_boot_units_removed',{units:Object.keys(units).length});
  }else if(['finalize','failed-bootstrap','remove'].includes(phase)){
    if(phase!=='failed-bootstrap'&&manifest.containerdUnit){
      const proof=read(fixture+'/teardown-proof.json');assert.equal(proof.scope,tag);assert.equal(proof.resourcesRemoved,true);
      assert.equal(proof.version,1);assert(manifest.containerdUnit);
    }else{
      // Only an interrupted, pre-install bootstrap can use this path.
      assert.equal(manifest.containerdUnit,undefined);assert(!fs.existsSync(fixture+'/automatic'));assert(!fs.existsSync(fixture+'/retained'));
      assert(['failed-bootstrap','remove'].includes(phase));
    }
    stopped(manifest.dockerUnit);if(manifest.containerdUnit)stopped(manifest.containerdUnit);
    if(fs.existsSync(fixture+'/boot-units.json'))assert.equal(read(fixture+'/boot-cleanup-proof.json').scope,tag);
    assert.equal(mounts().filter(m=>m.target===fixture||m.target.startsWith(fixture+'/')).length,0);noLoops();
    for(const pid of fs.readdirSync('/proc').filter(name=>/^\d+$/.test(name)&&Number(name)!==process.pid)){
      let value;try{value=fs.readFileSync('/proc/'+pid+'/cmdline','utf8');}catch(error){if(['ENOENT','ESRCH'].includes(error.code))continue;throw error;}
      assert(!value.includes(fixture+'/'),'Fixture process still running; retain files.');
    }
    // Refuse an unexpected top-level entry rather than deleting an unknown resource.
    const reviewedArchives=new Set(['allocprobe.tar','appfixture.tar','backend-ro.tar','code-update.tar','fullfixture.tar','iofix.tar',
      'nsfix.tar','observer.tar','permfix.tar','quota-tail.tar','readonly.tar','republish.tar','ro-cleanup.tar','ro-seed.tar','safe-diag.tar','sessionfix.tar','source.tar']);
    for(const name of fs.readdirSync(fixture))assert(reviewedArchives.has(name)||/^(?:automatic|retained|code|inbox|node|docker|docker-run|docker-client|containerd-data|containerd-run|tmp|api|agent-tmp|agent-tests\.log|bootstrap-code|boot-units\.json|boot-cleanup-proof\.json|boot-daemons\.log|pull-mariadb\.log|pull-postgresql\.log|app-public|app-state-[a-f0-9]{24}|manifest\.json|daemon\.json|containerd\.toml|docker\.log|containerd\.log|docker-root\.txt|evidence\.ndjson|teardown-proof\.json|teardown-anonymous-volumes\.json|host-cleanup-proof\.json|case-request\.json|case-source\.json|retention-checkpoint\.json|observer\.json|quota-intent\.json|probe-intent\.json|probe-volume\.json|node-v24\.16\.0-linux-x64\.tar\.xz|pluton-lifecycle-[A-Za-z0-9-]+\.tar)$/.test(name),'Unknown fixture entry; retain for operator review.');
    if(phase==='remove'){
      const proof=read(fixture+'/host-cleanup-proof.json');assert.equal(proof.scope,tag);assert.equal(proof.absenceVerified,true);
      fs.rmSync(fixture,{recursive:true});assert(!fs.existsSync(fixture));
      process.stdout.write(JSON.stringify({event:'exact_verified_fixture_removed',containers:0,mounts:0,loops:0,diskImages:0})+'\n');
      process.exit(0);
    }
    fs.writeFileSync(fixture+'/host-cleanup-proof.json',JSON.stringify({scope:tag,absenceVerified:true}),{mode:0o600,flag:'wx'});
    record('host_cleanup_verified',{containers:0,mounts:0,loops:0,diskImages:0,privateDaemonsStopped:true});
    // Export only the sanitized event journal, never SQLite, SQL, credentials or root metadata.
    const evidence=fixture+'/inbox/rehearsal-evidence.ndjson',inbox=fs.lstatSync(fixture+'/inbox');
    assert(inbox.isDirectory()&&!inbox.isSymbolicLink());assert.notEqual(inbox.uid,0);
    if(fs.existsSync(fixture+'/evidence.ndjson')){fs.copyFileSync(fixture+'/evidence.ndjson',evidence,fs.constants.COPYFILE_EXCL);fs.chownSync(evidence,inbox.uid,inbox.gid);fs.chmodSync(evidence,0o600);}
    process.stdout.write('PASS resources absent; preserve sanitized evidence, then remove only this exact verified fixture directory.\n');
  }else throw new Error('Unknown cleanup phase');
}catch(error){
  // No raw subprocess output or error data may escape this root fixture.
  process.stderr.write(JSON.stringify({event:'fixture_cleanup_refused',phase,
    locations:String(error.stack||'').split('\n').filter(line=>/^\s+at /.test(line)&&/\.cjs:\d+:\d+/.test(line)).slice(0,3)})+'\n');process.exitCode=1;
}
function writeBootProof(){fs.writeFileSync(fixture+'/boot-cleanup-proof.json',JSON.stringify({scope:tag,unitsAbsent:true}),{mode:0o600,flag:'wx'});}
