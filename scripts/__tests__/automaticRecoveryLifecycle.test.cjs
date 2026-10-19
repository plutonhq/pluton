const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {validate,hash,reconcile,legacyRequest,disposableSql,assertMountNamespace}=require('../../deploy/automatic-recovery/operator.cjs');
const request=(mode='persistent')=>({version:1,binding:{id:'a'.repeat(24),mode,engine:'mariadb',snapshotId:'b'.repeat(64),
  artifacts:[{databaseId:'db_example',database:'example_db',sha256:'c'.repeat(64),bytes:2048}],
  createdAt:Date.now()-1000,expiresAt:Date.now()+3600000},ownerToken:'d'.repeat(48),action:'provision',cleanupReady:false});
function action(req,value,sequence=1){
  req.action=value;req.version=value==='resume'?2:1;
  delete req.resumeSequence;if(value==='resume')req.resumeSequence=sequence;
}
function setup(req=request()){
  let journal={bindingHash:hash(req),state:'requested',attempted:false},exists=false,running=false;
  const calls=[],meta={id:req.binding.id};
  const io={exists:()=>exists,busy:()=>false,admit:()=>{},
    provision:()=>{assert.equal(journal.attempted,true);calls.push('create');exists=running=true;return meta;},
    inspect:()=>{calls.push('verify');return {meta,running};},publish:()=>calls.push('publish'),
    stop:()=>{running=false;calls.push('stop');},resume:()=>{running=true;calls.push('resume');},
    remove:()=>{exists=running=false;calls.push('delete');},absent:()=>{assert.equal(exists,false);calls.push('positive-absence');}};
  const emit=(state,patch={})=>{journal={...journal,...patch,state};};
  return {req,io,calls,emit,get journal(){return journal;},run(){reconcile(req,journal,io,emit);}};
}
test('strict engine/operations/provenance input; never arbitrary Docker or caller paths',()=>{
  for(const field of ['image','command','mount','network','privileged','dockerSocket','dockerConfig','root','persistent']){
    const req=request();req[field]='not-accepted';assert.throws(()=>validate(req));
  }
  for(const engine of ['mysql']){const req=request();req.binding.engine=engine;assert.equal(validate(req),req);}
  for(const engine of ['MYSQL','__proto__','constructor']){const req=request();req.binding.engine=engine;assert.throws(()=>validate(req));}
  for(const database of ['../escape','mysql','pluton_restore_guard','postgres']){const req=request();req.binding.artifacts[0].database=database;assert.throws(()=>validate(req));}
  const duplicate=request();duplicate.binding.artifacts.push(duplicate.binding.artifacts[0]);assert.throws(()=>validate(duplicate));
});
for(const mode of ['persistent','disposable'])test(mode+' create is durable, duplicate-safe and mode bound',()=>{
  const f=setup(request(mode));f.run();assert.equal(f.journal.state,'ready');f.run();
  assert.equal(f.calls.filter(c=>c==='create').length,1);assert.equal(f.calls.includes('delete'),false);
  const forged=structuredClone(f.req);forged.binding.mode=mode==='persistent'?'disposable':'persistent';
  assert.throws(()=>reconcile(forged,f.journal,f.io,f.emit),{code:'ownership-token-mismatch'});
});
test('retained Active survives reconciliation; never automatically re-start a stopped container',()=>{
  const f=setup();f.run();f.req.action='stop';f.run();f.run();assert.equal(f.calls.filter(c=>c==='stop').length,1);
  f.req.action='provision';f.run();assert.equal(f.journal.state,'stopped');assert.equal(f.calls.includes('resume'),false);
  action(f.req,'resume');f.run();assert.equal(f.journal.state,'ready');
});
test('operator restart resumes only an exact created-but-never-ready container, without another create',()=>{
  const f=setup();f.emit('starting-database',{attempted:true});
  f.io.exists=()=>true;f.run();
  assert.equal(f.calls.includes('create'),false);assert.equal(f.calls.includes('resume'),true);
  assert.equal(f.journal.state,'ready');assert.equal(f.journal.readyOnce,true);
});

