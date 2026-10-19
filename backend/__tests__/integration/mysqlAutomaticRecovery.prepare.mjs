// Local disposable fixture only. No host namespace/loop/systemd operations.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const retained = require('/fixture-deploy/persistent-restore/operator.cjs');
const automatic = require('/fixture-deploy/automatic-recovery/operator.cjs');
const [mode = 'disposable', scenario = 'success'] = process.argv.slice(2);
if (
	process.getuid() !== 0 ||
	!['disposable', 'persistent'].includes(mode) ||
	![
		'success',
		'wrong-password',
		'bad-tls',
		'invalid-marker',
		'existing-database',
		'cancel',
	].includes(scenario)
)
	throw new Error('Invalid isolated fixture.');
const write = (file, value, gid = 999, permissions = 0o640) => {
	fs.writeFileSync(
		file,
		typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value),
		{ mode: permissions }
	);
	fs.chownSync(file, 0, gid);
	fs.chmodSync(file, permissions);
};
for (const directory of ['/config', '/boot', '/public']) {
	fs.chownSync(directory, 0, directory === '/public' ? 10001 : 999);
	fs.chmodSync(directory, 0o750);
}
fs.chownSync('/lock', 999, 999);
fs.chmodSync('/lock', 0o700);
const id = crypto.randomBytes(12).toString('hex'),
	host = 'persistent-db-' + id,
	activationId = crypto.randomBytes(16).toString('hex'),
	storageId = crypto.randomBytes(16).toString('hex'),
	password = crypto.randomBytes(32).toString('hex'),
	snapshotId = 'a'.repeat(64);
const openssl = args => execFileSync('openssl', args, { stdio: 'pipe' });
openssl([
	'req',
	'-x509',
	'-newkey',
	'rsa:2048',
	'-nodes',
	'-days',
	'2',
	'-subj',
	'/CN=Synthetic Internal MySQL CA',
	'-keyout',
	'/tmp/ca.key',
	'-out',
	'/config/ca.pem',
]);
openssl([
	'req',
	'-new',
	'-newkey',
	'rsa:2048',
	'-nodes',
	'-subj',
	'/CN=' + host,
	'-keyout',
	'/config/server.key',
	'-out',
	'/tmp/server.csr',
]);
write(
	'/tmp/server.ext',
	'subjectAltName=DNS:' +
		(scenario === 'bad-tls' ? 'wrong.example.internal' : host) +
		'\nextendedKeyUsage=serverAuth\n'
);
openssl([
	'x509',
	'-req',
	'-in',
	'/tmp/server.csr',
	'-CA',
	'/config/ca.pem',
	'-CAkey',
	'/tmp/ca.key',
	'-set_serial',
	'0x' + activationId,
	'-days',
	'2',
	'-sha256',
	'-extfile',
	'/tmp/server.ext',
	'-out',
	'/config/server.pem',
]);
for (const file of ['ca.pem', 'server.key', 'server.pem']) {
	fs.chownSync('/config/' + file, 0, 999);
	fs.chmodSync('/config/' + file, 0o640);
}
let bootstrap =
	mode === 'persistent'
		? retained.bootstrapSql('mysql', 'example_db', password, activationId, storageId)
		: automatic.disposableSql(
				['example_db'],
				'mysql',
				'example_db',
				password,
				activationId,
				storageId,
				'restore_user'
			);
const guard =
	mode === 'persistent'
		? 'pluton_restore_guard.contract'
		: 'pluton_recovery_guard.pluton_recovery_guard';
if (scenario === 'invalid-marker')
	bootstrap += 'UPDATE ' + guard + " SET purpose='invalid-synthetic-marker';\n";
if (scenario === 'existing-database')
	bootstrap +=
		'CREATE DATABASE example_db; CREATE TABLE example_db.protected_fixture(id INT); INSERT INTO example_db.protected_fixture VALUES(1);\n';
