process.env.APP_TITLE = 'Pluton Test';
process.env.SECRET = 'a-super-secret-key-for-testing-123';
process.env.ENCRYPTION_KEY = 'an-encryption-key-for-testing-456';
process.env.APIKEY = 'an-api-key-for-testing-and-so-on-789';
process.env.USER_NAME = 'testUser';
process.env.USER_PASSWORD = 'testPassword';

import { DownloadEventService } from '../../src/services/events/DownloadEventService';
import { BackupStore } from '../../src/stores/BackupStore';
import { BaseSnapshotManager } from '../../src/managers/BaseSnapshotManager';
import {
	DownloadStartEvent,
	DownloadErrorEvent,
	DownloadCompleteEvent,
} from '../../src/types/events';

jest.mock('../../src/db/index', () => ({
	db: {
		select: jest.fn(),
		insert: jest.fn(),
		update: jest.fn(),
		delete: jest.fn(),
	},
}));

// Mock all dependencies
jest.mock('../../src/stores/BackupStore');

// Mock the logger to prevent file I/O during tests and allow spying on log calls
jest.mock('../../src/utils/logger', () => ({
	planLogger: jest.fn().mockReturnValue({
		info: jest.fn(),
		error: jest.fn(),
		warn: jest.fn(),
	}),
}));

describe('DownloadEventService', () => {
	let downloadEventService: DownloadEventService;
	let mockBackupStore: jest.Mocked<BackupStore>;

	beforeEach(() => {
		jest.clearAllMocks();

		mockBackupStore = new BackupStore(null as any) as jest.Mocked<BackupStore>;
		mockBackupStore.update = jest.fn();
		mockBackupStore.getById = jest.fn();

		downloadEventService = new DownloadEventService(mockBackupStore);
	});

	describe('onDownloadStart', () => {
		const planId = 'plan-123';
		const backupId = 'backup-abc';
		const startEvent: DownloadStartEvent = { planId, backupId };

		it('should update backup with started download status', async () => {
			// Arrange
			mockBackupStore.update.mockResolvedValue({} as any);

			// Act
			await downloadEventService.onDownloadStart(startEvent);

			// Assert
			expect(mockBackupStore.update).toHaveBeenCalledWith(backupId, {
				download: {
					status: 'started',
					started: expect.any(Number),
				},
			});
		});

		it('should log an error and not throw if backupStore.update fails', async () => {
			// Arrange
			mockBackupStore.update.mockRejectedValue(new Error('DB write failed'));

			// Act & Assert — should not throw
			await expect(downloadEventService.onDownloadStart(startEvent)).resolves.toBeUndefined();
		});
	});

	describe('onDownloadError', () => {
		const planId = 'plan-123';
		const backupId = 'backup-abc';
		const errorMsg = 'Download timed out';
		const errorEvent: DownloadErrorEvent = { planId, backupId, error: errorMsg };

		it('should get backup by id and update with failed download status', async () => {
			// Arrange
			const existingBackup = {
				id: backupId,
				download: { status: 'started', started: 1000 },
			};
			mockBackupStore.getById.mockResolvedValue(existingBackup as any);
			mockBackupStore.update.mockResolvedValue({} as any);

			// Act
			await downloadEventService.onDownloadError(errorEvent);

			// Assert
			expect(mockBackupStore.getById).toHaveBeenCalledWith(backupId);
			expect(mockBackupStore.update).toHaveBeenCalledWith(backupId, {
				download: {
					...existingBackup.download,
					status: 'failed',
					error: errorMsg,
					ended: expect.any(Number),
				},
			});
		});

		it('should handle missing backup gracefully (backup is null)', async () => {
			// Arrange
			mockBackupStore.getById.mockResolvedValue(null);
			mockBackupStore.update.mockResolvedValue({} as any);

			// Act
			await downloadEventService.onDownloadError(errorEvent);

			// Assert
			expect(mockBackupStore.getById).toHaveBeenCalledWith(backupId);
			expect(mockBackupStore.update).toHaveBeenCalledWith(backupId, {
				download: {
					status: 'failed',
					error: errorMsg,
					ended: expect.any(Number),
				},
			});
		});

		it('should log an error and not throw if an exception occurs', async () => {
			// Arrange
			mockBackupStore.getById.mockRejectedValue(new Error('DB read failed'));

			// Act & Assert — should not throw
			await expect(downloadEventService.onDownloadError(errorEvent)).resolves.toBeUndefined();
		});
	});

	describe('onDownloadComplete', () => {
		const planId = 'plan-123';
		const backupId = 'backup-abc';
		const completeEvent: DownloadCompleteEvent = { planId, backupId, success: true };

		it('should get backup by id and update with complete download status', async () => {
			// Arrange
			const existingBackup = {
				id: backupId,
				download: { status: 'started', started: 1000 },
			};
			mockBackupStore.getById.mockResolvedValue(existingBackup as any);
			mockBackupStore.update.mockResolvedValue({} as any);

			// Act
			await downloadEventService.onDownloadComplete(completeEvent);

			// Assert
			expect(mockBackupStore.getById).toHaveBeenCalledWith(backupId);
			expect(mockBackupStore.update).toHaveBeenCalledWith(backupId, {
				download: {
					...existingBackup.download,
					status: 'complete',
					error: '',
					ended: expect.any(Number),
				},
			});
		});

		it('should handle missing backup gracefully (backup is null)', async () => {
			// Arrange
			mockBackupStore.getById.mockResolvedValue(null);
			mockBackupStore.update.mockResolvedValue({} as any);

			// Act
			await downloadEventService.onDownloadComplete(completeEvent);

			// Assert
			expect(mockBackupStore.getById).toHaveBeenCalledWith(backupId);
			expect(mockBackupStore.update).toHaveBeenCalledWith(backupId, {
				download: {
					status: 'complete',
					error: '',
					ended: expect.any(Number),
				},
			});
		});

		it('should log an error and not throw if an exception occurs', async () => {
			// Arrange
			mockBackupStore.getById.mockRejectedValue(new Error('DB read failed'));

			// Act & Assert — should not throw
			await expect(downloadEventService.onDownloadComplete(completeEvent)).resolves.toBeUndefined();
		});
	});
});
