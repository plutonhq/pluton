'use strict';
// Explicit root-operated CLI, NOT a daemon/API and never mounted in the application.
// Supports host Node >=16. No application request can start a container or supply CLI options.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const ROOT = '/etc/pluton-internal';
const REQUESTS = '/var/lib/pluton-internal-requests';
const NETWORK = 'pluton-internal-recovery';
const LOCK = 'pluton-internal-recovery-lock';
const images = Object.freeze({
  mariadb: 'mariadb:11.8.8@sha256:24e76fcec8c003a0362d0dd53f4806e7e79458d7fdeaf47437760e19496f5a9c',
  postgresql: 'postgres:18.6-bookworm@sha256:afc7e2d441324c0388fa80c3d24f733b4194a4eb7f47dd8ee2b08eb1a24a647c',
});
const env = () => ({ PATH: '/usr/local/bin:/usr/bin:/bin', LANG: 'C', LC_ALL: 'C', DOCKER_HOST: 'unix:///var/run/docker.sock' });
const run = (binary, args, options = {}) => execFileSync(binary, args, { encoding: 'utf8', timeout: 120_000, maxBuffer: 65_536,
  env: env(), stdio: ['pipe', 'pipe', 'pipe'], ...options });
const docker = args => run('docker', args);
const random = () => crypto.randomBytes(16).toString('hex');
const fail = () => { throw new Error('Internal recovery operator action refused. Review trusted local configuration and cleanup status.'); };
function rootFile(file) {
  let current = file;
  while (true) {
    const stat = fs.lstatSync(current);
    if (stat.uid !== 0 || stat.isSymbolicLink() || stat.mode & 0o6022) fail();
    if (current === path.dirname(current)) break;
    current = path.dirname(current);
  }
  if (!fs.statSync(file).isFile() || fs.statSync(file).size > 65_536) fail();
}
function read(file) { rootFile(file); return JSON.parse(fs.readFileSync(file, 'utf8')); }
function write(file, value, uid = 0, gid = 0, mode = 0o600) {
  const temporary = `${file}.${random()}.tmp`;
  fs.writeFileSync(temporary, typeof value === 'string' ? value : JSON.stringify(value), { flag: 'wx', mode });
  fs.chownSync(temporary, uid, gid); fs.chmodSync(temporary, mode); fs.renameSync(temporary, file);
}
function directory(file, uid, gid, mode) {
  fs.mkdirSync(file, { recursive: true, mode });
  const stat = fs.lstatSync(file);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail();
  fs.chownSync(file, uid, gid); fs.chmodSync(file, mode);
}
const identifier = value => /^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(value) &&
  !['root', 'mysql', 'postgres', 'template0', 'template1', 'pluton_recovery_guard', 'information_schema', 'performance_schema', 'sys'].includes(value.toLowerCase());
function validateSelection(engine, databases, username, maxSqlMiB) {
  if (!Object.prototype.hasOwnProperty.call(images, engine) || !identifier(username) || !Array.isArray(databases) || !databases.length || databases.length > 8 ||
      databases.some(name => !identifier(name)) || new Set(databases).size !== databases.length ||
      !Number.isInteger(maxSqlMiB) || maxSqlMiB < 1 || maxSqlMiB > 448) fail();
}
function bootstrapSql(engine, databases, username, password) {
  validateSelection(engine, databases, username, 128);
  if (!/^[a-f0-9]{64}$/.test(password)) fail();
  if (engine === 'mariadb') return `CREATE DATABASE pluton_recovery_guard;
CREATE TABLE pluton_recovery_guard.pluton_recovery_guard(purpose VARCHAR(64) NOT NULL);
INSERT INTO pluton_recovery_guard.pluton_recovery_guard VALUES ('pluton-phase6-recovery-only');
CREATE USER '${username}'@'%' IDENTIFIED BY '${password}' REQUIRE SSL;
GRANT SELECT ON pluton_recovery_guard.pluton_recovery_guard TO '${username}'@'%';
${databases.map(name => `GRANT ALL PRIVILEGES ON \`${name.replaceAll('_', '\\_')}\`.* TO '${username}'@'%';`).join('\n')}
DELETE FROM mysql.global_priv WHERE User <> '${username}';
FLUSH PRIVILEGES;
`;
  return `SET password_encryption='scram-sha-256';
