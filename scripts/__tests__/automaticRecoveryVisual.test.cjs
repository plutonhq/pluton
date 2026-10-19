const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

test('visual fixture has normal plan UI structures and measured exact snapshot stats, with no scheduled writes',async()=>{
  const {visualPlanSettings,visualSnapshotStats}=await import('../../backend/__tests__/integration/automaticRecoveryVisual.fixture.mjs');
  const settings=visualPlanSettings();
  assert.equal(settings.interval.type,'daily');assert.equal(settings.prune.snapCount,5);
  assert.equal(settings.integrity.enabled,false);assert.equal(settings.replication.enabled,false);
  for(const channel of Object.values(settings.notification))assert.equal(channel.enabled,false);
  const fresh=visualPlanSettings();settings.prune.snapCount=1;assert.equal(fresh.prune.snapCount,5);
  const summary={snapshot_id:'a'.repeat(64),total_files_processed:2,total_bytes_processed:200};
  assert.deepEqual(visualSnapshotStats(summary),{size:200,snapshots:[summary.snapshot_id]});
  for(const patch of [{snapshot_id:'latest'},{total_files_processed:undefined},{total_bytes_processed:-1}])
    assert.throws(()=>visualSnapshotStats({...summary,...patch}));
  const seed=fs.readFileSync('backend/__tests__/integration/automaticRecoveryApi.seed.mjs','utf8');
  assert.match(seed,/visualPlanSettings\(\),?\)/);assert.match(seed,/JSON.stringify\(stats\)/);
  assert.match(seed,/started_at=\?,ended_at=\?/);assert.match(seed,/SELECT count\(\*\) n FROM plans/);
});

function browserFixture(){
  const fixture='/srv/pluton-fixture/lifecycle-lab-'+'a'.repeat(32),calls=[];
  let handler,listener;
  const request={on(){return this;}};
  const server={listen(...args){listener=args;},close(){}};
  const http={createServer(callback){handler=callback;return server;},request(options,callback){calls.push({options,callback});return request;}};
  const filesystem={realpathSync:p=>p,readFileSync:p=>{
    if(p===fixture+'/manifest.json')return JSON.stringify({purpose:'disposable-lifecycle-rehearsal'});
    if(p===fixture+'/api/browser.json')return JSON.stringify({address:'172.20.0.2'});
    throw new Error('Browser proxy must not read credentials.');
  }};
  vm.runInNewContext(fs.readFileSync('scripts/automatic-recovery-vm-browser.cjs','utf8'),{
    require:name=>({'node:fs':filesystem,'node:http':http,'node:assert/strict':assert})[name],
    process:{argv:['node','fixture',fixture],getuid:()=>0,on(){}},
  },{filename:path.resolve('scripts/automatic-recovery-vm-browser.cjs')});
  const invoke=(patch={})=>{
    const response={code:null,headers:null,writeHead(code,headers){this.code=code;this.headers=headers;},end(){}};
    let piped=false;
    const input={url:'/api/user/validate',method:'GET',headers:{host:'127.0.0.1:15173'},socket:{remoteAddress:'127.0.0.1'},
      pipe(value){assert.equal(value,request);piped=true;},...patch};
    handler(input,response);return {response,input,piped};
  };
  return {invoke,calls,listener,server};
}
test('browser fixture stays loopback-only with no auto-login, credentials or caller-selectable upstream',()=>{
  const f=browserFixture();assert.deepEqual(Array.from(f.listener),[15174,'127.0.0.1']);
  for(const patch of [{url:'/__fixture/login'},{headers:{host:'attacker.example'}},{socket:{remoteAddress:'192.0.2.10'}}]){
    const value=f.invoke(patch);assert([403,404].includes(value.response.code));assert.equal(value.piped,false);
  }
  assert.equal(f.calls.length,0);assert.equal(f.server.maxConnections,16);
});
test('proxy preserves login/session/origin responses, strips forwarded input and never authenticates an anonymous request',()=>{
  const f=browserFixture(),origin='http://127.0.0.1:15173';
  const value=f.invoke({url:'/api/user/login',method:'POST',headers:{host:'127.0.0.1:15173',origin,cookie:'synthetic-cookie',
    'content-type':'application/json','x-forwarded-host':'attacker.example','x-forwarded-proto':'https','x-forwarded-for':'192.0.2.10',forwarded:'host=attacker.example'}});
  const forwarded=f.calls[0].options;
  assert.equal(forwarded.host,'172.20.0.2');assert.equal(forwarded.path,'/api/user/login');assert.equal(forwarded.method,'POST');
  assert.equal(forwarded.headers.origin,origin);assert.equal(forwarded.headers.cookie,'synthetic-cookie');
  for(const name of ['x-forwarded-host','x-forwarded-proto','x-forwarded-for','forwarded'])assert.equal(forwarded.headers[name],undefined);
  const headers={'set-cookie':['token=synthetic-cookie; HttpOnly; SameSite=Lax']};
  f.calls[0].callback({statusCode:401,headers,pipe:out=>assert.equal(out,value.response)});
  assert.equal(value.response.code,401);assert.equal(value.response.headers,headers);
  f.invoke();assert.equal(f.calls[1].options.headers.cookie,undefined);
});
