// Disposable synthetic repository builder. Not an application startup hook.
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {configService} from '/app/backend/dist/services/ConfigService.js';
import {visualPlanSettings,visualSnapshotStats} from '/fixture/visual-data.mjs';
const require=createRequire('/app/backend/package.json'),Database=require('better-sqlite3'),Cryptr=require('cryptr');
const {drizzle}=require('drizzle-orm/better-sqlite3'),{migrate}=require('drizzle-orm/better-sqlite3/migrator');
assert.equal(process.getuid(),10001);
const sqlite=new Database('/data/db/pluton.db');migrate(drizzle(sqlite),{migrationsFolder:'/app/drizzle'});
assert.equal(sqlite.prepare('SELECT count(*) n FROM plans').get().n,0);
const credentials=JSON.parse(fs.readFileSync('/fixture/credentials.json','utf8'));
const crypt=new Cryptr(configService.config.SECRET);
sqlite.prepare('INSERT INTO storages(id,name,type,settings,credentials) VALUES(?,?,?,?,?)')
  .run('storage-fixture','Synthetic read-only SFTP','sftp',JSON.stringify({host:'repository-fixture',port:2022,user:'fixture_reader'}),
    JSON.stringify({pass:crypt.encrypt(credentials.sftpPassword)}));
sqlite.exec("INSERT INTO devices(id,name,type,agent_id,status,settings) VALUES('app-01','Synthetic offline source','device','agent-fixture','offline','{}');");
sqlite.prepare('INSERT INTO agent_identities(agent_id,device_id,encrypted_secret,hostname,os,architecture,agent_version,capabilities) VALUES(?,?,?,?,?,?,?,?)')
  .run('agent-fixture','app-01',crypt.encrypt(crypto.randomBytes(32).toString('hex')),'app-01','Linux','x86_64','0.4.0','{}');
fs.mkdirSync('/srv/example-app/nested',{recursive:true,mode:0o755});
fs.writeFileSync('/srv/example-app/nested/example.txt','Synthetic application data for exact-snapshot recovery.\n');
const results=[];
function native(args){try{return execFileSync('/usr/local/bin/restic',args,{encoding:'utf8',timeout:120000,maxBuffer:1048576,
  env:{PATH:'/usr/local/bin:/usr/bin:/bin',HOME:'/tmp',LANG:'C'},stdio:['ignore','pipe','pipe']});}
  catch{throw new Error('Synthetic Restic fixture creation failed.');}}
assert([undefined,'mysql'].includes(process.argv[2]));
for(const engine of process.argv[2]==='mysql'?['mysql']:['mariadb','postgresql']){
  const plan='plan-'+engine,backup='backup-'+engine,repository='repo-'+engine;
  const database='fixture_'+engine,sql=(engine==='mysql'?'-- Server version 8.4.11\n':'')+
    "CREATE TABLE fixture_entries(value VARCHAR(100));\nINSERT INTO fixture_entries VALUES ('synthetic API recovery content');\n"+
    (engine==='mysql'?"CREATE TEMPORARY TABLE fixture_assertion(passed INT CHECK(passed=1)); INSERT INTO fixture_assertion SELECT IF(COUNT(*)=1 AND MAX(value)='synthetic API recovery content',1,0) FROM fixture_entries; DROP TEMPORARY TABLE fixture_assertion;\n":'');
  fs.writeFileSync('/pluton/database/db_example.sql',sql,{mode:0o600});
  const passwordFile='/fixture/repository-password';
  fs.writeFileSync(passwordFile,crypto.randomBytes(32).toString('base64url'),{mode:0o600,flag:'wx'});
  const password=fs.readFileSync(passwordFile,'utf8');
  const common=['--repo','/fixture/repositories/'+engine,'--password-file',passwordFile,'--no-cache'];
  native([...common,'init']);
  const output=native([...common,'backup','--json','--host','app-01','--tag','pluton-plan-'+plan,'--tag','pluton-backup-'+backup,
    '/srv/example-app','/pluton/database/db_example.sql']);
  const summary=output.trim().split('\n').map(line=>JSON.parse(line)).find(row=>row.message_type==='summary');
  const snapshot=summary.snapshot_id,stats=visualSnapshotStats(summary),now=Math.floor(Date.now()/1000);
  assert.match(snapshot,/^[a-f0-9]{64}$/);
  const artifact={databaseId:'db_example',engine,database,path:'/pluton/database/db_example.sql',bytes:Buffer.byteLength(sql),
    sha256:crypto.createHash('sha256').update(sql).digest('hex')};
  const source={includes:['/srv/example-app'],excludes:[]};
  sqlite.prepare('INSERT INTO plans(id,title,source_id,source_type,method,storage_id,storage_path,source_config,settings,active) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(plan,'Synthetic '+engine+' fixture','app-01','device','backup','storage-fixture',engine,JSON.stringify(source),JSON.stringify(visualPlanSettings()),0);
  sqlite.prepare('UPDATE plans SET stats=?,tags=?,last_backup_time=? WHERE id=?')
    .run(JSON.stringify(stats),JSON.stringify(['synthetic','visual-acceptance']),now,plan);
  sqlite.prepare('INSERT INTO remote_managed_repositories(id,plan_id,agent_id,storage_id,storage_path,encrypted_password,initialized_at) VALUES(?,?,?,?,?,?,?)')
    .run(repository,plan,'agent-fixture','storage-fixture',engine,crypt.encrypt(password),Math.floor(Date.now()/1000));
  sqlite.prepare('INSERT INTO backups(id,plan_id,source_id,source_type,method,storage_id,storage_path,source_config,status,success,in_progress,completion_stats) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(backup,plan,'app-01','device','backup','storage-fixture',engine,JSON.stringify(source),'completed',1,0,
      JSON.stringify({...summary,sourcePaths:source.includes,lifecycle:{warnings:[],databases:[artifact]}}));
  sqlite.prepare('UPDATE backups SET title=?,started_at=?,ended_at=? WHERE id=?')
    .run('Synthetic '+engine+' completed backup',now-1,now,backup);
  results.push({engine,planId:plan,backupId:backup,snapshotId:snapshot,databaseId:artifact.databaseId});
  fs.unlinkSync(passwordFile);
}
fs.writeFileSync('/fixture/snapshots.json',JSON.stringify(results),{mode:0o600});sqlite.close();
console.log(JSON.stringify({event:'real_synthetic_restic_snapshots_created',engines:results.map(row=>row.engine),snapshots:results.length}));
