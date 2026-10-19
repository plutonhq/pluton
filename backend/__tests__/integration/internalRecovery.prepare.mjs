// Disposable root-only fixture preparation, no Docker socket/host data/network.
import fs from 'node:fs';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
const {bootstrapSql,cleanupRequest}=createRequire(import.meta.url)('/fixture-operator.cjs');
const [engine,variant='normal',action='prepare']=process.argv.slice(2);
if(!['mariadb','postgresql'].includes(engine) || !['normal','marker','existing','tls','restart'].includes(variant) || process.getuid()!==0) throw new Error('invalid isolated fixture');
function write(file,text,uid=0,gid=10001,mode=0o640) {fs.writeFileSync(file,text,{mode});fs.chownSync(file,uid,gid);fs.chmodSync(file,mode);}
if(action==='receipt') {
  const state=JSON.parse(fs.readFileSync('/public/state.json','utf8'));
  const stat=fs.statSync('/requests/request.json'); const request=JSON.parse(fs.readFileSync('/requests/request.json','utf8'));
  cleanupRequest(request,state,stat);
  const receipt={...state,status:'removed',testId:request.testId,snapshotId:request.snapshotId};
  write(`/public/removed-${state.activationId}.json`,JSON.stringify(receipt));
  // Simulate the next activation publishing its state before the old application job tick.
  write('/public/state.json',JSON.stringify({...state,activationId:'f'.repeat(32),status:'active'}));
  console.log('PASS exact infrastructure removal receipt');
} else {
  fs.chownSync('/public',0,10001);fs.chmodSync('/public',0o750);
  fs.chownSync('/requests',10001,10001);fs.chmodSync('/requests',0o700);
  fs.chownSync('/lock',999,999);fs.chmodSync('/lock',0o700);
  const run=args=>execFileSync('openssl',args,{stdio:'pipe'});
  run(['req','-x509','-newkey','rsa:2048','-nodes','-days','2','-subj','/CN=Disposable internal fixture CA','-keyout','/tmp/ca.key','-out','/tmp/ca.pem']);
  for(const db of ['mariadb','postgresql']) {
    const directory=`/private-${db}`;fs.chownSync(directory,999,999);fs.chmodSync(directory,0o750);
    const host=variant==='tls' && engine===db?'untrusted.example.invalid':`internal-${db}`;
    run(['req','-new','-newkey','rsa:2048','-nodes','-subj',`/CN=${host}`,'-keyout',`${directory}/server.key`,'-out','/tmp/server.csr']);
    fs.writeFileSync('/tmp/server.ext',`subjectAltName=DNS:${host}\nextendedKeyUsage=serverAuth\n`);
    run(['x509','-req','-in','/tmp/server.csr','-CA','/tmp/ca.pem','-CAkey','/tmp/ca.key','-set_serial',`0x${crypto.randomBytes(16).toString('hex')}`,
      '-days','2','-sha256','-extfile','/tmp/server.ext','-out',`${directory}/server.pem`]);
    for(const file of ['server.key','server.pem']) {fs.chownSync(`${directory}/${file}`,999,999);fs.chmodSync(`${directory}/${file}`,0o600);}
    const ca=fs.readFileSync('/tmp/ca.pem','utf8');write(`${directory}/ca.pem`,ca,999,999,0o600);
    const password=crypto.randomBytes(32).toString('hex');
    let sql=bootstrapSql(db,['example_db'],'recovery_user',password);
    if(variant==='marker' && db===engine) sql=sql.replace('pluton-phase6-recovery-only','invalid-disposable-marker');
    if(variant==='existing' && db===engine) sql=db==='mariadb'?`CREATE DATABASE example_db;\n${sql}`:
      sql.replace('ALTER ROLE postgres NOLOGIN;', 'CREATE DATABASE fixture_existing;\nALTER ROLE postgres NOLOGIN;');
    write(`${directory}/bootstrap.sql`,sql,999,999,0o600);
    write(`/public/${db}-ca.pem`,ca);
    write(`/public/${db}.json`,JSON.stringify({version:1,target:{engine:db,host:`internal-${db}`,port:db==='mariadb'?3306:5432,username:'recovery_user',
      password,tls:'verify-identity',enabled:true,dedicated:true},databases:['example_db'],maxSqlBytes:128*1024**2}));
  }
  write('/public/state.json',JSON.stringify({version:1,engine,installationId:'a'.repeat(32),activationId:'b'.repeat(32),approved:true,status:'active',expiresAt:Date.now()+3600_000}));
  // Copy reviewed code into a root-owned immutable public location, normalize Windows fixture line endings only.
  fs.chownSync('/boot',0,0);fs.chmodSync('/boot',0o755);
  write('/boot/bootstrap.sh',fs.readFileSync('/fixture-bootstrap.sh','utf8').replaceAll('\r\n','\n'),0,0,0o444);
  console.log('PASS disposable TLS/ownership/bootstrap provisioning');
}
