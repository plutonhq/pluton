const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const root = path.join(__dirname, '..', '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
test('native argument inspection detects password flags, not unrelated protocol/public-key options', async () => {
  const { isPasswordArgument } = await import('../../backend/__tests__/integration/mysqlRecoveryWorker.observe.mjs');
  for (const value of ['--protocol=tcp', '--port=3306', '--get-server-public-key', '--defaults-file=/tmp/pluton-mysql-fixture/credentials.cnf']) assert.equal(isPasswordArgument(value), false);
  for (const value of ['-p', '-psynthetic-fixture', '--password=synthetic-fixture', '--password', '--password2=synthetic-fixture']) assert.equal(isPasswordArgument(value), true);
});
test('worker uses a pinned glibc base and official, signature-verified, SHA-pinned Oracle LTS packages', () => {
  const docker = read('Dockerfile.mysql-recovery-worker');
  assert.match(docker, /node:24\.16\.0-bookworm-slim@sha256:[a-f0-9]{64}/);
  assert.match(docker, /signed-by=\/usr\/share\/keyrings\/mysql-community.gpg/);
  assert.match(docker, /BCA43417C3B485DD128EC6D4B7B3B788A8D3785C/);
  assert.match(docker, /mysql-community-client-core=8\.4\.11-1debian12/);
  assert.match(docker, /mysql-community-client-plugins=8\.4\.11-1debian12/);
  assert.match(docker, /sha256sum -c/);
  assert(!/allow-unauthenticated|trusted=yes|AllowInsecureRepositories|FROM mysql:|install[^\n]*mysql-community-server/.test(docker));
  assert.match(docker, /USER 10001:10001\s+RUN node/);
  assert(!/EXPOSE|VOLUME|Dockerfile.source/.test(docker));
});
test('optional compose shares only private IPC, approved public target config and CA, never application state', () => {
  const overlay = read('deploy/compose.mysql-recovery-worker.yml');
  assert.match(overlay, /PLUTON_MYSQL_WORKER_IMAGE_REF:\?Set a reviewed worker image by digest/);
  assert.match(overlay, /cap_drop: \[ALL\]/);
  assert.match(overlay, /no-new-privileges:true/);
  assert.match(overlay, /user: "10001:10001"/);
  assert.match(overlay, /pluton-mysql-ipc:\/run\/pluton-mysql-worker:ro/);
  assert(!/\n\s+(?:ports|expose|privileged):|\/data|\/var\/run\/docker.sock|\.env|SECRET|ENCRYPTION_KEY/.test(overlay));
  assert(!read('deploy/compose.yml').includes('mysql-recovery-worker'));
});
test('workflow gates both immutable images on real native MySQL IPC imports without publishing PR builds', () => {
  const workflow = read('.github/workflows/container.yml');
  assert.match(workflow, /validate-mysql-recovery-worker.ps1 -RuntimeImage pluton-recovery-ci:local/);
  assert.match(workflow, /publish-mysql-worker:[\s\S]*needs: \[validate, build-pr\]/);
  assert.match(workflow, /ghcr.io\/\$\{\{ github.repository \}\}-mysql-recovery-worker/);
  assert.match(workflow, /file: Dockerfile.mysql-recovery-worker[\s\S]*push: false/);
});
test('native fixture targets only randomized private containers, never host services or supplied credentials', () => {
  const runner = read('scripts/validate-mysql-recovery-worker.ps1');
  assert.match(runner, /docker network create --internal/);
  assert.match(runner, /mysql:8\.4\.11@sha256:[a-f0-9]{64}/);
  assert.match(runner, /Unsafe fixture cleanup target/);
  assert(!/--privileged|--network host|--publish|--port|docker.sock|\[string\]\$(?:Password|Target|Host|Secret)/.test(runner));
});
test('persistent MySQL gate is required and Custom-only fixtures never request privileged mount infrastructure',()=>{
  const workflow=read('.github/workflows/container.yml');
  assert.match(workflow,/run: \.\/scripts\/validate-mysql-persistent-restore\.ps1 -WorkerImage pluton-mysql-worker:local -RuntimeImage pluton-recovery-ci:local/);
  const runner=read('scripts/validate-mysql-persistent-restore.ps1');
  for(const value of ['docker network create --internal',"--user '10001:10001'",'--cap-drop ALL','--network none','Unsafe fixture cleanup target.'])assert(runner.includes(value));
  assert(!/--privileged|SYS_ADMIN|loop-control|docker\.sock|--publish|--network host/.test(runner));
  const fixture=read('backend/__tests__/integration/mysqlPersistentRestore.smoke.mjs');
  assert.match(fixture,/attempt < 20/);assert.match(fixture,/database-target-preflight.*database-import/);
});
