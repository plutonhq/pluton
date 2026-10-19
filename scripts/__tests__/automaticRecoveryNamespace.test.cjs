const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {approvedTarget,parseMountInfo,assertViews,assertPrivateSeedClone,validateUnit}=require('../../deploy/automatic-recovery/systemdStorage.cjs');
const {classifyReadinessFailure}=require('../../deploy/persistent-restore/operator.cjs');
const id='a'.repeat(24),point='/srv/example-fixture/retained/view/'+id,file='/srv/example-fixture/retained/images/'+id+'.ext4';
const profiles=[{images:'/srv/example-fixture/retained/images',view:'/srv/example-fixture/retained/view'},
  {images:'/srv/example-fixture/disposable/images',view:'/srv/example-fixture/disposable/view'}];
const line=(device='7:0',options='rw,nosuid,nodev,noexec',target=point)=>
  '114 28 '+device+' / '+target+' '+options+' shared:12 - ext4 /dev/loop0 rw\n';
test('mount source/target pairs are derived from fixed host profiles and exact IDs, never mailbox paths',()=>{
  assert.equal(approvedTarget(profiles,file,point),id);
  for(const [source,target] of [[file,point+'/child'],[file.replace(id,'../'+id),point],[file,'/'],
    [file,point.replace('retained','disposable')],[file.replace('.ext4','.img'),point]])
    assert.throws(()=>approvedTarget(profiles,source,target),{code:'operator-mount-unverified'});
});
test('private operator namespace is valid only when host, operator and Docker see the same protected ext4',()=>{
  const mount=parseMountInfo(line(),point);assert.doesNotThrow(()=>assertViews([mount,mount,mount]));
  for(const changed of [null,{...mount,device:'7:1'},{...mount,fstype:'tmpfs'},{...mount,root:'/subdir'},
    {...mount,source:'/dev/sdb1'},{...mount,options:['rw','nosuid','nodev']}])
    assert.throws(()=>assertViews([mount,changed,mount]),{code:'operator-mount-unverified'});
});
test('absent, escaped and stacked mount entries cannot be mistaken for the verified target',()=>{
  assert.equal(parseMountInfo(line(),point+'/absent'),null);
  assert.equal(parseMountInfo(line('7:0','rw,nosuid,nodev,noexec','/srv/with\\040space'),'/srv/with space').target,'/srv/with space');
  assert.throws(()=>parseMountInfo(line()+line('7:1'),point));
  assert.throws(()=>parseMountInfo(line().replace('7:0','invalid'),point));
});
test('cleanup may detach only its own verified stale RO seed clone, never a host or foreign filesystem',()=>{
  const source=parseMountInfo(line(),point),local={...source,options:['ro','nosuid','nodev','noexec']};
  assert.doesNotThrow(()=>assertPrivateSeedClone(local,source,'mnt:[2]','mnt:[1]'));
  assert.throws(()=>assertPrivateSeedClone(local,source,'mnt:[1]','mnt:[1]'));
  assert.throws(()=>assertPrivateSeedClone({...local,device:'7:9'},source,'mnt:[2]','mnt:[1]'));
  assert.throws(()=>assertPrivateSeedClone({...local,options:['rw','nosuid','nodev','noexec']},source,'mnt:[2]','mnt:[1]'));
  assert.throws(()=>assertPrivateSeedClone(local,null,'mnt:[2]','mnt:[1]'));
});
test('only the exact transient PID-1 mount unit with fixed safe options is accepted',()=>{
  const unit={LoadState:'loaded',Transient:'yes',What:file,Where:point,Type:'ext4',
    Description:'Pluton owned recovery ext4 '+id,Options:'loop,nodev,nosuid,noexec'};
  assert.doesNotThrow(()=>validateUnit(unit,file,point,id));
  for(const patch of [{Transient:'no'},{What:'/dev/sdb1'},{Where:'/'},{Type:'tmpfs'},
    {Description:'foreign unit'},{Options:'loop,nodev,nosuid,noexec,exec'},{Options:'loop,nodev,nosuid'}])
    assert.throws(()=>validateUnit({...unit,...patch},file,point,id));
  const mounted={...unit,What:'/dev/loop0',Options:'rw,nosuid,nodev,noexec,relatime'};
  assert.throws(()=>validateUnit(mounted,file,point,id));
  assert.throws(()=>validateUnit(mounted,file,point,id,'/srv/unrelated.ext4'));
  assert.doesNotThrow(()=>validateUnit(mounted,file,point,id,file));
  const readonlyPoint=point.replace('/view/','/app-view/');
  const readonly={...mounted,Where:readonlyPoint,Description:'Pluton owned recovery readonly '+id,Options:'ro,nosuid,nodev,noexec,relatime'};
  assert.doesNotThrow(()=>validateUnit(readonly,file,readonlyPoint,id,file,point));
  assert.throws(()=>validateUnit({...readonly,Options:'rw,nosuid,nodev,noexec,relatime'},file,readonlyPoint,id,file,point));
  assert.throws(()=>validateUnit({...readonly,What:'/dev/loop9'},file,readonlyPoint,id,'/unrelated.img',point));
});
test('a dynamically propagated app mount must be cloned from the already-readonly private seed',()=>{
  const seed=point.replace('/view/','/readonly-stage/'),published=point.replace('/view/','/app-view/');
  const unit={LoadState:'loaded',Transient:'yes',What:point,Where:seed,Type:'none',
    Description:'Pluton owned recovery readonly-seed '+id,Options:'bind,ro,nodev,nosuid,noexec'};
  assert.doesNotThrow(()=>validateUnit(unit,file,seed,id,undefined,point,'readonly-seed'));
  const clone={...unit,What:seed,Where:published,Description:'Pluton owned recovery readonly '+id,Options:'bind'};
  assert.doesNotThrow(()=>validateUnit(clone,file,published,id,undefined,seed));
  assert.throws(()=>validateUnit({...clone,What:point},file,published,id,undefined,seed));
  const writable=parseMountInfo(line(),point),readonly={...writable,options:['ro','nosuid','nodev','noexec']};
  assert.doesNotThrow(()=>assertViews([readonly,readonly,readonly],true));
  assert.throws(()=>assertViews([readonly,writable,readonly],true));
  const source=fs.readFileSync('deploy/automatic-recovery/systemdStorage.cjs','utf8');
  assert.match(source,/--options=bind,ro,nodev,nosuid,noexec/);assert.match(source,/--options=bind'/);
  assert.match(source,/readonlyStage,false/);assert.match(source,/readonlyView,true/);
});
test('disposable VM teardown refuses unknown resources and rechecks absence before deleting only its exact fixture root',()=>{
  const source=fs.readFileSync('scripts/automatic-recovery-vm-cleanup.cjs','utf8');
  assert.match(source,/lifecycle-lab-\[a-f0-9\]\{32\}/);assert.match(source,/fs\.realpathSync\(fixture\),fixture/);
  assert.match(source,/\.state,'removed'/);assert.match(source,/original|org\.pluton\.fixture/);
  assert.match(source,/noLoops\(\)/);assert.match(source,/host-cleanup-proof\.json/);
  assert.match(source,/fs\.rmSync\(fixture,\{recursive:true\}\)/);
  assert.doesNotMatch(source,/\['(?:system|image|volume|network)',\s*'prune'/);
});
function findmnt(invoke){
  const context={require:name=>name==='node:child_process'?{execFileSync:invoke}:require(name),module:{exports:{}}};
  vm.runInNewContext(fs.readFileSync('deploy/persistent-restore/storage.cjs','utf8'),context);
  return context.module.exports.mounted;
}
test('findmnt no-match is absence, but timeouts/access/parse failures fail closed rather than overmounting',()=>{
  const error=values=>Object.assign(new Error('synthetic private command failure'),values);
  assert.equal(findmnt(()=>{throw error({status:1,stdout:'',stderr:''});})(point),null);
  for(const result of [error({status:1,stderr:'permission denied'}),error({status:null,code:'ETIMEDOUT'}),
    error({status:2}),error({status:1,stdout:'invalid'})])assert.throws(()=>findmnt(()=>{throw result;})(point));
  for(const output of ['not json','{}','{"filesystems":[]}','{"filesystems":[{},{}]}'])
    assert.throws(()=>findmnt(()=>output)(point));
  assert.equal(findmnt(()=>JSON.stringify({filesystems:[{target:point}]}))(point).target,point);
});
test('namespace solution retains sandbox and has no namespace escape or generic command interface',()=>{
  const service=fs.readFileSync('deploy/automatic-recovery/pluton-recovery-lifecycle.service','utf8');
  assert.match(service,/PrivateTmp=true/);assert.match(service,/ProtectHome=true/);assert.match(service,/NoNewPrivileges=true/);
  const source=fs.readFileSync('deploy/automatic-recovery/systemdStorage.cjs','utf8');
  assert.doesNotMatch(source,/run\([^\n]*['"](?:nsenter|sh|bash)['"]|shell\s*:\s*true/);
  assert.match(source,/systemd-mount/);assert.match(source,/--automount=no/);assert.match(source,/\/proc\/1\/mountinfo/);
  assert.match(source,/ownedUnit\(properties/);assert.match(source,/assertViews\(views/);
  const operator=fs.readFileSync('deploy/persistent-restore/operator.cjs','utf8');
  assert.match(operator,/--make-private/);assert.match(operator,/--make-rshared/);
});
test('new storage anchor, underlying mount directory and credential directory normalize only intended modes despite restrictive umask',()=>{
  const source=fs.readFileSync('deploy/persistent-restore/storage.cjs','utf8');
  assert.match(source,/fs\.fchmodSync\(anchor,0o444\)/);assert.match(source,/fs\.chmodSync\(mountpoint,0o755\)/);
  assert.match(source,/O_NOFOLLOW,0o444/);
  const operator=fs.readFileSync('deploy/persistent-restore/operator.cjs','utf8');
  assert.match(operator,/fs\.chownSync\(directory,0,999\);fs\.chmodSync\(directory,0o750\)/);
  assert.doesNotMatch(source+operator,/chmodSync\([^\n]+0o777/);
});
test('PostgreSQL startup Connection refused is retryable; authentication, TLS and unknown failures stay terminal',()=>{
  for(const value of ['connection to server failed: Connection refused','connection refused','FATAL: the database system is starting up',"ERROR 2002: Can't connect"])
    assert.equal(classifyReadinessFailure(value),null);
  assert.equal(classifyReadinessFailure('FATAL: password authentication failed'),'target-authentication-failed');
  assert.equal(classifyReadinessFailure('ERROR 1045 Access denied'),'target-authentication-failed');
  assert.equal(classifyReadinessFailure('SSL error: server certificate verification failed'),'target-tls-failed');
  assert.equal(classifyReadinessFailure('permission denied'),'target-readiness-failed');
});
