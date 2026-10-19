import { BackupService } from '../../src/services/BackupServices';
import { BackupStore } from '../../src/stores/BackupStore';
import { PlanStore } from '../../src/stores/PlanStore';
import { StorageStore } from '../../src/stores/StorageStore';
import { RestoreStore } from '../../src/stores/RestoreStore';
import { BaseSnapshotManager } from '../../src/managers/BaseSnapshotManager';
import { BaseBackupManager } from '../../src/managers/BaseBackupManager';
import { LocalStrategy as LocalSnapshotStrategy } from '../../src/strategies/snapshot/LocalStrategy';
import { LocalStrategy as LocalBackupStrategy } from '../../src/strategies/backup/LocalStrategy';
import { jobQueue } from '../../src/jobs/JobQueue';
import { initializeLogger } from '../../src/utils/logger';
import { ManagedRepositoryAccessError } from '../../src/utils/restic/ManagedSftpRepositorySession';

// Mock dependencies
jest.mock('../../src/stores/BackupStore');
jest.mock('../../src/stores/PlanStore');
jest.mock('../../src/stores/StorageStore');
jest.mock('../../src/stores/RestoreStore');
jest.mock('../../src/managers/BaseSnapshotManager');
jest.mock('../../src/managers/BaseBackupManager');
jest.mock('../../src/strategies/snapshot/LocalStrategy');
jest.mock('../../src/strategies/backup/LocalStrategy');
jest.mock('../../src/jobs/JobQueue');

