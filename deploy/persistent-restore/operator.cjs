/* Manual root operator. No listener, Docker proxy, command shell, caller paths or arbitrary commands. */
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const defaultStorage=require('./storage.cjs');
// Factory options come ONLY from reviewed root-owned host code, never from the mailbox/API.
function createOperator(options={}){
const storage=options.storage||defaultStorage;
const PURPOSE=options.purpose||'pluton-persistent-database-restore-v1';
const ROOT=options.root||'/etc/pluton-persistent-restores';
const DATA=options.data||'/var/lib/pluton-persistent-restores';
const REQUESTS=options.requests||'/var/lib/pluton-persistent-restore-requests';
const NETWORK=options.network||'pluton-persistent-restores';
const LOCK=options.lock||'pluton-internal-recovery-lock';
const images={
  mariadb:'mariadb:11.8.8@sha256:24e76fcec8c003a0362d0dd53f4806e7e79458d7fdeaf47437760e19496f5a9c',
  postgresql:'postgres:18.6-bookworm@sha256:afc7e2d441324c0388fa80c3d24f733b4194a4eb7f47dd8ee2b08eb1a24a647c',
  mysql:'mysql:8.4.11@sha256:24989179f58856db763f418010c1169fecc944e3ec1ea7e921572d83eb070f70'
};
const idPattern=/^[a-f0-9]{24}$/;
function fail(code='operator-safety-refused'){throw Object.assign(new Error('Persistent restore operator refused.'),{code});}
function run(binary,args,timeout=60000){
  return execFileSync(binary,args,{encoding:'utf8',timeout,killSignal:'SIGKILL',maxBuffer:65536,stdio:['ignore','pipe','pipe'],
    env:{PATH:'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',LANG:'C',LC_ALL:'C',
      ...(options.automatic?{DOCKER_HOST:options.dockerSocket?'unix://'+options.dockerSocket:'unix:///var/run/docker.sock',
        DOCKER_CONFIG:options.dockerConfig||'/etc/pluton-automatic-recovery/docker-cli'}:{})}}).trim();
}
function read(file,uid=0,mode=0o600,max=65536){
  storage.rootParent(file);
  const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try {
    const stat=fs.fstatSync(fd);
    if(!stat.isFile()||stat.uid!==uid||(stat.mode&0o777)!==mode||stat.size>max)fail();
    return JSON.parse(fs.readFileSync(fd,'utf8'));
  } finally {fs.closeSync(fd);}
}
function write(file,value,gid=0,mode=0o600){
  const tmp=file+'.'+crypto.randomBytes(12).toString('hex')+'.tmp';
  const fd=fs.openSync(tmp,'wx',mode);
  try {fs.writeFileSync(fd,typeof value==='string'?value:JSON.stringify(value));fs.fchownSync(fd,0,gid);fs.fchmodSync(fd,mode);fs.fsyncSync(fd);}
  finally{fs.closeSync(fd);}
  fs.renameSync(tmp,file);
  const parent=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(parent);}finally{fs.closeSync(parent);}
}
function rootCode(file){const stat=fs.lstatSync(file);storage.rootParent(file);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.uid!==0||(stat.mode&0o022))fail();}
function init(){
  if(!fs.existsSync(ROOT)){fs.mkdirSync(ROOT,{mode:0o755});fs.chmodSync(ROOT,0o755);}
  storage.directory(ROOT,0,0,0o755);
  const marker=path.join(ROOT,'installation.json');
  if(!fs.existsSync(marker)){
    if(fs.readdirSync(ROOT).some(file=>file!=='operator.lock'))fail('unknown-operator-installation');
    write(marker,{purpose:PURPOSE,installationId:crypto.randomBytes(16).toString('hex')});
  }
  const installation=read(marker);
  if(installation.purpose!==PURPOSE||!/^[a-f0-9]{32}$/.test(installation.installationId))fail();
  for(const directory of [DATA,path.join(DATA,'images'),path.join(ROOT,'private')])storage.directory(directory);
  for(const directory of [path.join(DATA,'view'),path.join(ROOT,'public')]){
    if(!fs.existsSync(directory)){fs.mkdirSync(directory,{mode:0o750});fs.chownSync(directory,0,10001);fs.chmodSync(directory,0o750);}
    storage.directory(directory,0,10001,0o750);
  }
  if(!fs.existsSync(REQUESTS)){fs.mkdirSync(REQUESTS,{mode:0o700});fs.chownSync(REQUESTS,10001,10001);}
  storage.directory(REQUESTS,10001,10001,0o700);
  // Private mount propagation is a deployment prerequisite; never alter the host root mount.
  const mounted=storage.mounted(path.join(DATA,'view'));
  if(!mounted){
    run('/usr/bin/mount',['--bind',path.join(DATA,'view'),path.join(DATA,'view')]);
    // A new self-bind must leave its parent's peer group before becoming the
    // dedicated shared anchor, otherwise later submounts can propagate twice.
    run('/usr/bin/mount',['--make-private',path.join(DATA,'view')]);
  }
  run('/usr/bin/mount',['--make-rshared',path.join(DATA,'view')]);
  ensureNetwork();
  return installation;
}
function ensureNetwork(){
  const names=run('docker',['network','ls','--format','{{.Name}}']).split(/\r?\n/);
  if(!names.includes(NETWORK))run('docker',['network','create','--internal','--label','org.pluton.purpose='+PURPOSE,NETWORK]);
  const network=JSON.parse(run('docker',['network','inspect',NETWORK]))[0];
  if(!network.Internal||network.Labels?.['org.pluton.purpose']!==PURPOSE)fail('foreign-network');
}
function policy(){
  const file=path.join(ROOT,'public','policy.json');
  const value=fs.existsSync(file)?read(file,0,0o640,2048):{maxSqlBytes:128*1024**2,maxRetentionSeconds:86400};
  if(Object.keys(value).sort().join(',')!=='maxRetentionSeconds,maxSqlBytes'||
    !Number.isSafeInteger(value.maxSqlBytes)||value.maxSqlBytes<1||value.maxSqlBytes>448*1024**2||
    !Number.isSafeInteger(value.maxRetentionSeconds)||value.maxRetentionSeconds<86400||value.maxRetentionSeconds>30*86400)fail('operator-policy-unsafe');
  return value;
}
function validateRequest(request,id,stat){
  if(request.engine==='mysql'&&!options.automatic)fail('mysql-automatic-profile-required');
  const keys=['version','purpose','mode','action','restoreId','snapshotId','databaseId','engine','database','sha256','bytes','expiresAt','cleanupReady','targetFingerprint'];
  if(!stat.isFile()||stat.uid!==10001||(stat.mode&0o777)!==0o600||stat.size>8192||
    Object.keys(request).some(key=>!keys.includes(key))||request.version!==1||request.purpose!==PURPOSE||
    request.mode!=='internal'||request.restoreId!==id||!idPattern.test(id)||
    !['provision','stop','resume','delete'].includes(request.action)||!Object.hasOwn(images,request.engine)||
    !/^[a-f0-9]{64}$/.test(request.snapshotId)||!/^db_[A-Za-z0-9_-]{1,80}$/.test(request.databaseId)||
    !/^[a-f0-9]{64}$/.test(request.sha256)||!/^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$/.test(request.database)||
    ['mysql','sys','postgres','template0','template1','information_schema','performance_schema','pluton_recovery_guard','pluton_restore_guard'].includes(request.database.toLowerCase())||
    !Number.isSafeInteger(request.bytes)||request.bytes<=0||request.bytes>448*1024**2||
    !Number.isSafeInteger(request.expiresAt)||typeof request.cleanupReady!=='boolean'||
    (request.targetFingerprint!==null&&!/^[a-f0-9]{64}$/.test(request.targetFingerprint)))fail('request-unsafe');
  return request;
}
function request(id){
  storage.directory(REQUESTS,10001,10001,0o700);
  const file=path.join(REQUESTS,id+'.json'),fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try{const stat=fs.fstatSync(fd);if(stat.size>8192)fail();return validateRequest(JSON.parse(fs.readFileSync(fd,'utf8')),id,stat);}
  finally{fs.closeSync(fd);}
}
function bootstrapSql(engine,database,password,activation,storageId,username='restore_user'){
  if(!Object.hasOwn(images,engine)||!/^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$/.test(database)||
    !/^[a-f0-9]{64}$/.test(password)||!/^[a-f0-9]{32}$/.test(activation)||!/^[a-f0-9-]{32,36}$/.test(storageId)||
    !/^[a-z][a-z0-9_]{0,62}$/.test(username)||['root','postgres','admin','administrator'].includes(username))fail();
  if(options.bootstrapSql)return options.bootstrapSql(engine,database,password,activation,storageId,username);
  if(engine==='mariadb'||engine==='mysql')return `CREATE DATABASE pluton_restore_guard;
CREATE TABLE pluton_restore_guard.contract(purpose VARCHAR(64),activation_id VARCHAR(32),storage_id VARCHAR(36));
INSERT INTO pluton_restore_guard.contract VALUES ('${PURPOSE}','${activation}','${storageId}');
CREATE USER '${username}'@'%' IDENTIFIED BY '${password}' REQUIRE SSL;
GRANT SELECT ON pluton_restore_guard.contract TO '${username}'@'%';
GRANT ALL PRIVILEGES ON \`${database.replaceAll('_','\\_')}\`.* TO '${username}'@'%';
`;
  return `CREATE DATABASE pluton_restore_guard;
\\connect pluton_restore_guard
CREATE TABLE contract(purpose VARCHAR(64),activation_id VARCHAR(32),storage_id VARCHAR(36));
INSERT INTO contract VALUES ('${PURPOSE}','${activation}','${storageId}');
CREATE ROLE ${username} LOGIN PASSWORD '${password}' NOSUPERUSER CREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 6;
REVOKE ALL ON DATABASE pluton_restore_guard FROM PUBLIC;
GRANT CONNECT ON DATABASE pluton_restore_guard TO ${username};
GRANT USAGE ON SCHEMA public TO ${username};
GRANT SELECT ON contract TO ${username};
ALTER ROLE postgres NOLOGIN;
`;
}
function metadata(id){
  const meta=read(path.join(ROOT,'private',id,'metadata.json'));
  if(meta.id!==id||!Object.hasOwn(images,meta.engine)||meta.volume?.file!==path.join(DATA,'images',id+'.ext4')||
    meta.volume?.mountpoint!==path.join(DATA,'view',id)||meta.volume.identity?.restoreId!==id||
    meta.approval?.id!==id||meta.approval?.purpose!==PURPOSE||meta.approval?.mode!=='internal'||
    meta.approval?.storage.id!==meta.volume.identity.storageId||meta.approval.activationId!==meta.volume.identity.activationId||
    !/^[a-f0-9]{64}$/.test(meta.containerId))fail('root-metadata-unsafe');
  return meta;
}
function approvalFingerprint(approval){
  const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?
    Object.fromEntries(Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,item])=>[key,canonical(item)])):value;
  return crypto.createHash('sha256').update(JSON.stringify(canonical(approval))).digest('hex');
}
function ownership(inspect,meta){
  const config=inspect.Config||{},host=inspect.HostConfig||{},labels=config.Labels||{},mounts=inspect.Mounts||[];
  const temporary=host.Tmpfs?.['/tmp']?.split(',')||[];
  const base=meta.engine==='postgresql'?'/var/lib/postgresql':'/var/lib/mysql';
  const approved=new Map([[base,meta.volume.mountpoint],['/run/pluton-persistent-bootstrap',path.join(ROOT,'private',meta.id)],
    ['/opt/pluton-persistent/bootstrap.sh',path.join(__dirname,'bootstrap.sh')],['/run/pluton-internal-lock',LOCK]]);
  if(meta.engine==='mysql')approved.set('/opt/pluton-persistent/mysql-lock.py',path.join(__dirname,'mysql-lock.py'));
  if(options.automatic&&(labels['org.pluton.automatic.binding']!==options.bindingHash||
    labels['org.pluton.automatic.mode']!==options.mode||host.RestartPolicy?.Name!=='no'))fail('resource-ownership-mismatch');
  if(inspect.Id!==meta.containerId||!idPattern.test(meta.id)||config.Image!==images[meta.engine]||config.User!=='999:999'||
    labels['org.pluton.persistent.restore']!==meta.id||labels['org.pluton.persistent.activation']!==meta.approval.activationId||
    labels['org.pluton.persistent.storage']!==meta.approval.storage.id||labels['org.pluton.purpose']!==PURPOSE||
    host.Privileged||!host.ReadonlyRootfs||host.NetworkMode==='host'||Object.keys(host.PortBindings||{}).length||
    host.Memory!==2147483648||host.MemorySwap!==2147483648||host.NanoCpus!==1e9||host.PidsLimit!==128||
    !host.CapDrop?.includes('ALL')||!host.SecurityOpt?.some(v=>v==='no-new-privileges:true'||v==='no-new-privileges')||
    (host.CapAdd||[]).length||(host.Devices||[]).length||mounts.length!==approved.size||
    Object.keys(host.Tmpfs||{}).length!==1||temporary.length!==8||
    ['rw','noexec','nosuid','nodev','uid=999','gid=999','mode=700'].some(option=>!temporary.includes(option))||
    !temporary.some(option=>option==='size=128m'||option==='size=134217728')||
    mounts.some(m=>approved.get(m.Destination)!==(m.Type==='volume'?m.Name:m.Source)||
      (m.Destination!==base&&m.Destination!=='/run/pluton-internal-lock'&&m.RW))||
    Object.keys(inspect.NetworkSettings?.Networks||{}).length!==1||!inspect.NetworkSettings.Networks[NETWORK]||
    host.NetworkMode!==NETWORK||host.PublishAllPorts||
    JSON.stringify(config.Entrypoint)!==JSON.stringify(['/bin/bash'])||
    JSON.stringify(config.Cmd)!==JSON.stringify(['/opt/pluton-persistent/bootstrap.sh',meta.engine]))fail('resource-ownership-mismatch');
}
function state(meta,value){
  write(path.join(ROOT,'public',meta.id+'.state.json'),{purpose:PURPOSE,restoreId:meta.id,
    snapshotId:meta.request.snapshotId,activationId:meta.approval.activationId,storageId:meta.approval.storage.id,
    containerId:meta.containerId,state:value,observedAt:Date.now()},10001,0o640);
}
function publish(meta){
  const file=path.join(ROOT,'private',meta.id,'ca.pem');rootCode(file);
  const ca=fs.readFileSync(file);
  if(crypto.createHash('sha256').update(ca).digest('hex')!==meta.approval.caSha256)fail('target-tls-failed');
  // Re-publish an already verified identity after a readiness interruption.
  // This reuses the exact stored credentials/CA; it never bootstraps or rotates.
  write(path.join(ROOT,'public',meta.id+'-ca.pem'),ca.toString('utf8'),10001,0o640);
  write(path.join(ROOT,'public',meta.id+'.json'),meta.approval,10001,0o640);state(meta,'active');
}
function inspect(meta){const value=JSON.parse(run('docker',['inspect',meta.containerId]))[0];ownership(value,meta);return value;}
function bindRequest(meta,req){
  if(req.snapshotId!==meta.request.snapshotId||req.sha256!==meta.request.sha256||req.databaseId!==meta.request.databaseId||
    req.engine!==meta.engine||req.database!==meta.request.database||req.expiresAt!==meta.request.expiresAt||
    req.targetFingerprint!==(meta.fingerprint||approvalFingerprint(meta.approval)))
    fail('request-binding-mismatch');
}
/** Host-only, bounded ancestor traversal. No path/environment/request can select
 * another cgroup. A constrained parent cannot masquerade as the whole host. */
