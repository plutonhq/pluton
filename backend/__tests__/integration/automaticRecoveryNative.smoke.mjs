import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
import {setTimeout as pause} from 'node:timers/promises';
import {PersistentDatabaseImporter} from '/app/backend/dist/utils/persistentDatabaseImporter.js';
import {RecoveryDatabaseImporter} from '/app/backend/dist/utils/recoveryDatabaseImport.js';
import {DatabaseRestoreStore} from '/app/backend/dist/stores/DatabaseRestoreStore.js';
import {RecoveryTestStore} from '/app/backend/dist/stores/RecoveryTestStore.js';
import {runRecoveryProcess} from '/app/backend/dist/utils/recoveryProcess.js';
const require=createRequire('/app/backend/package.json'),Database=require('better-sqlite3'),
  {drizzle}=require('drizzle-orm/better-sqlite3'),{migrate}=require('drizzle-orm/better-sqlite3/migrator');
assert.equal(process.getuid(),10001);assert.equal(process.getgid(),10001);
const c=JSON.parse(await fs.readFile('/fixture/public/context.json','utf8'));
const open=()=>{const s=new Database('/fixture/state/native.db');migrate(drizzle(s),{migrationsFolder:'/app/drizzle'});s.pragma('foreign_keys=ON');return s;};
let sqlite=open();
sqlite.exec("INSERT INTO storages(id,name,type) VALUES('storage-01','Synthetic SFTP','sftp'); INSERT INTO devices(id,name) VALUES('app-01','Fixture'); INSERT INTO agent_identities(agent_id,device_id,encrypted_secret,hostname,os,architecture,agent_version,capabilities) VALUES('agent-01','app-01','synthetic-cipher','app-01','Linux','x86_64','0.4.0','{}');");
sqlite.prepare('INSERT INTO plans(id,title,source_id,source_type,method,storage_id,source_config,settings) VALUES(?,?,?,?,?,?,?,?)')
  .run('plan-01','Fixture','app-01','device','backup','storage-01','{}','{}');
sqlite.prepare('INSERT INTO remote_managed_repositories(id,plan_id,agent_id,storage_id,storage_path,encrypted_password,initialized_at) VALUES(?,?,?,?,?,?,?)')
  .run('repo-01','plan-01','agent-01','storage-01','managed/app','synthetic-cipher',1);
const snapshot='a'.repeat(64);
sqlite.prepare('INSERT INTO backups(id,plan_id,source_id,source_type,method,storage_id,status,in_progress,success,completion_stats) VALUES(?,?,?,?,?,?,?,?,?,?)')
  .run('backup-01','plan-01','app-01','device','backup','storage-01','completed',0,1,JSON.stringify({snapshot_id:snapshot}));
sqlite.prepare('UPDATE plans SET storage_path=? WHERE id=?').run('managed/app','plan-01');
sqlite.prepare('UPDATE backups SET storage_path=? WHERE id=?').run('managed/app','backup-01');
const secret=crypto.randomBytes(32).toString('hex');
const sql="CREATE TABLE fixture_entries(value VARCHAR(100)); INSERT INTO fixture_entries VALUES ('synthetic native lifecycle content');\n";
const directory='/fixture/state/workspace';await fs.mkdir(directory,{mode:0o700});
const file=directory+'/fixture.sql';await fs.writeFile(file,sql,{mode:0o600});
const entry={databaseId:'db_example',engine:c.engine,database:'example_db',path:'/pluton/database/db_example.sql',bytes:Buffer.byteLength(sql),
  sha256:crypto.createHash('sha256').update(sql).digest('hex'),artifactValidation:'passed',importValidation:'pending'};
