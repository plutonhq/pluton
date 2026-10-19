'use strict';
// Root-only fixture on the explicitly authorized disposable KVM guest. No
// production path/profile, root shell protocol or caller-selected command.
const fs=require('node:fs'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const fixture=process.argv[2],action=process.argv[3];
assert.equal(process.getuid(),0);assert.match(fixture,/^\/srv\/pluton-fixture\/lifecycle-lab-[a-f0-9]{32}$/);
assert.equal(fs.realpathSync(fixture),fixture);
const manifest=JSON.parse(fs.readFileSync(fixture+'/manifest.json','utf8')),tag=manifest.scope;
assert.equal(manifest.purpose,'disposable-lifecycle-rehearsal');assert.equal(fixture.split('-').at(-1),tag);
const env={PATH:'/usr/sbin:/usr/bin:/sbin:/bin',LANG:'C',LC_ALL:'C',DOCKER_HOST:'unix://'+fixture+'/docker.sock',DOCKER_CONFIG:fixture+'/docker-client'};
const run=(file,args,timeout=90000)=>execFileSync(file,args,{env,encoding:'utf8',timeout,killSignal:'SIGKILL',maxBuffer:1048576,stdio:['ignore','pipe','pipe']}).trim();
const persistent=require('../deploy/persistent-restore/operator.cjs'),{createLifecycleOperator}=require('../deploy/automatic-recovery/operator.cjs');
const options={root:fixture+'/automatic/config',data:fixture+'/automatic/data',requests:fixture+'/automatic/requests',
  persistent:{root:fixture+'/retained/config',data:fixture+'/retained/data',requests:fixture+'/retained/requests',network:'pluton-lab-retained-'+tag},
  dockerSocket:fixture+'/docker.sock',dockerUnit:manifest.dockerUnit,disposableNetwork:'pluton-lab-tests-'+tag,lock:'pluton-lab-lock-'+tag};
const op=createLifecycleOperator(options),api=fixture+'/api',runtime='sha256:12f4747e4c563b01a2ce974cd9829a9f704335480583da8994be0b20e612b44a';
const prefix='pluton-lab-boot-'+tag,code=fixture+'/code',unitDirectory='/etc/systemd/system';
const write=(file,value)=>persistent.write(file,value);
function event(name,values={}){const line=JSON.stringify({event:name,...values})+'\n';fs.appendFileSync(fixture+'/evidence.ndjson',line,{mode:0o600});process.stdout.write(line);}
function container(name){return JSON.parse(run('docker',['inspect',name]))[0];}
function appId(){return JSON.parse(fs.readFileSync(api+'/containers.json','utf8')).app;}
function bind(source,target,mode='readonly'){return ['--mount','type=bind,source='+source+',target='+target+(mode?','+mode:'')];}
function sandbox(){assert.notEqual(fs.readlinkSync('/proc/self/ns/mnt'),fs.readlinkSync('/proc/1/ns/mnt'));
  assert.match(fs.readFileSync('/proc/self/status','utf8'),/^NoNewPrivs:\s+1$/m);}
function profiles(){return [options.persistent.data,op.DATA+'/disposable'];}
try{
  persistent.rootCode(__filename);assert.equal(run('/usr/bin/systemd-detect-virt',['--vm']),'kvm');
  if(action==='anchors'){op.assertAnchors();event('persistent_boot_anchors_verified');}
  else if(action==='tick'){sandbox();op.tick();}
  else if(action==='start'||action==='stop'){
    sandbox();op.assertAnchors();const c=container(appId());assert.equal(c.Config.Labels['org.pluton.fixture'],tag);
    assert.equal(c.Config.User,'10001:10001');assert.equal(c.HostConfig.RestartPolicy.Name,'on-failure');
    assert.equal(c.Image,runtime);assert.equal(c.HostConfig.Privileged,false);
    const repository=container(JSON.parse(fs.readFileSync(api+'/containers.json','utf8')).sftp);
    assert.equal(repository.Config.Labels['org.pluton.fixture'],tag);assert.equal(repository.Config.User,'10001:10001');
    assert.equal(repository.Image,runtime);assert.equal(repository.HostConfig.Privileged,false);
    if(action==='start')run('docker',['start',repository.Id]);
    run('docker',[action==='start'?'start':'stop',...(action==='stop'?['--time','30']:[]),c.Id]);
    if(action==='stop')run('docker',['stop','--time','10',repository.Id]);
    event('ordered_application_'+action);
  }else if(action==='prepare'){
    assert(!fs.existsSync(api));fs.mkdirSync(api,{mode:0o755});fs.chmodSync(api,0o755);
    for(const name of ['private','repositories','source','sql']){fs.mkdirSync(api+'/'+name,{mode:0o700});fs.chownSync(api+'/'+name,10001,10001);}
    const password=crypto.randomBytes(32).toString('base64url');
    write(api+'/private/credentials.json',{sftpPassword:crypto.randomBytes(32).toString('base64url')});
    fs.chownSync(api+'/private/credentials.json',10001,10001);
    const appEnv=['NODE_ENV=production','IS_DOCKER=true','SERVER_PORT=5173','PLUTON_DATA_DIR=/data',
      'ENCRYPTION_KEY='+crypto.randomBytes(32).toString('hex'),'SECRET='+crypto.randomBytes(32).toString('hex'),
      'USER_NAME=fixture_admin','USER_PASSWORD='+password,'APP_URL=http://127.0.0.1:15173','PLUTON_AUTOMATIC_RECOVERY=enabled'];
    write(api+'/app.env',appEnv.join('\n')+'\n');write(api+'/login.json',{username:'fixture_admin',password});
    const volume='pluton-lab-api-'+tag;run('docker',['volume','create','--label','org.pluton.fixture='+tag,volume]);
    write(api+'/volume.json',{name:volume});
    const mounts=[...bind(code+'/backend/dist','/app/backend/dist'),...bind(code+'/backend/drizzle','/app/drizzle'),
      ...bind(code+'/backend/public','/app/backend/public')];
    const common=['--user','10001:10001','--label','org.pluton.fixture='+tag,'--read-only','--cap-drop','ALL','--security-opt','no-new-privileges',
      '--memory','768m','--cpus','1','--pids-limit','128','--tmpfs','/tmp:rw,nosuid,nodev,size=64m,mode=1777'];
    run('docker',['run','--rm',...common,'--network','none','--env-file',api+'/app.env','--mount','type=volume,source='+volume+',target=/data',
      ...mounts,...bind(api+'/private','/fixture',''),...bind(api+'/repositories','/fixture/repositories',''),
      ...bind(api+'/source','/srv/example-app',''),...bind(api+'/sql','/pluton/database',''),
      ...bind(code+'/backend/__tests__/integration/automaticRecoveryApi.seed.mjs','/fixture/seed.mjs'),
      ...bind(code+'/backend/__tests__/integration/automaticRecoveryVisual.fixture.mjs','/fixture/visual-data.mjs'),
      '--entrypoint','node',runtime,'--loader','./backend/loader.mjs','/fixture/seed.mjs'],180000);
    fs.renameSync(api+'/private/snapshots.json',api+'/snapshots.json');
    // Auth proxy is fixed fixture code, bounded JSON on stdin; no password in
    // Rclone arguments/environment, no credential output, read-only repository.
    write(api+'/auth.cjs',"const fs=require('fs'),crypto=require('crypto');let input='';process.stdin.on('data',c=>{input+=c;if(input.length>8192)process.exit(1)});process.stdin.on('end',()=>{try{const a=JSON.parse(input),b=JSON.parse(fs.readFileSync('/fixture/credentials.json'));if(a.user!=='fixture_reader'||typeof a.pass!=='string'||crypto.createHash('sha256').update(a.pass).digest('hex')!==crypto.createHash('sha256').update(b.sftpPassword).digest('hex'))process.exit(1);process.stdout.write(JSON.stringify({type:'local',_root:'/repositories'}));}catch{process.exit(1)}});\n");
    fs.chmodSync(api+'/auth.cjs',0o644);
    const sftp=run('docker',['create',...common,'--network',options.disposableNetwork,'--network-alias','repository-fixture',
      '--env','HOME=/tmp',...bind(api+'/repositories','/repositories'),...bind(api+'/auth.cjs','/fixture/auth.cjs'),
      ...bind(api+'/private/credentials.json','/fixture/credentials.json'),'--entrypoint','rclone',runtime,
      'serve','sftp','--addr',':2022','--read-only','--auth-proxy','/usr/local/bin/node /fixture/auth.cjs','--cache-dir','/tmp/cache','--config','/dev/null','--log-level','ERROR']);
    const app=run('docker',['create',...common,'--restart','on-failure','--network',options.disposableNetwork,'--env-file',api+'/app.env',
      '--mount','type=volume,source='+volume+',target=/data',...mounts,
      ...bind(op.PUBLIC,'/run/pluton-automatic-recovery'),...bind(op.REQUESTS,'/run/pluton-automatic-recovery-requests',''),
      ...bind(options.persistent.root+'/public','/run/pluton-persistent-restores'),
      ...bind(options.persistent.data+'/app-view','/run/pluton-persistent-storage','readonly,bind-propagation=rslave'),
      ...bind(op.DATA+'/disposable/app-view','/run/pluton-automatic-storage','readonly,bind-propagation=rslave'),runtime]);
    run('docker',['network','connect',options.persistent.network,app]);write(api+'/containers.json',{app,sftp});
    run('docker',['start',sftp]);event('full_application_fixture_prepared',{realRepositories:2,nonRoot:true,noHostPorts:true});
  }else if(action==='install-boot'){
    assert.equal(fs.readlinkSync('/proc/self/ns/mnt'),fs.readlinkSync('/proc/1/ns/mnt'));
    const units=require('../deploy/automatic-recovery/bootUnits.cjs').render({roots:profiles(),node:process.execPath,code,docker:manifest.dockerUnit,prefix});
    const script=process.execPath+' '+__filename+' '+fixture;
    units[prefix+'-anchors.service']=units[prefix+'-anchors.service'].replace(process.execPath+' '+code+'/deploy/automatic-recovery/operator.cjs anchors',script+' anchors');
    units[prefix+'-application.service']=units[prefix+'-application.service'].replaceAll(process.execPath+' '+code+'/deploy/automatic-recovery/application.cjs',script);
    units[prefix+'-lifecycle.service']='[Unit]\nDescription=Disposable reviewed recovery operator\nRequires='+manifest.dockerUnit+' '+prefix+'-anchors.service\nAfter='+manifest.dockerUnit+' '+prefix+'-anchors.service\n\n[Service]\nType=oneshot\nUser=root\nGroup=root\nUMask=0077\nExecStart='+script+' tick\nPrivateTmp=true\nProtectHome=true\nNoNewPrivileges=true\nLockPersonality=true\nRestrictAddressFamilies=AF_UNIX AF_INET AF_INET6\nTimeoutStartSec=240\nTimeoutStopSec=10\nKillMode=control-group\n';
    units[prefix+'-lifecycle.timer']='[Unit]\nDescription=Disposable reconciliation timer\n[Timer]\nOnBootSec=20\nOnUnitInactiveSec=5\nAccuracySec=1\n[Install]\nWantedBy=timers.target\n';
    for(const [unit,binary,config] of [[manifest.containerdUnit,'/usr/bin/containerd','--config '+fixture+'/containerd.toml'],[manifest.dockerUnit,'/usr/bin/dockerd','--config-file='+fixture+'/daemon.json']]){
      units[unit]='[Unit]\nDescription=Disposable fixture private daemon\nRequiresMountsFor='+fixture+'\n'+
        (unit===manifest.dockerUnit?'Requires='+manifest.containerdUnit+'\nAfter='+manifest.containerdUnit+'\n':'')+
        '\n[Service]\nType=notify\nDelegate=yes\nKillMode=process\nWorkingDirectory='+fixture+'\nEnvironment=TMPDIR='+fixture+'/tmp\n'+
        'ExecStart='+binary+' '+config+'\nTimeoutStartSec=120\nTimeoutStopSec=60\nStandardOutput=append:'+fixture+'/boot-daemons.log\nStandardError=append:'+fixture+'/boot-daemons.log\n[Install]\nWantedBy=multi-user.target\n';
    }
    // Record exact hashes before installing; cleanup never removes an unknown unit.
    write(fixture+'/boot-units.json',Object.fromEntries(Object.entries(units).map(([name,value])=>[name,crypto.createHash('sha256').update(value).digest('hex')])));
    for(const [name,value] of Object.entries(units)){
      const file=unitDirectory+'/'+name;assert(!fs.existsSync(file));
      if(name.includes('/')){const dir=file.slice(0,file.lastIndexOf('/'));if(!fs.existsSync(dir))fs.mkdirSync(dir,{mode:0o755});}
      fs.writeFileSync(file,value,{mode:0o644,flag:'wx'});
    }
    run('/usr/bin/systemctl',['stop',manifest.dockerUnit],90000);
    run('/usr/bin/systemctl',['stop',manifest.containerdUnit],90000);
    run('/usr/bin/systemctl',['daemon-reload']);
    // Prove boot mount execution now, not just adoption of installation mounts.
    for(const root of profiles())for(const plane of ['readonly-stage','app-view','view'])run('/usr/bin/umount',['--',root+'/'+plane]);
    run('/usr/bin/systemctl',['enable',manifest.dockerUnit,prefix+'-lifecycle.timer']);
    run('/usr/bin/systemctl',['start',manifest.dockerUnit],150000);
    run('/usr/bin/systemctl',['start',prefix+'-lifecycle.timer']);op.assertAnchors();
    event('persistent_units_hot_start_verified',{privateTmp:true,protectHome:true,bootNotYetTested:true});
  }else if(action==='refresh-boot-application'){
    const name=prefix+'-application.service',file=unitDirectory+'/'+name,record=JSON.parse(fs.readFileSync(fixture+'/boot-units.json','utf8'));
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),record[name]);
    const units=require('../deploy/automatic-recovery/bootUnits.cjs').render({roots:profiles(),node:process.execPath,code,docker:manifest.dockerUnit,prefix});
    const value=units[name].replaceAll(process.execPath+' '+code+'/deploy/automatic-recovery/application.cjs',process.execPath+' '+__filename+' '+fixture);
    persistent.write(file,value,0,0o644);record[name]=crypto.createHash('sha256').update(value).digest('hex');write(fixture+'/boot-units.json',record);
    run('/usr/bin/systemctl',['daemon-reload']);event('fixture_application_boot_dependency_refreshed');
  }else if(action==='boot-preflight'){
    assert.equal(fs.readlinkSync('/proc/self/ns/mnt'),fs.readlinkSync('/proc/1/ns/mnt'));op.assertAnchors();
    const units=JSON.parse(fs.readFileSync(fixture+'/boot-units.json','utf8'));
    for(const [name,hash] of Object.entries(units)){
      const file=unitDirectory+'/'+name,stat=fs.lstatSync(file);assert.equal(stat.uid,0);assert.equal(stat.mode&0o777,0o644);
      assert.equal(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),hash);
    }
    const rows=fs.readFileSync('/etc/fstab','utf8').split('\n').map(l=>l.trim()).filter(l=>l&&!l.startsWith('#')).map(l=>l.split(/\s+/));
    assert.equal(rows.filter(r=>r[1]==='/srv/pluton-fixture'&&r[2]==='ext4'&&!r[3].split(',').includes('noauto')).length,1);
    for(const name of [manifest.dockerUnit,prefix+'-lifecycle.timer'])assert.equal(run('/usr/bin/systemctl',['is-enabled',name]),'enabled');
    for(const name of [prefix+'-application.service',prefix+'-lifecycle.service']){
      const properties=run('/usr/bin/systemctl',['show',name,'--property=PrivateTmp,ProtectHome,NoNewPrivileges']);
      assert.match(properties,/PrivateTmp=yes/);assert.match(properties,/ProtectHome=yes/);assert.match(properties,/NoNewPrivileges=yes/);
    }
    const names=Object.keys(units).filter(name=>!name.includes('/'));
    run('/usr/bin/systemd-analyze',['verify',...names.map(name=>unitDirectory+'/'+name)]);
    event('preboot_persistent_ordering_checked',{persistentFixtureDisk:true,unitsVerified:true,privateTmp:true,protectHome:true,rebootPerformed:false});
  }else if(action==='boot-order-proof'){
    op.assertAnchors();
    const units=[prefix+'-anchors.service',manifest.dockerUnit,prefix+'-lifecycle.service',prefix+'-application.service'];
    const times=[];
    for(const unit of units){
      const values=Object.fromEntries(run('/usr/bin/systemctl',['show',unit,
        '--property=ActiveEnterTimestampMonotonic,ExecMainStartTimestampMonotonic,ExecMainExitTimestampMonotonic,ActiveState'])
        .split('\n').map(line=>{const n=line.indexOf('=');return [line.slice(0,n),line.slice(n+1)];}));
      times.push({unit,start:Number(values.ExecMainStartTimestampMonotonic),end:Number(values.ExecMainExitTimestampMonotonic),
        active:Number(values.ActiveEnterTimestampMonotonic)});
    }
    // The periodic reconciler's last start can be later than the application.
    // Per-boot journal proves the initial ordered reconciliation independently.
    const raw=run('/usr/bin/journalctl',['-b','--no-pager','-o','json','-u',prefix+'-lifecycle.service']);
    const starts=raw.split('\n').filter(Boolean).map(line=>JSON.parse(line)).filter(row=>row.MESSAGE_ID==='39f53479d3a045ac8e11786248231fbf');
    assert(starts.length);const initialTick=Math.min(...starts.map(row=>Number(row.__MONOTONIC_TIMESTAMP)));
    assert(times[0].active>0&&times[0].active<=times[1].start);
    assert(times[1].active>0&&times[1].active<=initialTick);
    assert(initialTick<=times[3].start);
    event('cold_boot_startup_order_verified',{anchorsBeforeDocker:true,dockerBeforeReconciliation:true,reconciliationBeforeApplication:true});
  }else if(action==='location'){
    const c=container(appId());assert.equal(c.State.Running,true);
    const addresses=Object.values(c.NetworkSettings.Networks).map(n=>n.IPAddress);
    assert(addresses.length&&addresses.every(p=>/^\d+\.\d+\.\d+\.\d+$/.test(p)));
    // Private connection detail: do not include it in public evidence/report.
    process.stdout.write(addresses[0]+'\n');
  }else if(action==='browser-start'){
    const c=container(appId());assert(c.State.Running);assert.equal(c.Config.Labels['org.pluton.fixture'],tag);
    const address=Object.values(c.NetworkSettings.Networks)[0].IPAddress;
    write(api+'/browser.json',{address});
    const unit=prefix+'-browser.service';write(api+'/browser-unit.json',{unit});
    persistent.rootCode(code+'/scripts/automatic-recovery-vm-browser.cjs');
    run('/usr/bin/systemd-run',['--quiet','--no-block','--collect','--unit='+unit,
      '--property=Type=exec','--property=PrivateTmp=yes','--property=ProtectHome=yes','--property=NoNewPrivileges=yes',
      '--property=UMask=0077','--property=RestrictAddressFamilies=AF_UNIX AF_INET','--property=MemoryMax=96M',
      '--property=TimeoutStopSec=10',process.execPath,code+'/scripts/automatic-recovery-vm-browser.cjs',fixture]);
    event('private_browser_fixture_started',{loopbackOnly:true,normalLogin:true,noCredentialInUrl:true,autoLogin:false});
  }else if(action==='verify-consumed-resume'){
    const engine=process.argv[4];assert(['mariadb','postgresql'].includes(engine));
    const selection=JSON.parse(fs.readFileSync(api+'/'+engine+'-restore.json','utf8'));
    const file=op.REQUESTS+'/'+selection.id+'.json',raw=fs.readFileSync(file,'utf8'),req=JSON.parse(raw);
    assert.equal(req.action,'resume');assert.equal(req.binding.snapshotId,selection.snapshotId);
    const driver=op.engineDriver(req),meta=driver.metadata(selection.id);
    assert(driver.inspect(meta).State.Running);
    const journal=JSON.parse(fs.readFileSync(op.ROOT+'/journal/'+selection.id+'.json','utf8'));
    assert.equal(req.version,2);assert(Number.isSafeInteger(req.resumeSequence)&&req.resumeSequence>0);
    assert.equal(journal.consumedResumeSequence,req.resumeSequence);
    assert.match(journal.resumeRevision,/^[a-f0-9]{64}$/);
    run('docker',['stop','--time','30',meta.containerId]);
    run('/usr/bin/systemctl',['start',prefix+'-lifecycle.service'],240000);
    assert.equal(driver.inspect(meta).State.Running,false);assert.equal(fs.readFileSync(file,'utf8'),raw);
    const stopped=JSON.parse(fs.readFileSync(op.ROOT+'/journal/'+selection.id+'.json','utf8'));
    assert.equal(stopped.state,'stopped');assert.equal(stopped.consumedResumeSequence,req.resumeSequence);
    event('consumed_resume_not_replayed',{engine,mailboxUnchanged:true,sameContainer:true,explicitResumeRequired:true});
  }else if(['content','checkpoint','verify-checkpoint'].includes(action)){
    const engine=process.argv[4];assert(['mariadb','postgresql'].includes(engine));
    const selection=JSON.parse(fs.readFileSync(api+'/'+engine+'-restore.json','utf8'));
    const req=JSON.parse(fs.readFileSync(op.REQUESTS+'/'+selection.id+'.json','utf8'));
    assert.equal(req.binding.mode,'persistent');assert.equal(req.binding.engine,engine);
    assert.equal(req.binding.snapshotId,selection.snapshotId);
    const driver=op.engineDriver(req),meta=driver.metadata(selection.id),current=driver.inspect(meta);
    const journal=JSON.parse(fs.readFileSync(op.ROOT+'/journal/'+selection.id+'.json','utf8'));
    assert.equal(journal.bindingHash,op.hash(req));assert.equal(journal.readyOnce,true);
    assert.equal(current.HostConfig.Privileged,false);assert.equal(current.Config.User,'999:999');
    assert.equal(current.HostConfig.Memory,2147483648);assert.equal(current.HostConfig.NanoCpus,1000000000);
    assert.equal(fs.lstatSync(meta.volume.file).size,2147483648);
    const protectedValue={containerId:meta.containerId,storageId:meta.volume.identity.storageId,
      identity:meta.volume.identity,snapshotId:req.binding.snapshotId,bindingHash:journal.bindingHash,
      resumeRevision:journal.resumeRevision,consumedResumeSequence:journal.consumedResumeSequence,
      resumeSequence:req.resumeSequence,
      requestHash:crypto.createHash('sha256').update(fs.readFileSync(op.REQUESTS+'/'+selection.id+'.json')).digest('hex'),
      bootId:fs.readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim()};
    if(action==='checkpoint'){
      assert.equal(req.action,'resume');assert.match(protectedValue.resumeRevision,/^[a-f0-9]{64}$/);
      assert.equal(req.version,2);assert(Number.isSafeInteger(req.resumeSequence)&&req.resumeSequence>0);
      assert.equal(protectedValue.consumedResumeSequence,req.resumeSequence);
      write(api+'/'+engine+'-checkpoint.json',protectedValue);
      event('preboot_retained_checkpoint_created',{engine,quotaBytes:2147483648,ownership:true});
    }else if(action==='verify-checkpoint'){
      const before=JSON.parse(fs.readFileSync(api+'/'+engine+'-checkpoint.json','utf8'));
      assert.notEqual(before.bootId,protectedValue.bootId);
      for(const name of ['containerId','storageId','identity','snapshotId','bindingHash','resumeRevision','resumeSequence','consumedResumeSequence','requestHash'])assert.deepEqual(protectedValue[name],before[name]);
      assert.equal(current.State.Running,false);op.assertAnchors();
      event('cold_boot_retained_identity_verified',{engine,sameContainer:true,sameFilesystem:true,sameBinding:true,
        consumedResumeUnchanged:true,mailboxUnchanged:true,explicitResumeRequired:true});
    }else{
      assert.equal(current.State.Running,true);
      const output=execFileSync('docker',['exec','--interactive',appId(),'node','--loader','./backend/loader.mjs',
        '--input-type=module','-',selection.id],{env,encoding:'utf8',timeout:90000,maxBuffer:65536,stdio:['pipe','pipe','pipe'],
          input:fs.readFileSync(code+'/backend/__tests__/integration/automaticRecoveryApi.inspect.mjs','utf8')});
      const proof=output.trim().split('\n').map(line=>{try{return JSON.parse(line);}catch{return null;}})
        .find(row=>row?.event==='synthetic_api_import_content_verified');assert(proof);assert.equal(proof.kernelReadonly,true);
      event(proof.event,{engine,exactSnapshot:true,ownership:true,tls:true,tables:1,kernelReadonly:true});
    }
  }else throw new Error('Unsupported fixture action');
}catch(error){
  process.stderr.write(JSON.stringify({event:'acceptance_fixture_refused',action,code:error.code||null,
    locations:String(error.stack||'').split('\n').filter(l=>/^\s+at /.test(l)&&/\.(?:cjs|mjs):\d+:\d+/.test(l)).slice(0,3)})+'\n');process.exitCode=1;
}
