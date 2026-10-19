import { StorageStore } from '../../src/stores/StorageStore';
import { DatabaseType } from '../../src/db';
import { NewStorage, StorageFull } from '../../src/db/schema/storages';
import { providers } from '../../src/utils/providers';

// Mock the providers to have a predictable structure for testing
jest.mock('../../src/utils/providers', () => ({
	providers: {
		s3: { name: 'AWS S3', settings: [{ label: 'Region', value: 'region' }] },
		local: { name: 'Local Storage', settings: [] },
	},
}));

describe('StorageStore', () => {
	let storageStore: StorageStore;
	let mockDb: any;

	// Mock data to be used across tests
	const mockStorages = [
		{
			id: 'storage-1',
			name: 'My S3 Bucket',
			type: 's3',
			credentials: { accessKey: 'encrypted-key' },
			plans: [
				{ id: 'plan-1', stats: { size: 1024 } },
				{ id: 'plan-2', stats: { size: 2048 } },
			],
		},
		{
			id: 'storage-2',
			name: 'Local Disk',
			type: 'local',
			credentials: {},
			plans: [{ id: 'plan-3', stats: { size: 512 } }],
		},
	];

	beforeEach(() => {
		// Create a deeply mocked database object
		mockDb = {
			$client: { prepare: jest.fn(() => ({ get: () => undefined })) },
			query: {
				storages: {
					findMany: jest.fn(),
					findFirst: jest.fn(),
				},
				plans: {
					findMany: jest.fn().mockResolvedValue([]),
				},
			},
			insert: jest.fn().mockReturnThis(),
			values: jest.fn().mockReturnThis(),
			returning: jest.fn(),
			update: jest.fn().mockReturnThis(),
			set: jest.fn().mockReturnThis(),
			where: jest.fn().mockReturnThis(),
			delete: jest.fn().mockReturnThis(),
		} as any;
		mockDb.transaction = jest.fn((callback: (db: any) => any) => callback(mockDb));

		storageStore = new StorageStore(mockDb);
	});

	afterEach(() => {
		jest.clearAllMocks();
	});

	describe('getAll', () => {
		it('should return all storages without plans by default', async () => {
			// Arrange
			mockDb.query.storages.findMany.mockResolvedValue(mockStorages as any);

			// Act
			await storageStore.getAll();

			// Assert
			expect(mockDb.query.storages.findMany).toHaveBeenCalledWith(
				expect.objectContaining({
					with: {
						plans: { limit: 0, columns: expect.any(Object) },
					},
				})
			);
		});

		it('should return full storage details with calculated usedSize when full=true', async () => {
			// Arrange
			mockDb.query.storages.findMany.mockResolvedValue(mockStorages as any);

			// Act
			const result = (await storageStore.getAll(true, false)) as StorageFull[];

			// Assert
			expect(mockDb.query.storages.findMany).toHaveBeenCalledWith(
				expect.objectContaining({
					with: {
						plans: { limit: undefined, columns: expect.any(Object) },
					},
				})
			);
			expect(result).toHaveLength(2);
			expect(result[0].id).toBe('storage-1');
			expect(result[0].storageTypeName).toBe('AWS S3');
			expect(result[0].usedSize).toBe(3072); // 1024 + 2048
			expect(result[1].id).toBe('storage-2');
			expect(result[1].storageTypeName).toBe('Local Storage');
			expect(result[1].usedSize).toBe(512);
		});

		it('should hide credentials when hideCreds=true', async () => {
			// Arrange
			mockDb.query.storages.findMany.mockResolvedValue(mockStorages as any);

			// Act
			const result = await storageStore.getAll(false, true);

			// Assert
			expect(result).not.toBeNull();
			expect(result![0].credentials).toBeNull();
		});

		it('should return null if no storages are found', async () => {
			// Arrange
			mockDb.query.storages.findMany.mockResolvedValue([]);

			// Act
			const result = await storageStore.getAll();

			// Assert
			expect(result).toEqual([]);
		});
	});

	describe('getById', () => {
		it('should return a single storage by its ID', async () => {
			// Arrange
			mockDb.query.storages.findFirst.mockResolvedValue(mockStorages[0] as any);

			// Act
			const result = await storageStore.getById('storage-1');

			// Assert
			expect(mockDb.query.storages.findFirst).toHaveBeenCalledWith(expect.any(Object));
			expect(result).not.toBeNull();
			expect(result!.id).toBe('storage-1');
		});

		it('should return full storage details by ID when full=true', async () => {
			// Arrange
			mockDb.query.storages.findFirst.mockResolvedValue(mockStorages[0] as any);

			// Act
			const result = (await storageStore.getById('storage-1', true)) as StorageFull;

			// Assert
			expect(result.usedSize).toBe(3072);
			expect(result.storageTypeName).toBe('AWS S3');
			expect(result.storageFields).toEqual([{ label: 'Region', value: 'region' }]);
		});

		it('should return null for a non-existent ID', async () => {
			// Arrange
			mockDb.query.storages.findFirst.mockResolvedValue(null);

			// Act
			const result = await storageStore.getById('non-existent-id');

			// Assert
			expect(result).toBeNull();
		});
	});

	describe('getByIds', () => {
		it('should return multiple storages for an array of IDs', async () => {
			// Arrange
			mockDb.query.storages.findMany.mockResolvedValue(mockStorages as any);
			const ids = ['storage-1', 'storage-2'];

			// Act
			const result = await storageStore.getByIds(ids);

			// Assert
			expect(mockDb.query.storages.findMany).toHaveBeenCalledWith(expect.any(Object));
			expect(result).toHaveLength(2);
		});
	});

	describe('create', () => {
		it('should insert a new storage and return it', async () => {
			// Arrange
			const newStorageData: NewStorage = {
				id: 'storage-3',
				name: 'New FTP',
				type: 'ftp',
			};
			(mockDb.returning as jest.Mock).mockResolvedValue([newStorageData]);

			// Act
			const result = await storageStore.create(newStorageData);

			// Assert
			expect(mockDb.insert).toHaveBeenCalledWith(expect.any(Object));
			expect(mockDb.values).toHaveBeenCalledWith(newStorageData);
			expect(result).toEqual(newStorageData);
		});
	});

	describe('update', () => {
		it('should update an existing storage and return the updated data', async () => {
			// Arrange
			const storageId = 'storage-1';
			const updates = { name: 'Updated S3 Bucket' };
			const updatedStorage = { ...mockStorages[0], ...updates };
			(mockDb.returning as jest.Mock).mockReturnValue({ all: () => [updatedStorage] });

			// Act
			const result = await storageStore.update(storageId, updates);

			// Assert
			expect(mockDb.update).toHaveBeenCalledWith(expect.any(Object));
			expect(mockDb.set).toHaveBeenCalledWith(
				expect.objectContaining({
					name: 'Updated S3 Bucket',
					updatedAt: expect.any(Object), // Expecting sql`...` object
				})
			);
			expect(mockDb.where).toHaveBeenCalled();
			expect(result).toEqual(updatedStorage);
		});
	});

	describe('delete', () => {
		it('should delete a storage and return true on success', async () => {
			// Arrange
			(mockDb.delete as jest.Mock).mockReturnValue({
				where: jest.fn().mockResolvedValue({ changes: 1 }),
			});

			// Act
			const result = await storageStore.delete('storage-1');

			// Assert
			expect(mockDb.delete).toHaveBeenCalledWith(expect.any(Object));
			expect(result).toBe(true);
		});

		it('should return false if no rows were deleted', async () => {
			// Arrange
			(mockDb.delete as jest.Mock).mockReturnValue({
				where: jest.fn().mockResolvedValue({ changes: 0 }),
			});

			// Act
			const result = await storageStore.delete('non-existent-id');

			// Assert
			expect(result).toBe(false);
		});
	});

	describe('getReplicationPlanSources', () => {
		const replicationPlan = (
			id: string,
			sourceId: string,
			targetId: string,
			storageId = 'primary'
		) => ({
			id,
			title: `Plan ${id}`,
			createdAt: new Date(),
			isActive: true,
			stats: null,
			method: 'restic',
			storageId,
			sourceId,
			settings: { replication: { enabled: true, storages: [{ storageId: targetId }] } },
		});

		it('should return the source of every plan replicating to the storage', async () => {
			mockDb.query.plans.findMany.mockResolvedValue([
				replicationPlan('plan-1', 'main', 'storage-1'),
				replicationPlan('plan-2', 'device-2', 'storage-1'),
			]);

			const result = await storageStore.getReplicationPlanSources('storage-1');

			expect(result).toEqual(['main', 'device-2']);
		});

		it('should list a source once when it owns two replication plans', async () => {
			mockDb.query.plans.findMany.mockResolvedValue([
				replicationPlan('plan-1', 'device-2', 'storage-1'),
				replicationPlan('plan-2', 'device-2', 'storage-1'),
			]);

			const result = await storageStore.getReplicationPlanSources('storage-1');

			expect(result).toEqual(['device-2']);
		});

		it('should ignore a plan that replicates to a different storage', async () => {
			mockDb.query.plans.findMany.mockResolvedValue([
				replicationPlan('plan-1', 'device-2', 'storage-9'),
			]);

			const result = await storageStore.getReplicationPlanSources('storage-1');

			expect(result).toEqual([]);
		});

		it('should ignore a plan whose primary storage is the same storage', async () => {
			mockDb.query.plans.findMany.mockResolvedValue([
				replicationPlan('plan-1', 'device-2', 'storage-1', 'storage-1'),
			]);

			const result = await storageStore.getReplicationPlanSources('storage-1');

			expect(result).toEqual([]);
		});

		it('should ignore a plan with replication disabled', async () => {
			const plan = replicationPlan('plan-1', 'device-2', 'storage-1');
			plan.settings.replication.enabled = false;
			mockDb.query.plans.findMany.mockResolvedValue([plan]);

			const result = await storageStore.getReplicationPlanSources('storage-1');

			expect(result).toEqual([]);
		});

		it('should return an empty list when no plan exists', async () => {
			mockDb.query.plans.findMany.mockResolvedValue([]);

			const result = await storageStore.getReplicationPlanSources('storage-1');

			expect(result).toEqual([]);
		});
		it('never distributes server-side managed mirror credentials to the source Agent', async () => {
			mockDb.query.plans.findMany.mockResolvedValue([
				{ ...replicationPlan('plan-managed', 'app-01', 'storage-1'), sourceType: 'device' },
				{ ...replicationPlan('plan-local', 'main', 'storage-1'), sourceType: 'device' },
			]);
			expect(await storageStore.getReplicationPlanSources('storage-1')).toEqual(['main']);
			expect(await storageStore.getReplicationPlans('storage-1')).toHaveLength(2);
		});
	});
});