describe('BackupService', () => {
	let backupService: BackupService;
	let mockBackupStore: jest.Mocked<BackupStore>;
	let mockPlanStore: jest.Mocked<PlanStore>;
	let mockStorageStore: jest.Mocked<StorageStore>;
	let mockRestoreStore: jest.Mocked<RestoreStore>;
	let mockSnapshotManager: jest.Mocked<BaseSnapshotManager>;
	let mockBackupManager: jest.Mocked<BaseBackupManager>;
	let mockSnapshotStrategy: jest.Mocked<LocalSnapshotStrategy>;
	let mockBackupStrategy: jest.Mocked<LocalBackupStrategy>;
	let mockJobQueue: jest.Mocked<typeof jobQueue>;

	beforeAll(() => {
		initializeLogger();
	});

	beforeEach(() => {
		jest.clearAllMocks();

		// Instantiate mocks
		mockBackupStore = new BackupStore(null as any) as jest.Mocked<BackupStore>;
		mockPlanStore = new PlanStore(null as any) as jest.Mocked<PlanStore>;
		mockPlanStore.beginSourceRemoval.mockReturnValue(jest.fn());
		mockPlanStore.deleteBackupIfUnreferenced.mockResolvedValue(true);
		mockStorageStore = new StorageStore(null as any) as jest.Mocked<StorageStore>;
		mockRestoreStore = new RestoreStore(null as any) as jest.Mocked<RestoreStore>;
		mockSnapshotManager = new BaseSnapshotManager() as jest.Mocked<BaseSnapshotManager>;
		mockBackupManager = new BaseBackupManager() as jest.Mocked<BaseBackupManager>;
		mockJobQueue = jobQueue as jest.Mocked<typeof jobQueue>;

		// Mock strategy constructors and their return values
		mockSnapshotStrategy = new LocalSnapshotStrategy(
			mockSnapshotManager
		) as jest.Mocked<LocalSnapshotStrategy>;
		(LocalSnapshotStrategy as jest.Mock).mockReturnValue(mockSnapshotStrategy);

		mockBackupStrategy = new LocalBackupStrategy(
			mockBackupManager
		) as jest.Mocked<LocalBackupStrategy>;
		(LocalBackupStrategy as jest.Mock).mockReturnValue(mockBackupStrategy);

		// Instantiate the service with mocked dependencies
		backupService = new BackupService(
			mockSnapshotManager,
			mockBackupManager,
			mockPlanStore,
			mockBackupStore,
			mockRestoreStore,
			mockStorageStore
		);
	});

	describe('remote managed recovery routing', () => {
		it('routes remote Download GET/POST only through the scoped session, preserving cancellation', async () => {
			const descriptor = { fileName: 'backup-backup-01.tar', streamTo: jest.fn() };
			const download = jest.fn().mockResolvedValue(descriptor);
			const prepareDownload = jest.fn().mockResolvedValue({ streaming: true });
			backupService = new BackupService(
				mockSnapshotManager,
				mockBackupManager,
				mockPlanStore,
				mockBackupStore,
				mockRestoreStore,
				mockStorageStore,
				undefined,
				{ download, prepareDownload } as any
			);
			mockBackupStore.getById.mockResolvedValue({
				id: 'backup-01',
				sourceId: 'app-01',
				sourceType: 'device',
				method: 'backup',
			} as any);
			const signal = new AbortController().signal;
			await expect(backupService.getBackupDownload('backup-01')).resolves.toBe(descriptor);
			await expect(
				backupService.generateBackupDownload('backup-01', undefined, signal)
			).resolves.toEqual({ streaming: true });
			expect(download).toHaveBeenCalledWith('backup-01');
			expect(prepareDownload).toHaveBeenCalledWith('backup-01', undefined, signal);
			expect(mockSnapshotStrategy.getSnapshotDownload).not.toHaveBeenCalled();
			expect(mockSnapshotStrategy.downloadSnapshot).not.toHaveBeenCalled();
			expect(mockBackupStore.update).not.toHaveBeenCalled();
		});
		it('fails closed for remote Download when recovery is not wired; never falls back to local', async () => {
			mockBackupStore.getById.mockResolvedValue({
				id: 'backup-01',
				sourceId: 'app-01',
				sourceType: 'device',
				method: 'backup',
			} as any);
			await expect(backupService.getBackupDownload('backup-01')).rejects.toMatchObject({
				statusCode: 501,
			});
			await expect(backupService.generateBackupDownload('backup-01')).rejects.toMatchObject({
				statusCode: 501,
			});
			expect(mockSnapshotStrategy.getSnapshotDownload).not.toHaveBeenCalled();
			expect(mockSnapshotStrategy.downloadSnapshot).not.toHaveBeenCalled();
		});
		it('routes remote Browse through the scoped recovery service without using the local strategy', async () => {
			const browse = jest.fn().mockResolvedValue([{ path: '/srv/example-app/index.txt' }]);
			backupService = new BackupService(
				mockSnapshotManager,
				mockBackupManager,
				mockPlanStore,
				mockBackupStore,
				mockRestoreStore,
				mockStorageStore,
				undefined,
				{ browse } as any
			);
			mockBackupStore.getById.mockResolvedValue({
				id: 'backup-01',
				sourceId: 'app-01',
				sourceType: 'device',
				method: 'backup',
			} as any);
			await expect(backupService.getSnapshotFiles('backup-01')).resolves.toEqual([
				{ path: '/srv/example-app/index.txt' },
			]);
			expect(browse).toHaveBeenCalledWith('backup-01', undefined);
			expect(mockSnapshotStrategy.getSnapshotFiles).not.toHaveBeenCalled();
			expect(mockStorageStore.getById).not.toHaveBeenCalled();
		});
		it('preserves a sanitized repository failure without falling back to another snapshot strategy', async () => {
			const failure = new ManagedRepositoryAccessError('wrong-password');
			const browse = jest.fn().mockRejectedValue(failure);
			backupService = new BackupService(
				mockSnapshotManager,
				mockBackupManager,
				mockPlanStore,
				mockBackupStore,
				mockRestoreStore,
				mockStorageStore,
				undefined,
				{ browse } as any
			);
			mockBackupStore.getById.mockResolvedValue({
				id: 'backup-01',
				sourceId: 'app-01',
				sourceType: 'device',
				method: 'backup',
			} as any);
			await expect(backupService.getSnapshotFiles('backup-01', 'mirror-01')).rejects.toBe(failure);
			expect(browse).toHaveBeenCalledWith('backup-01', 'mirror-01');
			expect(mockSnapshotStrategy.getSnapshotFiles).not.toHaveBeenCalled();
		});
		it('fails closed if remote recovery is not wired', async () => {
			mockBackupStore.getById.mockResolvedValue({
				id: 'backup-01',
				sourceId: 'app-01',
				sourceType: 'device',
				method: 'backup',
			} as any);
			await expect(backupService.getSnapshotFiles('backup-01')).rejects.toMatchObject({
				statusCode: 501,
			});
			expect(mockSnapshotStrategy.getSnapshotFiles).not.toHaveBeenCalled();
		});
		it('does not route remote sync into Phase 4 filesystem recovery', async () => {
			const browse = jest.fn();
			backupService = new BackupService(
				mockSnapshotManager,
				mockBackupManager,
				mockPlanStore,
				mockBackupStore,
				mockRestoreStore,
				mockStorageStore,
				undefined,
				{ browse } as any
			);
			mockBackupStore.getById.mockResolvedValue({
				id: 'backup-01',
				planId: 'plan-01',
				sourceId: 'app-01',
				sourceType: 'device',
				method: 'sync',
				storageId: 'local',
				storagePath: 'application',
			} as any);
			await expect(backupService.getSnapshotFiles('backup-01')).rejects.toThrow(
				'REMOTE_CAPABILITY_NOT_IMPLEMENTED'
			);
			expect(browse).not.toHaveBeenCalled();
		});
	});

	// -------------------------
	// Tests for deleting a backup
	// -------------------------
	describe('deleteBackup', () => {
		const backupId = 'backup-123';
		const mockBackup = {
			id: backupId,
			sourceId: 'main', // For local strategy
			storageId: 'storage-abc',
			planId: 'plan-xyz',
			storagePath: '/backups/test',
			encryption: true,
			method: 'backup',
			mirrors: [],
		} as any;
		const mockStorage = { id: 'storage-abc', name: 'Test Storage' } as any;

		it('should successfully delete a backup and its snapshot', async () => {
			// Arrange
			mockBackupStore.getById.mockResolvedValue(mockBackup);
			mockStorageStore.getById.mockResolvedValue(mockStorage);
			mockSnapshotStrategy.removeSnapshot.mockResolvedValue({
				success: true,
				result: 'Snapshot removed',
				stats: { primary: { total_size: 1024, snapshots: ['snap1'] }, mirrors: {} },
			});
			mockPlanStore.update.mockResolvedValue({} as any);
			mockBackupStore.delete.mockResolvedValue(true);

			// Act
			const result = await backupService.deleteBackup(backupId, true);

			// Assert
			expect(mockBackupStore.getById).toHaveBeenCalledWith(backupId);
			expect(mockStorageStore.getById).toHaveBeenCalledWith(mockBackup.storageId);
			expect(mockSnapshotStrategy.removeSnapshot).toHaveBeenCalledWith(
				mockBackup.planId,
				backupId,
				{
					storageName: mockStorage.name,
					storagePath: mockBackup.storagePath,
					encryption: mockBackup.encryption,
					mirrors: mockBackup.mirrors,
				}
			);
			expect(mockPlanStore.update).toHaveBeenCalledWith(mockBackup.planId, {
				stats: { size: 1024, snapshots: ['snap1'] },
			});
			expect(mockPlanStore.deleteBackupIfUnreferenced).toHaveBeenCalledWith(backupId);
			expect(result).toEqual({
				success: true,
				result: 'Snapshot removed',
				stats: { primary: { total_size: 1024, snapshots: ['snap1'] }, mirrors: {} },
			});
		});

		it('should throw an error if the backup is not found', async () => {
			// Arrange
			mockBackupStore.getById.mockResolvedValue(null);

			// Act & Assert
			await expect(backupService.deleteBackup(backupId)).rejects.toThrow('Backup not found');
		});

		it('keeps the snapshot record and plan stats when removal fails', async () => {
			mockBackupStore.getById.mockResolvedValue(mockBackup);
			mockStorageStore.getById.mockResolvedValue(mockStorage);
			mockSnapshotStrategy.removeSnapshot.mockResolvedValue({
				success: false,
				result: 'Storage unavailable',
			});
			await expect(backupService.deleteBackup(backupId, true)).rejects.toHaveProperty(
				'statusCode',
				500
			);
			expect(mockBackupStore.delete).not.toHaveBeenCalled();
			expect(mockPlanStore.update).not.toHaveBeenCalled();
		});

		it('preserves the explicit no-encryption repository setting during removal', async () => {
			mockBackupStore.getById.mockResolvedValue({ ...mockBackup, encryption: false });
			mockStorageStore.getById.mockResolvedValue(mockStorage);
			mockSnapshotStrategy.removeSnapshot.mockResolvedValue({ success: true, result: 'Removed' });
			await backupService.deleteBackup(backupId, true);
			expect(mockSnapshotStrategy.removeSnapshot).toHaveBeenCalledWith(
				mockBackup.planId,
				backupId,
				expect.objectContaining({ encryption: false })
			);
		});

		it.each(['backup', 'restore'])('refuses snapshot deletion during an active %s', async kind => {
			mockBackupStore.getById.mockResolvedValue({ ...mockBackup, inProgress: kind === 'backup' });
			mockRestoreStore.isRestoreRunning.mockResolvedValue(kind === 'restore');
			await expect(backupService.deleteBackup(backupId, true)).rejects.toHaveProperty(
				'statusCode',
				409
			);
			expect(mockSnapshotStrategy.removeSnapshot).not.toHaveBeenCalled();
			expect(mockBackupStore.delete).not.toHaveBeenCalled();
		});

		it('refuses remote snapshot deletion until remote forget is implemented', async () => {
			mockBackupStore.getById.mockResolvedValue({
				...mockBackup,
				sourceId: 'remote-device-01',
				sourceType: 'device',
			});

			await expect(backupService.deleteBackup(backupId)).rejects.toThrow(
				'REMOTE_CAPABILITY_NOT_IMPLEMENTED'
			);
			expect(mockBackupStore.delete).not.toHaveBeenCalled();
		});
	});

	// ---------------------------------
	// Tests for getting a backup download
	// ---------------------------------
	describe('getBackupDownload', () => {
		const backupId = 'backup-to-download';
		const mockBackup = {
			id: backupId,
			sourceId: 'main',
			planId: 'plan-xyz',
			method: 'backup',
		} as any;

		it('should successfully get a backup download stream', async () => {
			// Arrange
			const mockStreamData = { fileName: 'backup.tar', fileStream: 'stream_object' };
			mockBackupStore.getById.mockResolvedValue(mockBackup);
			mockSnapshotStrategy.getSnapshotDownload.mockResolvedValue({
				success: true,
				result: mockStreamData,
			});

			// Act
			const result = await backupService.getBackupDownload(backupId);

			// Assert
			expect(mockBackupStore.getById).toHaveBeenCalledWith(backupId);
			expect(mockSnapshotStrategy.getSnapshotDownload).toHaveBeenCalledWith(
				mockBackup.planId,
				backupId
			);
			expect(result).toEqual(mockStreamData);
		});

		it('should throw an error if the backup is not found', async () => {
			// Arrange
			mockBackupStore.getById.mockResolvedValue(null);

			// Act & Assert
			await expect(backupService.getBackupDownload(backupId)).rejects.toThrow('Backup not found');
		});

		it('should throw an error if the strategy fails to get the download', async () => {
			// Arrange
			mockBackupStore.getById.mockResolvedValue(mockBackup);
			mockSnapshotStrategy.getSnapshotDownload.mockResolvedValue({
				success: false,
				result: 'Strategy failed',
			});

			// Act & Assert
			await expect(backupService.getBackupDownload(backupId)).rejects.toThrow('Strategy failed');
		});
	});

	// ------------------------------------
	// Tests for generating a backup download
	// ------------------------------------
	describe('generateBackupDownload', () => {
		const backupId = 'backup-to-generate';
		const mockBackup = {
			id: backupId,
			sourceId: 'main',
			planId: 'plan-xyz',
			storageId: 'storage-abc',
			storagePath: '/path',
			encryption: true,
			method: 'backup',
		} as any;
		const mockStorage = { id: 'storage-abc', name: 'Test Storage' } as any;

		it('should successfully trigger the generation of a backup download', async () => {
			// Arrange
			mockBackupStore.getById.mockResolvedValue(mockBackup);
			mockStorageStore.getById.mockResolvedValue(mockStorage);
			mockSnapshotStrategy.downloadSnapshot.mockResolvedValue({
				success: true,
				result: 'Generation started',
			});

			// Act
			const result = await backupService.generateBackupDownload(backupId);

			// Assert
			expect(mockBackupStore.getById).toHaveBeenCalledWith(backupId);
			expect(mockStorageStore.getById).toHaveBeenCalledWith(mockBackup.storageId);
			expect(mockSnapshotStrategy.downloadSnapshot).toHaveBeenCalledWith(
				mockBackup.planId,
				backupId,
				'',
				{
					storageName: mockStorage.name,
					storagePath: mockBackup.storagePath,
					encryption: mockBackup.encryption,
				}
			);
			expect(result).toBe('Generation started');
		});

		it('should throw an error if the backup is not found', async () => {
			// Arrange
			mockBackupStore.getById.mockResolvedValue(null);

			// Act & Assert
			await expect(backupService.generateBackupDownload(backupId)).rejects.toThrow(
				'Backup not found'
			);
		});

		it('should throw an error if the strategy fails to generate the download', async () => {
			// Arrange
			mockBackupStore.getById.mockResolvedValue(mockBackup);
			mockStorageStore.getById.mockResolvedValue(mockStorage);
			mockSnapshotStrategy.downloadSnapshot.mockResolvedValue({
				success: false,
				result: 'Failed to generate Download Link',
			});

			// Act & Assert
			await expect(backupService.generateBackupDownload(backupId)).rejects.toThrow(
				'Failed to generate Download Link'
			);
		});
	});

	// ----------------------------------
	// Tests for canceling a backup download
	// ----------------------------------
	describe('cancelBackupDownload', () => {
		const planId = 'plan-xyz';
		const backupId = 'backup-to-cancel-dl';
		const mockBackup = { id: backupId, sourceId: 'main', method: 'backup' } as any;

		it('should successfully cancel a backup download generation', async () => {
			// Arrange
			mockBackupStore.getById.mockResolvedValue(mockBackup);
			mockSnapshotStrategy.cancelSnapshotDownload.mockResolvedValue({
				success: true,
				result: 'Cancelled',
			});
			mockBackupStore.update.mockResolvedValue({} as any);

			// Act
			const result = await backupService.cancelBackupDownload(planId, backupId);

			// Assert
			expect(mockBackupStore.getById).toHaveBeenCalledWith(backupId);
			expect(mockSnapshotStrategy.cancelSnapshotDownload).toHaveBeenCalledWith(planId, backupId);
			expect(mockBackupStore.update).toHaveBeenCalledWith(backupId, { download: null });
			expect(result).toBe('Cancelled');
		});

		it('should throw an error if backup is not found', async () => {
			// Arrange
			mockBackupStore.getById.mockResolvedValue(null);

			// Act & Assert
			await expect(backupService.cancelBackupDownload(planId, backupId)).rejects.toThrow(
				'Backup not found'
			);
		});

		it('should throw an error if strategy fails to cancel', async () => {
			// Arrange
			mockBackupStore.getById.mockResolvedValue(mockBackup);
			mockSnapshotStrategy.cancelSnapshotDownload.mockResolvedValue({
				success: false,
				result: 'Failed to cancel Download',
			});

			// Act & Assert
			await expect(backupService.cancelBackupDownload(planId, backupId)).rejects.toThrow(
				'Failed to cancel Download'
			);
			expect(mockBackupStore.update).not.toHaveBeenCalled();
		});
	});

	// ---------------------------
	// Tests for canceling a backup
	// ---------------------------
	describe('cancelBackup', () => {
		const planId = 'plan-xyz';
		const backupId = 'backup-to-cancel';
		const mockBackup = { id: backupId, sourceId: 'main', method: 'backup' } as any;

		it('should successfully cancel a local backup', async () => {
			// Arrange
			mockBackupStore.getById.mockResolvedValue(mockBackup);
			mockBackupStrategy.cancelBackup.mockResolvedValue({ success: true, result: 'Cancelled' });
			mockJobQueue.remove.mockReturnValue(true);
			mockBackupStore.update.mockResolvedValue({} as any);

			// Act
			const result = await backupService.cancelBackup(planId, backupId);

			// Assert
			expect(mockBackupStore.getById).toHaveBeenCalledWith(backupId);
			expect(mockBackupStrategy.cancelBackup).toHaveBeenCalledWith(planId, backupId);
			expect(mockJobQueue.remove).toHaveBeenCalledWith('Backup', planId);
			expect(mockBackupStore.update).toHaveBeenCalledWith(backupId, {
				status: 'cancelled',
				inProgress: false,
				ended: expect.any(Object), // a SQL fragment
			});
			expect(result).toEqual({ success: true, result: 'Cancelled' });
		});

		it('should not call jobQueue.remove for a remote backup', async () => {
			// Arrange
			const remoteBackup = { ...mockBackup, sourceId: 'remote-device-1', sourceType: 'device' };
			mockBackupStore.getById.mockResolvedValue(remoteBackup);
			const mockRemoteBackupStrategy = {
				cancelBackup: jest.fn().mockResolvedValue({ success: true, result: 'Cancelled' }),
			};
			const getBackupStrategySpy = jest
				.spyOn(backupService, 'getBackupStrategy')
				.mockReturnValue(mockRemoteBackupStrategy as any);
			mockBackupStore.update.mockResolvedValue({} as any);

			// Act
			await backupService.cancelBackup(planId, backupId);

			// Assert
			expect(mockJobQueue.remove).not.toHaveBeenCalled();
			getBackupStrategySpy.mockRestore(); // clean up the spy
		});

		it('should throw an error if backup is not found', async () => {
			// Arrange
			mockBackupStore.getById.mockResolvedValue(null);

			// Act & Assert
			await expect(backupService.cancelBackup(planId, backupId)).rejects.toThrow(
				'Backup not found'
			);
		});

		it('should throw an error if strategy fails to cancel', async () => {
			// Arrange
			mockBackupStore.getById.mockResolvedValue(mockBackup);
			mockBackupStrategy.cancelBackup.mockResolvedValue({
				success: false,
				result: 'Strategy failed',
			});

			// Act & Assert
			await expect(backupService.cancelBackup(planId, backupId)).rejects.toThrow('Strategy failed');
			expect(mockBackupStore.update).not.toHaveBeenCalled();
		});
	});

	// -------------------------------
	// Tests for getting backup progress
	// -------------------------------
	describe('getBackupProgress', () => {
		const backupId = 'backup-in-progress';
		const mockBackup = {
			id: backupId,
			sourceId: 'main',
			planId: 'plan-xyz',
			method: 'backup',
		} as any;

		it('should successfully get backup progress', async () => {
			// Arrange
			const progressData = { percent_done: 50 };
			mockBackupStore.getById.mockResolvedValue(mockBackup);
			mockBackupStrategy.getBackupProgress.mockResolvedValue({
				success: true,
				result: progressData,
			});

			// Act
			const result = await backupService.getBackupProgress(backupId);

			// Assert
			expect(mockBackupStore.getById).toHaveBeenCalledWith(backupId);
			expect(mockBackupStrategy.getBackupProgress).toHaveBeenCalledWith(
				mockBackup.planId,
				backupId
			);
			expect(result).toEqual(progressData);
		});

		it('should throw an error if backup is not found', async () => {
			// Arrange
			mockBackupStore.getById.mockResolvedValue(null);

			// Act & Assert
			await expect(backupService.getBackupProgress(backupId)).rejects.toThrow('Backup not found');
		});

		it('should throw an error if strategy fails to get progress', async () => {
			// Arrange
			mockBackupStore.getById.mockResolvedValue(mockBackup);
			mockBackupStrategy.getBackupProgress.mockResolvedValue({
				success: false,
				result: 'Failed to get Backup Progress',
			});

			// Act & Assert
			await expect(backupService.getBackupProgress(backupId)).rejects.toThrow(
				'Failed to get Backup Progress'
			);
		});
	});

	// --------------------------------
	// Tests for getting snapshot files
	// --------------------------------
	describe('getSnapshotFiles', () => {
		const backupId = 'backup-with-files';
		const mockBackup = {
			id: backupId,
			sourceId: 'main',
			planId: 'plan-xyz',
			storageId: 'storage-abc',
			storagePath: '/path',
			encryption: true,
			method: 'backup',
		} as any;
		const mockStorage = { id: 'storage-abc', name: 'Test Storage' } as any;

		it('should successfully retrieve snapshot files', async () => {
			// Arrange
			const mockFiles = [{ name: 'file1.txt', path: '/file1.txt' }];
			mockBackupStore.getById.mockResolvedValue(mockBackup);
			mockStorageStore.getById.mockResolvedValue(mockStorage);
			mockSnapshotStrategy.getSnapshotFiles.mockResolvedValue({
				success: true,
				result: mockFiles as any,
			});

			// Act
			const result = await backupService.getSnapshotFiles(backupId);

			// Assert
			expect(mockBackupStore.getById).toHaveBeenCalledWith(backupId);
			expect(mockStorageStore.getById).toHaveBeenCalledWith(mockBackup.storageId);
			expect(mockSnapshotStrategy.getSnapshotFiles).toHaveBeenCalledWith(
				mockBackup.planId,
				backupId,
				{
					storageName: mockStorage.name,
					storagePath: mockBackup.storagePath,
					encryption: mockBackup.encryption,
					skipCache: false,
				}
			);
			expect(result).toEqual(mockFiles);
		});

		it('should throw an error if backup not found', async () => {
			// Arrange
			mockBackupStore.getById.mockResolvedValue(null);

			// Act & Assert
			await expect(backupService.getSnapshotFiles(backupId)).rejects.toThrow('Backup not found');
		});

		it('should throw an error if strategy fails', async () => {
			// Arrange
			mockBackupStore.getById.mockResolvedValue(mockBackup);
			mockStorageStore.getById.mockResolvedValue(mockStorage);
			mockSnapshotStrategy.getSnapshotFiles.mockResolvedValue({
				success: false,
				result: 'Strategy failed',
			});

			// Act & Assert
			await expect(backupService.getSnapshotFiles(backupId)).rejects.toThrow('Strategy failed');
		});
	});
});
