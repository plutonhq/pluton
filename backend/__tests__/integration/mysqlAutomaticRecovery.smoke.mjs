import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { MysqlRecoveryWorkerClient } from '/app/backend/dist/utils/mysqlRecoveryWorkerClient.js';
import { RecoveryTestStore } from '/app/backend/dist/stores/RecoveryTestStore.js';
import { DatabaseRestoreStore } from '/app/backend/dist/stores/DatabaseRestoreStore.js';
import { MysqlPersistentDatabaseImporter } from '/app/backend/dist/utils/mysqlPersistentDatabaseImporter.js';
const require = createRequire('/app/backend/package.json'),
	Database = require('better-sqlite3'),
	{ drizzle } = require('drizzle-orm/better-sqlite3'),
	{ migrate } = require('drizzle-orm/better-sqlite3/migrator');
assert.equal(process.getuid(), 10001);
assert.equal(process.getgid(), 10001);
await assert.rejects(fs.access('/var/run/docker.sock'));
assert.match(await fs.readFile('/proc/self/status', 'utf8'), /^CapEff:\s+0+$/m);
const c = JSON.parse(await fs.readFile('/fixture/public/context.json', 'utf8'));
const sqlite = new Database('/fixture/state/import.sqlite');
migrate(drizzle(sqlite), { migrationsFolder: '/app/drizzle' });
sqlite.pragma('foreign_keys=ON');
sqlite.exec(
	"INSERT INTO storages(id,name,type) VALUES('storage-01','Synthetic SFTP','sftp'); INSERT INTO devices(id,name) VALUES('app-01','Fixture');"
);
sqlite.exec(
	"INSERT INTO agent_identities(agent_id,device_id,encrypted_secret,hostname,os,architecture,agent_version,capabilities) VALUES('agent-01','app-01','synthetic-cipher','app-01','Linux','x86_64','0.4.0','{}');"
);
sqlite
	.prepare(
		'INSERT INTO plans(id,title,source_id,source_type,method,storage_id,source_config,settings) VALUES(?,?,?,?,?,?,?,?)'
	)
	.run('plan-01', 'Fixture', 'app-01', 'device', 'backup', 'storage-01', '{}', '{}');
sqlite
	.prepare(
		'INSERT INTO remote_managed_repositories(id,plan_id,agent_id,storage_id,storage_path,encrypted_password,initialized_at) VALUES(?,?,?,?,?,?,?)'
	)
	.run('repo-01', 'plan-01', 'agent-01', 'storage-01', 'managed/app', 'synthetic-cipher', 1);
sqlite
	.prepare(
		'INSERT INTO backups(id,plan_id,source_id,source_type,method,storage_id,status,in_progress,success,completion_stats) VALUES(?,?,?,?,?,?,?,?,?,?)'
	)
	.run(
		'backup-01',
		'plan-01',
		'app-01',
		'device',
		'backup',
		'storage-01',
		'completed',
		0,
		1,
		JSON.stringify({ snapshot_id: c.snapshotId })
	);
sqlite.prepare('UPDATE plans SET storage_path=? WHERE id=?').run('managed/app', 'plan-01');
sqlite.prepare('UPDATE backups SET storage_path=? WHERE id=?').run('managed/app', 'backup-01');
const key = crypto.randomBytes(32).toString('hex');
const store = new RecoveryTestStore(drizzle(sqlite), key);
const policy = { enabled: false, databaseImport: 'required', targetModes: { mysql: 'internal' } };
let target;
if (c.mode === 'disposable') {
	await store.enqueue({
		id: c.id,
		planId: 'plan-01',
		backupId: 'backup-01',
		repositoryId: 'repo-01',
		snapshotId: c.snapshotId,
		status: 'queued',
		trigger: 'manual',
		policy,
	});
	await store.claim();
	target = await store.beginInternalSession({
		testId: c.id,
		engine: 'mysql',
		installationId: 'e'.repeat(32),
		activationId: c.approval.activationId,
		target: c.approval.target,
		caSha256: c.approval.caSha256,
	});
}
const client = new MysqlRecoveryWorkerClient(store, undefined, async testId => {
	assert.equal(testId, c.id);
	return { id: c.id, snapshotId: c.snapshotId };
});
const entry = {
	...c.artifact,
	engine: 'mysql',
	path: '/pluton/database/db_example.sql',
	artifactValidation: 'passed',
	importValidation: 'pending',
};
const controller = new AbortController();
let stage = 'preflight',
	timer;
