process.env.APP_TITLE = 'Pluton Test';
process.env.SECRET = 'a-super-secret-key-for-testing-123';
process.env.ENCRYPTION_KEY = 'an-encryption-key-for-testing-456';
process.env.APIKEY = 'an-api-key-for-testing-and-so-on-789';
process.env.USER_NAME = 'testUser';
process.env.USER_PASSWORD = 'testPassword';

import { BackupEventService } from '../../src/services/events/BackupEventService';
import { PlanStore } from '../../src/stores/PlanStore';
import { BackupStore } from '../../src/stores/BackupStore';
import { BaseBackupManager } from '../../src/managers/BaseBackupManager';
import { BackupNotification } from '../../src/notifications/BackupNotification';
import { PlanFull } from '../../src/types/plans';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import { BackupStartEvent } from '#core-backend/types/events';

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
jest.mock('../../src/managers/BaseBackupManager');
jest.mock('../../src/notifications/BackupNotification');
jest.mock('fs');
jest.mock('fs/promises');

// Mock the logger to prevent file I/O during tests and allow spying on log calls
jest.mock('../../src/utils/logger', () => ({
	planLogger: jest.fn().mockReturnValue({
		info: jest.fn(),
		error: jest.fn(),
		warn: jest.fn(),
	}),
}));

