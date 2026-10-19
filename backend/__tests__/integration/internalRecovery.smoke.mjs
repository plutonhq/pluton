import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';
import { RecoveryTestStore } from '/app/backend/dist/stores/RecoveryTestStore.js';
import { InternalRecoveryTargets } from '/app/backend/dist/utils/internalRecoveryTargets.js';
import { InternalRecoveryImporter } from '/app/backend/dist/utils/internalRecoveryImporter.js';
import { runRecoveryProcess } from '/app/backend/dist/utils/recoveryProcess.js';
const [engine,variant='normal',action='test']=process.argv.slice(2);
process.umask(0o077);
assert.equal(process.getuid(),10001);assert.equal(process.getgid(),10001);
const internal=new InternalRecoveryTargets();
const root='/tmp/internal-fixture';await fs.mkdir(root,{mode:0o700});
const sql="CREATE TABLE fixture_entries(value VARCHAR(100)); INSERT INTO fixture_entries VALUES ('synthetic recovery content');\n";
const file=path.join(root,'fixture.sql');await fs.writeFile(file,sql,{mode:0o600});
const entry=()=>({engine,database:'example_db',path:'/pluton/database/db_app.sql',databaseId:'db_app',bytes:Buffer.byteLength(sql),
  sha256:crypto.createHash('sha256').update(sql).digest('hex'),artifactValidation:'passed',importValidation:'pending'});
