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
			mockStorageStore,
			null // broker
		);
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
			mockBackupStore.getById.mockResolvedValue(mockBackup);
			mockRestoreStore.isRestoreRunning.mockResolvedValue(false);
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
			expect(mockStorageStore.getById).toHaveBeenCalledWith(mockBackup.storageId);
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
