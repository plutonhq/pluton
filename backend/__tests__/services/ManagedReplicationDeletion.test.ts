import Cryptr from 'cryptr';
import { PlanService } from '../../src/services/PlanService';
import { configService } from '../../src/services/ConfigService';
import { validateReplicationSettings } from '../../src/utils/managedReplicationPolicy';

function context() {
	const replica = {
		replicationId: 'replica-01',
		storageId: 's3-01',
		storagePath: 'synthetic-bucket/pluton/fixture',
		storageName: 'Mirror',
	};
	const plan: any = {
		id: 'plan-01',
		sourceId: 'app-01',
		sourceType: 'device',
		method: 'backup',
		storageId: 'primary',
		storagePath: 'managed/fixture',
		settings: { replication: { enabled: true, concurrent: false, storages: [replica] } },
	};
	const plans: any = {
		getById: jest.fn(async () => plan),
		update: jest.fn(async (_id, update) => ({ ...plan, ...update })),
		delete: jest.fn(async () => true),
		beginSourceRemoval: jest.fn(() => () => {}),
		assertNoRetainedDatabaseRestores: jest.fn(),
		hasActiveBackups: jest.fn(async () => false),
		hasActiveRestore: jest.fn(async () => false),
		getStorageRemovalReferences: jest.fn(async () => []),
	};
	const remote: any = {
		updateManagedPlan: jest.fn(async () => {}),
		removeManagedPlan: jest.fn(async () => ({ storagePath: plan.storagePath })),
	};
	const managed: any = {
		assertPlanIdle: jest.fn(),
		detach: jest.fn(),
		listDestinations: jest.fn(() => []),
	};
	const storages: any = {
		getByIds: jest.fn(async () => [{ id: 's3-01', name: 'Mirror' }]),
		getById: jest.fn(),
	};
	const local: any = { removeBackup: jest.fn() };
	const service = new PlanService(
		local,
		plans,
		{} as any,
		storages,
		{} as any,
		{} as any,
		remote,
		undefined,
		managed
	);
	return { service, plans, managed, remote, storages, local, plan, replica };
}
describe('managed replica removal stays isolated from legacy purge', () => {
	it('preserves standard root-path configuration; managed dedicated-prefix checks remain separate', () => {
		expect(() => validateReplicationSettings({ enabled: true, concurrent: true, storages: [{
			replicationId: 'standard-01', storageId: 'local-01', storagePath: '',
		}] })).not.toThrow();
	});
	it('reports retained primary, disabled and previously detached replica paths on plan removal', async () => {
		const f = context(); f.plan.settings.replication.enabled = false;
		f.managed.listDestinations.mockReturnValue([
			{ planId: 'plan-01', destinationStorageId: 's3-02', destinationStoragePath: 'synthetic-bucket/pluton/retained' },
			{ planId: 'other-plan', destinationStorageId: 's3-03', destinationStoragePath: 'synthetic-bucket/unrelated' },
		]);
		const result = await f.service.deletePlan('plan-01', true);
		expect(result.storageDisposition.status).toBe('retained_intentionally');
		expect(result.unremovedPaths).toHaveLength(3);
		expect(result.unremovedPaths.map(item => item.storagePath)).toEqual([
			'managed/fixture', f.replica.storagePath, 'synthetic-bucket/pluton/retained',
		]);
		expect(result.storageDisposition.paths).toEqual(result.unremovedPaths);
		expect(f.local.removeBackup).not.toHaveBeenCalled();
	});
	it('detaches and retains an idle managed replica without calling remote strategy purge', async () => {
		const f = context();
		await expect(
			f.service.deleteReplicationStorage(
				f.plan.id,
				f.replica.storageId,
				f.replica.storagePath,
				false,
				f.replica.replicationId
			)
		).resolves.toMatchObject({ success: true });
		expect(f.managed.detach).toHaveBeenCalledWith('plan-01', 'replica-01');
		expect(f.remote.updateManagedPlan).toHaveBeenCalled();
		expect(f.local.removeBackup).not.toHaveBeenCalled();
	});
	it('refuses physical replica deletion before changing settings or issuing a command', async () => {
		const f = context();
		await expect(
			f.service.deleteReplicationStorage(
				f.plan.id,
				f.replica.storageId,
				f.replica.storagePath,
				true,
				f.replica.replicationId
			)
		).rejects.toMatchObject({ statusCode: 409 });
		expect(f.plans.update).not.toHaveBeenCalled();
		expect(f.managed.detach).not.toHaveBeenCalled();
	});
	it('refuses concurrent or uncertain work before detachment or plan metadata removal', async () => {
		const f = context();
		f.managed.assertPlanIdle.mockImplementation(() => {
			throw Object.assign(new Error('Busy'), { statusCode: 409 });
		});
		await expect(f.service.deletePlan('plan-01', false)).rejects.toMatchObject({ statusCode: 409 });
		expect(f.remote.removeManagedPlan).not.toHaveBeenCalled();
		expect(f.plans.delete).not.toHaveBeenCalled();
	});
	it('detects S3 aliases that overlap a retained destination', async () => {
		const f = context();
		const cipher = new Cryptr(configService.config.SECRET);
		const s3 = (id: string, endpoint: string) => ({
			id,
			type: 's3compatible',
			credentials: Object.fromEntries(
				Object.entries({
					endpoint,
					bucket: 'synthetic-bucket',
					access_key_id: 'synthetic-key',
					secret_access_key: 'synthetic-secret',
				}).map(([k, v]) => [k, cipher.encrypt(v)])
			),
			settings: {},
		});
		f.storages.getById.mockImplementation(async (id: string) =>
			s3(
				id,
				id === 's3-01'
					? 'https://s3.example.internal'
					: 'https://synthetic-bucket.s3.example.internal'
			)
		);
		f.managed.listDestinations.mockReturnValue([
			{
				destinationStorageId: 'alias-01',
				destinationStoragePath: 'synthetic-bucket/pluton/fixture/nested',
			},
		]);
		await expect(
			(f.service as any).assertRemovableStorage('s3-01', f.replica.storagePath, 'plan-01')
		).rejects.toMatchObject({ statusCode: 409 });
	});
	it('applies the server replica limit before standard plan creation side effects', async () => {
		const f = context();
		await expect(
			f.service.createPlan({
				settings: {
					replication: {
						enabled: true,
						concurrent: false,
						storages: [f.replica, f.replica, f.replica],
					},
				},
			} as any)
		).rejects.toMatchObject({ statusCode: 400 });
		expect(f.storages.getById).not.toHaveBeenCalled();
	});
});
