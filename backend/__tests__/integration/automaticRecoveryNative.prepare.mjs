// Bounded container tmpfs only; NOT production host ext4/quota acceptance.
import fs from 'node:fs';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),retained=require('/fixture-deploy/persistent-restore/operator.cjs'),
  automatic=require('/fixture-deploy/automatic-recovery/operator.cjs');
const [engine,mode]=process.argv.slice(2);
if(process.getuid()!==0||!['mariadb','postgresql'].includes(engine)||!['persistent','disposable'].includes(mode))throw new Error('invalid isolated fixture');
const write=(name,value,gid=999,permissions=0o640)=>{fs.writeFileSync(name,value,{mode:permissions});fs.chownSync(name,0,gid);fs.chmodSync(name,permissions);};
for(const folder of ['/config','/public','/boot']){fs.chownSync(folder,0,folder==='/public'?10001:999);fs.chmodSync(folder,0o750);}
fs.chownSync('/state',10001,10001);fs.chmodSync('/state',0o700);fs.chownSync('/lock',999,999);fs.chmodSync('/lock',0o700);
const native=args=>execFileSync('openssl',args,{stdio:'pipe'});
native(['req','-x509','-newkey','rsa:2048','-nodes','-days','2','-subj','/CN=Disposable native lifecycle CA','-keyout','/tmp/ca.key','-out','/tmp/ca.pem']);
native(['req','-new','-newkey','rsa:2048','-nodes','-subj','/CN=auto-native-db','-keyout','/config/server.key','-out','/tmp/server.csr']);
fs.writeFileSync('/tmp/server.ext','subjectAltName=DNS:auto-native-db\nextendedKeyUsage=serverAuth\n');
native(['x509','-req','-in','/tmp/server.csr','-CA','/tmp/ca.pem','-CAkey','/tmp/ca.key','-set_serial','0x'+crypto.randomBytes(16).toString('hex'),
  '-days','2','-sha256','-extfile','/tmp/server.ext','-out','/config/server.pem']);
for(const file of ['server.key','server.pem']){fs.chownSync('/config/'+file,0,999);fs.chmodSync('/config/'+file,0o640);}
const ca=fs.readFileSync('/tmp/ca.pem'),id=crypto.randomBytes(12).toString('hex'),activationId=crypto.randomBytes(16).toString('hex'),
  storageId=crypto.randomBytes(16).toString('hex'),password=crypto.randomBytes(32).toString('hex');
write('/config/ca.pem',ca);write('/public/ca.pem',ca,10001);
write('/config/bootstrap.sql',mode==='persistent'?retained.bootstrapSql(engine,'example_db',password,activationId,storageId):
  automatic.disposableSql(['example_db'],engine,'example_db',password,activationId,storageId,'restore_user'));
write('/config/identity.json',JSON.stringify({restoreId:id,activationId,storageId}));
write('/boot/bootstrap.sh',fs.readFileSync('/fixture-deploy/persistent-restore/bootstrap.sh'));
// Fixture-only anchor: does NOT stand in for production root-owned mount validation.
write('/boot/start.sh',['#!/bin/bash','set -Eeuo pipefail','umask 077',
  'case "$1" in mariadb) base=/var/lib/mysql;; postgresql) base=/var/lib/postgresql;; *) exit 70;; esac',
  'cp /run/pluton-persistent-bootstrap/identity.json "$base/identity.json"','mkdir -m 700 "$base/data"',
  'exec /bin/bash /opt/pluton-native/bootstrap.sh "$1"',''].join('\n'));
write('/public/context.json',JSON.stringify({id,activationId,storageId,engine,mode,
  target:{engine,host:'auto-native-db',port:engine==='mariadb'?3306:5432,username:'restore_user',password,tls:'verify-identity',enabled:true,dedicated:true},
  caSha256:crypto.createHash('sha256').update(ca).digest('hex')}),10001);
console.log('PASS isolated native bootstrap preparation; no host mounts/loop devices.');
