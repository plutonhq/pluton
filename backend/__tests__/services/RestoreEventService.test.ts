process.env.APP_TITLE = 'Pluton Test';
process.env.SECRET = 'a-super-secret-key-for-testing-123';
process.env.ENCRYPTION_KEY = 'an-encryption-key-for-testing-456';
process.env.APIKEY = 'an-api-key-for-testing-and-so-on-789';
process.env.USER_NAME = 'testUser';
process.env.USER_PASSWORD = 'testPassword';

import { RestoreEventService } from '../../src/services/events/RestoreEventService';
import { PlanStore } from '../../src/stores/PlanStore';
import { BackupStore } from '../../src/stores/BackupStore';
import { RestoreStore } from '../../src/stores/RestoreStore';
import { BaseRestoreManager } from '../../src/managers/BaseRestoreManager';
import { RestoreStartEvent, RestoreCompleteEvent, RestoreErrorEvent } from '../../src/types/events';
import * as fsPromises from 'fs/promises';

jest.mock('../../src/db/index', () => ({
	db: {
		select: jest.fn(),
		insert: jest.fn(),
		update: jest.fn(),
		delete: jest.fn(),
	},
}));

// Mock all dependencies
jest.mock('../../src/stores/PlanStore');
jest.mock('../../src/stores/BackupStore');
jest.mock('../../src/stores/RestoreStore');
jest.mock('../../src/managers/BaseRestoreManager');
jest.mock('fs/promises');

// Mock the logger
jest.mock('../../src/utils/logger', () => ({
	planLogger: jest.fn().mockReturnValue({
		info: jest.fn(),
		error: jest.fn(),
		warn: jest.fn(),
	}),
}));

