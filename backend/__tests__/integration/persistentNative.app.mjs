import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {DatabaseRestoreStore} from '/app/backend/dist/stores/DatabaseRestoreStore.js';
import {PersistentDatabaseImporter} from '/app/backend/dist/utils/persistentDatabaseImporter.js';
import {PersistentRestoreTargets} from '/app/backend/dist/utils/persistentRestoreTargets.js';
import {RecoveryDatabaseImporter} from '/app/backend/dist/utils/recoveryDatabaseImport.js';
import {runRecoveryProcess} from '/app/backend/dist/utils/recoveryProcess.js';
const require=createRequire('/app/backend/package.json'),Database=require('better-sqlite3');
const {drizzle}=require('drizzle-orm/better-sqlite3'),{migrate}=require('drizzle-orm/better-sqlite3/migrator');
const [action]=process.argv.slice(2),base='/fixture/state/application';
assert.equal(process.getuid(),10001);assert.equal(process.getgid(),10001);process.umask(0o077);
assert.match(await fs.readFile('/proc/self/status','utf8'),/^CapEff:\s+0+$/m);
await assert.rejects(fs.access('/var/run/docker.sock'));
const config=JSON.parse(await fs.readFile(base+'/fixture.json','utf8')),key=await fs.readFile(base+'/key','utf8');
const sqlite=new Database(base+'/restore.db');migrate(drizzle(sqlite),{migrationsFolder:'/app/drizzle'});
const store=new DatabaseRestoreStore(sqlite,key),targets=new PersistentRestoreTargets();
const target=await targets.read(config.id);
await assert.rejects(fs.readdir('/run/pluton-persistent-storage/'+config.id+'/data'),error=>error.code==='EACCES');
await assert.rejects(fs.readFile('/run/pluton-persistent-bootstrap/server.key'),error=>error.code==='EACCES');
const checked=async input=>{
   for(const name of ['PGPASSWORD','MYSQL_PWD','SECRET','ENCRYPTION_KEY'])assert.equal(input.env[name],undefined);
   assert(!JSON.stringify(input.args).includes(target.target.password));
   const file=input.env.PGPASSFILE||input.args[0].split('=')[1],stat=await fs.stat(file);
   assert.equal(stat.uid,10001);assert.equal(stat.mode&0o777,0o600);
   const result=await runRecoveryProcess(input);
   if(typeof input.input==='string'&&/^SELECT (JSON_|json_)/.test(input.input)) {
      const actual=await runRecoveryProcess({...input,input:'SELECT count(*) FROM fixture_entries;',capture:true});
      assert.equal(actual.trim(),'8192');
   }
   return result;
};
const importer=()=>new PersistentDatabaseImporter(store,target,'/run/pluton-persistent-restores/'+config.id+'-ca.pem',checked);
const workspace=base+'/client';await fs.mkdir(workspace,{mode:0o700,recursive:true});
let row=store.get(config.id),checkpoint='setup';
try {
   if(action==='import'){
      const artifact={databaseId:'db_example',engine:target.engine,database:'example_db',path:'/pluton/database/db_example.sql',
         bytes:config.bytes,sha256:config.sha256,artifactValidation:'passed',importValidation:'pending'};
      row=store.create({id:config.id,owner:'administrator',purpose:target.purpose,planId:'plan-01',repositoryId:'repo-01',backupId:'backup-01',
         snapshotId:config.snapshot,databaseId:'db_example',artifact,metadataToken:'e'.repeat(64),mode:target.mode,targetId:config.id,
         ownerToken:crypto.randomBytes(24).toString('hex'),status:'queued',stage:'preflight',cleanup:'none',createdAt:Date.now(),
         expiresAt:Date.now()+3600000,ttlSeconds:3600});
      row=store.bind(row.id,target);row=store.claim(row.id);assert(row);
      await targets.assertBinding(row,target);await targets.admission(target,row,base);
      const trust='/run/pluton-persistent-restores/'+config.id+'-ca.pem';
      checkpoint='wrong-credential-refusal';
      await assert.rejects(new PersistentDatabaseImporter(store,{...target,target:{...target.target,password:crypto.randomBytes(32).toString('hex')}},trust,checked)
         .restore(row,base+'/dump.sql',workspace,new AbortController().signal,()=>{}),error=>error.code==='database-authentication-failed');
      checkpoint='tls-refusal';
      await assert.rejects(new PersistentDatabaseImporter(store,{...target,target:{...target.target,host:'localhost'}},trust,checked)
         .restore(row,base+'/dump.sql',workspace,new AbortController().signal,()=>{}),error=>error.code==='database-tls-failed');
      checkpoint='digest-refusal';
      const tampered=await fs.readFile(base+'/dump.sql');tampered[0]^=1;
      await fs.writeFile(base+'/tampered.sql',tampered,{mode:0o600,flag:'wx'});
      await assert.rejects(importer().restore(row,base+'/tampered.sql',workspace,new AbortController().signal,()=>{}),
         error=>error.code==='database-artifact-hash-mismatch');
      await fs.unlink(base+'/tampered.sql');
      await assert.rejects(new PersistentDatabaseImporter(store,{...target,engine:target.engine==='mariadb'?'postgresql':'mariadb'},
         '/run/pluton-persistent-restores/'+config.id+'-ca.pem',checked).restore(row,base+'/dump.sql',workspace,new AbortController().signal,()=>{}),
         error=>error.code==='database-engine-or-artifact-mismatch');
      checkpoint='cancel-import';
      const cancellation=new AbortController();let timer;
      try {
         await assert.rejects(importer().restore(row,base+'/dump.sql',workspace,cancellation.signal,stage=>{
            if(stage==='database-import')timer=setTimeout(()=>cancellation.abort(),150);
         }),error=>error.code==='cancelled');
      }finally{clearTimeout(timer);}
      checkpoint='cancel-owned-cleanup';
      await importer().removeOwned(row,workspace);assert.equal(store.lease(row.id),null);
      checkpoint='retained-import';
      const inspection=await importer().restore(row,base+'/dump.sql',workspace,new AbortController().signal,()=>{});
      assert.equal(inspection.tables,1);assert(store.lease(row.id));assert.equal(store.lease(row.id).state,'validated');
      store.update(row.id,{status:'active',inspection,lastValidatedAt:Date.now()});
      await assert.rejects(importer().restore({...row,status:'importing'},base+'/dump.sql',workspace,new AbortController().signal,()=>{}),
         error=>error.code==='database-already-exists');
      // Disposable Phase 6 cleanup must not accept the retained target's guard or purpose.
      const old=new RecoveryDatabaseImporter({leases:async()=>[],leaseTarget:async()=>target.target,addLease:async()=>{},removeLease:async()=>{}},
         checked,()=>target.engine==='mariadb'?'/usr/bin/mariadb':'/usr/bin/psql',()=>'/run/pluton-persistent-restores/'+config.id+'-ca.pem');
      checkpoint='phase6-isolation';
      await assert.rejects(old.verifyEmptyTarget(target.target,workspace));
      await assert.rejects(old.cleanup({id:'f'.repeat(24),testId:row.id,targetId:row.targetId,
         database:store.lease(row.id).database,ownerToken:row.ownerToken},workspace));
      assert.equal((await importer().inspect(row,workspace)).tables,1);assert(store.lease(row.id));
      console.log('PASS native '+target.engine+' '+target.mode+' import / real SQL catalog / digest / retained ownership / existing database / Phase 6 isolation / private credentials');
   }else if(action==='inspect-delete'){
      assert(row);assert.equal(row.status,'active');assert.equal(store.lease(row.id).state,'validated');
      assert.equal((await importer().inspect(row,workspace)).tables,1);
      const wrong={...row,ownerToken:'f'.repeat(48)};
      await assert.rejects(importer().removeOwned(wrong,workspace),error=>error.code==='restore-ownership-uncertain');assert(store.lease(row.id));
      await importer().removeOwned(row,workspace);assert.equal(store.lease(row.id),null);
      await importer().removeOwned(row,workspace);
      if(target.mode==='internal')store.update(row.id,{status:'cleanup_required',cleanup:'infrastructure_pending',cancelRequested:true});
      else store.finishDeleted(row.id);
      assert(!JSON.stringify(sqlite.prepare('SELECT * FROM persistent_database_restores').get()).includes(target.target.password));
      console.log('PASS native '+target.engine+' retained data survives container and application restart / foreign ownership refused / explicit owned deletion');
   }else throw new Error('Unknown fixture action');
}catch(error){console.error('FAIL persistent native fixture: '+(error.code||'assertion-failed')+' / '+checkpoint+
   (typeof error.actual?.code==='string'?' category='+error.actual.code:''));process.exitCode=1;}
finally{sqlite.close();await fs.rm(workspace,{recursive:true,force:true});}