try {
	if (c.mode === 'persistent') {
		const persistentStore = new DatabaseRestoreStore(sqlite, key);
		let row = {
			id: c.id,
			owner: 'administrator',
			purpose: c.approval.purpose,
			planId: 'plan-01',
			backupId: 'backup-01',
			repositoryId: 'repo-01',
			snapshotId: c.snapshotId,
			databaseId: entry.databaseId,
			artifact: entry,
			metadataToken: 'f'.repeat(64),
			mode: 'internal',
			targetId: c.id,
			targetFingerprint: null,
			encryptedApproval: null,
			ownerToken: c.ownerToken,
			database: null,
			status: 'queued',
			stage: 'snapshot-validation',
			cleanup: 'none',
			createdAt: c.binding.createdAt,
			startedAt: null,
			expiresAt: c.binding.expiresAt,
			ttlSeconds: 3600,
			lastValidatedAt: null,
			inspection: null,
			errorCode: null,
			cancelRequested: false,
		};
		persistentStore.create(row);
		persistentStore.bind(c.id, c.approval);
		row = persistentStore.claim(c.id);
		assert(row);
		const importer = new MysqlPersistentDatabaseImporter(persistentStore, c.approval);
		let failed, inspection;
		try {
			inspection = await importer.restore(
				row,
				'/fixture/state/artifact.sql',
				'/fixture/state',
				controller.signal,
				value => {
					stage = value;
					if (c.scenario === 'cancel' && value === 'database-import')
						timer = setTimeout(() => controller.abort(), 250);
				}
			);
		} catch (error) {
			failed = error;
		}
		const expected = {
			'wrong-password': 'database-authentication-failed',
			'bad-tls': 'database-tls-failed',
			'invalid-marker': 'restore-purpose-guard-mismatch',
			'existing-database': 'database-already-exists',
			'cancel': 'cancelled',
		}[c.scenario];
		if (expected) assert.equal(failed?.code, expected);
		else {
			if (failed) throw failed;
			assert.equal(inspection.tables, 1);
			assert.equal(inspection.views, 1);
			assert.equal(persistentStore.lease(c.id).state, 'validated');
			persistentStore.update(c.id, { status: 'active', database: inspection.database });
			// The driver performs Stop/Resume of the SAME container, not a SQL retry.
			await fs.writeFile('/fixture/state/restart-requested', 'ready', { mode: 0o600 });
			const deadline = Date.now() + 60000;
			for (;;) {
				try {
					await fs.access('/fixture/state/restart-complete');
					break;
				} catch {
					if (Date.now() > deadline) throw new Error('restart timeout');
				}
				await new Promise(resolve => setTimeout(resolve, 100));
			}
			const reopened = new DatabaseRestoreStore(sqlite, key),
				retained = reopened.get(c.id);
			assert.equal(retained.status, 'active');
			assert.equal(retained.ownerToken, row.ownerToken);
			assert.equal(retained.snapshotId, c.snapshotId);
			const next = new MysqlPersistentDatabaseImporter(reopened, reopened.approval(c.id));
			const current = await next.inspect(retained, '/fixture/state', controller.signal);
			assert.equal(current.tables, 1);
			assert.equal(current.views, 1);
			assert.equal(current.database, inspection.database);
		}
		if (['success', 'cancel'].includes(c.scenario)) {
			await importer.removeOwned(row, '/fixture/state');
			assert.equal(persistentStore.lease(c.id), null);
		} else assert.equal(persistentStore.lease(c.id), null);
		console.log(
			'PASS Oracle MySQL Internal persistent/' +
				c.scenario +
				' native import, retained identity and owner cleanup. Host ext4 NOT tested.'
		);
	} else {
		let failed;
		try {
			await client.importDatabase({
				testId: c.id,
				targetId: target.id,
				target: c.approval.target,
				entry,
				file: '/fixture/state/artifact.sql',
				directory: '/fixture/state',
				signal: controller.signal,
				allowedDatabases: ['example_db'],
				stage: value => {
					stage = value;
					if (c.scenario === 'cancel' && value === 'database-import')
						timer = setTimeout(() => controller.abort(), 250);
				},
			});
		} catch (error) {
			failed = error;
		}
		const expected = {
			'wrong-password': 'database-authentication-failed',
			'bad-tls': 'database-tls-failed',
			'invalid-marker': 'recovery-target-unsafe',
			'existing-database': 'database-already-exists',
			'cancel': 'cancelled',
		}[c.scenario];
		if (expected) assert.equal(failed?.code, expected);
		else {
			if (failed) throw failed;
			assert.equal(entry.importValidation, 'passed');
			assert.equal(entry.tables, 1);
			assert.equal(entry.views, 1);
			assert.equal((await store.leases(c.id)).length, 1);
		}
		if (['success', 'cancel'].includes(c.scenario)) {
			for (const lease of await store.leases(c.id)) await client.cleanup(lease);
			assert.equal((await store.leases(c.id)).length, 0);
			await client.verifyEmptyTarget(target, c.id);
		} else assert.equal((await store.leases(c.id)).length, 0);
		console.log(
			'PASS Oracle MySQL Internal ' +
				c.mode +
				'/' +
				c.scenario +
				' native SQL/lease guard; no host quota acceptance claimed.'
		);
	}
} catch (error) {
	console.error(
		'FAIL Oracle Internal fixture stage=' + stage + ' code=' + (error.code || 'assertion')
	);
	process.exitCode = 1;
} finally {
	clearTimeout(timer);
	sqlite.close();
}
