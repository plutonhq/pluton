import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { DatabaseRestoreStore } from '/app/backend/dist/stores/DatabaseRestoreStore.js';
import { DatabaseRestoreService } from '/app/backend/dist/services/DatabaseRestoreService.js';
import { PersistentRestoreTargets } from '/app/backend/dist/utils/persistentRestoreTargets.js';
import { MysqlPersistentDatabaseImporter } from '/app/backend/dist/utils/mysqlPersistentDatabaseImporter.js';
import { MysqlRecoveryWorkerClient } from '/app/backend/dist/utils/mysqlRecoveryWorkerClient.js';
import { recoveryMetadataToken } from '/app/backend/dist/utils/recoveryPreparation.js';
import sourceFixture from './mysqlPersistentRestore.source.cjs';
const { seedMysqlPersistentSource, admissionDiagnostic } = sourceFixture;
const require = createRequire('/app/backend/package.json'),
	Database = require('better-sqlite3');
const { drizzle } = require('drizzle-orm/better-sqlite3'),
	{ migrate } = require('drizzle-orm/better-sqlite3/migrator');
const mode = process.argv[2],
	base = '/fixture-state',
	targetId = 'c'.repeat(24),
	snapshot = 'b'.repeat(64);
assert.equal(process.getuid(), 10001);
assert.equal(process.getgid(), 10001);
await assert.rejects(fs.access('/var/run/docker.sock'));
assert.match(await fs.readFile('/proc/self/status', 'utf8'), /^CapEff:\s+0+$/m);
const keyFile = base + '/key';
try {
	await fs.writeFile(keyFile, crypto.randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 });
} catch (error) {
	if (error.code !== 'EEXIST') throw error;
}
const sqlite = new Database(
	base +
		'/' +
		(mode === 'resume' ? 'success' : mode === 'app-reconcile' ? 'app-interrupted' : mode) +
		'.sqlite'
);
migrate(drizzle(sqlite), { migrationsFolder: '/app/drizzle' });
const store = new DatabaseRestoreStore(sqlite, await fs.readFile(keyFile, 'utf8')),
	targets = new PersistentRestoreTargets();
const approval = await targets.read(targetId);
let sql =
	"-- MySQL dump\n-- Server version 8.4.11\nCREATE TABLE fixture_entries(value VARCHAR(100)); INSERT INTO fixture_entries VALUES('synthetic recovered content'); CREATE VIEW fixture_view AS SELECT value FROM fixture_entries; CREATE TEMPORARY TABLE fixture_assertion(passed INT CHECK(passed=1)); INSERT INTO fixture_assertion SELECT IF(COUNT(*)=1 AND MAX(value)='synthetic recovered content',1,0) FROM fixture_entries; DROP TEMPORARY TABLE fixture_assertion;\n";
if (['restart', 'app-interrupted', 'cancel-repeat'].includes(mode))
	sql = '-- Server version 8.4.11\nCREATE TABLE fixture_entries(id INT); SELECT SLEEP(90);\n';
if (mode === 'sql-failure')
	sql =
		'-- Server version 8.4.11\nCREATE TABLE fixture_entries(id INT); SELECT nonexistent_column FROM fixture_entries;\n';