CREATE ROLE "${username}" LOGIN PASSWORD '${password}' CREATEDB NOSUPERUSER NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
CREATE DATABASE pluton_recovery_guard;
\\connect pluton_recovery_guard
CREATE TABLE pluton_recovery_guard(purpose VARCHAR(64) NOT NULL);
INSERT INTO pluton_recovery_guard VALUES ('pluton-phase6-recovery-only');
GRANT CONNECT ON DATABASE pluton_recovery_guard TO "${username}";
GRANT USAGE ON SCHEMA public TO "${username}";
GRANT SELECT ON pluton_recovery_guard TO "${username}";
ALTER ROLE postgres NOLOGIN;
`;
}
function ownership(inspect, meta) {
  const labels = inspect.Config?.Labels || {};
  const host = inspect.HostConfig || {};
  const engine = meta.engine;
  const mounts = inspect.Mounts || [];
  const approved = new Map([['/opt/pluton-internal/bootstrap.sh', `${ROOT}/bootstrap.sh`],
    ['/run/pluton-internal-bootstrap', `${ROOT}/engines/${engine}`], ['/run/pluton-internal-lock', LOCK]]);
  if (!Object.prototype.hasOwnProperty.call(images, engine) || !/^[a-f0-9]{64}$/.test(inspect.Id || '') || inspect.Id !== meta.containerId ||
      labels['org.pluton.internal.installation'] !== meta.installationId || labels['org.pluton.internal.activation'] !== meta.activationId ||
      labels['org.pluton.internal.engine'] !== engine || inspect.Config.Image !== images[engine] || inspect.Config.User !== '999:999' ||
      host.Privileged || !host.ReadonlyRootfs || host.NetworkMode === 'host' || Object.keys(host.PortBindings || {}).length ||
      host.Memory !== 2147483648 || host.MemorySwap !== 2147483648 || host.NanoCpus !== 1e9 || host.PidsLimit !== 128 ||
      !host.CapDrop?.includes('ALL') || !host.SecurityOpt?.includes('no-new-privileges:true') ||
      (host.CapAdd || []).length || (host.Devices || []).length ||
      JSON.stringify(inspect.Config.Entrypoint) !== JSON.stringify(['/bin/bash','/opt/pluton-internal/bootstrap.sh',engine]) ||
      mounts.filter(m => m.Type !== 'tmpfs').length !== 3 || mounts.some(m => m.Type !== 'tmpfs' &&
        (approved.get(m.Destination) !== (m.Type === 'volume' ? m.Name : m.Source) || (m.Destination !== '/run/pluton-internal-lock' && m.RW))) ||
      Object.keys(inspect.NetworkSettings?.Networks || {}).some(name => name !== NETWORK)) fail();
}
function cleanupRequest(request, meta, stat) {
  const keys = ['version','installationId','activationId','engine','testId','snapshotId','cleanupReady'];
  if (!stat.isFile() || stat.uid !== 10001 || (stat.mode & 0o777) !== 0o600 || stat.size > 2048 ||
      Object.keys(request).some(key => !keys.includes(key)) || request.version !== 1 || request.cleanupReady !== true ||
      request.installationId !== meta.installationId || request.activationId !== meta.activationId || request.engine !== meta.engine ||
      !/^[a-f0-9]{24}$/.test(request.testId || '') || !/^[a-f0-9]{64}$/.test(request.snapshotId || '')) fail();
}
function resourceCheck(maxSqlMiB) {
  const mem = fs.readFileSync('/proc/meminfo', 'utf8');
  const field = name => Number(new RegExp(`^${name}:\\s+(\\d+) kB$`, 'm').exec(mem)?.[1]) * 1024;
  const pressure = Number(/^some avg10=(\d+(?:\.\d+)?)/m.exec(fs.readFileSync('/proc/pressure/memory', 'utf8'))?.[1]);
  if (!Number.isFinite(field('MemAvailable')) || !Number.isFinite(pressure) || field('MemTotal') < 3800 * 1024 ** 2 ||
      field('MemAvailable') < 2560 * 1024 ** 2 || field('SwapTotal') - field('SwapFree') > 128 * 1024 ** 2 || pressure > 1 ||
      maxSqlMiB * 4 + 256 > 2048) fail();
  const space = run('df',['-Pk',REQUESTS]).trim().split('\n').slice(-1)[0].trim().split(/\s+/);
  if (!/^\d+$/.test(space[3] || '') || Number(space[3])*1024 < 3*1024**3) fail();
  // Disk for the restored artifact is rechecked by the application; target data is bounded tmpfs.
}
function prepare(engine, names, username, cap) {
  const databases = names.split(',');
  validateSelection(engine, databases, username, cap);
  rootFile(path.join(__dirname,'bootstrap.sh')); rootFile(path.join(__dirname,'targets.compose.yml'));
  const initial=!fs.existsSync(ROOT);
  if ((!initial && !fs.existsSync(`${ROOT}/operator.json`)) || (initial && fs.existsSync(REQUESTS)) ||
      fs.existsSync(`${ROOT}/engines/${engine}`)) fail(); // Never adopt/overwrite an unknown or partially provisioned resource.
  if (fs.existsSync(`${ROOT}/public/${engine}.json`)) fail(); // Never silently rotate existing recovery credentials.
  directory(ROOT, 0, 0, 0o755);
  const metaPath = `${ROOT}/operator.json`;
  const meta = fs.existsSync(metaPath) ? read(metaPath) : { installationId: random(), status: 'removed' };
  if (meta.status !== 'removed') fail();
  write(metaPath,meta); // Durable installation identity even if later provisioning is interrupted.
  directory(`${ROOT}/public`, 0, 10001, 0o750);
  directory(`${ROOT}/engines`, 0, 0, 0o700);
  const privateDir = `${ROOT}/engines/${engine}`;
  directory(privateDir, 999, 999, 0o750);
  directory(REQUESTS, 10001, 10001, 0o700);
  // A new recovery-only CA, explicitly approved by running this command; never touches application keys.
  if (!fs.existsSync(`${ROOT}/ca.pem`)) {
    run('openssl', ['req','-x509','-newkey','rsa:3072','-nodes','-sha256','-days','365','-subj','/CN=Pluton Internal Recovery CA',
      '-keyout',`${ROOT}/ca.key`,'-out',`${ROOT}/ca.pem`]); fs.chmodSync(`${ROOT}/ca.key`, 0o600);
  }
  const ext = `subjectAltName=DNS:internal-${engine}\nextendedKeyUsage=serverAuth\n`;
  write(`${privateDir}/server.ext`, ext);
  run('openssl', ['req','-new','-newkey','rsa:3072','-nodes','-subj',`/CN=internal-${engine}`,'-keyout',`${privateDir}/server.key`,'-out',`${privateDir}/server.csr`]);
  run('openssl', ['x509','-req','-in',`${privateDir}/server.csr`,'-CA',`${ROOT}/ca.pem`,'-CAkey',`${ROOT}/ca.key`,
    '-set_serial',`0x${random()}`,'-days','30','-sha256','-extfile',`${privateDir}/server.ext`,'-out',`${privateDir}/server.pem`]);
  for (const file of ['server.key','server.pem']) { fs.chownSync(`${privateDir}/${file}`,999,999); fs.chmodSync(`${privateDir}/${file}`,0o600); }
  write(`${privateDir}/ca.pem`, fs.readFileSync(`${ROOT}/ca.pem`, 'utf8'), 999,999);
  const password = crypto.randomBytes(32).toString('hex');
  write(`${privateDir}/bootstrap.sql`, bootstrapSql(engine, databases, username, password),999,999);
  write(`${ROOT}/public/${engine}-ca.pem`,fs.readFileSync(`${ROOT}/ca.pem`, 'utf8'),0,10001,0o640);
  write(`${ROOT}/public/${engine}.json`, { version:1, target:{engine,host:`internal-${engine}`,port:engine === 'mariadb' ? 3306 : 5432,
    username,password,tls:'verify-identity',enabled:true,dedicated:true},databases,maxSqlBytes:cap*1024**2 },0,10001,0o640);
  rootFile(path.join(__dirname,'bootstrap.sh')); rootFile(path.join(__dirname,'targets.compose.yml'));
  write(`${ROOT}/bootstrap.sh`,fs.readFileSync(path.join(__dirname,'bootstrap.sh'),'utf8'),0,0,0o444);
  write(`${ROOT}/targets.compose.yml`,fs.readFileSync(path.join(__dirname,'targets.compose.yml'),'utf8'),0,0,0o444);
  // Installation-owned shared control objects are tiny and do not run any database.
  for (const [kind,name] of [['network',NETWORK],['volume',LOCK]]) {
    const exists = docker([kind,'ls','--format','{{.Name}}']).trim().split('\n').includes(name);
    if (exists) {
      const info = JSON.parse(docker([kind,'inspect',name]))[0];
      if (info.Labels?.['org.pluton.internal.installation'] !== meta.installationId || (kind === 'network' && !info.Internal)) fail();
    } else docker([kind,'create',...(kind === 'network' ? ['--internal'] : []),'--label',`org.pluton.internal.installation=${meta.installationId}`,name]);
  }
  docker(['run','--rm','--network','none','--read-only','--entrypoint','sh','--mount',`type=volume,source=${LOCK},target=/lock`,
    images[engine],'-ec','chown 999:999 /lock && chmod 700 /lock']);
  write(metaPath, meta);
  console.log('Internal recovery engine provisioned; inactive. No application secrets changed.');
}
function activate(engine) {
  const meta = read(`${ROOT}/operator.json`);
  if (!Object.prototype.hasOwnProperty.call(images,engine) || meta.status !== 'removed') fail();
  const config = read(`${ROOT}/public/${engine}.json`);
  validateSelection(engine,config.databases,config.target.username,config.maxSqlBytes/1024**2);
  resourceCheck(config.maxSqlBytes/1024**2);
  run('openssl',['x509','-in',`${ROOT}/engines/${engine}/server.pem`,'-checkend','7200','-noout']);
  // Refuse even a stopped unknown leftover; do not replace containers or a second activation.
  if (docker(['ps','-aq','--filter',`label=org.pluton.internal.installation=${meta.installationId}`]).trim()) fail();
  const activationId = random();
  const composeEnv = { ...env(),PLUTON_INTERNAL_INSTALLATION:meta.installationId,PLUTON_INTERNAL_ACTIVATION:activationId };
  const starting = { ...meta,engine,activationId,status:'starting',containerId:undefined,cleanupTestId:undefined,cleanupSnapshotId:undefined };
  write(`${ROOT}/operator.json`,starting); // Retained even if startup/daemon/CLI is interrupted.
  try {run('docker',['compose','--project-name','pluton-internal','-f',`${ROOT}/targets.compose.yml`,'--profile',engine,
    'up','-d','--no-deps','--no-recreate',`internal-${engine}`],{env:composeEnv});} catch { /* Discover only this activation below; never delete a partial start. */ }
  finishActivation(starting);
}
function finishActivation(meta) {
  const {engine,activationId}=meta;
  if(meta.status!=='starting' || !Object.prototype.hasOwnProperty.call(images,engine) || !/^[a-f0-9]{32}$/.test(activationId||'')) fail();
  const id = docker(['ps','-aq','--no-trunc','--filter',`label=org.pluton.internal.activation=${activationId}`]).trim();
  if (!id) {write(`${ROOT}/operator.json`,{...meta,status:'removed'});fail();}
  if (!/^[a-f0-9]{64}$/.test(id)) fail();
  const updated = { ...meta,containerId:id,status:'active' };
  write(`${ROOT}/operator.json`,updated); // Durable before publishing readiness, including failed startup.
  ownership(JSON.parse(docker(['inspect',id]))[0],updated);
  write(`${ROOT}/public/state.json`,{version:1,installationId:meta.installationId,activationId,engine,approved:true,
    status:'active',expiresAt:Date.now()+2*60*60_000},0,10001,0o640);
  console.log('Internal recovery activated manually. Run exactly one approved test, then deactivate.');
}
function deactivate() {
  const meta = read(`${ROOT}/operator.json`);
  if (meta.status !== 'active' || !/^[a-f0-9]{64}$/.test(meta.containerId || '')) fail();
  const parent = fs.lstatSync(REQUESTS);
  if (!parent.isDirectory() || parent.isSymbolicLink() || parent.uid !== 10001 || (parent.mode&0o777)!==0o700) fail();
  const fd = fs.openSync(`${REQUESTS}/request.json`,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  let request;
  try { const stat = fs.fstatSync(fd); request=JSON.parse(fs.readFileSync(fd,'utf8')); cleanupRequest(request,meta,stat); } finally { fs.closeSync(fd); }
  if ((meta.cleanupTestId && meta.cleanupTestId!==request.testId) || (meta.cleanupSnapshotId && meta.cleanupSnapshotId!==request.snapshotId)) fail();
  const boundMeta={...meta,cleanupTestId:request.testId,cleanupSnapshotId:request.snapshotId};
  write(`${ROOT}/operator.json`,boundMeta); // The test binding survives interruption during stop/remove/receipt publication.
  const present = docker(['ps','-aq','--no-trunc','--filter',`id=${meta.containerId}`]).trim();
  if (present) {
    ownership(JSON.parse(docker(['inspect',meta.containerId]))[0],meta);
    docker(['stop','--time','30',meta.containerId]); docker(['rm',meta.containerId]);
  }
  if (docker(['ps','-aq','--no-trunc','--filter',`id=${meta.containerId}`]).trim()) fail();
  const state = {version:1,installationId:meta.installationId,activationId:meta.activationId,engine:meta.engine,
    approved:true,status:'removed',expiresAt:Date.now()+2*60*60_000,testId:request.testId,snapshotId:request.snapshotId};
  // Durable per-activation receipt cannot be lost when the operator activates the next target before an app tick.
  const receiptFile=`${ROOT}/public/removed-${meta.activationId}.json`;
  if(fs.existsSync(receiptFile)) {
    const previous=read(receiptFile);
    if(previous.status!=='removed' || ['version','installationId','activationId','engine','approved','testId','snapshotId'].some(key=>previous[key]!==state[key])) fail();
  } else write(receiptFile,state,0,10001,0o640);
  write(`${ROOT}/public/state.json`,state,0,10001,0o640);
  write(`${ROOT}/operator.json`,{...boundMeta,status:'removed'});
  console.log('Owned internal container removed. Application will reconcile the exact test cleanup receipt.');
}
if (require.main === module) {
  try {
    if (process.platform !== 'linux' || process.arch !== 'x64' || process.getuid() !== 0) fail();
    process.umask(0o077);
    // Serialize ALL operator actions. The lock is held by the parent flock process, not a stale PID file.
    if (process.env.PLUTON_INTERNAL_OPERATOR_LOCK !== 'held') {
      run('flock',['--exclusive','--nonblock','/run/pluton-internal-operator.lock',process.execPath,__filename,...process.argv.slice(2)],
        {env:{...env(),PLUTON_INTERNAL_OPERATOR_LOCK:'held'},stdio:'inherit'});
      process.exit(0);
    }
    const [command,engine,names,username='recovery_user',cap='128',...extra]=process.argv.slice(2);
    if (extra.length) fail();
    if (command === 'prepare' && engine && names) prepare(engine,names,username,Number(cap));
    else if (command === 'activate' && engine && !names) activate(engine);
    else if (command === 'resume-activation' && !engine) finishActivation(read(`${ROOT}/operator.json`));
    else if (command === 'deactivate' && !engine) deactivate();
    else fail();
  } catch { console.error('Internal recovery operator action refused. No automatic deletion/credential rotation was attempted. Inspect local provisioning, resources, ownership and Cleanup Required status.'); process.exitCode=1; }
}
module.exports = { images,validateSelection,bootstrapSql,ownership,cleanupRequest };
