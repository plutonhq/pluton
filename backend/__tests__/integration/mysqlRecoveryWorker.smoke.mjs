import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { MysqlRecoveryWorkerClient } from '/app/backend/dist/utils/mysqlRecoveryWorkerClient.js';
const mode = process.argv[2];
assert.equal(process.getuid(), 10001);
assert.equal(process.getgid(), 10001);
const target = JSON.parse(await fs.readFile('/fixture-control/targets.json', 'utf8'));
let leases = [];
const persist = async () =>
	fs.writeFile('/tmp/leases.json', JSON.stringify(leases), { mode: 0o600 });
const store = {
	leases: async () => leases,
	leaseTarget: async () => target,
	addLease: async lease => {
		leases.push(lease);
		await persist();
	},
	removeLease: async id => {
		leases = leases.filter(lease => lease.id !== id);
		await persist();
	},
};
const client = new MysqlRecoveryWorkerClient(store);
const controller = new AbortController();
const stages = [];
let sql =
	"CREATE TABLE fixture_entries (value VARCHAR(100) CHECK(value='synthetic recovered content')); INSERT INTO fixture_entries VALUES ('synthetic recovered content'); CREATE VIEW fixture_view AS SELECT value FROM fixture_entries; CREATE TEMPORARY TABLE fixture_assertion (passed INT CHECK(passed=1)); INSERT INTO fixture_assertion SELECT IF(COUNT(*)=1 AND MAX(value)='synthetic recovered content',1,0) FROM fixture_entries; DROP TEMPORARY TABLE fixture_assertion;\n";
if (mode === 'sql-failure')
	sql = 'CREATE TABLE fixture_entries(id INT); SELECT nonexistent_column FROM fixture_entries;\n';
if (mode === 'client-command') sql = '\\! touch /tmp/mysql-worker-command-escape\n';
if (['cancel', 'restart'].includes(mode))
	sql = 'CREATE TABLE fixture_entries(id INT); SELECT SLEEP(90);\n';
await fs.writeFile('/tmp/artifact.sql', sql, { mode: 0o600 });
if (mode === 'wrong-password') target.password = crypto.randomBytes(32).toString('hex');
if (mode === 'target-mismatch') target.host = 'unapproved.example.internal';
const entry = {
	engine: 'mysql',
	database: 'example_db',
	path: '/pluton/database/app.sql',
	bytes: Buffer.byteLength(sql),
	sha256: crypto.createHash('sha256').update(sql).digest('hex'),
	artifactValidation: 'passed',
	importValidation: 'pending',
};
if (mode === 'bad-digest') entry.sha256 = '0'.repeat(64);
const input = {
	testId: 'a'.repeat(24),
	targetId: 'b'.repeat(24),
	target,
	entry,
	file: '/tmp/artifact.sql',
	directory: '/tmp',
	signal: controller.signal,
	allowedDatabases: ['example_db'],
	stage: stage => {
		stages.push(stage);
		if (stage === 'database-import') {
			if (mode === 'cancel') setTimeout(() => controller.abort(), 5000);
			if (['cancel', 'restart'].includes(mode)) void fs.writeFile('/fixture-state/ready', mode);
		}
	},
};
const expected = {
	'wrong-password': 'database-authentication-failed',
	'invalid-marker': 'recovery-target-unsafe',
	'existing-database': 'database-already-exists',
	'sql-failure': 'database-import-failed',
	'client-command': 'database-import-failed',
	'bad-digest': 'database-artifact-hash-mismatch',
	'target-mismatch': 'recovery-target-unsafe',
	'bad-tls': 'database-tls-failed',
	'unavailable': 'mysql-worker-unavailable',
	'cancel': 'cancelled',
	'restart': 'mysql-worker-unavailable',
}[mode];
try {
	if (expected)
		await assert.rejects(client.importDatabase(input), error => {
			assert(!error.message.includes(target.password));
			return error.code === expected;
		});
	else {
		assert.equal(mode, 'success');
		await client.importDatabase(input);
		assert.equal(entry.importValidation, 'passed');
		assert.equal(entry.tables, 1);
		assert.equal(entry.views, 1);
		assert.deepEqual(stages, [
			'database-target-preflight',
			'database-import',
			'database-import-validation',
		]);
		assert.equal(leases.length, 1);
		// Existing DB/ownership protection even if a caller supplies a forged cleanup token.
		await assert.rejects(client.cleanup({ ...leases[0], ownerToken: 'e'.repeat(48) }));
		assert.equal(leases.length, 1);
	}
	if (
		[
			'wrong-password',
			'invalid-marker',
			'existing-database',
			'bad-digest',
			'target-mismatch',
			'bad-tls',
			'unavailable',
		].includes(mode)
	)
		assert.equal(leases.length, 0);
	if (['sql-failure', 'client-command', 'cancel', 'restart'].includes(mode))
		assert.equal(leases.length, 1);
	for (const lease of [...leases]) {
		// A restart can temporarily be unavailable. Durable cleanup is explicitly retried, not dropped.
		for (let attempt = 0; ; attempt++) {
			try {
				await client.cleanup(lease);
				break;
			} catch (error) {
				if (mode !== 'restart' || attempt > 40) throw error;
				await new Promise(resolve => setTimeout(resolve, 250));
			}
		}
	}
	assert.equal(leases.length, 0);
	assert(!JSON.stringify({ entry, stages }).includes(target.password));
	console.log(
		`PASS Oracle MySQL worker ${mode}: real TLS/client/import boundary, closed diagnostics, ownership-safe cleanup.`
	);
} finally {
	await fs.rm('/tmp/artifact.sql', { force: true });
	await fs.rm('/tmp/leases.json', { force: true });
}
