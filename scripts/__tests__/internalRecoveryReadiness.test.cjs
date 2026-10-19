const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const root=path.join(__dirname,'../..');
const modulePath=pathToFileURL(path.join(root,'backend/__tests__/integration/internalRecovery.readiness.mjs')).href;
test('a listener becoming available after the former three-second window is awaited, not assumed ready',async()=>{
  const {waitForReadiness}=await import(modulePath);let time=0,attempts=0;
  const result=await waitForReadiness(async()=>{attempts++;if(time<4500)throw {code:'database-target-unavailable'};},
    {now:()=>time,sleep:async ms=>{time+=ms;}});
  assert.equal(result.elapsedMs,4500);assert.equal(attempts,19);
});
test('read-only native probe timeouts are bounded; permanent unavailability never returns success',async()=>{
  const {waitForReadiness}=await import(modulePath);let time=0;
  await assert.rejects(waitForReadiness(async()=>{throw {code:'database-import-timeout'};},
    {timeoutMs:1000,now:()=>time,sleep:async ms=>{time+=ms;}}),error=>{
      assert.equal(error.code,'fixture-readiness-timeout');assert.equal(error.lastCode,'database-import-timeout');
      assert.equal(error.attempts,4);return true;
    });
  assert.equal(time,1000);
});
for(const code of ['database-authentication-failed','database-tls-failed','internal-target-unsafe',
  'recovery-target-unsafe','database-client-incompatible','untrusted-private-provider-message'])
  test(`${code} is terminal, never retried or leaked`,async()=>{
    const {waitForReadiness}=await import(modulePath);let attempts=0;
    await assert.rejects(waitForReadiness(async()=>{attempts++;throw {code,message:'synthetic-private-value'};},
      {sleep:async()=>{throw new Error('A terminal refusal must not sleep');}}),error=>{
        assert.equal(error.code,code.startsWith('untrusted')?'fixture-probe-failed':code);
        assert(!JSON.stringify(error).includes('synthetic-private-value'));return true;
      });
    assert.equal(attempts,1);
  });
test('restart harness requires real readiness and preserves ownership/cleanup assertions',()=>{
  const harness=fs.readFileSync(path.join(root,'scripts/validate-internal-recovery.ps1'),'utf8');
  assert(!harness.includes('Start-Sleep -Seconds 3'));
  assert(harness.includes('/fixture-readiness.mjs $engine $variant restart'));
  assert(harness.includes('/fixture-smoke.mjs $engine $variant unavailable'));
  assert(harness.includes('Durable lease reconciliation failed.'));
  assert(harness.includes("'Refusing foreign fixture target cleanup.'"));
  const probe=fs.readFileSync(path.join(root,'backend/__tests__/integration/internalRecovery.readiness.mjs'),'utf8');
  for(const required of ['readonly:true,fileMustExist:true',"query_only = ON",'baseline','internal.trust(session,true)',
    'ssl-verify-server-cert=ON',"PGSSLMODE:'verify-full'",'mode:0o600',"cleanupReady,false",'new Resolver({timeout:500,tries:1})'])
    assert(probe.includes(required),required);
  assert(!/shell:\s*true|process\.env|docker\.sock|CREATE DATABASE|DROP DATABASE|DELETE FROM/.test(probe));
});
