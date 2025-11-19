import { EventEmitter } from 'events';
import { BaseRestoreManager } from '../../src/managers/BaseRestoreManager';
import { RestoreHandler } from '../../src/managers/handlers/RestoreHandler';
import { jobQueue } from '../../src/jobs/JobQueue';
import { getSnapshotByTag } from '../../src/utils/restic/restic';
import { RestoreOptions } from '../../src/types/restores';

// Mock the dependencies
jest.mock('../../src/managers/handlers/RestoreHandler');
jest.mock('../../src/jobs/JobQueue');
jest.mock('../../src/utils/restic/restic');
jest.mock('../../src/utils/helpers');

describe('BaseRestoreManager', () => {
	let manager: BaseRestoreManager;
	let mockRestoreHandler: jest.Mocked<RestoreHandler>;

	beforeEach(() => {
		jest.clearAllMocks();
		manager = new BaseRestoreManager();
		mockRestoreHandler = (manager as any).restoreHandler as jest.Mocked<RestoreHandler>;
	});

	describe('constructor', () => {
		it('should create an instance with RestoreHandler', () => {
			expect(manager).toBeInstanceOf(BaseRestoreManager);
			expect(manager).toBeInstanceOf(EventEmitter);
			expect((manager as any).restoreHandler).toBeInstanceOf(RestoreHandler);
		});
	});

	describe('performRestoreExecution', () => {
		it('should call restoreHandler.execute with correct parameters', async () => {
			const backupId = 'backup-123';
			const restoreId = 'restore-456';
			const options: RestoreOptions = {
				planId: 'plan-1',
				storagePath: '/storage/path',
				storageName: 'storage-1',
				encryption: true,
				target: '/restore/target',
				overwrite: 'always',
				includes: ['file1.txt'],
				excludes: ['*.tmp'],
				delete: false,
			};
			const retryInfo = { attempts: 0, maxAttempts: 3 };

			mockRestoreHandler.execute = jest.fn().mockResolvedValue('success');

			const result = await manager.performRestoreExecution(backupId, restoreId, options, retryInfo);

			expect(mockRestoreHandler.execute).toHaveBeenCalledWith(
				backupId,
				restoreId,
				options,
				retryInfo
			);
			expect(result).toBe('success');
		});

		it('should propagate errors from restoreHandler.execute', async () => {
			const error = new Error('Restore execution failed');
			mockRestoreHandler.execute = jest.fn().mockRejectedValue(error);

			await expect(
				manager.performRestoreExecution('backup-123', 'restore-456', {} as RestoreOptions, {
					attempts: 0,
					maxAttempts: 3,
				})
			).rejects.toThrow('Restore execution failed');
		});
	});

	describe('restoreSnapshot', () => {
		let addPriorityJobSpy: jest.SpyInstance;

		beforeEach(() => {
			addPriorityJobSpy = jest.spyOn(jobQueue, 'addPriorityJob').mockImplementation();
			jest
				.spyOn(require('../../src/utils/helpers'), 'generateUID')
				.mockReturnValue('generated-restore-id');
		});

		afterEach(() => {
			addPriorityJobSpy.mockRestore();
		});

		it('should add a priority restore job to the queue', async () => {
			const backupId = 'backup-789';
			const options: RestoreOptions = {
				planId: 'plan-2',
				storagePath: '/storage/path',
				storageName: 'storage-2',
				encryption: false,
				target: '/restore/target',
				overwrite: 'if-newer',
				includes: ['*.jpg'],
				excludes: [],
				delete: true,
			};

			const result = await manager.restoreSnapshot(backupId, options);

			expect(addPriorityJobSpy).toHaveBeenCalledWith(
				'Restore',
				{ backupId, restoreId: 'generated-restore-id', options },
				2,
				60000
			);
			expect(result).toEqual({
				success: true,
				result: 'Restore job has been added to the queue.',
			});
		});
	});

	describe('getRestoreSnapshotStats', () => {
		const mockOptions: RestoreOptions = {
			planId: 'plan-3',
			storagePath: '/storage/path',
			storageName: 'storage-3',
			encryption: true,
			target: '/restore/target',
			overwrite: 'always',
			includes: ['file1.txt'],
			excludes: [],
			delete: false,
		};

		beforeEach(() => {
			(getSnapshotByTag as jest.Mock) = jest.fn();
			mockRestoreHandler.dryRestore = jest.fn();
		});

		it('should return dry restore results when snapshot is found', async () => {
			const mockSnapshot = {
				id: 'snapshot-123',
				tags: ['backup-backup-456'],
				time: '2024-01-01T00:00:00Z',
			};
			const mockDryRestoreResult = {
				success: true,
				result: {
					stats: { total_files: 10, files_restored: 10 },
					files: [],
				},
			};

			(getSnapshotByTag as jest.Mock).mockResolvedValue({
				success: true,
				result: mockSnapshot,
			});
			mockRestoreHandler.dryRestore.mockResolvedValue(mockDryRestoreResult);

			const result = await manager.getRestoreSnapshotStats('plan-3', 'backup-456', mockOptions);

			expect(getSnapshotByTag).toHaveBeenCalledWith('backup-backup-456', mockOptions);
			expect(mockRestoreHandler.dryRestore).toHaveBeenCalledWith(
				'backup-456',
				'snapshot-123',
				mockOptions
			);
			expect(result).toEqual(mockDryRestoreResult);
		});

		it('should return error result when snapshot is not found', async () => {
			(getSnapshotByTag as jest.Mock).mockResolvedValue({
				success: false,
				result: 'Snapshot not found',
			});

			const result = await manager.getRestoreSnapshotStats('plan-3', 'backup-456', mockOptions);

			expect(getSnapshotByTag).toHaveBeenCalledWith('backup-backup-456', mockOptions);
			expect(mockRestoreHandler.dryRestore).not.toHaveBeenCalled();
			expect(result).toEqual({
				success: false,
				result: 'Snapshot not found',
			});
		});

		it('should handle errors from getSnapshotByTag', async () => {
			const error = new Error('Failed to get snapshot');
			(getSnapshotByTag as jest.Mock).mockRejectedValue(error);

			const result = await manager.getRestoreSnapshotStats('plan-3', 'backup-456', mockOptions);

			expect(result).toEqual({
				success: false,
				result: 'Failed to get snapshot',
			});
		});

		it('should handle errors from dryRestore', async () => {
			const mockSnapshot = {
				id: 'snapshot-123',
				tags: ['backup-backup-456'],
			};
			const error = new Error('Dry restore failed');

			(getSnapshotByTag as jest.Mock).mockResolvedValue({
				success: true,
				result: mockSnapshot,
			});
			mockRestoreHandler.dryRestore.mockRejectedValue(error);

			const result = await manager.getRestoreSnapshotStats('plan-3', 'backup-456', mockOptions);

			expect(result).toEqual({
				success: false,
				result: 'Dry restore failed',
			});
		});

		it('should handle errors without message property', async () => {
			(getSnapshotByTag as jest.Mock).mockRejectedValue('Unknown error');

			const result = await manager.getRestoreSnapshotStats('plan-3', 'backup-456', mockOptions);

			expect(result).toEqual({
				success: false,
				result: '',
			});
		});
	});

	describe('cancelSnapshotRestore', () => {
		beforeEach(() => {
			mockRestoreHandler.cancel = jest.fn();
		});

		it('should cancel restore successfully', async () => {
			mockRestoreHandler.cancel.mockResolvedValue(true);

			const result = await manager.cancelSnapshotRestore('plan-4', 'restore-789');

			expect(mockRestoreHandler.cancel).toHaveBeenCalledWith('plan-4', 'restore-789');
			expect(result).toEqual({
				success: true,
				result: 'Restore cancelled',
			});
		});

		it('should return false when cancel fails', async () => {
			mockRestoreHandler.cancel.mockResolvedValue(false);

			const result = await manager.cancelSnapshotRestore('plan-4', 'restore-789');

			expect(result).toEqual({
				success: false,
				result: 'Restore cancelled',
			});
		});

		it('should handle errors from cancel', async () => {
			const error = new Error('Cancel failed');
			mockRestoreHandler.cancel.mockRejectedValue(error);

			const result = await manager.cancelSnapshotRestore('plan-4', 'restore-789');

			expect(result).toEqual({
				success: false,
				result: 'Cancel failed',
			});
		});

		it('should handle errors without message property', async () => {
			mockRestoreHandler.cancel.mockRejectedValue('Unknown error');

			const result = await manager.cancelSnapshotRestore('plan-4', 'restore-789');

			expect(result).toEqual({
				success: false,
				result: '',
			});
		});
	});
});