describe('RestoreEventService', () => {
	let restoreEventService: RestoreEventService;
	let mockPlanStore: jest.Mocked<PlanStore>;
	let mockBackupStore: jest.Mocked<BackupStore>;
	let mockRestoreStore: jest.Mocked<RestoreStore>;
	let mockLocalAgent: jest.Mocked<BaseRestoreManager>;

	beforeEach(() => {
		jest.clearAllMocks();

		mockPlanStore = new PlanStore(null as any) as jest.Mocked<PlanStore>;
		mockBackupStore = new BackupStore(null as any) as jest.Mocked<BackupStore>;
		mockRestoreStore = new RestoreStore(null as any) as jest.Mocked<RestoreStore>;
		mockLocalAgent = new BaseRestoreManager() as jest.Mocked<BaseRestoreManager>;

		restoreEventService = new RestoreEventService(
			mockPlanStore,
			mockBackupStore,
			mockRestoreStore,
			mockLocalAgent
		);
	});

	describe('onRestoreStart', () => {
		const planId = 'plan-123';
		const backupId = 'backup-abc';
		const restoreId = 'restore-xyz';
		const mockBackup = {
			id: backupId,
			planId,
			storageId: 'storage-1',
			sourceId: 'main',
			sourceType: 'device',
			method: 'backup',
		} as any;
		const startEvent: RestoreStartEvent = {
			planId,
			backupId,
			restoreId,
			config: {
				target: '/tmp/restore',
				overwrite: 'always',
				includes: [],
				excludes: [],
				delete: false,
			},
			stats: { total_files: 10, total_bytes: 1024 } as any,
			summary: { totalFiles: 10, totalBytes: 1024 } as any,
		};

		it('should create a restore record and emit "restoreCreated" for a local agent', async () => {
			// Arrange
			mockBackupStore.getById.mockResolvedValue(mockBackup);
			mockRestoreStore.create.mockImplementation(data =>
				Promise.resolve({ ...data, id: restoreId } as any)
			);

			// Act
			await restoreEventService.onRestoreStart(startEvent);

			// Assert
			expect(mockBackupStore.getById).toHaveBeenCalledWith(backupId);
			expect(mockRestoreStore.create).toHaveBeenCalledWith(
				expect.objectContaining({
					id: restoreId,
					backupId,
					planId,
					status: 'started',
					inProgress: true,
					config: startEvent.config,
					taskStats: startEvent.stats,
				})
			);
			expect(mockLocalAgent.emit).toHaveBeenCalledWith('restoreCreated', { backupId, restoreId });
		});

		it('should log an error and not create a record if the backup is not found', async () => {
			// Arrange
			mockBackupStore.getById.mockResolvedValue(null);

			// Act
			await restoreEventService.onRestoreStart(startEvent);

			// Assert
			expect(mockRestoreStore.create).not.toHaveBeenCalled();
			expect(mockLocalAgent.emit).not.toHaveBeenCalled();
		});

		it('should log an error if creating the restore record in the database fails', async () => {
			// Arrange
			mockBackupStore.getById.mockResolvedValue(mockBackup);
			mockRestoreStore.create.mockResolvedValue(null); // Simulate DB creation failure

			// Act
			await restoreEventService.onRestoreStart(startEvent);

			// Assert
			expect(mockRestoreStore.create).toHaveBeenCalled();
			expect(mockLocalAgent.emit).not.toHaveBeenCalled(); // Should not emit if DB write fails
		});
	});

	describe('onRestoreError', () => {
		const errorEvent: RestoreErrorEvent = {
			planId: 'plan-123',
			backupId: 'backup-abc',
			restoreId: 'restore-xyz',
			error: 'A transient error occurred.',
		};

		it('should update the restore record with an error status and message', async () => {
			// Arrange
			mockRestoreStore.update.mockResolvedValue({ id: errorEvent.restoreId } as any);

			// Act
			await restoreEventService.onRestoreError(errorEvent);

			// Assert
			expect(mockRestoreStore.update).toHaveBeenCalledWith(errorEvent.restoreId, {
				status: 'error',
				errorMsg: errorEvent.error,
				inProgress: true,
				ended: expect.any(Object), // Expecting sql`(unixepoch())`
			});
		});

		it('should do nothing if restoreId is missing', async () => {
			// Arrange
			const invalidEvent = { ...errorEvent, restoreId: undefined };

			// Act
			await restoreEventService.onRestoreError(invalidEvent as any);

			// Assert
			expect(mockRestoreStore.update).not.toHaveBeenCalled();
		});
	});

	describe('onRestoreFailed', () => {
		const failedEvent: RestoreErrorEvent = {
			planId: 'plan-123',
			backupId: 'backup-abc',
			restoreId: 'restore-xyz',
			error: 'Permanent failure.',
		};

		it('should update the restore record with a failed status', async () => {
			// Arrange
			mockRestoreStore.update.mockResolvedValue({ id: failedEvent.restoreId } as any);

			// Act
			await restoreEventService.onRestoreFailed(failedEvent);

			// Assert
			expect(mockRestoreStore.update).toHaveBeenCalledWith(failedEvent.restoreId, {
				status: 'failed',
				errorMsg: failedEvent.error,
				inProgress: false,
				ended: expect.any(Object),
			});
		});
	});

	describe('onRestoreComplete', () => {
		const restoreId = 'restore-xyz';
		const completeEvent: RestoreCompleteEvent = {
			planId: 'plan-123',
			backupId: 'backup-abc',
			restoreId,
			success: true,
		};

		it('should update status to "completed" and parse progress file on success', async () => {
			// Arrange
			const mockProgressData = { data: { message_type: 'summary' } };
			(fsPromises.readFile as jest.Mock).mockResolvedValue(JSON.stringify(mockProgressData));
			mockRestoreStore.update.mockResolvedValue({ id: restoreId } as any);

			// Act
			await restoreEventService.onRestoreComplete(completeEvent);

			// Assert
			expect(fsPromises.readFile).toHaveBeenCalledWith(
				expect.stringContaining(`restore-${restoreId}.json`),
				'utf8'
			);
			expect(mockRestoreStore.update).toHaveBeenCalledWith(restoreId, {
				status: 'completed',
				inProgress: false,
				ended: expect.any(Object),
				completionStats: mockProgressData.data,
			});
		});

		it('should update status to "failed" when success is false', async () => {
			// Arrange
			(fsPromises.readFile as jest.Mock).mockResolvedValue('{}');
			mockRestoreStore.update.mockResolvedValue({ id: restoreId } as any);

			// Act
			await restoreEventService.onRestoreComplete({ ...completeEvent, success: false });

			// Assert
			expect(mockRestoreStore.update).toHaveBeenCalledWith(restoreId, {
				status: 'failed',
				inProgress: false,
				ended: expect.any(Object),
				completionStats: undefined, // No progress data to parse
			});
		});

		it('should handle missing progress file gracefully', async () => {
			// Arrange
			(fsPromises.readFile as jest.Mock).mockRejectedValue(new Error('File not found'));
			mockRestoreStore.update.mockResolvedValue({ id: restoreId } as any);

			// Act
			await restoreEventService.onRestoreComplete(completeEvent);

			// Assert
			expect(mockRestoreStore.update).toHaveBeenCalledWith(restoreId, {
				status: 'completed',
				inProgress: false,
				ended: expect.any(Object),
				completionStats: undefined, // Should be undefined as file read failed
			});
		});
	});
});