const artifact = {
	databaseId: 'db_example',
	engine: mode === 'wrong-engine' ? 'mariadb' : 'mysql',
	database: 'example_db',
	path: '/pluton/database/db_example.sql',
	bytes: mode === 'oversize' ? 128 * 1024 ** 2 + 1 : Buffer.byteLength(sql),
	sha256: crypto.createHash('sha256').update(sql).digest('hex'),
	artifactValidation: 'pending',
	importValidation: 'pending',
};
if (mode === 'invalid-metadata') delete artifact.database;
const metadata = {
	planId: 'plan-01',
	backupId: 'backup-01',
	snapshotId: snapshot,
	repositoryId: 'repo-01',
	databases: [artifact],
};
// Resume/reconciliation must reuse the original durable source and restore state.
if (!['resume', 'app-reconcile'].includes(mode)) seedMysqlPersistentSource(sqlite, metadata);
const plan = {
	sourceType: 'device',
	sourceId: 'app-01',
	method: 'backup',
	title: 'Synthetic MySQL',
};
const request = {
	planId: metadata.planId,
	backupId: metadata.backupId,
	snapshotId: snapshot,
	databaseId: 'db_example',
	metadataToken: recoveryMetadataToken(metadata),
	mode: 'custom',
	targetId,
	ttlSeconds: 3600,
	resourcesAcknowledged: true,
	securityAcknowledged: true,
};
const service = new DatabaseRestoreService(
	store,
	{ getById: async () => plan },
	{
		testMetadata: async () => metadata,
		databaseRestoreArtifact: async (_binding, directory) => {
			await fs.mkdir(directory + '/pluton/database', { recursive: true, mode: 0o700 });
			await fs.writeFile(
				directory + '/pluton/database/db_example.sql',
				mode === 'bad-digest' ? sql.replace('fixture_entries', 'fixture_invalid') : sql,
				{ mode: 0o600 }
			);
		},
	},
	targets,
	base + '/workspaces',
	['restart', 'app-interrupted'].includes(mode)
		? target => {
				const client = new MysqlPersistentDatabaseImporter(store, target);
				return {
					inspect: (...args) => client.inspect(...args),
					removeOwned: (...args) => client.removeOwned(...args),
					restore: (row, file, directory, signal, stage) =>
						client.restore(row, file, directory, signal, value => {
							stage(value);
							if (['restart', 'app-interrupted'].includes(mode) && value === 'database-import')
								void fs.writeFile(base + '/ready', mode, { mode: 0o600 });
						}),
				};
			}
		: undefined
);
let checkpoint = 'service';
try {
	if (mode === 'coexist') {
		const recoveryTarget = JSON.parse(
			await fs.readFile('/run/pluton-persistent-restores/recovery-target.json', 'utf8')
		);
		let leases = [];
		const client = new MysqlRecoveryWorkerClient({
			leases: async () => leases,
			leaseTarget: async () => recoveryTarget,
			addLease: async lease => {
				leases.push(lease);
			},
			removeLease: async id => {
				leases = leases.filter(lease => lease.id !== id);
			},
		});
		await fs.writeFile('/tmp/phase6.sql', sql, { mode: 0o600 });
		const entry = { ...artifact, artifactValidation: 'passed' };
		await client.importDatabase({
			testId: 'a'.repeat(24),
			targetId: 'b'.repeat(24),
			target: recoveryTarget,
			entry,
			file: '/tmp/phase6.sql',
			directory: '/tmp',
			signal: new AbortController().signal,
			allowedDatabases: ['example_db'],
			stage: () => {},
		});
		assert.equal(entry.importValidation, 'passed');
		assert.equal(entry.tables, 1);
		assert.equal(entry.views, 1);
		for (const lease of [...leases]) await client.cleanup(lease);
		assert.equal(leases.length, 0);
	} else if (mode === 'app-reconcile') {
		const interrupted = store.list()[0];
		assert.equal(interrupted.status, 'importing');
		assert.equal(store.lease(interrupted.id).state, 'created');
		await service.recoverInterrupted();
		await service.idle();
		const reconciled = service.get(interrupted.id, 'administrator');
		assert.equal(reconciled.status, 'deleted');
		assert.equal(reconciled.errorCode, 'interrupted');
		assert.equal(reconciled.completedAt, null);
		assert.equal(store.lease(interrupted.id), null);
	} else if (mode === 'resume') {
		const retained = store.list()[0];
		assert.equal(retained.status, 'active');
		const completed = retained.completedAt;
		await service.recoverInterrupted();
		assert.equal(service.get(retained.id, 'administrator').status, 'active');
		const inspected = await service.inspect(retained.id, 'administrator');
		assert.equal(inspected.inspection.tables, 1);
		assert.equal(inspected.inspection.views, 1);
		assert.equal(inspected.completedAt, completed);
		assert.equal(inspected.snapshotId, snapshot);
		assert.equal(inspected.engine, 'mysql');
		assert(service.list('administrator').some(row => row.id === retained.id));
		assert.equal(service.list('other-owner').length, 0);
		const importer = new MysqlPersistentDatabaseImporter(store, approval);
		await assert.rejects(
			importer.removeOwned({ ...retained, ownerToken: 'f'.repeat(48) }, '/tmp'),
			error => error.code === 'restore-ownership-uncertain'
		);
		assert(store.lease(retained.id));
		await assert.rejects(service.delete(retained.id, 'administrator', { confirmation: 'wrong' }));
		await service.delete(retained.id, 'administrator', { confirmation: retained.id });
		await service.idle();
		assert.equal(service.get(retained.id, 'administrator').status, 'deleted');
		assert.equal(store.lease(retained.id), null);
		await service.delete(retained.id, 'administrator', { confirmation: retained.id });
	} else if (mode === 'cancel-repeat') {
		await fs.writeFile('/tmp/authorized.sql', sql, { mode: 0o600 });
		for (const cancelAt of ['database-target-preflight', 'database-import'])
			for (let attempt = 0; attempt < 20; attempt++) {
				checkpoint = cancelAt + '-' + attempt + '-restore';
				const id = crypto.randomBytes(12).toString('hex'),
					ownerToken = crypto.randomBytes(24).toString('hex');
				store.create({
					id,
					owner: 'administrator',
					purpose: approval.purpose,
					planId: 'plan-01',
					backupId: 'backup-01',
					repositoryId: 'repo-01',
					snapshotId: snapshot,
					databaseId: 'db_example',
					artifact,
					metadataToken: request.metadataToken,
					mode: 'custom',
					targetId,
					ownerToken,
					status: 'queued',
					stage: 'preflight',
					cleanup: 'none',
					createdAt: Date.now(),
					expiresAt: Date.now() + 3600000,
					ttlSeconds: 3600,
				});
				store.bind(id, approval);
				const item = store.claim(id);
				assert(item);
				const controller = new AbortController();
				const client = new MysqlPersistentDatabaseImporter(store, approval);
				await assert.rejects(
					client.restore(
						{ ...item, artifact: { ...artifact, artifactValidation: 'passed' } },
						'/tmp/authorized.sql',
						'/tmp',
						controller.signal,
						stage => {
							if (stage === cancelAt) controller.abort();
						}
					),
					error => error.code === 'cancelled'
				);
				checkpoint = cancelAt + '-' + attempt + '-cleanup';
				await client.removeOwned(store.get(id), '/tmp');
				store.finishDeleted(id);
				assert.equal(store.lease(id), null);
			}
		console.log(
			'PASS real Oracle persistent cancellation: 20 preflight + 20 import; owned cleanup after each, no stability sleeps.'
		);
	} else {
		let result;
		try {
			result = await service.create(request, 'administrator');
		} catch (error) {
			const expected = {
				'wrong-engine': 'target-binding-mismatch',
				'invalid-metadata': 'database-metadata-incomplete',
				'oversize': 'resource-operator-sql-budget',
			}[mode];
			if (!expected)
				console.error('CHECK unexpected fixture admission: ' + admissionDiagnostic(error));
			assert(expected, 'unexpected admission refusal');
			assert.equal(error.code, expected);
			assert.equal(store.list().length, 0);
			console.log('PASS Oracle persistent ' + mode + ': refused before reservation/import.');
			process.exitCode = 0;
		}
		if (result) {
			await assert.rejects(
				service.create(request, 'administrator'),
				error => error.code === 'target-already-reserved'
			);
			await service.tick();
			await service.idle();
			const current = service.get(result.id, 'administrator');
			const expected = {
				'wrong-password': 'database-authentication-failed',
				'bad-tls': 'database-tls-failed',
				'invalid-marker': 'restore-purpose-guard-mismatch',
				'existing-database': 'database-already-exists',
				'sql-failure': 'database-import-failed',
				'bad-digest': 'database-artifact-hash-mismatch',
				'worker-approval-missing': 'target-binding-mismatch',
				'unavailable': 'mysql-worker-unavailable',
				'startup-failure': 'mysql-worker-unavailable',
				'restart': 'mysql-worker-unavailable',
			}[mode];
			if (expected) {
				assert.notEqual(current.status, 'active');
				assert.equal(current.failureCode, expected);
				assert.equal(current.completedAt, null);
				if (['sql-failure', 'bad-digest'].includes(mode)) assert.equal(current.status, 'deleted');
			} else {
				assert(['success', 'ttl'].includes(mode));
				assert.equal(current.status, 'active');
				assert.equal(current.inspection.tables, 1);
				assert.equal(current.inspection.views, 1);
				assert.equal(store.lease(result.id).state, 'validated');
				assert(current.completedAt > 0);
				if (mode === 'ttl') {
					store.update(result.id, { expiresAt: Date.now() - 1 });
					await assert.rejects(service.inspect(result.id, 'administrator'));
					await service.tick();
					await service.idle();
					assert.equal(store.get(result.id).status, 'deleted');
				}
			}
			assert(!JSON.stringify(service.list('administrator')).includes(approval.target.password));
			assert(
				!JSON.stringify(
					sqlite.prepare('SELECT * FROM persistent_database_restores').all()
				).includes(approval.target.password)
			);
			if (mode === 'success') assert.equal(store.get(result.id).status, 'active');
		}
	}
	console.log(
		'PASS real Oracle MySQL persistent ' + mode + ': exact artifact/ownership/retention boundary.'
	);
} catch (error) {
	console.error(
		'FAIL Oracle persistent ' +
			mode +
			': ' +
			checkpoint +
			' / ' +
			(error.code || error.actual || 'assertion') +
			(error.expected ? ' expected=' + error.expected : '')
	);
	process.exitCode = 1;
} finally {
	await service.shutdown();
	sqlite.close();
}
