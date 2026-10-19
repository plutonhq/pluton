// Test-only readiness: no Docker access, arbitrary endpoint, import, DDL or lease mutation.
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Resolver } from 'node:dns/promises';
import { connect } from 'node:net';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const transient = new Set(['database-target-unavailable', 'database-import-timeout']);
const safeCodes = new Set([...transient, 'database-authentication-failed', 'database-tls-failed',
  'database-client-missing', 'database-client-incompatible', 'internal-target-unsafe',
  'recovery-target-unsafe', 'fixture-readiness-timeout', 'fixture-probe-failed']);
const safeCode = error => safeCodes.has(error?.code) ? error.code : 'fixture-probe-failed';
/** Only a fixed read-only probe is retried. Authentication/TLS/identity errors are terminal. */
export async function waitForReadiness(probe, {timeoutMs=45000, intervalMs=250,
  now=()=>performance.now(), sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}) {
  const start=now(); let attempts=0,lastCode;
  while(now()-start < timeoutMs) {
    attempts++;
    try { await probe(); return {attempts,elapsedMs:Math.round(now()-start)}; }
    catch(error) {
      lastCode=safeCode(error);
      if(!transient.has(lastCode)) throw Object.assign(new Error('Fixture readiness refused.'),{code:lastCode,attempts});
    }
    const remaining=timeoutMs-(now()-start);
    if(remaining>0) await sleep(Math.min(intervalMs,remaining));
  }
  throw Object.assign(new Error('Fixture readiness deadline exceeded.'),{code:'fixture-readiness-timeout',lastCode,attempts});
}
const unavailable = () => Object.assign(new Error('Fixture transport unavailable.'),{code:'database-target-unavailable'});
async function tcp(host,port) {
  return new Promise(resolve=>{
    const socket=connect({host,port});let done=false;
    const finish=value=>{if(done)return;done=true;clearTimeout(timer);socket.destroy();resolve(value);};
    const timer=setTimeout(()=>finish(false),500);
    socket.once('connect',()=>finish(true));socket.once('error',()=>finish(false));
  });
}
async function main() {
  const [engine,variant,phase]=process.argv.slice(2);
  assert(['mariadb','postgresql'].includes(engine));
  assert(['normal','marker','existing','tls','restart'].includes(variant));
  assert(['startup','restart'].includes(phase));
  assert.equal(process.getuid(),10001); assert.equal(process.getgid(),10001);
  process.umask(0o077);
  const {InternalRecoveryTargets}=await import('/app/backend/dist/utils/internalRecoveryTargets.js');
  const {runRecoveryProcess}=await import('/app/backend/dist/utils/recoveryProcess.js');
  const {detectRecoveryClient}=await import('/app/backend/dist/utils/recoveryDatabaseClients.js');
  const internal=new InternalRecoveryTargets();
  // The private fixture network is IPv4. Bound DNS as well as TCP/native SQL.
  const dns=new Resolver({timeout:500,tries:1});
  const directory=await fs.mkdtemp('/tmp/internal-readiness-');
  let sqlite,target,ca,baseline,store,session;
  const metrics={scenario:`${engine}/${variant}/${phase}`,stage:`${phase}-native-readiness`,
    dnsResolved:false,tcpReady:false,dnsWaits:0,tcpWaits:0,transportWaits:0};
  try {
    if(phase==='restart') {
      const require=createRequire('/app/backend/package.json');
      const {RecoveryTestStore}=await import('/app/backend/dist/stores/RecoveryTestStore.js');
      sqlite=new (require('better-sqlite3'))('/fixture-state/recovery.db',{readonly:true,fileMustExist:true});
      sqlite.pragma('query_only = ON');
      store=new RecoveryTestStore(require('drizzle-orm/better-sqlite3').drizzle(sqlite),await fs.readFile('/fixture-state/key','utf8'));
      [session]=await store.pendingInternalSessions(); assert(session && session.engine===engine && !session.cleanupReady);
      const row=await store.get(session.testId); assert.equal(row.snapshotId,'e'.repeat(64));
      baseline=JSON.stringify(await store.leases(session.testId)); assert((await store.leases(session.testId)).length>0);
      target=await store.leaseTarget(session.id); ca=internal.trust(session,true);
      metrics.persistedLeases=(await store.leases(session.testId)).length;
    } else {
      const activation=await internal.prepare(engine,[{engine,database:'example_db'}]);
      target=activation.target; ca=internal.trust(activation,true);
    }
    assert.equal(target.host,`internal-${engine}`); assert.equal(target.port,engine==='mariadb'?3306:5432);
    const binary=detectRecoveryClient(engine), pg=engine==='postgresql';
    const credentials=path.join(directory,pg?'pgpass':'client.cnf');
    const quote=value=>`"${value.replaceAll('\\','\\\\').replaceAll('"','\\"')}"`;
    const escape=value=>value.replaceAll('\\','\\\\').replaceAll(':','\\:');
    await fs.writeFile(credentials,pg
      ? `${escape(target.host)}:${target.port}:*:${escape(target.username)}:${escape(target.password)}\n`
      : `[client]\nprotocol=tcp\nhost=${quote(target.host)}\nport=${target.port}\nuser=${quote(target.username)}\npassword=${quote(target.password)}\nssl=ON\nssl-verify-server-cert=ON\nssl-ca=${quote(ca)}\n`,{mode:0o600,flag:'wx'});
    assert.equal((await fs.stat(credentials)).mode&0o777,0o600);
    const env={PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C',HOME:directory,TMPDIR:directory,
      ...(pg?{PGPASSFILE:credentials,PGSSLMODE:'verify-full',PGSSLROOTCERT:ca,PGGSSENCMODE:'disable',PGCONNECT_TIMEOUT:'2'}:{})};
    const args=pg?['-X','--no-password','--no-psqlrc','--quiet','--host',target.host,'--port',String(target.port),
      '--username',target.username,'--dbname','pluton_recovery_guard','--set','ON_ERROR_STOP=1','--pset','pager=off','--tuples-only','--no-align']
      :[`--defaults-file=${credentials}`,'--batch','--raw','--skip-column-names','--binary-mode','--sandbox','--local-infile=0','--skip-reconnect','--connect-timeout=2','--database=pluton_recovery_guard'];
    const ready=await waitForReadiness(async()=>{
      try {await dns.resolve4(target.host);metrics.dnsResolved=true;} catch {metrics.dnsResolved=false;metrics.dnsWaits++;metrics.transportWaits++;throw unavailable();}
      metrics.tcpReady=await tcp(target.host,target.port);
      if(!metrics.tcpReady){metrics.tcpWaits++;metrics.transportWaits++;throw unavailable();}
      const purpose=phase==='restart';
      try {
        const output=await runRecoveryProcess({binary,args,env,cwd:directory,signal:new AbortController().signal,
          stage:'database-target-preflight',timeoutMs:3000,capture:true,input:purpose?'SELECT purpose FROM pluton_recovery_guard;':'SELECT 1;'});
        if(variant==='tls') throw Object.assign(new Error('Expected invalid TLS accepted.'),{code:'fixture-probe-failed'});
        if(output.trim()!==(purpose?'pluton-phase6-recovery-only':'1'))
          throw Object.assign(new Error('Fixture target mismatch.'),{code:'recovery-target-unsafe'});
      } catch(error) {
        // Only the intentionally bad-certificate startup scenario may prepare a negative test.
        if(phase==='startup' && variant==='tls' && error.code==='database-tls-failed') return;
        throw error;
      }
    });
    if(store) {
      assert.equal(JSON.stringify(await store.leases(session.testId)),baseline);
      assert.equal((await store.internalSession(session.id)).cleanupReady,false);
    }
    console.log(JSON.stringify({kind:'fixture_readiness',...metrics,...ready,
      status:variant==='tls'?'expected-tls-refusal':'ready'}));
  } catch(error) {
    console.error(JSON.stringify({kind:'fixture_readiness',...metrics,status:'refused',code:safeCode(error),
      ...(transient.has(error.lastCode)?{lastCode:error.lastCode}:{}),attempts:error.attempts}));process.exitCode=1;
  } finally {dns.cancel();sqlite?.close();await fs.rm(directory,{recursive:true,force:true});}
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  main().catch(()=>{console.error('Fixture readiness setup refused.');process.exitCode=1;});
}
