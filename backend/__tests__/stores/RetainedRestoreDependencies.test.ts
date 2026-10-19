import { drizzle } from 'drizzle-orm/better-sqlite3';
import { fixture, row, approval } from '../integration/persistentRestore.fixture';
import { PlanStore } from '../../src/stores/PlanStore';
import { RetainedRestoreDependencyError } from '../../src/utils/retainedRestoreDependency';
import type { DatabaseRestoreStatus } from '../../src/types/databaseRestores';
import { PlanService } from '../../src/services/PlanService';

describe('retained database ownership blocks destructive source removal', () => {
	let context: ReturnType<typeof fixture>;
	let plans: PlanStore;
	beforeEach(() => {
		context = fixture();
		plans = new PlanStore(drizzle(context.sqlite) as any);
	});
	afterEach(() => context.sqlite.close());
	const retained = (engine = 'mariadb') => {
		const item = row(approval());
		item.artifact.engine = engine as typeof item.artifact.engine;
		return context.store.create(item);
	};
	for (const engine of ['mysql', 'mariadb', 'postgresql']) {
		it.each<DatabaseRestoreStatus>([
			'provisioning_required',
			'queued',
			'importing',
			'active',
			'stopped',
			'expired',
			'deleting',
			'cleanup_required',
			'failed',
			'cancelled',
		])(`${engine}: %s blocks plan and backup deletion without altering ownership`, async status => {
			const item = retained(engine);
			context.store.update(item.id, { status, expiresAt: Date.now() - 1 });
			const before = context.store.get(item.id);
			expect(() => plans.assertNoRetainedDatabaseRestores({ planId: item.planId })).toThrow(
				RetainedRestoreDependencyError
			);
			expect(() => plans.assertNoRetainedDatabaseRestores({ backupId: item.backupId })).toThrow(
				RetainedRestoreDependencyError
			);
			await expect(plans.delete(item.planId, true)).rejects.toMatchObject({
				statusCode: 409,
				code: 'RETAINED_DATABASE_RESTORE_DEPENDENCY',
			});
			await expect(plans.deleteBackupIfUnreferenced(item.backupId)).rejects.toHaveProperty(
				'statusCode',
				409
			);
			expect(context.store.get(item.id)).toEqual(before);
			expect(context.sqlite.prepare('SELECT count(*) FROM backups').pluck().get()).toBe(1);
		});
	}
	it.each(['lease', 'lifecycle', 'uncertain'])(
		'deleted history still blocks with residual %s evidence',
		async kind => {
			const item = retained();
			context.store.update(item.id, {
				status: 'deleted',
				cleanup: kind === 'uncertain' ? 'uncertain' : 'verified',
			});
			if (kind === 'lease')
				context.sqlite
					.prepare(
						`INSERT INTO persistent_restore_import_leases(restore_id,target_id,database_name,owner_token,state) VALUES(?,?,'example_db',?,'validated')`
					)
					.run(item.id, item.targetId, item.ownerToken);
			if (kind === 'lifecycle')
				context.sqlite
					.prepare(
						`INSERT INTO automatic_recovery_lifecycle(id,mode,binding,owner_token,state,created_at,updated_at) VALUES(?,'persistent','{}',?,'stopped',1,1)`
					)
					.run(item.id, item.ownerToken);
			await expect(plans.delete(item.planId, true)).rejects.toHaveProperty('statusCode', 409);
		}
	);
	it('permits verified Deleted history without a lease or live lifecycle and preserves the receipt', async () => {
		const item = retained();
		context.store.update(item.id, { status: 'deleted', cleanup: 'verified' });
		await expect(plans.deleteBackupIfUnreferenced(item.backupId)).resolves.toBe(true);
		// The normal remote-plan removal service removes its managed repository registration first.
		context.sqlite
			.prepare('DELETE FROM remote_managed_repositories WHERE plan_id=?')
			.run(item.planId);
		await expect(plans.delete(item.planId, true)).resolves.toBe(true);
		expect(context.store.get(item.id)).toMatchObject({
			status: 'deleted',
			cleanup: 'verified',
			ownerToken: item.ownerToken,
		});
	});
	it('matches a different backup record for the same full snapshot and repository', () => {
		const item = retained();
		context.sqlite
			.prepare(
				`INSERT INTO backups(id,plan_id,source_id,method,storage_id,storage_path,completion_stats) VALUES('backup-copy',?,'app-01','backup','storage-01','managed/fixture',?)`
			)
			.run(item.planId, JSON.stringify({ snapshot_id: item.snapshotId }));
		expect(() => plans.assertNoRetainedDatabaseRestores({ backupId: 'backup-copy' })).toThrow(
			RetainedRestoreDependencyError
		);
		context.sqlite
			.prepare('UPDATE backups SET completion_stats=? WHERE id=?')
			.run(JSON.stringify({ snapshot_id: 'a'.repeat(64) }), 'backup-copy');
		expect(() => plans.assertNoRetainedDatabaseRestores({ backupId: 'backup-copy' })).not.toThrow();
	});
	it('excludes new reservations while an asynchronous plan removal is in flight, then rejects stale preview after deletion', async () => {
		const item = row();
		jest
			.spyOn(plans, 'getById')
			.mockResolvedValue({
				sourceType: 'device',
				sourceId: 'app-01',
				method: 'backup',
				storage: { name: 'Synthetic SFTP' },
				settings: {},
				storageId: 'storage-01',
				storagePath: 'managed/fixture',
			} as any);
		let finish!: (value: unknown) => void;
		const remote = {
			removeManagedPlan: jest.fn(async () => {
				await new Promise(resolve => {
					finish = resolve;
				});
				context.sqlite
					.prepare('DELETE FROM remote_managed_repositories WHERE plan_id=?')
					.run(item.planId);
				return { storagePath: 'managed/fixture' };
			}),
		};
		const service = new PlanService(
			{} as any,
			plans,
			{} as any,
			{} as any,
			{} as any,
			{} as any,
			remote as any
		);
		const removal = service.deletePlan(item.planId, false);
		while (!finish) await new Promise(resolve => setImmediate(resolve));
		expect(() => context.store.create(item)).toThrow(RetainedRestoreDependencyError);
		finish({ success: true, result: 'Removed' });
		await removal;
		expect(() => context.store.create(item)).toThrow(RetainedRestoreDependencyError);
		expect(context.store.get(item.id)).toBeNull();
	});
	it('rechecks dependency inside the final SQLite transaction', async () => {
		plans.assertNoRetainedDatabaseRestores({ planId: 'plan-01' });
		retained();
		await expect(plans.delete('plan-01', true)).rejects.toHaveProperty('statusCode', 409);
	});
});
