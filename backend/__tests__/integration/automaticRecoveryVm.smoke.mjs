import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
import {AutomaticRecoveryLifecycle} from '/app/backend/dist/utils/automaticRecoveryLifecycle.js';
import {PersistentDatabaseImporter} from '/app/backend/dist/utils/persistentDatabaseImporter.js';
import {RecoveryDatabaseImporter} from '/app/backend/dist/utils/recoveryDatabaseImport.js';
import {DatabaseRestoreStore} from '/app/backend/dist/stores/DatabaseRestoreStore.js';
import {RecoveryTestStore} from '/app/backend/dist/stores/RecoveryTestStore.js';
import {runRecoveryProcess} from '/app/backend/dist/utils/recoveryProcess.js';
import {InternalRecoveryTargets} from '/app/backend/dist/utils/internalRecoveryTargets.js';
import {PersistentRestoreTargets} from '/app/backend/dist/utils/persistentRestoreTargets.js';
const require=createRequire('/app/backend/package.json'),Database=require('better-sqlite3'),
  {drizzle}=require('drizzle-orm/better-sqlite3'),{migrate}=require('drizzle-orm/better-sqlite3/migrator');
const childProcess=require('node:child_process'),nativeSpawn=childProcess.spawn;
let nativeFailure,lastNative;
childProcess.spawn=function(...args){
  const child=nativeSpawn.apply(this,args);let stderr='';
  child.stderr?.on('data',chunk=>{if(stderr.length<8192)stderr+=chunk.toString('utf8').slice(0,8192-stderr.length);});
  child.on('close',code=>{if(code){nativeFailure={exitCode:code,numericCode:/\bERROR\s+(\d{3,5})\b/.exec(stderr)?.[1]||null,
    category:/unknown (?:option|variable)/i.test(stderr)?'client-option':/does not exist|doesn't exist/i.test(stderr)?'missing-object':
      /access denied|permission denied/i.test(stderr)?'access':/syntax/i.test(stderr)?'syntax':'other'};}});
  return child;
};
assert.equal(process.getuid(),10001);assert.equal(process.getgid(),10001);
const phase=process.argv[2],c=JSON.parse(await fs.readFile('/fixture/public/context.json','utf8'));
const sqlite=new Database('/fixture/state/app.db');migrate(drizzle(sqlite),{migrationsFolder:'/app/drizzle'});sqlite.pragma('foreign_keys=ON');
const key='/fixture/state/private-key';
try{await fs.access(key);}catch{await fs.writeFile(key,crypto.randomBytes(32).toString('hex'),{mode:0o600,flag:'wx'});}
assert.equal((await fs.stat(key)).mode&0o777,0o600);const secret=await fs.readFile(key,'utf8');
const auto=new AutomaticRecoveryLifecycle(sqlite),persistent=new DatabaseRestoreStore(sqlite,secret),recovery=new RecoveryTestStore(drizzle(sqlite),secret);
const b=c.binding,entry={...b.artifacts[0],engine:c.engine,path:'/pluton/database/db_example.sql',artifactValidation:'passed',importValidation:'pending'};
const directory='/fixture/state/workspace',file=directory+'/fixture.sql';
await fs.mkdir(directory,{mode:0o700,recursive:true});await fs.writeFile(file,c.sql,{mode:0o600});
assert.equal(Buffer.byteLength(c.sql),entry.bytes);assert.equal(crypto.createHash('sha256').update(c.sql).digest('hex'),entry.sha256);
const controller=new AbortController();let imported=false,content=false,stage='setup',cancelled=false;
async function checked(input){
  lastNative={stage:input.stage,kind:typeof input.input==='object'?'artifact-stream':'query'};
  assert(!JSON.stringify(input.args).includes(c.target.password));
  for(const name of ['SECRET','ENCRYPTION_KEY','MYSQL_PWD','PGPASSWORD'])assert.equal(input.env[name],undefined);
  const credential=input.env.PGPASSFILE||input.args[0].split('=')[1];assert.equal((await fs.stat(credential)).mode&0o777,0o600);
  let timer;
  if(typeof input.input==='object'&&input.stage==='database-import'){
    imported=true;if(phase==='cancel-import')timer=setTimeout(()=>controller.abort(),150);
  }
  try{
    const output=await runRecoveryProcess(input);
    if(input.stage==='database-import-validation'&&typeof input.input==='string'&&input.input.includes('information_schema.tables')){
      const value=await runRecoveryProcess({...input,input:'SELECT value FROM fixture_entries;',capture:true});
      assert.equal(value.trim(),'synthetic native lifecycle content');content=true;
    }
    return output;
  }finally{clearTimeout(timer);}
}
try{
  if(phase==='request'){
    const resources=await new InternalRecoveryTargets(undefined,undefined,auto).admission(c.engine,[entry],'/fixture/state');
    assert.equal(resources.status,'admitted');
    sqlite.exec("INSERT INTO storages(id,name,type) VALUES('storage-01','Synthetic SFTP','sftp'); INSERT INTO devices(id,name) VALUES('app-01','Fixture'); INSERT INTO agent_identities(agent_id,device_id,encrypted_secret,hostname,os,architecture,agent_version,capabilities) VALUES('agent-01','app-01','synthetic-cipher','app-01','Linux','x86_64','0.4.0','{}');");
    sqlite.prepare('INSERT INTO plans(id,title,source_id,source_type,method,storage_id,source_config,settings,storage_path) VALUES(?,?,?,?,?,?,?,?,?)')
      .run('plan-01','Fixture','app-01','device','backup','storage-01','{}','{}','managed/app');
    sqlite.prepare('INSERT INTO remote_managed_repositories(id,plan_id,agent_id,storage_id,storage_path,encrypted_password,initialized_at) VALUES(?,?,?,?,?,?,?)')
      .run('repo-01','plan-01','agent-01','storage-01','managed/app','synthetic-cipher',1);
    sqlite.prepare('INSERT INTO backups(id,plan_id,source_id,source_type,method,storage_id,status,in_progress,success,completion_stats,storage_path) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .run('backup-01','plan-01','app-01','device','backup','storage-01','completed',0,1,JSON.stringify({snapshot_id:b.snapshotId}),'managed/app');
    if(c.mode==='persistent'){
      const row={id:c.id,owner:'administrator',purpose:'pluton-persistent-database-restore-v1',planId:'plan-01',backupId:'backup-01',repositoryId:'repo-01',
        snapshotId:b.snapshotId,databaseId:entry.databaseId,artifact:entry,metadataToken:'b'.repeat(64),mode:'internal',targetId:c.id,
        targetFingerprint:null,encryptedApproval:null,ownerToken:crypto.randomBytes(24).toString('hex'),database:null,status:'queued',
        stage:'checking-resources',cleanup:'none',createdAt:b.createdAt,startedAt:null,expiresAt:b.expiresAt,ttlSeconds:3600,
        lastValidatedAt:null,inspection:null,errorCode:null,cancelRequested:false};
      persistent.create(row);await auto.persistent(row,'provision',false);
    }else{
      await recovery.enqueue({id:c.id,planId:'plan-01',backupId:'backup-01',repositoryId:'repo-01',snapshotId:b.snapshotId,status:'queued',trigger:'manual',
        policy:{enabled:false,databaseImport:'required',targetModes:{[c.engine]:'internal'}}});
      await recovery.claim();await auto.testing(c.id,b.snapshotId,[entry],b.createdAt);
    }
    assert.equal(auto.record(c.id).action,'provision');
    const request='/run/pluton-automatic-recovery-requests/'+c.id+'.json';assert.equal((await fs.stat(request)).mode&0o777,0o600);
    assert.equal(JSON.parse(await fs.readFile(request,'utf8')).binding.snapshotId,b.snapshotId);
  }else if(phase==='resume'||phase==='stop'){
    assert.equal(c.mode,'persistent');await auto.action(c.id,phase,false);
  }else if(phase==='cancel'){
    await auto.action(c.id,'delete',false);assert.equal(auto.record(c.id).action,'delete');
    await assert.rejects(auto.action(c.id,'provision',false));
    assert.equal(persistent.lease(c.id),null);assert.equal((await recovery.leases(c.id)).length,0);cancelled=true;
  }else if(phase==='receipt'){
    assert.equal((await auto.receipt(c.id)).state,'removed');
    assert.equal(auto.record(c.id).state,'removed');
    await assert.rejects(fs.access('/run/pluton-automatic-recovery-requests/'+c.id+'.json'));
  }else{
    assert.equal((await auto.receipt(c.id)).state,'ready');
    stage=phase;
    if(c.mode==='persistent'){
      const approval=JSON.parse(await fs.readFile('/run/pluton-persistent-restores/'+c.id+'.json','utf8'));
      let row=persistent.get(c.id);
      if(phase==='import'||phase==='cancel-import'){persistent.bind(c.id,approval);row=persistent.claim(c.id);assert(row);}
      if(phase==='import'||phase==='cancel-import'){
        const targets=new PersistentRestoreTargets(undefined,undefined,undefined,undefined,auto);
        await targets.assertBinding(row);await targets.admission(approval,row,directory);
      }
      const importer=new PersistentDatabaseImporter(persistent,approval,'/fixture/public/ca.pem',checked);
      if(phase==='import'||phase==='cancel-import'){
        try{
          const result=await importer.restore(row,file,directory,controller.signal,()=>{});
          assert.equal(result.tables,1);assert(imported&&content);persistent.update(c.id,{status:'active',database:result.database});
        }catch(error){if(phase!=='cancel-import'||error.code!=='cancelled')throw error;assert(imported);cancelled=true;}
        if(phase==='cancel-import')assert(cancelled);
      }else if(phase==='inspect'){
        assert.equal(row.status,'active');assert.equal((await importer.inspect(row,directory,controller.signal)).tables,1);assert(content);
      }
      if(phase==='cleanup'||phase==='cancel-import'){
        await importer.removeOwned(persistent.get(c.id),directory);assert.equal(persistent.lease(c.id),null);
        await auto.action(c.id,'delete',true);
      }
    }else{
      const target=await auto.target(c.id);await auto.verifyStorage(c.id,target.storage,target.activationId);
      const importer=new RecoveryDatabaseImporter(recovery,checked,undefined,()=>target.caFile);
      if(phase==='import'||phase==='cancel-import'){
        const previous=(await recovery.pendingInternalSessions()).filter(value=>value.testId===c.id);
        assert(previous.length<=1);
        if(previous.length)assert.equal((await recovery.leases(c.id)).length,0); // Prior fixture failed schema validation before SQL.
        const session=previous.length?{...await recovery.leaseTarget(previous[0].id),id:previous[0].id}:
          await recovery.beginInternalSession({testId:c.id,...target});
        const {id:targetId,...databaseTarget}=session; // Same identity/config split as RecoveryTestService.
        try{
          await importer.importDatabase({testId:c.id,targetId,target:databaseTarget,entry,file,directory,signal:controller.signal,stage:()=>{},allowedDatabases:['example_db']});
          assert.equal(entry.importValidation,'passed');assert(imported&&content);
        }catch(error){if(phase!=='cancel-import'||error.code!=='cancelled')throw error;assert(imported);cancelled=true;}
        if(phase==='cancel-import')assert(cancelled);
      }
      if(phase==='cleanup'||phase==='cancel-import'){
        for(const lease of await recovery.leases(c.id))await importer.cleanup(lease,directory);
        assert.equal((await recovery.leases(c.id)).length,0);
        for(const session of await recovery.pendingInternalSessions())await recovery.markInternalCleanupReady(session.id);
        await auto.action(c.id,'delete',true);
      }
    }
    const files=await fs.readdir(directory);assert(!files.some(name=>/credential|\.cnf$|pgpass/.test(name)));
  }
  console.log(JSON.stringify({status:'passed',engine:c.engine,mode:c.mode,phase,cancelled}));
}catch(error){
  console.error(JSON.stringify({status:'failed',engine:c.engine,mode:c.mode,phase,stage,
    nativeStage:error.stage||lastNative?.stage,nativeKind:lastNative?.kind,nativeFailure,
    code:/^[a-z][a-z0-9-]{0,79}$/.test(error.code||'')?error.code:'fixture-assertion-failed',
    locations:String(error.stack||'').split('\n').filter(line=>/^\s+at /.test(line)&&/\.mjs:\d+:\d+/.test(line)).slice(0,3)}));
  process.exitCode=1;
}finally{sqlite.close();}
