const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('node:fs');
const path=require('node:path');
const operator=require('../../deploy/internal-recovery/operator.cjs');
const root=path.join(__dirname,'../..');
test('Docker fixture bind sources are platform-native joined paths, not Windows string interpolation', () => {
  const source=fs.readFileSync(path.join(root,'scripts/validate-internal-recovery.ps1'),'utf8');
  assert(!/\$repo\\/.test(source), 'A literal backslash survives unchanged in Linux Docker bind sources');
  for (const relative of ['backend/__tests__/integration/internalRecovery.prepare.mjs',
    'backend/__tests__/integration/internalRecovery.smoke.mjs','backend/__tests__/integration/internalRecovery.readiness.mjs','deploy/internal-recovery/operator.cjs',
    'deploy/internal-recovery/bootstrap.sh','backend/dist']) {
    assert(source.includes(`Join-Path $repo '${relative}'`));
    for (const platform of [path.posix,path.win32]) {
      const base=platform===path.posix?'/home/runner/work/example/example':'C:\\workspace\\example';
      assert.equal(platform.normalize(platform.join(base,relative)),platform.resolve(base,relative));
    }
    if(!relative.endsWith('/dist')) assert(fs.statSync(path.join(root,relative)).isFile());
  }
});
test('only native approved engines and bounded reviewed DB identifiers are provisioned', () => {
  assert.doesNotThrow(() => operator.validateSelection('mariadb',['example_db'],'recovery_user',384));
  for (const args of [['mysql',['example_db'],'recovery_user',128],['postgresql',['postgres'],'recovery_user',128],
    ['mariadb',['app; DROP DATABASE app'],'recovery_user',128],['mariadb',['example_db'],'root',128],
    ['mariadb',['example_db'],'recovery_user',512]]) assert.throws(() => operator.validateSelection(...args));
});
test('MariaDB grants escape wildcard underscores and never grant administrative global access', () => {
  const sql=operator.bootstrapSql('mariadb',['example_db'],'recovery_user','a'.repeat(64));
  assert(sql.includes('ON `example\\_db`.*'));
  assert(!sql.includes('GRANT ALL PRIVILEGES ON *.*'));
  assert(sql.includes('REQUIRE SSL'));
});
test('PostgreSQL recovery role has only the existing Phase 6 non-admin CREATE DATABASE contract', () => {
  const sql=operator.bootstrapSql('postgresql',['example_db'],'recovery_user','a'.repeat(64));
  for(const flag of ['NOSUPERUSER','NOCREATEROLE','NOINHERIT','NOREPLICATION','NOBYPASSRLS']) assert(sql.includes(flag));
  assert(sql.includes('ALTER ROLE postgres NOLOGIN'));
});
test('a cleanup request is scoped to one exact approved activation/test/snapshot', () => {
  const meta={installationId:'a'.repeat(32),activationId:'b'.repeat(32),engine:'mariadb'};
  const request={version:1,...meta,testId:'c'.repeat(24),snapshotId:'d'.repeat(64),cleanupReady:true};
  const stat={isFile:()=>true,uid:10001,mode:0o600,size:512};
  assert.doesNotThrow(() => operator.cleanupRequest(request,meta,stat));
  for(const bad of [{cleanupReady:false},{engine:'mysql'},{activationId:'e'.repeat(32)},{snapshotId:'latest'},{command:'rm'}])
    assert.throws(()=>operator.cleanupRequest({...request,...bad},meta,stat));
  assert.throws(()=>operator.cleanupRequest(request,meta,{...stat,mode:0o644}));
});
test('only exact owned, nonprivileged pinned containers can be removed', () => {
  const meta={engine:'mariadb',installationId:'a'.repeat(32),activationId:'b'.repeat(32),containerId:'c'.repeat(64)};
  const inspect={Id:meta.containerId,Config:{Image:operator.images.mariadb,User:'999:999',Entrypoint:['/bin/bash','/opt/pluton-internal/bootstrap.sh','mariadb'],
    Labels:{'org.pluton.internal.installation':meta.installationId,'org.pluton.internal.activation':meta.activationId,'org.pluton.internal.engine':'mariadb'}},
    HostConfig:{Privileged:false,ReadonlyRootfs:true,Memory:2147483648,MemorySwap:2147483648,NanoCpus:1e9,PidsLimit:128,CapDrop:['ALL'],SecurityOpt:['no-new-privileges:true']},
    Mounts:[{Type:'bind',Destination:'/opt/pluton-internal/bootstrap.sh',Source:'/etc/pluton-internal/bootstrap.sh',RW:false},
      {Type:'bind',Destination:'/run/pluton-internal-bootstrap',Source:'/etc/pluton-internal/engines/mariadb',RW:false},
      {Type:'volume',Destination:'/run/pluton-internal-lock',Name:'pluton-internal-recovery-lock',RW:true}],NetworkSettings:{Networks:{'pluton-internal-recovery':{}}}};
  assert.doesNotThrow(()=>operator.ownership(inspect,meta));
  for(const change of [{Privileged:true},{Memory:0},{CapAdd:['SYS_ADMIN']},{PortBindings:{'3306/tcp':[{}]}},{NetworkMode:'host'}])
    assert.throws(()=>operator.ownership({...inspect,HostConfig:{...inspect.HostConfig,...change}},meta));
  assert.throws(()=>operator.ownership({...inspect,Id:'d'.repeat(64)},meta));
  for(const [label,value] of [['org.pluton.internal.installation','e'.repeat(32)],
    ['org.pluton.internal.activation','f'.repeat(32)],['org.pluton.internal.engine','postgresql']])
    assert.throws(()=>operator.ownership({...inspect,Config:{...inspect.Config,
      Labels:{...inspect.Config.Labels,[label]:value}}},meta));
  assert.throws(()=>operator.ownership({...inspect,Config:{...inspect.Config,Image:'mysql:latest'}},meta));
  assert.throws(()=>operator.ownership({...inspect,Mounts:[...inspect.Mounts,{Type:'bind',Source:'/data',Destination:'/data',RW:true}]},meta));
});
test('no default database stack, ports, application Docker access or shared source/repository volumes', () => {
  const targets=fs.readFileSync(path.join(root,'deploy/internal-recovery/targets.compose.yml'),'utf8');
  assert(targets.includes('profiles: [mariadb]')); assert(targets.includes('profiles: [postgresql]'));
  assert(!/\n\s*(ports|expose|privileged):|docker.sock|\/data|\.env|SECRET|ENCRYPTION_KEY/.test(targets));
  assert.equal((targets.match(/@sha256:[a-f0-9]{64}/g)||[]).length,2);
  for(const protection of ['memswap_limit: 2g','pids_limit: 128','cpus: 1.0','read_only: true','restart: "no"']) assert(targets.includes(protection));
  const overlay=fs.readFileSync(path.join(root,'deploy/compose.internal-recovery.yml'),'utf8');
  assert(!/depends_on|docker.sock|privileged|\/data:|mysql/.test(overlay));
  assert(overlay.includes('/run/pluton-internal-recovery:ro'));
});
