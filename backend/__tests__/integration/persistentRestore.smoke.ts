import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { DatabaseRestoreStore, approvalFingerprint } from '../../src/stores/DatabaseRestoreStore';
import { createRequire } from 'node:module';
import { RecoveryTestStore } from '../../src/stores/RecoveryTestStore';
import type { DatabaseType } from '../../src/db';
import { persistentApprovalSchema, restoreRequest } from '../../src/utils/persistentRestorePolicy';
import { DatabaseRestoreService } from '../../src/services/DatabaseRestoreService';
import { recoveryMetadataToken } from '../../src/utils/recoveryPreparation';
import { fixture, approval, row, sql } from './persistentRestore.fixture';
const scenario = process.argv[2],
	scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'pluton-retained-'));
const { sqlite, store, key } = fixture();
let target = approval(),
	item = row(target),
	absent = false,
	removed = false,
	broken = false,
	requests: any[] = [],
	restoreCalls = 0,
	cleanupCalls = 0;
const metadata = () => ({
	planId: item.planId,
	backupId: item.backupId,
	repositoryId: item.repositoryId,
	snapshotId: item.snapshotId,
	databases: [item.artifact],
});
item.metadataToken = recoveryMetadataToken(metadata());
const inspection = {
	engine: 'mariadb',
	version: '11.8.8',
	database: 'example_db',
	tables: 1,
	views: 0,
	bytes: 1024,
	catalog: [],
	catalogTruncated: false,
	observedAt: Date.now(),
};
const sample = {
	cpuAvailable: 1,
	total: 4096 * 1024 ** 2,
	available: 3000 * 1024 ** 2,
	swapUsed: 0,
	pressure: 0,
	limit: 1536 * 1024 ** 2,
	used: 100 * 1024 ** 2,
	cgroupSwap: 0,
	diskAvailable: 10 * 1024 ** 3,
};
const targets: any = {
	policy: async () => ({ maxSqlBytes: 128 * 1024 ** 2, maxRetentionSeconds: 86400 }),
	list: async () => [],
	assertBinding: async () => {
		if (broken) throw Object.assign(new Error(), { code: 'operator-target-unavailable' });
		return target;
	},
	resourceView: async () => ({ status: 'measured', sample, observedAt: Date.now() }),
	admission: async () => {},
	ca: async () => '/synthetic-ca',
	request: async (...args: any[]) => {
		requests.push(args);
	},
	state: async () => ({ state: removed ? 'removed' : 'active', observedAt: Date.now() }),
	verifiedAbsent: async () => absent,
};
const importer: any = {
	restore: async (current: any) => {
		restoreCalls++;
		store.addLease({
			restoreId: current.id,
			targetId: current.targetId,
			database: 'example_db',
			ownerToken: current.ownerToken,
			state: 'validated',
		});
		return inspection;
	},
	inspect: async () => inspection,
	removeOwned: async (current: any) => {
		cleanupCalls++;
		store.removeLease(current.id);
		return true;
	},
};
const recovery: any = {
	testMetadata: async () => metadata(),
	databaseRestoreArtifact: async (_binding: any, directory: string) => {
		await fs.mkdir(path.join(directory, 'pluton/database'), { recursive: true, mode: 0o700 });
		await fs.writeFile(path.join(directory, 'pluton/database/db_example.sql'), sql, {
			mode: 0o600,
		});
	},
};
const plans: any = {
	getById: async () => ({ sourceType: 'device', sourceId: 'app-01', method: 'backup' }),
};
const service = new DatabaseRestoreService(
	store,
	plans,
	recovery,
	targets,
	path.join(scratch, 'workspaces'),
	() => importer
);
const save = () => {
	store.create(item);
	store.bind(item.id, target);
};
try {
	if (scenario === 'operator-fingerprint') {
		const operator = createRequire(import.meta.url)(
			'../../../deploy/persistent-restore/operator.cjs'
		);
		const reversed = {
			...Object.fromEntries(Object.entries(target).reverse()),
			target: Object.fromEntries(Object.entries(target.target).reverse()),
			storage: Object.fromEntries(Object.entries(target.storage).reverse()),
		};
		assert.equal(
			operator.approvalFingerprint(target),
			approvalFingerprint(persistentApprovalSchema.parse(reversed))
		);
		assert.equal(operator.approvalFingerprint(reversed), approvalFingerprint(target));
	} else if (scenario === 'migration') {
		assert(
			sqlite
				.prepare("SELECT name FROM sqlite_master WHERE name='persistent_database_restores'")
				.get()
		);
		save();
		assert.throws(() =>
			sqlite.prepare('DELETE FROM persistent_database_restores WHERE id=?').run(item.id)
		);
		assert.throws(() =>
			sqlite
				.prepare('UPDATE persistent_database_restores SET snapshot_id=? WHERE id=?')
				.run('e'.repeat(64), item.id)
		);
		assert(
			!JSON.stringify(sqlite.prepare('SELECT * FROM persistent_database_restores').get()).includes(
				target.target.password!
			)
		);
		sqlite.exec('DELETE FROM backups;DELETE FROM remote_managed_repositories;DELETE FROM plans;');
		assert(store.get(item.id));
		const again = new DatabaseRestoreStore(sqlite, key);
		assert.equal(again.approval(item.id).target.password, target.target.password);
	} else if (scenario === 'concurrency') {
		save();
		const second = store.create({ ...row({ ...target, id: 'd'.repeat(24) }, 'b'.repeat(24)) });
		assert(store.claim(item.id));
		assert.equal(store.claim(second.id), null);
		sqlite.exec(
			"INSERT INTO recovery_tests(id,plan_id,backup_id,repository_id,snapshot_id,status,trigger,policy,created_at) VALUES('eeeeeeeeeeeeeeeeeeeeeeee','plan-01','backup-01','repo-01','" +
				item.snapshotId +
				"','queued','manual','{}',1)"
		);
		const phase6 = new RecoveryTestStore(drizzle(sqlite) as unknown as DatabaseType, key);
		assert.equal(await phase6.claim(), null);
		assert.throws(() =>
			sqlite
				.prepare("UPDATE persistent_database_restores SET status='importing' WHERE id=?")
				.run(second.id)
		);
	} else if (scenario === 'delete-idempotent') {
		save();
		store.update(item.id, { status: 'active' });
		store.requestDelete(item.id);
		assert(store.claim(item.id, true));
		store.requestDelete(item.id);
		assert.equal(store.get(item.id)?.status, 'deleting');
		store.update(item.id, { status: 'cleanup_required', cleanup: 'infrastructure_pending' });
		store.requestDelete(item.id);
		assert.equal(store.get(item.id)?.cleanup, 'infrastructure_pending');
	} else if (scenario === 'stopped-expiry') {
		target = { ...target, mode: 'internal', id: item.id };
		item = { ...item, mode: 'internal', targetId: item.id };
		save();
		store.update(item.id, { status: 'stopped', expiresAt: Date.now() - 1 });
		importer.removeOwned = async () => {
			throw new Error('Private unavailable connection');
		};
		await service.tick();
		await service.idle();
		assert.equal(store.get(item.id)?.status, 'cleanup_required');
		assert.equal(store.get(item.id)?.cleanup, 'uncertain');
		assert.equal(requests.at(-1)[1], 'delete');
		assert.equal(requests.at(-1)[2], false);
	} else if (scenario === 'limit') {
		for (let i = 0; i < 8; i++)
			store.create(
				row(
					{ ...target, id: i.toString(16).padStart(24, '0') },
					(i + 16).toString(16).padStart(24, '0')
				)
			);
		assert.throws(() => store.create(item), /retained-restore-limit/);
	} else if (scenario === 'source') {
		sqlite.prepare('UPDATE plans SET settings=? WHERE id=?').run(
			JSON.stringify({
				remoteLifecycle: {
					databases: [{ host: 'RECOVERY.EXAMPLE.INTERNAL.', engine: 'mariadb' }],
				},
			}),
			'plan-01'
		);
		assert.throws(() => store.assertNotSource(target), /source-database-target-refused/);
	} else if (scenario === 'policy') {
		assert(persistentApprovalSchema.safeParse(target).success);
		for (const patch of [
			{ purpose: 'pluton-phase6-recovery-only' },
			{ target: { ...target.target, username: 'root' } },
			{ target: { ...target.target, tls: 'local' } },
			{ engine: 'mysql' },
		])
			assert(!persistentApprovalSchema.safeParse({ ...target, ...patch }).success);
		assert(
			!restoreRequest.safeParse({ engine: 'mariadb', host: 'arbitrary.example.internal' }).success
		);
	} else if (scenario === 'restart') {
		save();
		store.claim(item.id);
		store.addLease({
			restoreId: item.id,
			targetId: item.targetId,
			database: 'example_db',
			ownerToken: item.ownerToken,
			state: 'created',
		});
		const again = new DatabaseRestoreStore(sqlite, key);
		again.recoverInterrupted();
		assert.equal(again.get(item.id)?.status, 'cleanup_required');
		assert.equal(again.lease(item.id)?.ownerToken, item.ownerToken);
		assert.equal(again.approval(item.id).activationId, target.activationId);
		assert.throws(() => again.finishDeleted(item.id), /ownership-lease-unsafe/);
	} else if (scenario === 'import-retains') {
		save();
		await service.tick();
		await service.idle();
		assert.equal(store.get(item.id)?.status, 'active');
		assert.equal(restoreCalls, 1);
		assert.equal(cleanupCalls, 0);
		assert(store.lease(item.id));
		const view = JSON.stringify(service.get(item.id, 'administrator'));
		assert(!view.includes(target.target.password!));
		assert(!view.includes(item.ownerToken));
		assert(!view.includes('encryptedApproval'));
		assert.throws(() => service.get(item.id, 'foreign-user'));
		assert.equal((await service.inspect(item.id, 'administrator')).inspection?.tables, 1);
		await service.delete(item.id, 'administrator', { confirmation: item.id });
		await service.idle();
		assert.equal(store.get(item.id)?.status, 'deleted');
		assert.equal(cleanupCalls, 1);
	} else if (scenario === 'binding') {
		save();
		item.artifact = { ...item.artifact, bytes: item.artifact.bytes + 1 };
		await service.tick();
		await service.idle();
		assert.equal(restoreCalls, 0);
		assert.equal(store.get(item.id)?.errorCode, 'snapshot-metadata-changed');
	} else if (scenario === 'digest') {
		save();
		recovery.databaseRestoreArtifact = async (_binding: any, directory: string) => {
			await fs.mkdir(path.join(directory, 'pluton/database'), { recursive: true });
			await fs.writeFile(
				path.join(directory, 'pluton/database/db_example.sql'),
				sql.replace('TABLE', 'TABLX')
			);
		};
		await service.tick();
		await service.idle();
		assert.equal(restoreCalls, 0);
		assert.equal(store.get(item.id)?.errorCode, 'database-artifact-hash-mismatch');
	} else if (scenario === 'expiry') {
		save();
		store.update(item.id, { status: 'active', inspection, expiresAt: Date.now() - 1 });
		assert.equal(service.get(item.id, 'administrator').inspection, null);
		await assert.rejects(service.inspect(item.id, 'administrator'), /restore-access-not-active/);
		await service.tick();
		await service.idle();
		assert.equal(store.get(item.id)?.status, 'deleted');
	} else if (scenario === 'operator-cleanup') {
		target = {
			...target,
			mode: 'internal',
			id: item.id,
			containerId: 'f'.repeat(64),
			binding: { restoreId: item.id, snapshotId: item.snapshotId, sha256: item.artifact.sha256 },
		};
		item = { ...item, mode: 'internal', targetId: item.id };
		save();
		store.update(item.id, { status: 'active' });
		store.requestDelete(item.id);
		await service.tick();
		await service.idle();
		assert.equal(store.get(item.id)?.status, 'cleanup_required');
		assert.equal(store.get(item.id)?.cleanup, 'infrastructure_pending');
		assert.equal(requests.at(-1)[2], true);
		assert.notEqual(store.get(item.id)?.status, 'deleted');
		removed = true;
		await service.tick();
		assert.equal(store.get(item.id)?.status, 'deleted');
	} else if (scenario === 'unprovisioned') {
		item = { ...item, mode: 'internal', targetId: item.id, status: 'provisioning_required' };
		store.create(item);
		store.requestDelete(item.id);
		targets.assertBinding = async () => {
			const { DatabaseRestoreError } = await import('../../src/utils/persistentRestorePolicy');
			throw new DatabaseRestoreError('operator-target-unavailable');
		};
		await service.tick();
		await service.idle();
		assert.equal(store.get(item.id)?.cleanup, 'uncertain');
		assert.equal(requests.at(-1)[2], false);
		absent = true;
		await service.tick();
		assert.equal(store.get(item.id)?.status, 'deleted');
	} else if (scenario === 'resources') {
		sample.available = 1;
		await assert.rejects(
			service.create(
				{
					planId: item.planId,
					backupId: item.backupId,
					snapshotId: item.snapshotId,
					databaseId: item.databaseId,
					metadataToken: item.metadataToken,
					mode: 'internal',
					ttlSeconds: 86400,
					resourcesAcknowledged: true,
					securityAcknowledged: true,
				},
				'administrator'
			),
			/resource-host-memory-headroom/
		);
		sample.available=3000*1024**2;sample.diskAvailable=1;
		await assert.rejects(service.create({planId:item.planId,backupId:item.backupId,snapshotId:item.snapshotId,databaseId:item.databaseId,
			metadataToken:item.metadataToken,mode:'internal',ttlSeconds:86400,resourcesAcknowledged:true,securityAcknowledged:true},'administrator'),
			/resource-staging-capacity/);
		assert.equal(store.list().length, 0);
	} else throw new Error('Unknown test scenario');
	console.log('PASS ' + scenario);
} finally {
	await service.shutdown();
	sqlite.close();
	await fs.rm(scratch, { recursive: true, force: true });
}