for(const engine of ['mariadb','postgresql','mysql'])test(engine+' consumed Resume is not replayed after restart; a fresh explicit request still works',()=>{
  const req=request();req.binding.engine=engine;
  const f=setup(req);f.run();f.req.action='stop';f.run();action(f.req,'resume');
  reconcile(f.req,f.journal,f.io,f.emit,Date.now(),'first-mailbox-revision');
  assert.equal(f.calls.filter(c=>c==='resume').length,1);
  f.io.stop(); // A later Docker/guest restart, without changing the mailbox.
  reconcile(f.req,f.journal,f.io,f.emit,Date.now(),'first-mailbox-revision');
  assert.equal(f.journal.state,'stopped');assert.equal(f.calls.filter(c=>c==='resume').length,1);
  reconcile(f.req,f.journal,f.io,f.emit,Date.now(),'new-explicit-api-revision');
  assert.equal(f.journal.state,'stopped');assert.equal(f.calls.filter(c=>c==='resume').length,1);
  action(f.req,'resume',2);
  reconcile(f.req,f.journal,f.io,f.emit,Date.now(),'new-explicit-api-revision');
  assert.equal(f.journal.state,'ready');assert.equal(f.calls.filter(c=>c==='resume').length,2);
  f.io.stop();const {resumeRevision,...oldJournal}=f.journal;
  reconcile(f.req,oldJournal,f.io,f.emit,Date.now(),'legacy-ready-mailbox');
  assert.equal(f.journal.state,'stopped');assert.equal(f.calls.filter(c=>c==='resume').length,2);
  assert.equal(f.journal.consumedResumeSequence,2);
});

for(const engine of ['mariadb','postgresql','mysql'])test(engine+' consumes before Start; a crash burns authority and recovery requires a new explicit sequence',()=>{
  const req=request();req.binding.engine=engine;const f=setup(req);f.run();action(req,'stop');f.run();action(req,'resume');
  const resume=f.io.resume;
  f.io.resume=()=>{assert.equal(f.journal.consumedResumeSequence,1);throw new Error('crash after durable consumption, before Start');};
  assert.throws(()=>f.run(),/crash after durable consumption/);
  assert.equal(f.journal.consumedResumeSequence,1);assert.equal(f.calls.includes('resume'),false);
  f.io.resume=resume;
  reconcile(req,f.journal,f.io,f.emit,Date.now(),'reconstructed-after-crash');
  assert.equal(f.journal.state,'stopped');assert.equal(f.calls.includes('resume'),false);
  action(req,'resume',2);f.run();assert.equal(f.journal.consumedResumeSequence,2);
  assert.equal(f.calls.filter(c=>c==='resume').length,1);
  action(req,'stop');f.run();action(req,'resume',1);f.run();
  assert.equal(f.journal.state,'stopped');assert.equal(f.journal.consumedResumeSequence,2);
  assert.equal(f.calls.filter(c=>c==='resume').length,1);
  action(req,'delete');f.run();assert.equal(f.journal.consumedResumeSequence,2);
  req.cleanupReady=true;f.run();assert.equal(f.journal.state,'removed');assert.equal(f.journal.consumedResumeSequence,2);
});

test('a failed durable consumption write prevents Start; already-running explicit Resume is still consumed',()=>{
  const f=setup();f.run();action(f.req,'stop');f.run();action(f.req,'resume');
  assert.throws(()=>reconcile(f.req,f.journal,f.io,()=>{throw new Error('journal fsync failed');}),/journal fsync failed/);
  assert.equal(f.calls.includes('resume'),false);assert.equal(f.journal.consumedResumeSequence,undefined);
  f.run();assert.equal(f.calls.filter(c=>c==='resume').length,1);
  action(f.req,'resume',2);f.run();assert.equal(f.journal.consumedResumeSequence,2);
  f.io.stop();f.run();assert.equal(f.journal.state,'stopped');assert.equal(f.calls.filter(c=>c==='resume').length,1);
});

