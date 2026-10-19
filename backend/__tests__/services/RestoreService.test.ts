import { RestoreService } from '../../src/services/RestoreService';
import { RestoreStore } from '../../src/stores/RestoreStore';
import { PlanStore } from '../../src/stores/PlanStore';
import { BackupStore } from '../../src/stores/BackupStore';
import { StorageStore } from '../../src/stores/StorageStore';
import { BaseRestoreManager } from '../../src/managers/BaseRestoreManager';
import { LocalStrategy as LocalRestoreStrategy } from '../../src/strategies/restore/LocalStrategy';
import { NotFoundError } from '../../src/utils/AppError';
import { initializeLogger } from '../../src/utils/logger';

// Mock dependencies
jest.mock('../../src/stores/RestoreStore');
jest.mock('../../src/stores/PlanStore');
jest.mock('../../src/stores/BackupStore');
jest.mock('../../src/stores/StorageStore');
jest.mock('../../src/managers/BaseRestoreManager');
jest.mock('../../src/strategies/restore/LocalStrategy');

describe('RestoreService', () => {
	let restoreService: RestoreService;
	let mockRestoreStore: jest.Mocked<RestoreStore>;
	let mockPlanStore: jest.Mocked<PlanStore>;
	let mockBackupStore: jest.Mocked<BackupStore>;
	let mockStorageStore: jest.Mocked<StorageStore>;
	let mockRestoreManager: jest.Mocked<BaseRestoreManager>;
	let mockRestoreStrategy: jest.Mocked<LocalRestoreStrategy>;

	beforeAll(() => {
		initializeLogger();
	});

	beforeEach(() => {
		jest.clearAllMocks();

		// Instantiate mocks
		mockRestoreStore = new RestoreStore(null as any) as jest.Mocked<RestoreStore>;
		mockPlanStore = new PlanStore(null as any) as jest.Mocked<PlanStore>;
		mockBackupStore = new BackupStore(null as any) as jest.Mocked<BackupStore>;
		mockStorageStore = new StorageStore(null as any) as jest.Mocked<StorageStore>;
		mockRestoreManager = new BaseRestoreManager() as jest.Mocked<BaseRestoreManager>;

		// Mock strategy constructor and its return value
		mockRestoreStrategy = new LocalRestoreStrategy(
			mockRestoreManager
		) as jest.Mocked<LocalRestoreStrategy>;
		(LocalRestoreStrategy as jest.Mock).mockReturnValue(mockRestoreStrategy);

		// Instantiate the service with mocked dependencies
		restoreService = new RestoreService(
			mockRestoreManager,
			mockPlanStore,
			mockBackupStore,
			mockRestoreStore,
			mockStorageStore
		);
	});

	describe('remote internal staged recovery routing', () => {
		let recovery: any;
		const stagedConfig = {
			target: '',
			overwrite: 'never' as const,
			includes: [],
			excludes: [],
			delete: false,
		};
		beforeEach(() => {
			recovery = {
				preview: jest.fn(),
				restore: jest.fn(),
				stats: jest.fn(),
				progress: jest.fn(),
				cancel: jest.fn(),
			};
			restoreService = new RestoreService(
				mockRestoreManager,
				mockPlanStore,
				mockBackupStore,
				mockRestoreStore,
				mockStorageStore,
				recovery
			);
			mockBackupStore.getById.mockResolvedValue({
				id: 'backup-01',
				sourceId: 'app-01',
				sourceType: 'device',
				method: 'backup',
			} as any);
		});
		it('passes the expected plan binding to remote preview and restore, without the local manager', async () => {
			recovery.preview.mockResolvedValue({ stats: { files_restored: 1 }, files: [] });
			recovery.restore.mockResolvedValue('a'.repeat(24));
			await expect(
				restoreService.dryRestoreBackup('backup-01', stagedConfig, 'plan-01')
			).resolves.toMatchObject({ stats: { files_restored: 1 } });
			await expect(
				restoreService.restoreBackup('backup-01', stagedConfig, 'plan-01')
			).resolves.toBe('a'.repeat(24));
			expect(recovery.preview).toHaveBeenCalledWith('backup-01', stagedConfig, 'plan-01');
			expect(recovery.restore).toHaveBeenCalledWith('backup-01', stagedConfig, 'plan-01');
			expect(mockRestoreStrategy.restoreSnapshot).not.toHaveBeenCalled();
			expect(mockRestoreStrategy.getRestoreSnapshotStats).not.toHaveBeenCalled();
			expect(mockStorageStore.getById).not.toHaveBeenCalled();
		});
		it.each([
			['getRestoreStats', 'stats'],
			['getRestoreProgress', 'progress'],
			['cancelRestore', 'cancel'],
		])(
			'routes %s using the persisted staging marker, even though the executing source is main',
			async (method, handler) => {
				const row = {
					id: 'a'.repeat(24),
					sourceId: 'main',
					sourceType: 'device',
					method: 'backup',
					config: { stagingOnly: true },
					inProgress: true,
				} as any;
				mockRestoreStore.getById.mockResolvedValue(row);
				recovery[handler].mockResolvedValue({ success: true });
				await expect((restoreService as any)[method](row.id)).resolves.toEqual({ success: true });
				expect(recovery[handler]).toHaveBeenCalledWith(row);
				expect(mockRestoreStrategy.getRestoreProgress).not.toHaveBeenCalled();
				expect(mockRestoreStrategy.getRestoreStats).not.toHaveBeenCalled();
				expect(mockRestoreStrategy.cancelSnapshotRestore).not.toHaveBeenCalled();
			}
		);
		it('does not delete a running staged restore record', async () => {
			mockRestoreStore.getById.mockResolvedValue({
				id: 'a'.repeat(24),
				config: { stagingOnly: true },
				inProgress: true,
			} as any);
			await expect(restoreService.deleteRestore('a'.repeat(24))).rejects.toMatchObject({
				statusCode: 409,
			});
			expect(mockRestoreStore.delete).not.toHaveBeenCalled();
		});
		it('leaves unsupported remote sync restore on the existing strategy', async () => {
			mockBackupStore.getById.mockResolvedValue({
				id: 'backup-01',
				planId: 'plan-01',
				sourceId: 'app-01',
				sourceType: 'device',
				method: 'sync',
				storageId: 'local',
			} as any);
			mockPlanStore.getById.mockResolvedValue({
				method: 'sync',
				sourceType: 'device',
				settings: { performance: {} },
				sourceConfig: { includes: [] },
			} as any);
			await expect(
				restoreService.dryRestoreBackup('backup-01', stagedConfig, 'plan-01')
			).rejects.toThrow('REMOTE_CAPABILITY_NOT_IMPLEMENTED');
			await expect(
				restoreService.restoreBackup('backup-01', stagedConfig, 'plan-01')
			).rejects.toThrow('REMOTE_CAPABILITY_NOT_IMPLEMENTED');
			expect(recovery.preview).not.toHaveBeenCalled();
			expect(recovery.restore).not.toHaveBeenCalled();
		});
	});

	// ---------------------------
	// Tests for getting all restores
	// ---------------------------
	describe('getAllRestores', () => {
		it('should return an array of all restores', async () => {
			// Arrange
			const mockRestores = [{ id: 'restore-1' }, { id: 'restore-2' }] as any[];
			mockRestoreStore.getAll.mockResolvedValue(mockRestores);

			// Act
			const result = await restoreService.getAllRestores();

			// Assert
			expect(mockRestoreStore.getAll).toHaveBeenCalled();
			expect(result).toEqual(mockRestores);
			expect(result).toHaveLength(2);
		});

		it('should return null if the store returns null', async () => {
			// Arrange
			mockRestoreStore.getAll.mockResolvedValue(null);

			// Act
			const result = await restoreService.getAllRestores();

			// Assert
			expect(result).toBeNull();
		});
	});

	// ---------------------------
	// Tests for getting a single restore
	// ---------------------------
	describe('getRestore', () => {
		const restoreId = 'restore-xyz';
		const mockRestore = { id: restoreId, status: 'completed' } as any;

		it('should return a single restore for a valid ID', async () => {
			// Arrange
			mockRestoreStore.getById.mockResolvedValue(mockRestore);

			// Act
			const result = await restoreService.getRestore(restoreId);

			// Assert
			expect(mockRestoreStore.getById).toHaveBeenCalledWith(restoreId);
			expect(result).toEqual(mockRestore);
		});

		it('should throw a NotFoundError if the restore does not exist', async () => {
			// Arrange
			mockRestoreStore.getById.mockResolvedValue(null);

			// Act & Assert
			await expect(restoreService.getRestore(restoreId)).rejects.toThrow('Restore Item not found.');
			await expect(restoreService.getRestore(restoreId)).rejects.toHaveProperty('statusCode', 404);
		});
	});

	// ---------------------------
	// Tests for deleting a restore
	// ---------------------------
	describe('deleteRestore', () => {
		const restoreId = 'restore-to-delete';

		it('should successfully delete a restore record', async () => {
			// Arrange
			mockRestoreStore.getById.mockResolvedValue({ id: restoreId } as any);
			mockRestoreStore.delete.mockResolvedValue(true);

			// Act
			await restoreService.deleteRestore(restoreId);

			// Assert
			expect(mockRestoreStore.getById).toHaveBeenCalledWith(restoreId);
			expect(mockRestoreStore.delete).toHaveBeenCalledWith(restoreId);
		});

		it('should throw a NotFoundError if the restore to delete is not found', async () => {
			// Arrange
			mockRestoreStore.getById.mockResolvedValue(null);

			// Act & Assert
			await expect(restoreService.deleteRestore(restoreId)).rejects.toThrow('Restore not found');
			await expect(restoreService.deleteRestore(restoreId)).rejects.toHaveProperty(
				'statusCode',
				404
			);
			expect(mockRestoreStore.delete).not.toHaveBeenCalled();
		});
	});

	// ---------------------------
	// Tests for dry-run restore
	// ---------------------------
	describe('dryRestoreBackup', () => {
		const backupId = 'backup-for-dry-run';
		const mockBackup = {
			id: backupId,
			sourceId: 'main',
			method: 'backup',
			storageId: 'storage-abc',
			storagePath: '/backups',
			encryption: true,
			planId: 'plan-1',
		} as any;
		const mockStorage = { id: 'storage-abc', name: 'Test Storage' } as any;
		const restoreConfig = { target: '/restore/path', includes: [], excludes: [], delete: false };

		it('should successfully perform a dry-run restore', async () => {
			// Arrange
			const mockPlan = { id: 'plan-1', settings: {} } as any;
			mockBackupStore.getById.mockResolvedValue(mockBackup);
			mockRestoreStore.isRestoreRunning.mockResolvedValue(false);
			mockPlanStore.getById.mockResolvedValue(mockPlan);
			mockStorageStore.getById.mockResolvedValue(mockStorage);
			mockRestoreStrategy.getRestoreSnapshotStats.mockResolvedValue({
				success: true,
				result: { stats: 'some-stats' },
			});

			// Act
			const result = await restoreService.dryRestoreBackup(backupId, restoreConfig as any);

			// Assert
			expect(mockBackupStore.getById).toHaveBeenCalledWith(backupId);
			expect(mockRestoreStore.isRestoreRunning).toHaveBeenCalledWith(backupId);
			expect(mockPlanStore.getById).toHaveBeenCalledWith(mockBackup.planId);
			expect(mockRestoreStrategy.getRestoreSnapshotStats).toHaveBeenCalled();
			expect(result).toEqual({ stats: 'some-stats' });
		});

		it('should throw an error if backup is not found', async () => {
			// Arrange
			mockBackupStore.getById.mockResolvedValue(null);

			// Act & Assert
			await expect(restoreService.dryRestoreBackup(backupId, restoreConfig as any)).rejects.toThrow(
				'Backup not found'
			);
		});

		it('should throw an error if a restore is already in progress', async () => {
			// Arrange
			mockBackupStore.getById.mockResolvedValue(mockBackup);
			mockRestoreStore.isRestoreRunning.mockResolvedValue(true);

			// Act & Assert
			await expect(restoreService.dryRestoreBackup(backupId, restoreConfig as any)).rejects.toThrow(
				'A Restoration is already in progress for this Plan'
			);
		});
	});

	// ---------------------------
	// Tests for actual restore
	// ---------------------------
	describe('restoreBackup', () => {
		const backupId = 'backup-to-restore';
		const mockBackup = {
			id: backupId,
			sourceId: 'main',
			planId: 'plan-1',
			storageId: 'storage-abc',
			storagePath: '/backups',
			encryption: true,
			method: 'backup',
		} as any;
		const mockPlan = {
			id: 'plan-1',
			sourceConfig: { includes: ['/data'] },
			settings: { performance: {} },
		} as any;
		const mockStorage = { id: 'storage-abc', name: 'Test Storage' } as any;
		const restoreConfig = { target: '/restore/path' };

		it('should successfully trigger a restore operation', async () => {
			// Arrange
			mockBackupStore.getById.mockResolvedValue(mockBackup);
			mockPlanStore.getById.mockResolvedValue(mockPlan);
			mockRestoreStore.isRestoreRunning.mockResolvedValue(false);
			mockStorageStore.getById.mockResolvedValue(mockStorage);
			mockRestoreStrategy.restoreSnapshot.mockResolvedValue({
				success: true,
				result: 'Restore started',
			});

			// Act
			const result = await restoreService.restoreBackup(backupId, restoreConfig as any);

			// Assert
			expect(mockBackupStore.getById).toHaveBeenCalledWith(backupId);
			expect(mockPlanStore.getById).toHaveBeenCalledWith(mockBackup.planId);
			expect(mockRestoreStore.isRestoreRunning).toHaveBeenCalledWith(backupId);
			expect(mockRestoreStrategy.restoreSnapshot).toHaveBeenCalled();
			expect(result).toBe('Restore started');
		});

		it('should throw an error if the backup is not found', async () => {
			// Arrange
			mockBackupStore.getById.mockResolvedValue(null);

			// Act & Assert
			await expect(restoreService.restoreBackup(backupId, restoreConfig as any)).rejects.toThrow(
				'Backup not found'
			);
		});

		it('should throw an error if the plan is not found', async () => {
			// Arrange
			mockBackupStore.getById.mockResolvedValue(mockBackup);
			mockPlanStore.getById.mockResolvedValue(null);

			// Act & Assert
			await expect(restoreService.restoreBackup(backupId, restoreConfig as any)).rejects.toThrow(
				'Plan not found'
			);
		});

		it('should throw an error if a restore is already in progress', async () => {
			// Arrange
			mockBackupStore.getById.mockResolvedValue(mockBackup);
			mockPlanStore.getById.mockResolvedValue(mockPlan);
			mockRestoreStore.isRestoreRunning.mockResolvedValue(true);

			// Act & Assert
			await expect(restoreService.restoreBackup(backupId, restoreConfig as any)).rejects.toThrow(
				'A Restoration is already in progress for this Plan'
			);
		});
	});

	// ---------------------------
	// Tests for canceling a restore
	// ---------------------------
	describe('cancelRestore', () => {
		const restoreId = 'restore-to-cancel';
		const mockRestore = {
			id: restoreId,
			sourceId: 'main',
			method: 'backup',
			planId: 'plan-1',
		} as any;

		it('should successfully cancel a restore', async () => {
			// Arrange
			mockRestoreStore.getById.mockResolvedValue(mockRestore);
			mockRestoreStrategy.cancelSnapshotRestore.mockResolvedValue({
				success: true,
				result: 'Cancelled',
			});
			mockRestoreStore.update.mockResolvedValue({} as any);

			// Act
			const result = await restoreService.cancelRestore(restoreId);

			// Assert
			expect(mockRestoreStore.getById).toHaveBeenCalledWith(restoreId);
			expect(mockRestoreStrategy.cancelSnapshotRestore).toHaveBeenCalledWith(
				mockRestore.planId,
				restoreId
			);
			expect(mockRestoreStore.update).toHaveBeenCalledWith(restoreId, {
				status: 'cancelled',
				inProgress: false,
			});
			expect(result).toEqual({ success: true, result: 'Cancelled' });
		});

		it('should throw a NotFoundError if the restore to cancel is not found', async () => {
			// Arrange
			mockRestoreStore.getById.mockResolvedValue(null);

			// Act & Assert
			await expect(restoreService.cancelRestore(restoreId)).rejects.toThrow('Restore not found');
			await expect(restoreService.cancelRestore(restoreId)).rejects.toHaveProperty(
				'statusCode',
				404
			);
		});
	});

	// -------------------------------
	// Tests for getting restore progress
	// -------------------------------
	describe('getRestoreProgress', () => {
		const restoreId = 'restore-in-progress';
		const mockRestore = {
			id: restoreId,
			sourceId: 'main',
			method: 'backup',
			planId: 'plan-1',
		} as any;

		it('should successfully get restore progress', async () => {
			// Arrange
			const progressData = { percent_done: 75 };
			mockRestoreStore.getById.mockResolvedValue(mockRestore);
			mockRestoreStrategy.getRestoreProgress.mockResolvedValue({
				success: true,
				result: progressData,
			});

			// Act
			const result = await restoreService.getRestoreProgress(restoreId);

			// Assert
			expect(mockRestoreStore.getById).toHaveBeenCalledWith(restoreId);
			expect(mockRestoreStrategy.getRestoreProgress).toHaveBeenCalledWith(
				mockRestore.planId,
				restoreId
			);
			expect(result).toEqual(progressData);
		});

		it('should throw a NotFoundError if the restore is not found', async () => {
			// Arrange
			mockRestoreStore.getById.mockResolvedValue(null);

			// Act & Assert
			await expect(restoreService.getRestoreProgress(restoreId)).rejects.toThrow(
				'Restore not found'
			);
			await expect(restoreService.getRestoreProgress(restoreId)).rejects.toHaveProperty(
				'statusCode',
				404
			);
		});
	});
});