const target=JSON.parse(await fs.readFile(`/run/pluton-internal-recovery/${engine}.json`,'utf8')).target;
const require=createRequire('/app/backend/package.json');
const Database=require('better-sqlite3');
const {drizzle}=require('drizzle-orm/better-sqlite3');
const {migrate}=require('drizzle-orm/better-sqlite3/migrator');
const keyFile='/fixture-state/key';
let key;
try {key=await fs.readFile(keyFile,'utf8');} catch {key=crypto.randomBytes(32).toString('hex');await fs.writeFile(keyFile,key,{mode:0o600,flag:'wx'});}
const sqlite=new Database('/fixture-state/recovery.db');const db=drizzle(sqlite);
migrate(db,{migrationsFolder:'/app/drizzle'});sqlite.pragma('foreign_keys = ON');
const store=new RecoveryTestStore(db,key);
const snapshot='e'.repeat(64), testId='d'.repeat(24);
let session,leases=[];
if(['reconcile','receipt','unavailable'].includes(action)) {
  [session]=await store.pendingInternalSessions();assert(session);leases=await store.leases(session.testId);
} else {
  sqlite.exec("INSERT INTO storages(id,name,type) VALUES('storage-01','Synthetic SFTP','sftp'); INSERT INTO devices(id,name) VALUES('app-01','Fixture'); INSERT INTO agent_identities(agent_id,device_id,encrypted_secret,hostname,os,architecture,agent_version,capabilities) VALUES('agent-01','app-01','synthetic-cipher','app-01','Linux','x86_64','0.4.0','{}');");
  sqlite.prepare('INSERT INTO plans(id,title,source_id,source_type,method,storage_id,storage_path,source_config,settings) VALUES(?,?,?,?,?,?,?,?,?)').run('plan-01','Fixture','app-01','device','backup','storage-01','managed/app',JSON.stringify({includes:['/srv/example-app'],excludes:[]}),JSON.stringify({encryption:true}));
  sqlite.prepare('INSERT INTO remote_managed_repositories(id,plan_id,agent_id,storage_id,storage_path,encrypted_password,initialized_at) VALUES(?,?,?,?,?,?,?)').run('repo-01','plan-01','agent-01','storage-01','managed/app','synthetic-cipher',1);
  sqlite.prepare('INSERT INTO backups(id,plan_id,source_id,source_type,method,storage_id,storage_path,status,in_progress,success,completion_stats) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run('backup-01','plan-01','app-01','device','backup','storage-01','managed/app','completed',0,1,JSON.stringify({snapshot_id:snapshot}));
  await store.enqueue({id:testId,planId:'plan-01',backupId:'backup-01',repositoryId:'repo-01',snapshotId:snapshot,status:'queued',trigger:'manual',policy:{enabled:false,databaseImport:'required',targetModes:{[engine]:'internal'}}});
  await store.claim();
  const prepared=await internal.prepare(engine,[entry()]);
  const saved=await store.beginInternalSession({testId,...prepared});session=await store.internalSession(saved.id);
  assert(!JSON.stringify(sqlite.prepare('SELECT * FROM internal_recovery_sessions').get()).includes(target.password));
  assert.equal((await store.leaseTarget(session.id)).id,undefined);
  await internal.preflight(engine,[entry()],root); // Actual Linux host/PSI/cgroup/disk admission, not mocked.
}
const persist=async()=>{session=await store.internalSession(session.id);leases=await store.leases(session.testId);};
const realAdd=store.addLease.bind(store),realRemove=store.removeLease.bind(store);
store.addLease=async lease=>{await realAdd(lease);await persist();};
store.removeLease=async id=>{await realRemove(id);await persist();};
const checkedRun=async input=>{
  assert.equal(input.env.MYSQL_PWD,undefined);assert.equal(input.env.PGPASSWORD,undefined);
  for(const secret of [target.password]) assert(!JSON.stringify(input.args).includes(secret));
  for(const key of ['SECRET','ENCRYPTION_KEY']) assert.equal(input.env[key],undefined);
  const credentials=input.env.PGPASSFILE||input.args[0].split('=')[1];
  assert.equal((await fs.stat(credentials)).mode&0o777,0o600);assert.equal((await fs.stat(credentials)).uid,10001);
  let result;
  try { result=await runRecoveryProcess(input); } catch(error) {
    if(engine==='postgresql' && input.stage==='database-cleanup' && typeof input.input==='string' && input.input.startsWith('DROP DATABASE')) {
      const database=leases[0]?.database;
      if(/^pluton_rt_[a-f0-9]{24}$/.test(database||'')) {
        const count=await runRecoveryProcess({...input,input:`SELECT count(*) FROM pg_stat_activity WHERE datname='${database}' AND usename=current_user;`,capture:true});
        console.log(`CHECK disposable owned backend count after client cancellation: ${/^\d+$/.test(count.trim())?count.trim():'unknown'}`);
      }
    }
    console.log(`CHECK native failure ${engine} ${input.stage}/${error.code}`); throw error;
  }
  if(typeof input.input==='string' && input.input.includes('information_schema.tables')) {
    const content=await runRecoveryProcess({...input,input:'SELECT value FROM fixture_entries;',capture:true});
    assert.equal(content.trim(),'synthetic recovery content');
  }
  return result;
};
const importer=new InternalRecoveryImporter(store,internal,checkedRun);
const input=(item=entry(),password=target.password,signal=new AbortController().signal)=>({testId:session.testId,targetId:session.id,
  target:{...target,password},entry:item,file,directory:root,signal,allowedDatabases:['example_db'],stage:()=>{}});
try {
  if(action==='unavailable') {
    assert(leases.length>0);const before=JSON.stringify(leases),binding=JSON.stringify(session);
    const staleActivation=(session.activationId[0]==='a'?'b':'a')+session.activationId.slice(1);
    assert.throws(()=>internal.trust({...session,activationId:staleActivation},true),error=>error.code==='internal-target-unsafe');
    await assert.rejects(importer.cleanup(leases[0],root),error=>error.code==='database-target-unavailable');
    assert.equal(JSON.stringify(await store.leases(session.testId)),before);
    assert.equal(JSON.stringify(await store.internalSession(session.id)),binding);
    assert.equal((await store.get(session.testId)).snapshotId,snapshot);
    assert.equal(session.cleanupReady,false);assert.equal(session.releasedAt,null);
    await assert.rejects(fs.access('/run/pluton-internal-requests/request.json'),error=>error.code==='ENOENT');
    console.log(`PASS ${engine} unavailable target retains exact durable lease/activation/snapshot; stale activation refused; no cleanup approval`);
  } else if(action==='receipt') {
    assert(internal.removed(session,snapshot));assert(!internal.removed(session,'f'.repeat(64)));
    await store.completeInternalCleanup(session.id,{status:'failed'});assert.equal((await store.pendingInternalSessions()).length,0);
    console.log(`PASS ${engine} exact removal receipt and stale-snapshot refusal`);
  } else if(action==='reconcile') {
    for(const lease of [...leases]) await importer.cleanup(lease,root);
    await importer.verifyEmptyTarget({...target,id:session.id},root);assert.equal(leases.length,0);
    console.log(`PASS ${engine} container restart durable-lease cleanup`);
  } else if(['marker','existing','tls'].includes(variant)) {
    const item=entry();
    await assert.rejects(importer.importDatabase(input(item)),error=>{
      const expected=variant==='tls'?'database-tls-failed':variant==='existing'&&engine==='mariadb'?'database-already-exists':'recovery-target-unsafe';
      console.log(`CHECK ${engine} ${variant} sanitized ${error.stage}/${error.code}`);
      assert.equal(error.code,expected);assert(!JSON.stringify(error).includes(target.password));return true;
    });
    assert.equal(leases.length,0);assert.notEqual(item.importValidation,'passed');
    await assert.rejects(importer.verifyEmptyTarget({...target,id:session.id},root));
    console.log(`PASS ${engine} ${variant} refusal; no SQL mutation/removal approval`);
  } else {
    const view=await internal.readiness();assert.equal(view.find(v=>v.engine===engine).status,'ready');
    await assert.rejects(importer.importDatabase(input(entry(),'synthetic-wrong-credential')),error=>error.code==='database-authentication-failed');
    assert.equal(leases.length,0);
    console.log(`CHECK ${engine} credentials refused; import starting`);
    const item=entry();await importer.importDatabase(input(item));assert.equal(item.importValidation,'passed');assert.equal(item.tables,1);
    assert.equal(leases.length,1);
    if(variant==='restart') { await persist(); console.log(`PASS ${engine} durable restart lease prepared`);process.exit(0); }
    for(const lease of [...leases]) await importer.cleanup(lease,root);
    // Cancellation during a real SQL import is followed by ownership-checked native cleanup.
    const slow=engine==='mariadb'?'SELECT SLEEP(30);\n':'SELECT pg_sleep(30);\n';
    await fs.writeFile(file,slow,{mode:0o600});const controller=new AbortController();
    const cancelInput=input({...entry(),bytes:Buffer.byteLength(slow),sha256:crypto.createHash('sha256').update(slow).digest('hex')},target.password,controller.signal);
    let timer;cancelInput.stage=stage=>{if(stage==='database-import')timer=setTimeout(()=>controller.abort(),150);};
    try { await assert.rejects(importer.importDatabase(cancelInput),error=>error.code==='cancelled'); } finally {clearTimeout(timer);}
    for(const lease of [...leases]) await importer.cleanup(lease,root);
    await importer.verifyEmptyTarget({...target,id:session.id},root);assert.equal(leases.length,0);
    console.log(`PASS ${engine} TLS native import/content/auth/cancellation/private credentials/database cleanup`);
  }
  if(!['marker','existing','tls'].includes(variant) && !['receipt','unavailable'].includes(action)) {
    await fs.rm(root,{recursive:true});await store.markInternalCleanupReady(session.id);await persist();
    await internal.requestCleanup(session,snapshot);assert(!internal.removed(session,snapshot));await persist();
    console.log(`PASS ${engine} private workspace cleanup and operator removal pending`);
  }
} catch(error) {console.error(`FAIL internal ${engine} ${variant} ${action}: ${error.code||'assertion'}`);process.exitCode=1;}
finally {sqlite.close();}