let inspectedContent=false;
let phase='connection';
const checked=async input=>{
  assert(!JSON.stringify(input.args).includes(c.target.password));
  for(const key of ['SECRET','ENCRYPTION_KEY','MYSQL_PWD','PGPASSWORD'])assert.equal(input.env[key],undefined);
  const credentials=input.env.PGPASSFILE||input.args[0].split('=')[1];
  assert.equal((await fs.stat(credentials)).mode&0o777,0o600);
  const result=await runRecoveryProcess(input);
  if(typeof input.input==='string' && input.input.includes('information_schema.tables')){
    const value=await runRecoveryProcess({...input,input:'SELECT value FROM fixture_entries;',capture:true});
    assert.equal(value.trim(),'synthetic native lifecycle content');inspectedContent=true;
  }
  return result;
};
const signal=new AbortController().signal,ca='/fixture/public/ca.pem';
try{
  phase='native-readiness';
  const probe=new RecoveryDatabaseImporter({},runRecoveryProcess,undefined,()=>ca);
  const deadline=Date.now()+45000;
  for(;;){
    let connection;
    try{
      connection=await probe.connection(c.target,directory,signal);
      const persistent=c.mode==='persistent',guard=persistent?'pluton_restore_guard':'pluton_recovery_guard';
      const purpose=await connection.query(guard,'SELECT purpose FROM '+(persistent?'contract':'pluton_recovery_guard')+';','database-target-preflight');
      assert.equal(purpose.trim(),persistent?'pluton-persistent-database-restore-v1':'pluton-phase6-recovery-only');
      break;
    }catch(error){
      if(error.code!=='database-target-unavailable'||Date.now()>=deadline)throw error;
      await pause(150);
    }finally{await connection?.close();}
  }
  if(c.mode==='persistent'){
    phase='persistent-setup';
    let store=new DatabaseRestoreStore(sqlite,secret);
    const approval={version:1,id:c.id,purpose:'pluton-persistent-database-restore-v1',mode:'internal',
      activationId:c.activationId,engine:c.engine,database:'example_db',target:c.target,caSha256:c.caSha256,
      maxSqlBytes:128*1024**2,maxRetentionSeconds:86400,storage:{id:c.storageId,kind:'fixed-ext4',quotaBytes:2147483648},
      binding:{restoreId:c.id,snapshotId:snapshot,sha256:entry.sha256}};
    let row={id:c.id,owner:'administrator',purpose:approval.purpose,planId:'plan-01',backupId:'backup-01',repositoryId:'repo-01',
      snapshotId:snapshot,databaseId:entry.databaseId,artifact:entry,metadataToken:'b'.repeat(64),mode:'internal',targetId:c.id,
      targetFingerprint:null,encryptedApproval:null,ownerToken:crypto.randomBytes(24).toString('hex'),database:null,status:'queued',
      stage:'snapshot-validation',cleanup:'none',createdAt:Date.now(),startedAt:null,expiresAt:Date.now()+3600000,ttlSeconds:3600,
      lastValidatedAt:null,inspection:null,errorCode:null,cancelRequested:false};
    store.create(row);store.bind(c.id,approval);row=store.claim(c.id);assert(row);
    let importer=new PersistentDatabaseImporter(store,approval,ca,checked);
    phase='persistent-import';
    const metadata=await importer.restore(row,file,directory,signal,()=>{});
    assert.equal(metadata.tables,1);assert.equal(store.lease(c.id).state,'validated');assert(inspectedContent);
    store.update(c.id,{status:'active',database:metadata.database});sqlite.close();
    sqlite=open();store=new DatabaseRestoreStore(sqlite,secret);row=store.get(c.id);
    importer=new PersistentDatabaseImporter(store,store.approval(c.id),ca,checked);
    phase='persistent-restart-inspect';assert.equal((await importer.inspect(row,directory,signal)).tables,1);
    assert.equal(row.status,'active'); // App store/connection restart, running DB deliberately retained.
    phase='persistent-cleanup';await importer.removeOwned(row,directory);assert.equal(store.lease(c.id),null);
  }else{
    phase='disposable-setup';const store=new RecoveryTestStore(drizzle(sqlite),secret);
    await store.saveTarget('plan-01',c.target);
    await store.enqueue({id:c.id,planId:'plan-01',backupId:'backup-01',repositoryId:'repo-01',snapshotId:snapshot,status:'queued',trigger:'manual',
      policy:{enabled:false,databaseImport:'required'}});
    await store.claim();
    const target=await store.target('plan-01',c.engine);
    const importer=new RecoveryDatabaseImporter(store,checked,undefined,()=>ca);
    phase='disposable-import';await importer.importDatabase({testId:c.id,targetId:target.id,target:c.target,entry,file,directory,signal,stage:()=>{},allowedDatabases:['example_db']});
    assert.equal(entry.importValidation,'passed');assert(inspectedContent);
    phase='disposable-cleanup';for(const lease of await store.leases(c.id))await importer.cleanup(lease,directory);
    assert.equal((await store.leases(c.id)).length,0);
  }
  await fs.rm(directory,{recursive:true});sqlite.close();
  console.log('PASS '+c.engine+'/'+c.mode+' real bootstrap/native content, credentials, ownership and cleanup. Host ext4 NOT tested.');
}catch(error){
  const line=String(error.stack).match(/\/fixture-code\/automaticRecoveryNative\.smoke\.mjs:\d+:\d+/)?.[0]||'native-process';
  console.error('FAIL native lifecycle fixture '+c.engine+'/'+c.mode+' phase='+phase+' '+(error.code||'assertion')+' '+(error.stage||'')+' '+line);
  process.exitCode=1;
}
