import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import Cryptr from 'cryptr';
import { plans } from '../../src/db/schema/plans';
import { backups } from '../../src/db/schema/backups';
import { restores } from '../../src/db/schema/restores';
import {
	recoveryTests,
	recoveryTargets,
	recoveryTestPolicies,
	recoveryImportLeases,
} from '../../src/db/schema/recoveryTests';
import { RecoveryTestStore } from '../../src/stores/RecoveryTestStore';
import {
	internalRecoverySessions,
	internalRecoveryImportLeases,
} from '../../src/db/schema/internalRecovery';
import type { DatabaseType } from '../../src/db';

const scenario = process.argv[2];
const sqlite = new Database(':memory:');
const schema = {
	plans,
	backups,
	recoveryTests,
	recoveryTargets,
	recoveryTestPolicies,
	recoveryImportLeases,
	internalRecoverySessions,
	internalRecoveryImportLeases,
};
const db = drizzle(sqlite, { schema }) as unknown as DatabaseType;
const key = crypto.randomBytes(32).toString('hex');
const store = new RecoveryTestStore(db, key);
const id = 'a'.repeat(24),
	snapshotId = 'b'.repeat(64);
const migrationsFolder = path.resolve('drizzle');
const target = {
	engine: 'mariadb',
	host: 'localhost',
	port: 3306,
	username: 'recovery_user',
	tls: 'local',
	enabled: true,
	dedicated: true,
	password: 'synthetic-recovery-password',
};
try {
	if (scenario === 'migration' || scenario === 'migration-rollback') {
		const old = readMigrationFiles({ migrationsFolder }).slice(0, 9);
		for (const migration of old) for (const statement of migration.sql) sqlite.exec(statement);
		sqlite.exec(
			'CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, hash text NOT NULL, created_at numeric)'
		);
		for (const migration of old)
			sqlite
				.prepare('INSERT INTO __drizzle_migrations(hash,created_at) VALUES (?,?)')
				.run(migration.hash, migration.folderMillis);
		if (scenario === 'migration-rollback') {
			// A real migration transaction rolls back preceding CREATEs on an error.
			const migration = readMigrationFiles({ migrationsFolder })[9];
			assert.throws(() =>
				sqlite.transaction(() => {
					for (const statement of migration.sql) sqlite.exec(statement);
					sqlite.exec('SELECT * FROM missing_fixture_table');
				})()
			);
			assert.equal(
				sqlite.prepare("SELECT count(*) n FROM sqlite_master WHERE name='recovery_tests'").get().n,
				0
			);
		}
	} else migrate(db, { migrationsFolder });
	// Generic disposable metadata only; no native application singleton or live files.
	sqlite.exec(
		"INSERT INTO storages(id,name,type) VALUES ('storage-01','Fixture SFTP','sftp'); INSERT INTO devices(id,name) VALUES ('app-01','Fixture device'); INSERT INTO agent_identities(agent_id,device_id,encrypted_secret,hostname,os,architecture,agent_version,capabilities) VALUES ('agent-01','app-01','synthetic-cipher','app-01','Linux','x86_64','0.4.0','{}');"
	);
	db.insert(plans)
		.values({
			id: 'plan-01',
			title: 'Fixture plan',
			sourceId: 'app-01',
			sourceType: 'device',
			method: 'backup',
			storageId: 'storage-01',
			storagePath: 'managed/app',
			sourceConfig: { includes: ['/srv/example-app'], excludes: [] },
			settings: { encryption: true } as any,
		})
		.run();
	const cipher = new Cryptr(key).encrypt('synthetic-repository-password');
	sqlite
		.prepare(
			'INSERT INTO remote_managed_repositories(id,plan_id,agent_id,storage_id,storage_path,encrypted_password,initialized_at) VALUES (?,?,?,?,?,?,?)'
		)
		.run('repo-01', 'plan-01', 'agent-01', 'storage-01', 'managed/app', cipher, 1);
	db.insert(backups)
		.values({
			id: 'backup-01',
			planId: 'plan-01',
			sourceId: 'app-01',
			sourceType: 'device',
			method: 'backup',
			storageId: 'storage-01',
			storagePath: 'managed/app',
			status: 'completed',
			inProgress: false,
			success: true,
			ended: new Date(Date.now() + 2000),
			completionStats: { snapshot_id: snapshotId } as any,
		})
		.run();
	if (scenario.startsWith('migration')) {
		const before = sqlite.prepare('SELECT * FROM backups').all();
		migrate(db, { migrationsFolder });
		migrate(db, { migrationsFolder });
		assert.deepEqual(sqlite.prepare('SELECT * FROM backups').all(), before);
		assert.equal(
			sqlite.prepare('SELECT encrypted_password FROM remote_managed_repositories').get()
				.encrypted_password,
			cipher
		);
		assert.equal(sqlite.prepare('SELECT count(*) n FROM recovery_tests').get().n, 0);
	}
	sqlite.pragma('foreign_keys = ON');
	const row = {
		id,
		planId: 'plan-01',
		backupId: 'backup-01',
		repositoryId: 'repo-01',
		snapshotId,
		status: 'queued' as const,
		trigger: 'after_backup' as const,
		automationKey: `after-backup:backup-01:${snapshotId}`,
		policy: { enabled: true, databaseImport: 'disabled' as const },
	};
	if (scenario === 'internal') {
		await store.saveTarget('plan-01', target);
		const custom = db.select().from(recoveryTargets).get()!;
		await store.savePolicy('plan-01', {
			enabled: false,
			databaseImport: 'required',
			targetModes: { mariadb: 'internal' },
		});
		await assert.rejects(
			store.savePolicy('plan-01', { enabled: true, databaseImport: 'required' })
		);
		await store.savePolicy('plan-01', { enabled: false, databaseImport: 'required' });
		assert.equal((await store.policy('plan-01')).targetModes?.mariadb, 'internal');
		assert.deepEqual(db.select().from(recoveryTargets).get(), custom);
		await store.enqueue({ ...row, trigger: 'manual', policy: await store.policy('plan-01') });
		const input = {
			testId: id,
			engine: 'mariadb' as const,
			installationId: '1'.repeat(32),
			activationId: '2'.repeat(32),
			target: {
				...target,
				engine: 'mariadb' as const,
				host: 'internal-mariadb',
				tls: 'verify-identity' as const,
				dedicated: true as const,
			},
			caSha256: '3'.repeat(64),
		};
		await assert.rejects(store.beginInternalSession(input));
		await store.claim();
		const saved = await store.beginInternalSession(input);
		assert(saved.id.startsWith('irt_'));
		assert(
			!JSON.stringify(db.select().from(internalRecoverySessions).get()).includes(target.password)
		);
		assert.equal((await store.leaseTarget(saved.id))!.password, target.password);
		assert.equal(((await store.leaseTarget(saved.id)) as any).id, undefined);
		await assert.rejects(store.beginInternalSession(input));
		const lease = {
			id: '4'.repeat(24),
			testId: id,
			targetId: saved.id,
			database: 'example_db',
			ownerToken: '5'.repeat(48),
		};
		await store.addLease(lease);
		assert(lease.id.startsWith('il_'));
		assert.equal((await store.leases(id)).length, 1);
		await assert.rejects(store.markInternalCleanupReady(saved.id));
		await assert.rejects(store.assertPlanRemovable('plan-01'));
		assert.throws(() => sqlite.prepare('DELETE FROM recovery_tests WHERE id=?').run(id));
		await store.removeLease(lease.id);
		await store.markInternalCleanupReady(saved.id);
		assert.equal((await store.pendingInternalSessions()).length, 1);
		sqlite.exec(
			"CREATE TRIGGER reject_release BEFORE UPDATE ON internal_recovery_sessions BEGIN SELECT RAISE(ABORT,'fixture'); END;"
		);
		await assert.rejects(store.completeInternalCleanup(saved.id, { status: 'passed' }));
		assert.equal((await store.get(id))!.status, 'running');
		sqlite.exec('DROP TRIGGER reject_release');
		await store.completeInternalCleanup(saved.id, { status: 'failed' });
		await store.assertPlanRemovable('plan-01');
		sqlite.prepare('DELETE FROM recovery_tests WHERE id=?').run(id);
		assert.equal((await store.pendingInternalSessions()).length, 0);
		assert.deepEqual(db.select().from(recoveryTargets).get(), custom);
	}
	if (scenario === 'persistence') {
		await store.saveTarget('plan-01', target);
		const raw = db.select().from(recoveryTargets).get()!;
		assert.ok(!JSON.stringify(raw).includes(target.password));
		assert.equal(new Cryptr(key).decrypt(raw.encryptedPassword), target.password);
		assert.ok(!JSON.stringify(await store.targets('plan-01')).includes(target.password));
		await store.saveTarget('plan-01', { ...target, password: '' });
		assert.equal(db.select().from(recoveryTargets).get()!.encryptedPassword, raw.encryptedPassword);
		assert.equal((await store.target('plan-01', 'mariadb'))!.password, target.password);
		await assert.rejects(store.saveTarget('plan-01', { ...target, password: 'bad\nvalue' }));
	}
	if (scenario === 'transaction') {
		await store.saveTarget('plan-01', target);
		const before = db.select().from(recoveryTargets).all();
		sqlite.exec(
			"CREATE TRIGGER fail_target BEFORE UPDATE ON recovery_targets BEGIN SELECT RAISE(ABORT,'fixture failure'); END;"
		);
		await assert.rejects(
			store.saveTarget('plan-01', {
				...target,
				password: 'synthetic-replacement',
				host: '127.0.0.1',
			})
		);
		assert.deepEqual(db.select().from(recoveryTargets).all(), before);
	}
	if (scenario === 'ownership') {
		await assert.rejects(store.enqueue({ ...row, planId: 'missing-plan' }));
		await assert.rejects(store.enqueue({ ...row, repositoryId: 'missing-repo' }));
		await assert.rejects(store.enqueue({ ...row, snapshotId: 'c'.repeat(64) }));
		assert.throws(() =>
			db
				.insert(recoveryTests)
				.values({ ...row, snapshotId: 'latest' })
				.run()
		);
		await store.enqueue(row);
		assert.throws(() =>
			sqlite.prepare('UPDATE recovery_tests SET snapshot_id=?').run('c'.repeat(64))
		);
		await assert.rejects(store.saveTarget('plan-01', target));
	}
	if (scenario === 'automation') {
		await store.savePolicy('plan-01', { enabled: true, databaseImport: 'disabled' });
		assert.deepEqual(await store.automaticCandidates(), ['backup-01']);
		const first = await store.enqueue(row);
		assert.equal((await store.enqueue({ ...row, id: 'c'.repeat(24) })).id, first.id);
		assert.deepEqual(await store.automaticCandidates(), []);
		assert.equal((await store.claim())?.id, id);
		assert.equal(await store.claim(), null);
		await store.update(id, {
			status: 'failed',
			failureStage: 'staged-restore',
			failureCode: 'restore-failed',
		});
		assert.deepEqual(await store.automaticCandidates(), []);
		assert.equal(db.select().from(backups).get()!.status, 'completed');
		db.insert(backups)
			.values({
				id: 'backup-02',
				planId: 'plan-01',
				sourceId: 'app-01',
				method: 'backup',
				storageId: 'storage-01',
				storagePath: 'managed/app',
				status: 'failed',
				ended: new Date(Date.now() + 2000),
				completionStats: { snapshot_id: 'c'.repeat(64) } as any,
			})
			.run();
		assert.deepEqual(await store.automaticCandidates(), []);
	}
	if (scenario === 'cascade') {
		await store.saveTarget('plan-01', target);
		await store.savePolicy('plan-01', { enabled: true, databaseImport: 'required' });
		await store.enqueue(row);
		assert.throws(() => sqlite.prepare('DELETE FROM plans WHERE id=?').run('plan-01'));
		assert.throws(() => sqlite.prepare('DELETE FROM backups WHERE id=?').run('backup-01'));
		assert.throws(() =>
			sqlite.prepare('DELETE FROM remote_managed_repositories WHERE id=?').run('repo-01')
		);
		await assert.rejects(store.assertPlanRemovable('plan-01'));
		await store.update(id, { status: 'passed' });
		await store.assertPlanRemovable('plan-01');
		// The existing remote plan lifecycle removes repository metadata and backup
		// history first, then the plan. Phase 6 guards/cascades follow that ordering.
		sqlite.prepare('DELETE FROM remote_managed_repositories WHERE id=?').run('repo-01');
		sqlite.prepare('DELETE FROM backups WHERE id=?').run('backup-01');
		sqlite.prepare('DELETE FROM plans WHERE id=?').run('plan-01');
		assert.equal(db.select().from(recoveryTests).all().length, 0);
		assert.equal(db.select().from(recoveryTargets).all().length, 0);
		assert.equal(db.select().from(recoveryTestPolicies).all().length, 0);
		assert.equal(db.select().from(backups).all().length, 0);
	}
	if (scenario === 'restart') {
		await store.enqueue(row);
		await store.claim();
		assert.equal((await store.interrupted()).length, 1);
		assert.equal((await store.get(id))?.failureCode, 'interrupted');
		assert.equal(await store.claim(), null);
	}
	if (scenario === 'cancellation') {
		await store.enqueue(row);
		assert.equal((await store.requestCancellation(id))?.status, 'cancelled');
		assert.equal(await store.claim(), null);
		const second = await store.enqueue({
			...row,
			id: 'c'.repeat(24),
			automationKey: null,
			trigger: 'manual',
		});
		await store.claim();
		// Cancellation reads the transactional current state, not a stale queued row.
		assert.equal((await store.requestCancellation(second.id))?.status, 'running');
		assert.equal((await store.get(second.id))?.cancelRequested, true);
		await store.update(second.id, { status: 'cancelled' });
		assert.equal((await store.requestCancellation(second.id))?.status, 'cancelled');
		assert.equal(db.select().from(backups).get()!.status, 'completed');
	}
	if (scenario === 'workload-admission') {
		await store.enqueue(row);
		await assert.rejects(
			store.enqueue({
				...row,
				id: 'f'.repeat(24),
				trigger: 'manual',
				automationKey: null,
				policy: { ...row.policy, enabled: false, snapshotMetadataToken: 'f'.repeat(64) },
			}),
			/already queued or running/
		);
		db.update(backups).set({ inProgress: true }).run();
		assert.equal(await store.claim(), null);
		db.update(backups).set({ inProgress: false }).run();
		db.insert(restores).values({ id: 'restore-01', sourceId: 'main', inProgress: true }).run();
		assert.equal(await store.claim(), null);
		db.update(restores).set({ inProgress: false }).run();
		assert.equal((await store.claim())?.id, id);
	}
	if (scenario === 'concurrency') {
		db.insert(plans)
			.values({
				id: 'plan-02',
				title: 'Second fixture plan',
				sourceId: 'app-01',
				sourceType: 'device',
				method: 'backup',
				storageId: 'storage-01',
				storagePath: 'managed/other',
				sourceConfig: { includes: ['/srv/example-app'], excludes: [] },
				settings: { encryption: true } as any,
			})
			.run();
		sqlite
			.prepare(
				'INSERT INTO remote_managed_repositories(id,plan_id,agent_id,storage_id,storage_path,encrypted_password,initialized_at) VALUES (?,?,?,?,?,?,?)'
			)
			.run('repo-02', 'plan-02', 'agent-01', 'storage-01', 'managed/other', cipher, 1);
		db.insert(backups)
			.values({
				id: 'backup-02',
				planId: 'plan-02',
				sourceId: 'app-01',
				sourceType: 'device',
				method: 'backup',
				storageId: 'storage-01',
				storagePath: 'managed/other',
				status: 'completed',
				inProgress: false,
				completionStats: { snapshot_id: 'd'.repeat(64) } as any,
			})
			.run();
		await store.enqueue(row);
		await store.enqueue({
			...row,
			id: 'c'.repeat(24),
			planId: 'plan-02',
			backupId: 'backup-02',
			repositoryId: 'repo-02',
			snapshotId: 'd'.repeat(64),
			automationKey: null,
		});
		db.insert(backups)
			.values({
				id: 'backup-03',
				planId: 'plan-01',
				sourceId: 'app-01',
				sourceType: 'device',
				method: 'backup',
				storageId: 'storage-01',
				storagePath: 'managed/app',
				status: 'completed',
				inProgress: false,
				completionStats: { snapshot_id: 'e'.repeat(64) } as any,
			})
			.run();
		await assert.rejects(
			store.enqueue({
				...row,
				id: 'e'.repeat(24),
				backupId: 'backup-03',
				automationKey: null,
				snapshotId: 'e'.repeat(64),
			}),
			/One recovery test/
		);
		const claims = await Promise.all([store.claim(), store.claim(), store.claim()]);
		assert.equal(claims.filter(Boolean).length, 1);
		const first = claims.find(Boolean)!;
		await store.update(first.id, { status: 'passed' });
		assert.notEqual((await store.claim())?.id, first.id);
	}
	if (scenario === 'cleanup-ownership') {
		await store.saveTarget('plan-01', target);
		await store.enqueue(row);
		await store.claim();
		const saved = db.select().from(recoveryTargets).get()!;
		const lease = {
			id: 'lease-01',
			testId: id,
			targetId: saved.id,
			database: 'example_db',
			ownerToken: 'synthetic-owner-token',
		};
		await store.addLease(lease);
		await store.update(id, {
			status: 'passed_with_warning',
			warnings: [{ stage: 'workspace-cleanup', code: 'workspace-cleanup-failed' }],
		});
		await assert.rejects(store.saveTarget('plan-01', { ...target, host: '127.0.0.1' }));
		await assert.rejects(store.assertPlanRemovable('plan-01'));
		assert.throws(() => sqlite.prepare('DELETE FROM plans WHERE id=?').run('plan-01'));
		assert.throws(() => sqlite.prepare('DELETE FROM backups WHERE id=?').run('backup-01'));
		assert.throws(() =>
			sqlite.prepare('DELETE FROM remote_managed_repositories WHERE id=?').run('repo-01')
		);
		assert.equal((await store.leaseTarget(saved.id))?.password, target.password);
		assert.equal((await store.cleanupCandidates())[0].id, id);
		await store.removeLease(lease.id);
		await store.assertPlanRemovable('plan-01');
	}
	if (scenario === 'history') {
		db.insert(backups)
			.values({
				id: 'backup-02',
				planId: 'plan-01',
				sourceId: 'app-01',
				sourceType: 'device',
				method: 'backup',
				storageId: 'storage-01',
				storagePath: 'managed/app',
				status: 'completed',
				inProgress: false,
				completionStats: { snapshot_id: 'c'.repeat(64) } as any,
			})
			.run();
		db.insert(recoveryTests)
			.values({
				...row,
				id: 'd'.repeat(24),
				backupId: 'backup-02',
				snapshotId: 'c'.repeat(64),
				status: 'passed',
				trigger: 'manual',
				automationKey: null,
				createdAt: new Date('2025-01-01'),
			})
			.run();
		for (let index = 0; index < 205; index++)
			db.insert(recoveryTests)
				.values({
					...row,
					id: index.toString(16).padStart(24, '0'),
					status: 'passed',
					trigger: 'manual',
					automationKey: null,
					createdAt: new Date(Date.UTC(2026, 0, 1) + index * 1000),
				})
				.run();
		assert.equal((await store.list('plan-01')).length, 200);
		const visible = await store.list('plan-01', ['backup-01', 'backup-02', 'backup-foreign']);
		assert.equal(visible.length, 201);
		assert.equal(visible.find(test => test.backupId === 'backup-02')?.id, 'd'.repeat(24));
		assert.equal(visible[0].backupId, 'backup-01');
		assert.equal((await store.list('plan-other', ['backup-01', 'backup-02'])).length, 0);
	}
	console.log(`PASS ${scenario}`);
} finally {
	sqlite.close();
}
