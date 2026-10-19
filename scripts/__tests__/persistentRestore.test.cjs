const assert=require('node:assert/strict'),test=require('node:test'),fs=require('node:fs'),path=require('node:path');
const operator=require('../../deploy/persistent-restore/operator.cjs');
const root=path.join(__dirname,'../..');
const request={version:1,purpose:operator.PURPOSE,mode:'internal',action:'provision',restoreId:'a'.repeat(24),snapshotId:'b'.repeat(64),
  databaseId:'db_example',engine:'mariadb',database:'example_db',sha256:'c'.repeat(64),bytes:8*1024**2,
  expiresAt:Date.now()+3600000,cleanupReady:false,targetFingerprint:null};
const stat={isFile:()=>true,uid:10001,mode:0o600,size:1000};
test('operator accepts bounded exact snapshot requests, not caller paths, commands or unsupported engines',()=>{
  assert.doesNotThrow(()=>operator.validateRequest(request,request.restoreId,stat));
  for(const patch of [{engine:'mysql'},{mode:'custom'},{database:'postgres'},{purpose:'pluton-phase6-recovery-only'},{snapshotId:'latest'},
    {bytes:512*1024**2},{action:'exec'},{path:'/data'},{sql:'DROP DATABASE'},{targetFingerprint:'x'}])
    assert.throws(()=>operator.validateRequest({...request,...patch},request.restoreId,stat));
  assert.throws(()=>operator.validateRequest(request,request.restoreId,{...stat,mode:0o644}));
});
test('persistent bootstraps keep an independent purpose/guard, constrained roles and no global MySQL grants',()=>{
  for(const engine of ['mariadb','postgresql']){
    const sql=operator.bootstrapSql(engine,'example_db','d'.repeat(64),'e'.repeat(32),'f'.repeat(32)+'-fff');
    assert(sql.includes(operator.PURPOSE));assert(sql.includes('pluton_restore_guard'));
    assert(!sql.includes('pluton-phase6-recovery-only'));assert(!sql.includes('GRANT ALL PRIVILEGES ON *.*'));
    if(engine==='postgresql')for(const flag of ['NOSUPERUSER','NOCREATEROLE','NOREPLICATION','NOBYPASSRLS','postgres NOLOGIN'])assert(sql.includes(flag));
    else {assert(sql.includes('example\\_db'));assert(sql.includes('REQUIRE SSL'));}
  }
});
test('runtime overlay adds no Docker socket, target service, host port or privileged application',()=>{
  const overlay=fs.readFileSync(path.join(root,'deploy/compose.persistent-restore.yml'),'utf8');
  assert(!/docker\.sock|privileged:|ports:|\/data:/.test(overlay));assert(overlay.includes('read_only: true'));
  assert(overlay.includes('propagation: rslave'));assert(overlay.includes('external: true'));
  const source=fs.readFileSync(path.join(root,'deploy/persistent-restore/operator.cjs'),'utf8');
  assert(source.includes('--nonblock'));assert(source.includes('deleteIntent'));assert(source.includes('containerPresent'));
  assert(source.includes('nativeReady(meta)'));assert(source.includes('verifyNeverProvisioned'));
  assert(!/shell:\s*true|['"]-p['"]|MYSQL_PWD|PGPASSWORD=/.test(source));
});
test('persistent storage preallocates and verifies owned ext4 instead of tmpfs or an unbounded named DB volume',()=>{
  const source=fs.readFileSync(path.join(root,'deploy/persistent-restore/storage.cjs'),'utf8');
  for(const guard of ['fallocate','nodiscard','O_EXCL','O_NOFOLLOW','identity.uuid','identity.storageId','stat.blocks*512','nodev','nosuid','noexec','deletionIntent'])assert(source.includes(guard));
  assert(!/chmod.*777|chown.*10001/.test(source));
});
test('data initialization is not repeated on a retained database restart',()=>{
  const boot=fs.readFileSync(path.join(root,'deploy/persistent-restore/bootstrap.sh'),'utf8');
  assert(boot.includes('! -d "$data/mysql"'));assert(boot.includes('! -f "$data/PG_VERSION"'));
  assert(boot.includes('cmp --silent'));assert(boot.includes('flock -n'));
  assert(!/rm -rf|docker|forget|prune|unlock/.test(boot));assert(boot.includes('--tmpdir=/tmp'));
});
test('physical deletion refuses changed identity, port, mount, capability or temp resource profiles',()=>{
  const id='a'.repeat(24),activation='b'.repeat(32),storageId='c'.repeat(32),containerId='d'.repeat(64);
  const meta={id,engine:'mariadb',containerId,volume:{mountpoint:'/var/lib/pluton-persistent-restores/view/'+id},
    approval:{activationId:activation,storage:{id:storageId}}};
  const inspect={Id:containerId,Config:{Image:operator.images.mariadb,User:'999:999',Entrypoint:['/bin/bash'],
    Cmd:['/opt/pluton-persistent/bootstrap.sh','mariadb'],Labels:{'org.pluton.purpose':operator.PURPOSE,
      'org.pluton.persistent.restore':id,'org.pluton.persistent.activation':activation,'org.pluton.persistent.storage':storageId}},
    HostConfig:{ReadonlyRootfs:true,Memory:2147483648,MemorySwap:2147483648,NanoCpus:1e9,PidsLimit:128,
      CapDrop:['ALL'],SecurityOpt:['no-new-privileges:true'],NetworkMode:'pluton-persistent-restores',
      Tmpfs:{'/tmp':'rw,noexec,nosuid,nodev,uid=999,gid=999,mode=700,size=128m'}},
    NetworkSettings:{Networks:{'pluton-persistent-restores':{}}},
    Mounts:[{Destination:'/var/lib/mysql',Source:meta.volume.mountpoint,Type:'bind',RW:true},
      {Destination:'/run/pluton-persistent-bootstrap',Source:path.join('/etc/pluton-persistent-restores','private',id),Type:'bind',RW:false},
      {Destination:'/opt/pluton-persistent/bootstrap.sh',Source:path.join(root,'deploy/persistent-restore/bootstrap.sh'),Type:'bind',RW:false},
      {Destination:'/run/pluton-internal-lock',Name:'pluton-internal-recovery-lock',Type:'volume',RW:true}]};
  assert.doesNotThrow(()=>operator.ownership(inspect,meta));
  for(const patch of [{Privileged:true},{CapAdd:['SYS_ADMIN']},{PortBindings:{'3306/tcp':[{}]}},{Memory:0},
    {Tmpfs:{'/tmp':'rw,size=8g'}},{NetworkMode:'host'}])
    assert.throws(()=>operator.ownership({...inspect,HostConfig:{...inspect.HostConfig,...patch}},meta));
  assert.throws(()=>operator.ownership({...inspect,Id:'e'.repeat(64)},meta));
  assert.throws(()=>operator.ownership({...inspect,Mounts:[...inspect.Mounts,{Destination:'/data',Source:'/data',Type:'bind',RW:true}]},meta));
});
