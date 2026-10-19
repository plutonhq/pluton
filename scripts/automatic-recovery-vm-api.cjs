'use strict';
// Authenticated API acceptance client; no service substitution or in-process
// invocation. All state is private to the recorded disposable VM installation.
const fs=require('node:fs'),http=require('node:http'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const fixture=process.argv[2],action=process.argv[3],engine=process.argv[4];
assert.equal(process.getuid(),0);assert.match(fixture,/^\/srv\/pluton-fixture\/lifecycle-lab-[a-f0-9]{32}$/);
assert.equal(fs.realpathSync(fixture),fixture);
const manifest=JSON.parse(fs.readFileSync(fixture+'/manifest.json'));assert.equal(manifest.purpose,'disposable-lifecycle-rehearsal');
const api=fixture+'/api',ids=JSON.parse(fs.readFileSync(api+'/containers.json'));
const env={PATH:'/usr/sbin:/usr/bin:/sbin:/bin',LANG:'C',DOCKER_HOST:'unix://'+fixture+'/docker.sock',DOCKER_CONFIG:fixture+'/docker-client'};
const c=JSON.parse(execFileSync('docker',['inspect',ids.app],{env,encoding:'utf8'}))[0];
assert.equal(c.Config.Labels['org.pluton.fixture'],manifest.scope);assert(c.State.Running);
const address=action==='visual-readiness'?'127.0.0.1':Object.values(c.NetworkSettings.Networks)[0].IPAddress;
const port=action==='visual-readiness'?15174:5173;
let cookie=fs.existsSync(api+'/cookie')?fs.readFileSync(api+'/cookie','utf8'):'';
if(action==='visual-readiness')cookie=''; // Exercise normal login through the actual loopback proxy.
function event(name,fields={}){const line=JSON.stringify({event:name,...fields})+'\n';fs.appendFileSync(fixture+'/evidence.ndjson',line,{mode:0o600});process.stdout.write(line);}
function write(file,value){fs.writeFileSync(file,JSON.stringify(value),{mode:0o600});}
async function request(path,body,expected=200,headers={}){
  const result=await new Promise((resolve,reject)=>{
    const payload=body===undefined?null:JSON.stringify(body);
    const req=http.request({host:address,port,path,method:payload?'POST':'GET',timeout:90000,
      headers:{Host:'127.0.0.1:15173',Origin:'http://127.0.0.1:15173','Content-Type':'application/json',Cookie:cookie,
        ...(payload?{'Content-Length':Buffer.byteLength(payload)}:{}),...headers}},res=>{
      let data='';res.on('data',chunk=>{data+=chunk;if(data.length>1048576)res.destroy();});
      res.on('end',()=>{try{resolve({status:res.statusCode,value:JSON.parse(data),cookies:res.headers['set-cookie']});}catch{reject(new Error('non-json'));}});
    });req.on('timeout',()=>req.destroy(new Error('timeout')));req.on('error',()=>reject(new Error('API unavailable')));req.end(payload);
  });
  if(action==='visual-readiness'&&path==='/api/user/login'){
    const token=result.cookies?.find(value=>value.startsWith('token='));assert(token);
    assert.match(token,/; HttpOnly(?:;|$)/i);assert.match(token,/; SameSite=Lax(?:;|$)/i);
    assert.match(token,/; Path=\/(?:;|$)/i);assert.doesNotMatch(token,/; (?:Secure|Domain=)/i);
  }
  if(result.cookies){cookie=result.cookies.map(value=>value.split(';')[0]).join('; ');fs.writeFileSync(api+'/cookie',cookie,{mode:0o600});}
  if(result.status!==expected){
    // Only known public sanitized API errors; never arbitrary provider output.
    const safe=['capacity','resource','snapshot','repository','credentials','SFTP','JSON','origin','Too many','managed','completed','workload','request','binding','database'];
    event('api_unexpected_status',{action,status:result.status,errorCategory:safe.find(word=>String(result.value.error||'').toLowerCase().includes(word.toLowerCase()))||'other'});
    write(api+'/last-response.json',result.value);throw new Error('Unexpected API status');
  }
  return result.value.result===undefined?result.value:result.value.result;
}
(async()=>{
  if(!cookie)await request('/api/user/login',JSON.parse(fs.readFileSync(api+'/login.json')));
  if(action==='health'){
    await request('/api/health');await request('/api/user/validate');
    event('authenticated_full_application_healthy');return;
  }
  if(action==='visual-readiness'){
    await request('/api/user/validate');
    await request('/api/user/validate',undefined,401,{Cookie:''});
    const selections=JSON.parse(fs.readFileSync(api+'/snapshots.json'));
    for(const selection of selections){
      const plan=await request('/api/plans/'+selection.planId+'?backupHistory=summary');
      assert.equal(plan.isActive,false);assert.equal(plan.settings.interval.type,'daily');
      assert.equal(plan.settings.prune.snapCount,5);assert(plan.stats.snapshots.includes(selection.snapshotId));
      assert(plan.backups.some(row=>row.id===selection.backupId&&row.status==='completed'&&row.started&&row.ended));
      const history=await request('/api/plans/'+selection.planId+'/backups?page=1&pageSize=10');
      assert(history.items.some(row=>row.id===selection.backupId));
      const preview=await request('/api/database-restores/preparation',{
        planId:selection.planId,backupId:selection.backupId,snapshotId:selection.snapshotId});
      assert.equal(preview.snapshotId,selection.snapshotId);assert(preview.lifecycle.available);
      event('visual_fixture_plan_ready',{engine:selection.engine,exactSnapshot:true,paused:true,history:true,automaticAvailable:true});
    }
    const restores=await request('/api/database-restores');assert.deepEqual(restores,[]);
    event('visual_fixture_normal_login_verified',{httpOnly:true,sameSite:'lax',hostOnly:true,loopbackHttp:true,
      noAutoLogin:true,anonymousRefused:true,emptyRestoreHistory:true});return;
  }
  if(action==='security'){
    const sample=JSON.parse(fs.readFileSync(api+'/snapshots.json'))[0];
    const selection={planId:sample.planId,backupId:sample.backupId,snapshotId:sample.snapshotId};
    await request('/api/database-restores/preparation',selection,401,{Cookie:''});
    await request('/api/database-restores/preparation',selection,403,{Origin:'https://attacker.example'});
    await request('/api/database-restores/preparation',selection,403,{'Content-Type':'text/plain'});
    await request('/api/database-restores/preparation',selection,403,{Host:'attacker.example','X-Forwarded-Host':'127.0.0.1:15173'});
    await request('/api/database-restores/preparation',selection,403,{Origin:'https://attacker.example','X-Forwarded-Proto':'https'});
    event('real_api_auth_origin_json_boundaries_verified',{noAuthRefused:true,crossOriginRefused:true,forgedHostRefused:true,forgedForwardedRefused:true});
    return;
  }
  assert(['mariadb','postgresql','mysql'].includes(engine));
  const selection=JSON.parse(fs.readFileSync(api+'/snapshots.json')).find(row=>row.engine===engine);
  const {planId,backupId,snapshotId,databaseId}=selection;
  const record=api+'/'+engine+'-restore.json',recovery=api+'/'+engine+'-recovery.json';
  if(action==='preview'||action==='restore'){
    const preview=await request('/api/database-restores/preparation',{planId,backupId,snapshotId});
    assert.equal(preview.snapshotId,snapshotId);assert.equal(preview.databases[0].databaseId,databaseId);assert(preview.lifecycle.available);
    assert(!JSON.stringify(preview).includes('ownerToken'));write(api+'/'+engine+'-preview.json',preview);
    event('real_snapshot_preparation_passed',{engine,exactSnapshot:true,sqlArtifact:true,lifecycleAvailable:true,
      resources:preview.resources.sample?{hostMiB:Math.round(preview.resources.sample.total/1024**2),availableMiB:Math.round(preview.resources.sample.available/1024**2),serverMiB:Math.round(preview.resources.sample.limit/1024**2)}:null});
    if(action==='restore'){
      const row=await request('/api/database-restores',{planId,backupId,snapshotId,databaseId,metadataToken:preview.metadataToken,
        mode:'internal',ttlSeconds:process.argv[5]==='retained-boot'?86400:3600,resourcesAcknowledged:true,securityAcknowledged:true},202);
      write(record,{id:row.id,snapshotId});event('persistent_api_request_accepted',{engine});
    }
  }else if(action==='status'||['inspect','stop','resume','delete'].includes(action)){
    const id=JSON.parse(fs.readFileSync(record)).id;
    let row;
    if(action==='status')row=await request('/api/database-restores/'+id);
    else {
      row=await request('/api/database-restores/'+id+'/'+action,action==='delete'?{confirmation:id}:{},['delete','stop','resume'].includes(action)?202:200);
      if(!row.snapshotId)row=await request('/api/database-restores/'+id);
    }
    write(api+'/'+engine+'-status.json',row);
    assert.equal(row.snapshotId,snapshotId);assert(!JSON.stringify(row).includes('ownerToken'));
    event('persistent_api_state',{engine,operation:action,status:row.status,stage:row.stage,cleanup:row.cleanup,errorCode:row.errorCode,
      tables:row.inspection?.tables,hostState:row.lifecycle?.state,expired:row.expired});
  }else if(action==='recovery'){
    const preview=await request('/api/recovery-testing/'+planId+'/preparation',{backupId,snapshotId});
    assert.equal(preview.snapshotId,snapshotId);
    const row=await request('/api/recovery-testing/'+planId+'/tests',{backupId,snapshotId,metadataToken:preview.metadataToken,
      selection:{databaseImport:'required',targetModes:{[engine]:'internal'}},resourcesAcknowledged:true},202);
    write(recovery,{id:row.id,snapshotId});event('recovery_api_request_accepted',{engine,exactSnapshot:true});
  }else if(action==='recovery-status'){
    const row=await request('/api/recovery-testing/'+planId+'/tests/'+JSON.parse(fs.readFileSync(recovery)).id);
    write(api+'/'+engine+'-recovery-status.json',row);assert.equal(row.snapshotId,snapshotId);
    event('recovery_api_state',{engine,status:row.status,stage:row.stage,failureCode:row.failureCode,
      cleanup:row.result?.cleanup,databases:row.result?.databases?.map(d=>({engine:d.engine,artifact:d.artifactValidation,import:d.importValidation,tables:d.tables}))});
  }else throw new Error('Unsupported API fixture action');
})().catch(()=>{process.stderr.write(JSON.stringify({event:'api_acceptance_refused',action,engine})+'\n');process.exitCode=1;});
