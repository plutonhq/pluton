import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
assert.equal(process.getuid(), 10001);
assert.equal(process.getgid(), 10001);
const probe = spawnSync('/usr/bin/mysql', ['--no-defaults', '--commands=OFF', '--binary-mode', '--local-infile=0', '--version'], {
  encoding: 'utf8', timeout: 2000, env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' }, shell: false,
});
assert.equal(probe.status, 0);
assert.match(probe.stdout, /Ver 8\.4\.11\b.*MySQL Community/);
assert.doesNotMatch(probe.stdout, /MariaDB/i);
for (const name of ['mysql-community-client-core', 'mysql-community-client-plugins']) {
  const result = spawnSync('/usr/bin/dpkg-query', ['-W', '-f=${Version}', name], { encoding: 'utf8' });
  assert.equal(result.stdout, '8.4.11-1debian12');
}
for (const name of ['/usr/sbin/mysqld', '/usr/bin/mysqld', '/usr/bin/mariadbd', '/usr/lib/postgresql', '/var/run/docker.sock', '/data']) assert.equal(existsSync(name), false, name);
assert.equal(statSync('/app/worker.mjs').uid, 0);
assert.equal(statSync('/app/worker.mjs').mode & 0o022, 0);
console.log('UID 10001: genuine Oracle MySQL Community 8.4.11 client-only worker verified.');
