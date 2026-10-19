const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const root = path.resolve(__dirname, '../..');
const probe = fs.readFileSync(path.join(root, 'deploy/healthcheck.cjs'), 'utf8');

function execute({ status = 200, type = 'application/json; charset=utf-8', body = '{"status":"healthy"}', error = false, timeout = false } = {}) {
  const response = new EventEmitter();
  response.statusCode = status;
  response.headers = { 'content-type': type };
  let code = 0, cleared = false, timer;
  const exit = value => { code = value; throw new Error('fixture-exit'); };
  const context = {
    require: name => {
      assert.equal(name, 'node:http');
      return { get(options, callback) {
        assert.deepEqual(JSON.parse(JSON.stringify(options)), { host: '127.0.0.1', port: 5173, path: '/api/health', method: 'GET' });
        const request = new EventEmitter();
        queueMicrotask(() => {
          try {
            if (timeout) return timer();
            if (error) return request.emit('error', new Error('never-log-raw-fixture-error'));
            callback(response);
            response.emit('data', Buffer.from(body));
            response.emit('end');
          } catch (failure) { assert.equal(failure.message, 'fixture-exit'); }
        });
        return request;
      } };
    },
    process: { exit }, Buffer,
    setTimeout(callback, milliseconds) { timer = callback; assert.equal(milliseconds, 4000); return 1; },
    clearTimeout() { cleared = true; },
  };
  vm.runInNewContext(probe, context);
  return new Promise(resolve => queueMicrotask(() => resolve({ code, cleared })));
}
test('Compose, installer and image share the same GET-only bounded JSON probe', () => {
  const yaml = fs.readFileSync(path.join(root, 'deploy/compose.yml'), 'utf8');
  const body = yaml.split('        - |\n')[1].split('      interval:')[0].split('\n').filter(line => line.startsWith('          ')).map(line => line.slice(10)).join('\n') + '\n';
  assert.equal(body, probe.split('\n').filter(line => !line.startsWith('//')).join('\n'));
  const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile.source'), 'utf8');
  assert.match(dockerfile, /HEALTHCHECK[^\n]+\["node", "\/usr\/local\/libexec\/pluton\/healthcheck.cjs"\]/);
  const library = fs.readFileSync(path.join(root, 'deploy/lib.sh'), 'utf8');
  assert.match(library, /docker exec -i .* node < "\$SCRIPT_DIR\/healthcheck.cjs"/);
  assert(!library.includes('"status":"healthy"\'*'));
});
test('healthy bounded JSON succeeds without adding a browser origin or proxy trust', async () => {
  assert.deepEqual(await execute(), { code: 0, cleared: true });
});
for (const status of [301, 403, 404, 500, 503]) test(`HTTP ${status} is never healthy`, async () => {
  assert.equal((await execute({ status })).code, 11);
});
for (const body of ['invalid JSON', '{"status":"unhealthy"}', '[{"status":"healthy"}]', '{"status":"healthy","error":"hidden"}', '{"nested":{"status":"healthy"}}', '{"status":"healthy"}' + ' '.repeat(2048)]) {
  test('malformed, non-ready or oversized body is never healthy: ' + body.slice(0, 35), async () => {
    assert.notEqual((await execute({ body })).code, 0);
  });
}
test('HTML response, transport error and absolute deadline fail safely', async () => {
  assert.equal((await execute({ type: 'text/html' })).code, 12);
  assert.equal((await execute({ error: true })).code, 10);
  assert.equal((await execute({ timeout: true })).code, 10);
});
test('deployment recreates only Pluton without dependencies, orphan removal or destructive volume commands', () => {
  const deploy = fs.readFileSync(path.join(root, 'deploy/deploy.sh'), 'utf8');
  assert.equal((deploy.match(/compose up -d --no-deps --force-recreate pluton/g) || []).length, 2);
  assert(!/down -v|remove-orphans|\beval\b|restic (?:prune|forget|unlock)/.test(deploy));
  assert.match(deploy, /verify_container "\$old_image"/);
  assert.match(deploy, /verify_container "\$target_image"/);
  const library = fs.readFileSync(path.join(root, 'deploy/lib.sh'), 'utf8');
  assert.match(library, /\[ "\$key_length" -ge 12 \]/);
});