write('/config/bootstrap.sql', bootstrap);
write('/config/identity.json', { restoreId: id, activationId, storageId });
write(
	'/config/ready.cnf',
	'[client]\nhost=127.0.0.1\nprotocol=tcp\nuser=restore_user\npassword=' +
		password +
		'\nssl-mode=REQUIRED\n'
);
write('/boot/bootstrap.sh', fs.readFileSync('/fixture-deploy/persistent-restore/bootstrap.sh'));
write('/boot/mysql-lock.py', fs.readFileSync('/fixture-deploy/persistent-restore/mysql-lock.py'));
write(
	'/boot/start.sh',
	[
		'#!/bin/bash',
		'set -Eeuo pipefail',
		'umask 077',
		'if [[ ! -f /var/lib/mysql/identity.json ]];then cp /run/pluton-persistent-bootstrap/identity.json /var/lib/mysql/identity.json;mkdir -m 700 /var/lib/mysql/data;fi',
		'exec /bin/bash /opt/pluton-persistent/bootstrap.sh mysql',
		'',
	].join('\n')
);
const sql =
	scenario === 'cancel'
		? '-- Server version 8.4.11\nCREATE TABLE fixture_entries(id INT); SELECT SLEEP(60);\n'
		: "-- MySQL dump\n-- Server version 8.4.11\nCREATE TABLE fixture_entries(value VARCHAR(100)); INSERT INTO fixture_entries VALUES('synthetic automatic content'); CREATE VIEW fixture_view AS SELECT value FROM fixture_entries; CREATE TEMPORARY TABLE fixture_assertion(passed INT CHECK(passed=1)); INSERT INTO fixture_assertion SELECT IF(COUNT(*)=1 AND MAX(value)='synthetic automatic content',1,0) FROM fixture_entries; DROP TEMPORARY TABLE fixture_assertion;\n";
const artifact = {
	databaseId: 'db_example',
	database: 'example_db',
	sha256: crypto.createHash('sha256').update(sql).digest('hex'),
	bytes: Buffer.byteLength(sql),
};
const createdAt = Date.now(),
	binding = {
		id,
		mode,
		engine: 'mysql',
		snapshotId,
		artifacts: [artifact],
		createdAt,
		expiresAt: createdAt + 3600000,
	};
const ownerToken = crypto.randomBytes(24).toString('hex'),
	bindingHash = automatic.hash({ binding, ownerToken });
const ca = fs.readFileSync('/config/ca.pem'),
	target = {
		engine: 'mysql',
		host,
		port: 3306,
		username: 'restore_user',
		password: scenario === 'wrong-password' ? crypto.randomBytes(32).toString('hex') : password,
		tls: 'verify-identity',
		enabled: true,
		dedicated: true,
	};
const approval = {
	version: 1,
	id,
	purpose:
		mode === 'persistent' ? 'pluton-persistent-database-restore-v1' : 'pluton-phase6-recovery-only',
	mode: 'internal',
	activationId,
	engine: 'mysql',
	database: 'example_db',
	target,
	caSha256: crypto.createHash('sha256').update(ca).digest('hex'),
	maxSqlBytes: 128 * 1024 ** 2,
	maxRetentionSeconds: 86400,
	storage: { id: storageId, kind: 'fixed-ext4', quotaBytes: 2147483648 },
	binding: { restoreId: id, snapshotId, sha256: artifact.sha256 },
	containerId: 'c'.repeat(64),
};
write('/public/' + id + '-ca.pem', ca, 10001);
write('/public/' + id + '.mysql.json', { version: 1, binding, bindingHash, approval }, 10001);
write(
	'/public/' + id + '.receipt.json',
	{ version: 1, id, bindingHash, state: 'ready', code: null, observedAt: Date.now(), sequence: 1 },
	10001
);
write(
	'/public/target.json',
	{ internal: { enabled: true, maxArtifactBytes: 128 * 1024 ** 2 } },
	10001
);
write(
	'/public/context.json',
	{ id, mode, scenario, snapshotId, artifact, approval, binding, ownerToken },
	10001
);
fs.writeFileSync('/state/artifact.sql', sql, { mode: 0o600 });
fs.chownSync('/state/artifact.sql', 10001, 10001);
fs.chownSync('/state', 10001, 10001);
fs.chmodSync('/state', 0o700);
console.log('PASS private synthetic Oracle ' + mode + ' fixture prepared.');
