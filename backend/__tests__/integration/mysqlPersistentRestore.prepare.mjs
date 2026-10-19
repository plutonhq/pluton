// Disposable fixture only. Credentials/keys are generated inside private volumes.
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
const id = 'c'.repeat(24),
	action = process.argv[2] || 'prepare';
if (action === 'prepare') {
	await import('./mysqlRecoveryWorker.prepare.mjs');
	await fs.mkdir('/approval', { recursive: true, mode: 0o750 });
	await fs.chown('/approval', 0, 10001);
	const target = JSON.parse(await fs.readFile('/control/targets.json', 'utf8'));
	target.username = 'restore_user';
	target.password = crypto.randomBytes(32).toString('hex');
	const approval = {
		version: 1,
		id,
		purpose: 'pluton-persistent-database-restore-v1',
		mode: 'custom',
		activationId: 'd'.repeat(32),
		engine: 'mysql',
		database: 'example_db',
		target,
		caSha256: crypto
			.createHash('sha256')
			.update(await fs.readFile('/control/ca.pem'))
			.digest('hex'),
		maxSqlBytes: 128 * 1024 ** 2,
		maxRetentionSeconds: 86400,
		storage: { id: 'e'.repeat(32), kind: 'operator-approved-external', quotaBytes: 2 * 1024 ** 3 },
	};
	await fs.appendFile(
		'/control/provision.sql',
		`CREATE DATABASE pluton_restore_guard;
CREATE TABLE pluton_restore_guard.contract(purpose VARCHAR(80),activation_id VARCHAR(32),storage_id VARCHAR(36));
INSERT INTO pluton_restore_guard.contract VALUES('${approval.purpose}','${approval.activationId}','${approval.storage.id}');
CREATE USER 'restore_user'@'%' IDENTIFIED BY '${target.password}' REQUIRE SSL;
GRANT SELECT ON pluton_restore_guard.contract TO 'restore_user'@'%';
GRANT ALL PRIVILEGES ON \`example\\_db\`.* TO 'restore_user'@'%';
`
	);
	await fs.writeFile('/control/persistent-approval.json', JSON.stringify(approval), {
		mode: 0o600,
	});
	const config = {
		host: target.host,
		port: 3306,
		username: 'recovery_user',
		databases: ['example_db'],
		maxArtifactBytes: 1024 ** 2,
		persistent: {
			targetId: id,
			activationId: approval.activationId,
			storageId: approval.storage.id,
			host: target.host,
			port: 3306,
			username: target.username,
			database: 'example_db',
			maxArtifactBytes: 128 * 1024 ** 2,
		},
	};
	await fs.writeFile('/control/persistent-config.json', JSON.stringify(config), { mode: 0o600 });
	await fs.copyFile('/control/ca.pem', `/approval/${id}-ca.pem`);
	await fs.chown(`/approval/${id}-ca.pem`, 0, 10001);
	await fs.chmod(`/approval/${id}-ca.pem`, 0o640);
	await fs.copyFile('/control/targets.json', '/approval/recovery-target.json');
	await fs.chown('/approval/recovery-target.json', 0, 10001);
	await fs.chmod('/approval/recovery-target.json', 0o640);
	await fs.chown('/state', 10001, 10001);
	await fs.chmod('/state', 0o700);
}
const approval = JSON.parse(await fs.readFile('/control/persistent-approval.json', 'utf8'));
const config = JSON.parse(await fs.readFile('/control/persistent-config.json', 'utf8'));
if (action === 'wrong-password') approval.target.password = crypto.randomBytes(32).toString('hex');
if (action === 'bad-tls')
	approval.target.host = config.persistent.host = 'mysql-wrong-identity.example.internal';
if (action === 'worker-approval-missing') delete config.persistent;
if (action === 'startup-failure') config.persistent.storageId = 'invalid';
await fs.writeFile(`/approval/${id}.json`, JSON.stringify(approval), { mode: 0o640 });
await fs.chown(`/approval/${id}.json`, 0, 10001);
await fs.chmod(`/approval/${id}.json`, 0o640);
await fs.writeFile('/config/target.json', JSON.stringify(config), { mode: 0o644 });
console.log('PASS private synthetic MySQL persistent target policy: ' + action);