describe('BackupEventService', () => {
	let backupEventService: BackupEventService;
	let mockPlanStore: jest.Mocked<PlanStore>;
	let mockBackupStore: jest.Mocked<BackupStore>;
	let mockLocalAgent: jest.Mocked<BaseBackupManager>;
	let mockBackupNotification: jest.Mocked<BackupNotification>;

	beforeEach(() => {
		// Reset mocks to ensure test isolation
		jest.clearAllMocks();

		// Instantiate mocked dependencies
		mockPlanStore = new PlanStore(null as any) as jest.Mocked<PlanStore>;
		mockBackupStore = new BackupStore(null as any) as jest.Mocked<BackupStore>;
		mockLocalAgent = new BaseBackupManager() as jest.Mocked<BaseBackupManager>;

		// Since BackupNotification is instantiated inside the service, we mock its implementation.
		mockBackupNotification = {
			send: jest.fn().mockResolvedValue(undefined),
		} as any;
		(BackupNotification as jest.Mock).mockImplementation(() => mockBackupNotification);

		// Instantiate the service under test with mocked dependencies
		backupEventService = new BackupEventService(mockPlanStore, mockBackupStore, mockLocalAgent);
	});

	describe('onBackupStart', () => {
		const planId = 'plan-123';
		const backupId = 'backup-abc';
		const mockPlan: PlanFull = {
			id: planId,
			title: 'Test Plan',
			sourceId: 'main', // Local device
			storageId: 'storage-xyz',
			sourceType: 'device',
			method: 'backup',
			settings: {
				notification: {
					email: { enabled: true, case: 'start', type: 'smtp', emails: 'test@example.com' },
				},
			},
		} as any;
		const mockSummary = { message_type: 'summary', total_files_processed: 10 } as any;
		const startEvent: BackupStartEvent = { planId, backupId, summary: mockSummary };

		it('should create a new backup record, emit "backup_created", and send a notification for a new local backup', async () => {
			// Arrange
			mockBackupStore.getById.mockResolvedValue(null);
			mockPlanStore.hasActiveBackups.mockResolvedValue(false);
			mockPlanStore.getById.mockResolvedValue(mockPlan);
			mockBackupStore.create.mockImplementation(data =>
				Promise.resolve({ ...data, id: backupId, started: new Date() } as any)
			);

			// Act
			await backupEventService.onBackupStart(startEvent);

			// Assert
			expect(mockBackupStore.getById).toHaveBeenCalledWith(backupId);
			expect(mockPlanStore.hasActiveBackups).toHaveBeenCalledWith(planId);
			expect(mockBackupStore.create).toHaveBeenCalledWith(
				expect.objectContaining({
					id: backupId,
					planId,
					status: 'started',
					inProgress: true,
					sourceId: 'main',
					taskStats: mockSummary,
				})
			);
			expect(mockLocalAgent.emit).toHaveBeenCalledWith('backup_created', { planId, backupId });
			expect(mockBackupNotification.send).toHaveBeenCalledWith(
				mockPlan,
				'start',
				expect.objectContaining({ id: backupId, stats: mockSummary })
			);
		});

		it('should not emit "backup_created" for a new remote backup', async () => {
			// Arrange
			const remotePlan = { ...mockPlan, sourceId: 'remote-device-1' };
			mockBackupStore.getById.mockResolvedValue(null);
			mockPlanStore.hasActiveBackups.mockResolvedValue(false);
			mockPlanStore.getById.mockResolvedValue(remotePlan);
			mockBackupStore.create.mockResolvedValue({ id: backupId } as any);

			// Act
			await backupEventService.onBackupStart(startEvent);

			// Assert
			expect(mockLocalAgent.emit).not.toHaveBeenCalled();
		});

		it('should update an existing backup record on retry', async () => {
			// Arrange
			const existingBackup = { id: backupId, sourceId: 'main' };
			mockBackupStore.getById.mockResolvedValue(existingBackup as any);

			// Act
			await backupEventService.onBackupStart(startEvent);

			// Assert
			expect(mockBackupStore.update).toHaveBeenCalledWith(backupId, {
				inProgress: true,
				status: 'retrying',
				ended: null,
			});
			expect(mockLocalAgent.emit).toHaveBeenCalledWith('backup_created', { planId, backupId });
			expect(mockBackupStore.create).not.toHaveBeenCalled();
		});

		it('should do nothing if a backup is already active for the plan', async () => {
			// Arrange
			mockBackupStore.getById.mockResolvedValue(null);
			mockPlanStore.hasActiveBackups.mockResolvedValue(true);

			// Act
			await backupEventService.onBackupStart(startEvent);

			// Assert
			expect(mockBackupStore.create).not.toHaveBeenCalled();
			expect(mockBackupNotification.send).not.toHaveBeenCalled();
		});
	});

	describe('onBackupComplete', () => {
		const planId = 'plan-123';
		const backupId = 'backup-abc';
		const mockPlan: PlanFull = {
			id: planId,
			settings: {
				notification: { email: { enabled: true, case: 'end' } },
			},
		} as any;
		const mockCompletionStats = { message_type: 'summary', total_duration: 120 } as any;

		beforeEach(() => {
			(fs.existsSync as jest.Mock).mockReturnValue(false);
			(fsPromises.readFile as jest.Mock).mockResolvedValue('{}');
		});

		it('should update backup status to "completed" and send notification on success', async () => {
			// Arrange
			mockPlanStore.getById.mockResolvedValue(mockPlan);
			mockBackupStore.update.mockResolvedValue({
				id: backupId,
				started: new Date(),
				completionStats: mockCompletionStats,
			} as any);
			const completeEvent = { planId, backupId, success: true, summary: mockCompletionStats };

			// Act
			await backupEventService.onBackupComplete(completeEvent);

			// Assert
			expect(mockBackupStore.update).toHaveBeenCalledWith(
				backupId,
				expect.objectContaining({
					inProgress: false,
					status: 'completed',
					success: true,
					completionStats: mockCompletionStats,
				})
			);
			expect(mockBackupNotification.send).toHaveBeenCalledWith(
				mockPlan,
				'success',
				expect.objectContaining({ stats: mockCompletionStats })
			);
		});

		it('should update backup status to "failed" on failure', async () => {
			// Arrange
			mockPlanStore.getById.mockResolvedValue(mockPlan);
			mockBackupStore.update.mockResolvedValue({ id: backupId } as any);
			const completeEvent = { planId, backupId, success: false, summary: mockCompletionStats };

			// Act
			await backupEventService.onBackupComplete(completeEvent);

			// Assert
			expect(mockBackupStore.update).toHaveBeenCalledWith(
				backupId,
				expect.objectContaining({
					status: 'failed',
					success: false,
				})
			);
		});

		it('should read summary from progress file if not provided in event', async () => {
			// Arrange
			const progressFileData = JSON.stringify({
				events: [{ resticData: mockCompletionStats }],
			});
			(fs.existsSync as jest.Mock).mockReturnValue(true);
			(fsPromises.readFile as jest.Mock).mockResolvedValue(progressFileData);
			mockPlanStore.getById.mockResolvedValue(mockPlan);
			mockBackupStore.update.mockResolvedValue({ id: backupId } as any);
			const completeEvent = { planId, backupId, success: true, summary: undefined };

			// Act
			await backupEventService.onBackupComplete(completeEvent);

			// Assert
			expect(fsPromises.readFile).toHaveBeenCalledWith(
				expect.stringContaining(`backup-${backupId}.json`),
				'utf8'
			);
			expect(mockBackupStore.update).toHaveBeenCalledWith(
				backupId,
				expect.objectContaining({
					completionStats: mockCompletionStats,
				})
			);
		});
	});

	describe('onBackupError', () => {
		it('should update the backup status to "retrying" and log the error', async () => {
			// Arrange
			const planId = 'plan-123';
			const backupId = 'backup-abc';
			const error = 'A transient error occurred.';
			mockBackupStore.update.mockResolvedValue({ id: backupId } as any);

			// Act
			await backupEventService.onBackupError({ planId, backupId, error });

			// Assert
			expect(mockBackupStore.update).toHaveBeenCalledWith(backupId, {
				status: 'retrying',
				errorMsg: error,
			});
		});
	});

	describe('onBackupFailure', () => {
		const planId = 'plan-123';
		const backupId = 'backup-abc';
		const error = 'Permanently failed after multiple retries.';
		const mockPlan: PlanFull = {
			id: planId,
			settings: {
				notification: { email: { enabled: true, case: 'failure' } },
			},
		} as any;

		it('should mark backup as "failed", send notification, and call afterPermanentFailure', async () => {
			// Arrange
			mockPlanStore.getById.mockResolvedValue(mockPlan);
			mockBackupStore.update.mockResolvedValue({ id: backupId, started: new Date() } as any);
			const afterFailureSpy = jest
				.spyOn(backupEventService, 'afterPermanentFailure')
				.mockResolvedValue();

			// Act
			await backupEventService.onBackupFailure({ planId, backupId, error });

			// Assert
			expect(mockBackupStore.update).toHaveBeenCalledWith(
				backupId,
				expect.objectContaining({
					status: 'failed',
					errorMsg: error,
					success: false,
					inProgress: false,
				})
			);
			expect(mockBackupNotification.send).toHaveBeenCalledWith(
				mockPlan,
				'failure',
				expect.objectContaining({ id: backupId, error })
			);
			expect(afterFailureSpy).toHaveBeenCalledWith(planId, backupId, error);
		});
	});

	describe('onBackupStatsUpdate', () => {
		it('should update plan stats if data is valid', async () => {
			// Arrange
			const statsEvent = {
				planId: 'plan-123',
				backupId: 'backup-abc',
				total_size: 1024,
				snapshots: ['snap1', 'snap2'],
			};

			// Act
			await backupEventService.onBackupStatsUpdate(statsEvent);

			// Assert
			expect(mockPlanStore.update).toHaveBeenCalledWith(
				'plan-123',
				expect.objectContaining({
					stats: {
						size: 1024,
						snapshots: ['snap1', 'snap2'],
					},
				})
			);
		});
	});

	describe('onPruneEnd', () => {
		it('should update plan stats on successful prune', async () => {
			// Arrange
			const pruneEvent = {
				planId: 'plan-123',
				success: true,
				stats: {
					total_size: 512,
					snapshots: ['snap1'],
				},
			};

			// Act
			await backupEventService.onPruneEnd(pruneEvent);

			// Assert
			expect(mockPlanStore.update).toHaveBeenCalledWith(
				'plan-123',
				expect.objectContaining({
					stats: {
						size: 512,
						snapshots: ['snap1'],
					},
				})
			);
		});

		it('should not update plan stats if prune failed', async () => {
			// Arrange
			const pruneEvent = {
				planId: 'plan-123',
				success: false,
				error: 'Prune operation failed.',
			};

			// Act
			await backupEventService.onPruneEnd(pruneEvent);

			// Assert
			expect(mockPlanStore.update).not.toHaveBeenCalled();
		});
	});
});