function resourceCapacity(){
  const text=fs.readFileSync('/proc/meminfo','utf8'),field=name=>Number(new RegExp('^'+name+':\\s+(\\d+) kB$','m').exec(text)?.[1])*1024;
  let pressure=Number(/^some avg10=(\d+(?:\.\d+)?)/m.exec(fs.readFileSync('/proc/pressure/memory','utf8'))?.[1]);
  const member=/^0::([^\n]+)$/m.exec(fs.readFileSync('/proc/self/cgroup','utf8'))?.[1];
  if(!member||!member.startsWith('/')||member.includes('..')||/[\0\r\\]/.test(member))fail('resource-admission-refused');
  const base='/sys/fs/cgroup';let directory=path.resolve(base,'.'+member),depth=0;
  if(directory!==base&&!directory.startsWith(base+'/'))fail('resource-admission-refused');
  let total=field('MemTotal'),available=field('MemAvailable'),cpuAvailable=require('node:os').availableParallelism(),cgroupSwap=0;
  for(;;){
    if(++depth>32)fail('resource-admission-refused');
    const read=name=>{try{return fs.readFileSync(path.join(directory,name),'utf8').trim();}catch(error){if(directory===base&&error.code==='ENOENT')return null;throw error;}};
    const limit=read('memory.max');
    if(limit!==null){
      const currentText=read('memory.current'),swapText=read('memory.swap.current');
      if(!/^\d+$/.test(currentText)||!/^\d+$/.test(swapText))fail('resource-admission-refused');
      const current=Number(currentText),swap=Number(swapText);
      if(!Number.isFinite(current)||current<0||!Number.isFinite(swap)||swap<0)fail('resource-admission-refused');
      cgroupSwap=Math.max(cgroupSwap,swap);
      const localPressure=Number(/^some avg10=(\d+(?:\.\d+)?)/m.exec(read('memory.pressure'))?.[1]);
      if(!Number.isFinite(localPressure))fail('resource-admission-refused');pressure=Math.max(pressure,localPressure);
      if(limit!=='max'){
        const maximum=Number(limit);if(!/^\d+$/.test(limit)||!Number.isFinite(maximum)||maximum<=0)fail('resource-admission-refused');
        total=Math.min(total,maximum);available=Math.min(available,Math.max(0,maximum-current));
      }
    }
    const cpu=read('cpu.max');
    if(cpu!==null){const parts=cpu.split(/\s+/);if(parts.length!==2||!/^\d+$/.test(parts[1])||Number(parts[1])<=0)fail('resource-admission-refused');
      if(parts[0]!=='max'){if(!/^\d+$/.test(parts[0])||Number(parts[0])<=0)fail('resource-admission-refused');cpuAvailable=Math.min(cpuAvailable,Number(parts[0])/Number(parts[1]));}}
    if(directory===base)break;directory=path.dirname(directory);
  }
  const images=path.join(DATA,'images');storage.rootParent(images);const st=fs.lstatSync(images);
  if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==0||st.mode&0o022)fail('resource-admission-refused');
  const disk=fs.statfsSync(images),sample={total,available,swapUsed:field('SwapTotal')-field('SwapFree'),cgroupSwap,pressure,cpuAvailable,diskAvailable:disk.bavail*disk.bsize};
  if(Object.values(sample).some(value=>!Number.isFinite(value)||value<0))fail('resource-admission-refused');
  return sample;
}
function resourceAdmission(bytes,engine){
  const text=fs.readFileSync('/proc/meminfo','utf8'),field=name=>Number(new RegExp('^'+name+':\\s+(\\d+) kB$','m').exec(text)?.[1])*1024;
  const pressure=Number(/^some avg10=(\d+(?:\.\d+)?)/m.exec(fs.readFileSync('/proc/pressure/memory','utf8'))?.[1]);
  if(!Number.isFinite(field('MemAvailable'))||!Number.isFinite(pressure)||field('MemTotal')<3800*1024**2||
    field('MemAvailable')<(engine==='mysql'?2944:2560)*1024**2||field('SwapTotal')-field('SwapFree')>128*1024**2||pressure>1||
    bytes*4+256*1024**2>2*1024**3)fail('resource-admission-refused');
  if(engine==='mysql'){
    const sample=resourceCapacity();
    if(sample.total<3800*1024**2||sample.available<2944*1024**2||sample.swapUsed>128*1024**2||sample.cgroupSwap>0||sample.pressure>1)fail('resource-admission-refused');
    if(sample.cpuAvailable<2)fail('resource-cpu-insufficient');
    if(sample.diskAvailable<1024**3)fail('resource-disk-insufficient');
  }
}
function classifyReadinessFailure(stderr){
  if(/1045|access denied|password authentication failed/i.test(stderr))return 'target-authentication-failed';
  if(/TLS\/SSL|certificate verif|server certificate/i.test(stderr))return 'target-tls-failed';
  if(/200[2356]|can't connect|connection refused|could not translate host|connection timed out|database system is starting up/i.test(stderr))return null;
  return 'target-readiness-failed';
}
function nativeReady(meta){
  const privatePath='/run/pluton-persistent-bootstrap';
  const password=meta.approval.target.password,host=meta.approval.target.host;
  const directory=path.join(ROOT,'private',meta.id);
  const pg=meta.engine==='postgresql';
  const file=path.join(directory,pg?'ready.pgpass':'ready.cnf');
  write(file,pg?host+':5432:'+(options.disposable?'pluton_recovery_guard':'pluton_restore_guard')+':restore_user:'+password+'\n':
    '[client]\nhost='+host+'\nport=3306\nuser=restore_user\npassword='+password+
    (meta.engine==='mysql'?'\nssl-mode=VERIFY_IDENTITY\n':'\nssl=ON\nssl-verify-server-cert=ON\n')+'ssl-ca='+privatePath+'/ca.pem\n',999,0o640);
  // pgpass must be 0600 and readable as the native UID, not passed via PGPASSWORD.
  if(pg){fs.chownSync(file,999,999);fs.chmodSync(file,0o600);}
  const expected=[PURPOSE,meta.approval.activationId,meta.approval.storage.id].join('|');
  const end=Date.now()+45000;
  let waitingReported=false;
  try{
    while(Date.now()<end){
      const current=inspect(meta);if(!current.State.Running)fail(current.State.OOMKilled?'target-memory-exhausted':'target-process-stopped');
      try{
        const common=['exec','--user','999:999'];
        const guard=options.disposable?'pluton_recovery_guard':'pluton_restore_guard';
        const sql='SELECT purpose,activation_id,storage_id FROM '+(options.disposable?'pluton_recovery_guard':'contract')+';';
        const args=pg?[...common,'-e','PGPASSFILE='+privatePath+'/ready.pgpass','-e','PGSSLMODE=verify-full',
          '-e','PGSSLROOTCERT='+privatePath+'/ca.pem','-e','PGCONNECT_TIMEOUT=2','-e','PGOPTIONS=-c statement_timeout=2000',
          meta.containerId,'psql','-X','--no-password','--no-psqlrc','--quiet','--host',host,'--username','restore_user',
          '--dbname',guard,'--tuples-only','--no-align','--set','ON_ERROR_STOP=1','--command',sql]
          :[...common,meta.containerId,meta.engine==='mysql'?'mysql':'mariadb','--defaults-file='+privatePath+'/ready.cnf','--batch','--raw',
            '--skip-column-names','--connect-timeout=2','--database='+guard,'--execute',sql];
        const output=run('docker',args,5000).split(/[|\t]/).join('|');
        if(output!==expected)fail('target-purpose-mismatch');
        return;
      }catch(error){
        if(error.code==='target-purpose-mismatch')throw error;
        // Classify locally; never expose native provider output or credentials.
        const stderr=String(error.stderr||'');
        const code=classifyReadinessFailure(stderr);if(code)fail(code);
        if(options.automatic&&!waitingReported){
          process.stderr.write(JSON.stringify({event:'native_recovery_target_waiting',engine:meta.engine,category:'connection-not-ready'})+'\n');
          waitingReported=true;
        }
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,250);
    }
    fail('target-readiness-timeout');
  }finally{if(fs.existsSync(file))fs.unlinkSync(file);}
}
function provision(req){
  const approved=policy();
  if(req.action!=='provision'||req.expiresAt<=Date.now()||req.expiresAt>Date.now()+approved.maxRetentionSeconds*1000)fail('request-expired');
  if(req.bytes>approved.maxSqlBytes)fail('operator-sql-budget');
  rootCode(path.join(__dirname,'bootstrap.sh'));resourceAdmission(req.bytes,req.engine);
  if(req.engine==='mysql'){
    if(!options.automatic)fail('mysql-automatic-profile-required');
    rootCode(path.join(__dirname,'mysql-lock.py'));
    const version=run('docker',['run','--rm','--pull','never','--network','none','--read-only','--user','999:999',
      '--cap-drop','ALL','--security-opt','no-new-privileges:true','--memory','128m','--pids-limit','16',
      '--tmpfs','/var/lib/mysql:rw,noexec,nosuid,nodev,uid=999,gid=999,mode=700,size=1m',
      '--entrypoint','mysqld',images.mysql,'--version']);
    if(!/Ver 8\.4\.11\b.*MySQL Community Server/.test(version)||/MariaDB/i.test(version))fail('target-engine-incompatible');
  }
  const directory=path.join(ROOT,'private',req.restoreId);
  if(fs.existsSync(directory)){
    const previous=metadata(req.restoreId);
    if(req.snapshotId!==previous.request.snapshotId||req.sha256!==previous.request.sha256||
      req.databaseId!==previous.request.databaseId||previous.removed)fail('existing-provisioning-retained');
    storage.resume(previous.volume);const current=inspect(previous);
    if(!current.State.Running)run('docker',['start',previous.containerId]);
    nativeReady(previous);
    publish(previous);return;
  }
  fs.mkdirSync(directory,{mode:0o750});fs.chownSync(directory,0,999);fs.chmodSync(directory,0o750);
  const activation=crypto.randomBytes(16).toString('hex'),password=crypto.randomBytes(32).toString('hex');
  write(path.join(directory,'intent.json'),{purpose:PURPOSE,request:req,activation});
  const volume=storage.create(path.join(DATA,'images'),path.join(DATA,'view'),req.restoreId,activation);
  const host='persistent-db-'+req.restoreId;
  const certificateDays=String(Math.ceil(approved.maxRetentionSeconds/86400)+2);
  run('openssl',['req','-x509','-newkey','rsa:3072','-nodes','-sha256','-days',certificateDays,'-subj','/CN=Pluton Persistent Restore CA',
    '-keyout',path.join(ROOT,'private',req.restoreId+'-ca.key'),'-out',path.join(directory,'ca.pem')]);
  run('openssl',['req','-new','-newkey','rsa:3072','-nodes','-subj','/CN='+host,'-keyout',path.join(directory,'server.key'),'-out',path.join(directory,'server.csr')]);
  write(path.join(directory,'server.ext'),'subjectAltName=DNS:'+host+'\nextendedKeyUsage=serverAuth\n');
  run('openssl',['x509','-req','-in',path.join(directory,'server.csr'),'-CA',path.join(directory,'ca.pem'),'-CAkey',path.join(ROOT,'private',req.restoreId+'-ca.key'),
    '-set_serial','0x'+activation,'-days',certificateDays,'-sha256','-extfile',path.join(directory,'server.ext'),'-out',path.join(directory,'server.pem')]);
  for(const file of ['ca.pem','server.pem','server.key']){fs.chownSync(path.join(directory,file),0,999);fs.chmodSync(path.join(directory,file),0o640);}
  write(path.join(directory,'identity.json'),fs.readFileSync(path.join(volume.mountpoint,'identity.json'),'utf8'),999,0o640);
  write(path.join(directory,'bootstrap.sql'),bootstrapSql(req.engine,req.database,password,activation,volume.identity.storageId),999,0o640);
  const ca=fs.readFileSync(path.join(directory,'ca.pem'));
  const approval={version:1,id:req.restoreId,purpose:PURPOSE,mode:'internal',activationId:activation,engine:req.engine,database:req.database,
    target:{engine:req.engine,host,port:req.engine==='postgresql'?5432:3306,username:'restore_user',tls:'verify-identity',enabled:true,dedicated:true,password},
    caSha256:crypto.createHash('sha256').update(ca).digest('hex'),...approved,
    storage:{id:volume.identity.storageId,quotaBytes:volume.identity.quotaBytes,kind:'fixed-ext4'},
    binding:{restoreId:req.restoreId,snapshotId:req.snapshotId,sha256:req.sha256}};
  ensureNetwork();
  // A fixed approved control profile is shared by the two native engine bootstraps.
  let fresh=false;
  if(options.automatic){
    const names=run('docker',['volume','ls','--format','{{.Name}}']).split(/\r?\n/);
    if(!names.includes(LOCK)){
      run('docker',['volume','create','--label','org.pluton.automatic.installation='+options.installationId,LOCK]);fresh=true;
    }
  }else{
    try{run('docker',['volume','inspect',LOCK]);}catch{run('docker',['volume','create',LOCK]);fresh=true;}
  }
  let lockInfo;
  if(options.automatic){
    lockInfo=JSON.parse(run('docker',['volume','inspect',LOCK]))[0];
    if(lockInfo.Labels?.['org.pluton.automatic.installation']!==options.installationId||
      lockInfo.Driver!=='local'||Object.keys(lockInfo.Options||{}).length||lockInfo.Scope!=='local')fail('foreign-control-volume');
  }
  if(options.automatic){
    // Host operator only: no temporary root container, even to prepare the lock.
    const dockerRoot=run('docker',['info','--format','{{.DockerRootDir}}']);
    if(!path.isAbsolute(dockerRoot)||lockInfo.Mountpoint!==path.join(dockerRoot,'volumes',LOCK,'_data'))fail('foreign-control-volume');
    storage.rootParent(lockInfo.Mountpoint);
    if(fresh){
      const stat=fs.lstatSync(lockInfo.Mountpoint);
      if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==0||fs.readdirSync(lockInfo.Mountpoint).length)fail('foreign-control-volume');
      fs.chownSync(lockInfo.Mountpoint,999,999);fs.chmodSync(lockInfo.Mountpoint,0o700);
    }
    storage.directory(lockInfo.Mountpoint,999,999,0o700);
  }else if(fresh)run('docker',['run','--rm','--network','none','--read-only','--user','0:0','--mount','type=volume,source='+LOCK+',target=/lock',
    '--entrypoint','/bin/sh',images[req.engine],'-ec','chown 999:999 /lock && chmod 700 /lock']);
  const base=req.engine==='postgresql'?'/var/lib/postgresql':'/var/lib/mysql';
  const containerId=run('docker',['create',...(options.automatic?['--pull','never','--restart','no',
    '--label','org.pluton.automatic.binding='+options.bindingHash,'--label','org.pluton.automatic.mode='+options.mode]:[]),
    '--init','--name','pluton-persistent-'+req.restoreId,'--network',NETWORK,'--network-alias',host,
    '--hostname',host,'--user','999:999','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true',
    '--memory','2g','--memory-swap','2g','--cpus','1','--pids-limit','128',
    '--label','org.pluton.purpose='+PURPOSE,'--label','org.pluton.persistent.restore='+req.restoreId,
    '--label','org.pluton.persistent.activation='+activation,'--label','org.pluton.persistent.storage='+volume.identity.storageId,
    '--tmpfs','/tmp:rw,noexec,nosuid,nodev,uid=999,gid=999,mode=700,size=128m',
    '--mount','type=bind,source='+volume.mountpoint+',target='+base,
    '--mount','type=bind,source='+directory+',target=/run/pluton-persistent-bootstrap,readonly',
    '--mount','type=bind,source='+path.join(__dirname,'bootstrap.sh')+',target=/opt/pluton-persistent/bootstrap.sh,readonly',
    ...(req.engine==='mysql'?['--mount','type=bind,source='+path.join(__dirname,'mysql-lock.py')+',target=/opt/pluton-persistent/mysql-lock.py,readonly']:[]),
    '--mount','type=volume,source='+LOCK+',target=/run/pluton-internal-lock',
    '--entrypoint','/bin/bash',images[req.engine],'/opt/pluton-persistent/bootstrap.sh',req.engine]);
  if(!/^[a-f0-9]{64}$/.test(containerId))fail();
  approval.containerId=containerId;
  const meta={id:req.restoreId,engine:req.engine,containerId,volume,approval,request:req,fingerprint:approvalFingerprint(approval)};
  write(path.join(directory,'metadata.json'),meta);
  inspect(meta);options.stage?.('starting-database');
  // Recheck AFTER preallocation/certificates, immediately before initialization.
  // An interrupted/denied creation keeps its exact metadata for reconciliation.
  if(req.engine==='mysql')resourceAdmission(req.bytes,req.engine);
  run('docker',['start',containerId]);nativeReady(meta);
  publish(meta);
}
function containerPresent(meta){
  return run('docker',['container','ls','--all','--no-trunc','--filter','id='+meta.containerId,'--format','{{.ID}}'])
    .split(/\r?\n/).includes(meta.containerId);
}
function deleteOwned(meta,req){
  if(req.action!=='delete'||!req.cleanupReady)fail('database-cleanup-not-verified');
  if(!meta.deleteIntent){
    inspect(meta);storage.resume(meta.volume);
    meta.deleteIntent=true;write(path.join(ROOT,'private',meta.id,'metadata.json'),meta);
  }
  if(containerPresent(meta)){
    const current=inspect(meta);
    if(current.State.Running)run('docker',['stop','--time','30',meta.containerId]);
    if(inspect(meta).State.Running)fail();
    // Native owned-database cleanup has already been attested by Pluton.
    run('docker',['rm',meta.containerId]);
  }
  if(containerPresent(meta))fail('container-removal-unverified');
  // The durable root intent permits recovery across unmount/rmdir/unlink crash boundaries.
  storage.remove(meta.volume,true);
  meta.removed=true;write(path.join(ROOT,'private',meta.id,'metadata.json'),meta);
  state(meta,'removed');
  // After verified physical deletion, erase exact no-longer-needed credential files; retain non-secret audit binding.
  for(const file of [path.join(ROOT,'public',meta.id+'.json'),path.join(ROOT,'private',meta.id,'bootstrap.sql'),
    path.join(ROOT,'private',meta.id,'server.key'),path.join(ROOT,'private',meta.id+'-ca.key')]){
    if(fs.existsSync(file)){
      storage.rootParent(file);const stat=fs.lstatSync(file);
      if(!stat.isFile()||stat.isSymbolicLink()||stat.uid!==0||(stat.mode&0o022))fail('credential-cleanup-unsafe');
      fs.unlinkSync(file);
    }
  }
  delete meta.approval.target.password;write(path.join(ROOT,'private',meta.id,'metadata.json'),meta);
}
function verifyNeverProvisioned(req){
  const id=req.restoreId;
  if(req.action!=='delete'||req.cleanupReady||req.targetFingerprint!==null||
    fs.existsSync(path.join(ROOT,'private',id))||fs.existsSync(path.join(DATA,'images',id+'.ext4'))||
    fs.existsSync(path.join(DATA,'view',id))||storage.mounted(path.join(DATA,'view',id)))fail('unprovisioned-absence-uncertain');
  if(options.appView&&(fs.existsSync(path.join(options.appView,id))||storage.mounted(path.join(options.appView,id))))
    fail('unprovisioned-absence-uncertain');
  // Daemon/command failure is an error, never an empty inventory.
  if(run('docker',['container','ls','--all','--no-trunc','--filter','label=org.pluton.persistent.restore='+id,'--format','{{.ID}}']))
    fail('unprovisioned-absence-uncertain');
  write(path.join(ROOT,'public',id+'.absent.json'),{purpose:PURPOSE,restoreId:id,snapshotId:req.snapshotId,
    sha256:req.sha256,state:'never-provisioned',observedAt:Date.now()},10001,0o640);
}
function customApproval(id){
  if(!idPattern.test(id))fail('custom-approval-unsafe');
  const approval=read(path.join(ROOT,'private',id+'.candidate.json'));
  const target=approval.target||{},store=approval.storage||{};
  if(Object.keys(approval).some(key=>!['version','id','purpose','mode','activationId','engine','database','target','caSha256','maxSqlBytes','maxRetentionSeconds','storage'].includes(key))||
    Object.keys(target).some(key=>!['engine','host','port','username','tls','enabled','dedicated','password'].includes(key))||
    Object.keys(store).some(key=>!['id','kind','quotaBytes'].includes(key)))fail('custom-approval-unsafe');
  if(approval.version!==1||approval.id!==id||approval.purpose!==PURPOSE||approval.mode!=='custom'||
    !Object.hasOwn(images,approval.engine)||target.engine!==approval.engine||target.tls!=='verify-identity'||
    target.enabled!==true||target.dedicated!==true||typeof target.host!=='string'||target.host.length>253||
    !/^(?:[A-Za-z0-9][A-Za-z0-9.:-]*|::1)$/.test(target.host)||!Number.isSafeInteger(target.port)||target.port<1||target.port>65535||
    !/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(target.username)||['root','postgres','admin','administrator'].includes(target.username.toLowerCase())||
    typeof target.password!=='string'||!target.password||/[\0\r\n]/.test(target.password)||
    !/^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$/.test(approval.database)||
    !/^[a-f0-9]{32}$/.test(approval.activationId)||store.kind!=='operator-approved-external'||
    !/^[a-f0-9-]{32,36}$/.test(store.id)||store.quotaBytes<512*1024**2||store.quotaBytes>2*1024**3||
    approval.maxSqlBytes<1||approval.maxSqlBytes>448*1024**2||approval.maxRetentionSeconds<86400||
    approval.maxRetentionSeconds>30*86400||approval.binding||approval.containerId)fail('custom-approval-unsafe');
  if(![store.quotaBytes,approval.maxSqlBytes,approval.maxRetentionSeconds].every(Number.isSafeInteger)||
    ['mysql','sys','postgres','template0','template1','information_schema','performance_schema','pluton_recovery_guard','pluton_restore_guard'].includes(approval.database.toLowerCase()))
    fail('custom-approval-unsafe');
  const caFile=path.join(ROOT,'private',id+'-ca.pem');storage.rootParent(caFile);
  const stat=fs.lstatSync(caFile);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.uid!==0||(stat.mode&0o777)!==0o600||stat.size>16384)fail('custom-ca-unsafe');
  const ca=fs.readFileSync(caFile);
  if(crypto.createHash('sha256').update(ca).digest('hex')!==approval.caSha256)fail('custom-ca-mismatch');
  return {approval,ca};
}
function approveCustom(id){
  if(fs.existsSync(path.join(ROOT,'public',id+'.json')))fail('approval-already-exists');
  const {approval,ca}=customApproval(id);
  // Registration is explicit operator attestation, not provisioning or an automatic SQL mutation.
  write(path.join(ROOT,'public',id+'-ca.pem'),ca.toString('utf8'),10001,0o640);
  write(path.join(ROOT,'public',id+'.json'),approval,10001,0o640);
}
function operate(action,id){
  if(!idPattern.test(id))fail();
  if(action==='approve-custom'){approveCustom(id);return;}
  if(action==='prepare-custom'){
    const {approval}=customApproval(id),file=path.join(ROOT,'private',id+'.bootstrap.sql');
    if(fs.existsSync(file))fail('private-bootstrap-already-exists');
    const sql=bootstrapSql(approval.engine,approval.database,approval.target.password,approval.activationId,approval.storage.id,approval.target.username);
    const descriptor=fs.openSync(file,'wx',0o600);
    try{fs.writeFileSync(descriptor,sql);fs.fsyncSync(descriptor);}finally{fs.closeSync(descriptor);}
    return;
  }
  const req=request(id);
  if(action==='provision'){provision(req);return;}
  if(action==='delete'&&!fs.existsSync(path.join(ROOT,'private',id,'metadata.json'))){verifyNeverProvisioned(req);return;}
  const meta=metadata(id);bindRequest(meta,req);
  if(action==='delete'){deleteOwned(meta,req);return;}
  if(meta.removed||meta.deleteIntent)fail('restore-deletion-in-progress');
  storage.resume(meta.volume);
  const current=inspect(meta);
  if(action==='stop'){
    if(req.action!=='stop')fail();
    if(current.State.Running)run('docker',['stop','--time','30',meta.containerId]);
    if(inspect(meta).State.Running)fail();state(meta,'stopped');
  }else if(action==='resume'){
    if(req.action!=='resume'||req.expiresAt<=Date.now())fail('request-expired');
    resourceAdmission(req.bytes);
    if(!current.State.Running)run('docker',['start',meta.containerId]);
    nativeReady(meta);state(meta,'active');
  }else if(action==='resume-cleanup'){
    if(req.action!=='delete')fail();resourceAdmission(req.bytes);
    if(!current.State.Running)run('docker',['start',meta.containerId]);nativeReady(meta);state(meta,'active');
  }else if(action==='status'){
    if(current.State.Running)nativeReady(meta);
    state(meta,current.State.Running?'active':'stopped');
  }else fail();
}
return {PURPOSE,images,validateRequest,bootstrapSql,ownership,approvalFingerprint,approveCustom,
  init,provision,metadata,inspect,nativeReady,state,publish,bindRequest,deleteOwned,containerPresent,
  read,write,resourceAdmission,resourceCapacity,rootCode,verifyNeverProvisioned,policy,ROOT,DATA,NETWORK,operate,fail,classifyReadinessFailure};
}
module.exports={...createOperator(),createOperator};
if(require.main===module){
  const {ROOT,read,write,rootCode,init,operate,fail}=module.exports;
  try{
    if(process.platform!=='linux'||process.getuid()!==0||Number(process.versions.node.split('.')[0])<20)fail('root-linux-node20-required');
    rootCode(__filename);rootCode(path.join(__dirname,'storage.cjs'));
    // Serialize all root lifecycle actions. A delete/absence receipt cannot race an old provisioning request.
    if(process.env.PLUTON_PERSISTENT_OPERATOR_LOCKED!=='1'){
      if(!fs.existsSync(ROOT))fs.mkdirSync(ROOT,{mode:0o755});
      storage.directory(ROOT,0,0,0o755);
      const lock=path.join(ROOT,'operator.lock');
      const descriptor=fs.openSync(lock,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_NOFOLLOW,0o600);
      const stat=fs.fstatSync(descriptor);fs.closeSync(descriptor);
      if(!stat.isFile()||stat.uid!==0||(stat.mode&0o777)!==0o600)fail('operator-lock-unsafe');
      try{
        const output=execFileSync('/usr/bin/flock',['--exclusive','--nonblock',lock,process.execPath,__filename,...process.argv.slice(2)],
          {encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:4096,
            env:{PATH:'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',LANG:'C',LC_ALL:'C',PLUTON_PERSISTENT_OPERATOR_LOCKED:'1'}});
        process.stdout.write(output);
      }catch{fail('operator-locked-or-operation-refused');}
      process.exit(0);
    }
    const [action,id,...extra]=process.argv.slice(2);
    if(action==='set-policy'&&extra.length===1){
      read(path.join(ROOT,'installation.json'));
      const value={maxSqlBytes:Number(id),maxRetentionSeconds:Number(extra[0])};
      if(!Number.isSafeInteger(value.maxSqlBytes)||value.maxSqlBytes<1||value.maxSqlBytes>448*1024**2||
        !Number.isSafeInteger(value.maxRetentionSeconds)||value.maxRetentionSeconds<86400||value.maxRetentionSeconds>30*86400)fail('operator-policy-unsafe');
      write(path.join(ROOT,'public','policy.json'),value,10001,0o640);
    }else{
      if(extra.length)fail();
      if(action==='init'&&!id)init();else{read(path.join(ROOT,'installation.json'));operate(action,id);}
    }
    process.stdout.write(JSON.stringify({event:'persistent_restore_operator',action,status:'verified'})+'\n');
  }catch(error){process.stderr.write(JSON.stringify({event:'persistent_restore_operator_refused',code:error.code||'operator-operation-failed'})+'\n');process.exitCode=1;}
}