test('a burned Resume cannot be bypassed by an older provision request even before first readiness',()=>{
  const f=setup();f.emit('stopped',{attempted:true});f.io.exists=()=>true;
  action(f.req,'resume');f.io.resume=()=>{throw new Error('crash before first readiness');};
  assert.throws(()=>f.run(),/crash before first readiness/);
  assert.equal(f.journal.consumedResumeSequence,1);assert.equal(f.journal.readyOnce,undefined);
  action(f.req,'provision');f.run();assert.equal(f.journal.state,'stopped');
  assert.equal(f.calls.includes('resume'),false);
  assert.throws(()=>reconcile(f.req,{...f.journal,consumedResumeSequence:null},f.io,f.emit),{code:'operator-state-unsafe'});
});

test('legacy Resume never starts, but observation, Stop, Inspect and Delete remain usable',()=>{
  const f=setup();f.run();f.req.action='resume';f.run();
  assert.equal(f.journal.state,'ready');assert.equal(f.journal.consumedResumeSequence,undefined);
  f.io.stop();f.run();assert.equal(f.journal.state,'stopped');assert.equal(f.calls.includes('resume'),false);
  action(f.req,'resume');f.run();assert.equal(f.journal.consumedResumeSequence,1);
  for(const value of ['stop','inspect']){action(f.req,value);f.run();assert.equal(f.journal.state,'stopped');}
  f.req.action='resume';f.run();assert.equal(f.journal.state,'stopped');assert.equal(f.journal.consumedResumeSequence,1);
  action(f.req,'delete');f.req.cleanupReady=true;f.run();assert.equal(f.journal.state,'removed');
  assert.equal(f.journal.consumedResumeSequence,1);
});

test('strict versioned Resume sequence and corrupted consumed authority fail closed without reset',()=>{
  for(const sequence of [undefined,null,0,-1,1.5,'1',Number.MAX_SAFE_INTEGER+1]){
    const req=request();action(req,'resume',sequence);if(sequence===undefined)delete req.resumeSequence;
    assert.throws(()=>validate(req),{code:'request-unsafe'});
  }
  const req=request();req.resumeSequence=1;assert.throws(()=>validate(req),{code:'request-unsafe'});
  req.version=2;assert.throws(()=>validate(req),{code:'request-unsafe'});
  for(const consumed of [null,-1,1.5,'1',Number.MAX_SAFE_INTEGER+1]){
    const f=setup();f.run();action(f.req,'stop');f.run();action(f.req,'resume');
    assert.throws(()=>reconcile(f.req,{...f.journal,consumedResumeSequence:consumed},f.io,f.emit),{code:'operator-state-unsafe'});
    assert.equal(f.calls.includes('resume'),false);
  }
});
test('cancellation before creation requires positive absence, never creates',()=>{
  const f=setup();f.req.action='delete';f.run();assert.equal(f.journal.state,'removed');
  assert.deepEqual(f.calls,['positive-absence']);f.run();assert.equal(f.calls.length,1);
});
test('native cleanup ACK is required before exact physical deletion; repeated Delete safe',()=>{
  const f=setup();f.run();f.req.action='delete';f.run();assert.equal(f.calls.includes('delete'),false);
  f.req.cleanupReady=true;f.run();assert.equal(f.journal.state,'removed');f.run();
  assert.equal(f.calls.filter(c=>c==='delete').length,1);
});
test('a cancellation awaiting native cleanup cannot be overwritten by a stale provision or resume',()=>{
  const f=setup();f.run();f.req.action='delete';f.run();assert.equal(f.journal.cancelled,true);
  f.req.action='provision';assert.throws(()=>f.run(),{code:'deletion-in-progress'});
  action(f.req,'resume');assert.throws(()=>f.run(),{code:'deletion-in-progress'});
});
test('crash during removal resumes durable deletion rather than re-inspecting a deleted container',()=>{
  const f=setup();f.run();f.req.action='delete';f.req.cleanupReady=true;
  const original=f.io.remove;f.io.remove=()=>{throw new Error('daemon unavailable');};
  assert.throws(()=>f.run());assert.equal(f.journal.deleting,true);
  f.io.inspect=()=>{throw new Error('container already removed');};f.io.remove=original;
  f.run();assert.equal(f.journal.state,'removed');
});
test('partial creation/collision/unknown resource and wrong token are retained, never adopted',()=>{
  const f=setup();f.io.provision=()=>{throw new Error('partial Docker create');};assert.throws(()=>f.run());
  assert.throws(()=>f.run(),{code:'partial-provisioning-uncertain'});assert.equal(f.calls.includes('delete'),false);
  const collision=setup();collision.io.exists=()=>true;assert.throws(()=>collision.run(),{code:'resource-name-collision'});
  const changed=setup();changed.req.ownerToken='f'.repeat(48);assert.throws(()=>changed.run(),{code:'ownership-token-mismatch'});
});
test('resource refusal, disk/quota failure, daemon offline and ownership failure never create twice',()=>{
  for(const code of ['ram','disk','quota','daemon-offline','ownership-mismatch']){
    const f=setup();f.io.provision=()=>{throw Object.assign(new Error('sanitized fixture failure'),{code});};
    assert.throws(()=>f.run());assert.equal(f.journal.attempted,true);
    assert.throws(()=>f.run(),{code:'partial-provisioning-uncertain'});
  }
});
test('pre-creation admission failure is safely retryable after RAM, disk or daemon availability recovers',()=>{
  const f=setup();f.io.admit=()=>{throw new Error('resources unavailable');};
  assert.throws(()=>f.run());assert.equal(f.journal.attempted,false);assert.equal(f.calls.includes('create'),false);
  f.io.admit=()=>{};f.run();assert.equal(f.journal.state,'ready');
});
test('one heavy Internal resource, TTL refusal and no resurrection after delete intent',()=>{
  const f=setup();f.io.busy=()=>true;assert.throws(()=>f.run(),{code:'internal-lifecycle-busy'});
  f.io.busy=()=>false;f.req.binding.expiresAt=Date.now()-1;f.req.binding.createdAt=Date.now()-10000;
  assert.throws(()=>reconcile(f.req,{bindingHash:hash(f.req)},f.io,f.emit),{code:'request-expired'});
  const fresh=setup();fresh.run();fresh.req.action='delete';fresh.req.cleanupReady=true;
  fresh.io.remove=()=>{throw new Error('interrupted');};assert.throws(()=>fresh.run());
  action(fresh.req,'resume');assert.throws(()=>fresh.run(),{code:'deletion-in-progress'});
});
test('MySQL expiry refuses access or Resume and still requires native cleanup before exact removal',()=>{
  const req=request();req.binding.engine='mysql';const f=setup(req);f.run();
  const binding=hash(req),expired=req.binding.expiresAt+1;
  assert.throws(()=>reconcile(req,f.journal,f.io,f.emit,expired),{code:'request-expired'});
  action(req,'resume');assert.throws(()=>reconcile(req,f.journal,f.io,f.emit,expired),{code:'request-expired'});
  assert.equal(hash(req),binding);assert.equal(f.calls.includes('delete'),false);
  action(req,'delete');reconcile(req,f.journal,f.io,f.emit,expired);
  assert.equal(f.journal.cancelled,true);assert.equal(f.calls.includes('delete'),false);
  req.cleanupReady=true;reconcile(req,f.journal,f.io,f.emit,expired);reconcile(req,f.journal,f.io,f.emit,expired);
  assert.equal(f.journal.state,'removed');assert.equal(f.calls.filter(c=>c==='delete').length,1);
});
test('MySQL cancellation before provisioning proves absence without creating a target',()=>{
  for(const mode of ['disposable','persistent']){
    const req=request(mode);req.binding.engine='mysql';req.action='delete';const f=setup(req);
    f.run();f.run();assert.equal(f.journal.state,'removed');assert.deepEqual(f.calls,['positive-absence']);
  }
});
test('MySQL partial creation is never retried; interrupted cleanup uses the durable deletion path',()=>{
  const req=request();req.binding.engine='mysql';const partial=setup(req);
  partial.io.provision=()=>{throw new Error('synthetic partial creation');};
  assert.throws(()=>partial.run());assert.throws(()=>partial.run(),{code:'partial-provisioning-uncertain'});
  assert.equal(partial.calls.includes('delete'),false);
  const cleanReq=request();cleanReq.binding.engine='mysql';const f=setup(cleanReq);f.run();
  f.req.action='delete';f.req.cleanupReady=true;const remove=f.io.remove;
  f.io.remove=()=>{throw new Error('synthetic interrupted cleanup');};assert.throws(()=>f.run());
  assert.equal(f.journal.deleting,true);f.io.inspect=()=>{throw new Error('must not adopt a removed container');};
  f.io.remove=remove;f.run();f.run();assert.equal(f.journal.state,'removed');
  assert.equal(f.calls.filter(c=>c==='create').length,1);assert.equal(f.calls.filter(c=>c==='delete').length,1);
});
test('disposable guards stay independent and non-admin; fixed quota/images/non-root/ports in runtime',()=>{
  const sql=disposableSql(['example_db'],'mariadb','example_db','a'.repeat(64),'b'.repeat(32),'c'.repeat(32),'restore_user');
  assert.match(sql,/pluton-phase6-recovery-only/);assert.doesNotMatch(sql,/pluton-persistent-database-restore|GRANT ALL.*\*\.\*|GRANT OPTION/);
  const pg=disposableSql(['example_db'],'postgresql','example_db','a'.repeat(64),'b'.repeat(32),'c'.repeat(32),'restore_user');
  assert.match(pg,/NOSUPERUSER CREATEDB NOCREATEROLE/);
  const src=fs.readFileSync('deploy/persistent-restore/operator.cjs','utf8');
  assert.match(src,/--pull','never'/);assert.match(src,/--user','999:999/);assert.match(src,/--memory','2g/);
  assert.match(src,/org\.pluton\.automatic\.binding/);assert.match(src,/RestartPolicy/);assert.doesNotMatch(src,/'--publish'|'--privileged'|'--network','host'/);
  assert.match(src,/DOCKER_HOST:options\.dockerSocket\?'unix:\/\/'\+options\.dockerSocket:'unix:\/\/\/var\/run\/docker.sock'/);
  assert.doesNotMatch(src,/DOCKER_HOST:process\.env|dockerSocket:process\.env/);
  assert.match(src,/foreign-control-volume/);
  const overlay=fs.readFileSync('deploy/compose.automatic-recovery.yml','utf8');
  assert.doesNotMatch(overlay,/docker\.sock|privileged:|ports:/);assert.match(overlay,/create_host_path: false/);
  const service=fs.readFileSync('deploy/automatic-recovery/pluton-recovery-lifecycle.service','utf8');
  assert.match(service,/PrivateTmp=true/);assert.match(service,/ProtectHome=true/);
  assert.equal(legacyRequest(request('disposable')).purpose,'pluton-phase6-recovery-only');
});
test('installation bind anchors require the host mount namespace; isolation is never escaped',()=>{
  assert.doesNotThrow(()=>assertMountNamespace('mnt:[123]','mnt:[123]'));
  assert.throws(()=>assertMountNamespace('mnt:[456]','mnt:[123]'),{code:'operator-mount-namespace-unapproved'});
  assert.throws(()=>assertMountNamespace('unknown','unknown'),{code:'operator-mount-namespace-unapproved'});
});
