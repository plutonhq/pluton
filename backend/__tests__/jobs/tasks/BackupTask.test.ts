// Mock dependencies
const mockBackupManagerPerformBackupExecution = jest.fn();
const mockLogger = {
	info: jest.fn(),
	error: jest.fn(),
};
const mockPlanLogger = jest.fn(() => ({
	info: jest.fn(),
	error: jest.fn(),
}));

jest.mock('../../../src/utils/logger', () => ({
	logger: mockLogger,
	planLogger: mockPlanLogger,
}));

import { BackupTask } from '../../../src/jobs/tasks/BackupTask';
import { Job } from '../../../src/jobs/JobQueue';
import { BaseBackupManager } from '../../../src/managers/BaseBackupManager';

describe('BackupTask', () => {
	let backupTask: BackupTask;
	let mockBackupManager: jest.Mocked<BaseBackupManager>;

	beforeEach(() => {
		jest.clearAllMocks();

		mockBackupManager = {
			performBackupExecution: mockBackupManagerPerformBackupExecution,
		} as any;

		backupTask = new BackupTask(mockBackupManager);

		mockBackupManagerPerformBackupExecution.mockResolvedValue(undefined);
	});

	describe('constructor', () => {
		it('creates task with correct name', () => {
			expect(backupTask.name).toBe('Backup');
		});

		it('stores backup manager reference', () => {
			expect((backupTask as any).backupManager).toBe(mockBackupManager);
		});
	});

	describe('run', () => {
		it('throws error when planId is missing', async () => {
			const job: Job = {
				id: 'job-1',
				name: 'Backup',
				payload: {},
				attempts: 0,
				maxAttempts: 3,
				retryDelay: 60000,
				lastAttempt: 0,
			};

			await expect(backupTask.run(job)).rejects.toThrow('Missing planId in job payload');

			expect(mockLogger.error).toHaveBeenCalledWith(
				'BackupTask failed: planId is missing from the payload.'
			);
		});

		it('throws error when payload is undefined', async () => {
			const job: Job = {
				id: 'job-1',
				name: 'Backup',
				payload: undefined,
				attempts: 0,
				maxAttempts: 3,
				retryDelay: 60000,
				lastAttempt: 0,
			};

			await expect(backupTask.run(job)).rejects.toThrow('Missing planId in job payload');
		});

		it('executes backup successfully', async () => {
			const job: Job = {
				id: 'job-1',
				name: 'Backup',
				payload: {
					planId: 'plan-123',
					backupId: 'backup-456',
				},
				attempts: 1,
				maxAttempts: 5,
				retryDelay: 60000,
				lastAttempt: 0,
			};

			await backupTask.run(job);

			expect(mockLogger.info).toHaveBeenCalledWith('Starting backup job for plan: plan-123');

			expect(mockBackupManagerPerformBackupExecution).toHaveBeenCalledWith(
				'plan-123',
				'backup-456',
				{
					attempts: 1,
					maxAttempts: 5,
				}
			);

			expect(mockPlanLogger).toHaveBeenCalledWith('backup', 'plan-123', 'backup-456');
		});

		it('handles backup execution errors', async () => {
			const error = new Error('Backup failed');
			mockBackupManagerPerformBackupExecution.mockRejectedValueOnce(error);

			const job: Job = {
				id: 'job-1',
				name: 'Backup',
				payload: {
					planId: 'plan-123',
					backupId: 'backup-456',
				},
				attempts: 0,
				maxAttempts: 3,
				retryDelay: 60000,
				lastAttempt: 0,
			};

			await expect(backupTask.run(job)).rejects.toThrow('Backup failed');

			expect(mockPlanLogger).toHaveBeenCalledWith('backup', 'plan-123', 'backup-456');
		});

		it('passes attempt information correctly', async () => {
			const job: Job = {
				id: 'job-1',
				name: 'Backup',
				payload: {
					planId: 'plan-999',
					backupId: 'backup-888',
				},
				attempts: 3,
				maxAttempts: 10,
				retryDelay: 120000,
				lastAttempt: 0,
			};

			await backupTask.run(job);

			expect(mockBackupManagerPerformBackupExecution).toHaveBeenCalledWith(
				'plan-999',
				'backup-888',
				{
					attempts: 3,
					maxAttempts: 10,
				}
			);
		});

		it('handles backup without backupId', async () => {
			const job: Job = {
				id: 'job-1',
				name: 'Backup',
				payload: {
					planId: 'plan-123',
				},
				attempts: 0,
				maxAttempts: 3,
				retryDelay: 60000,
				lastAttempt: 0,
			};

			await backupTask.run(job);

			expect(mockBackupManagerPerformBackupExecution).toHaveBeenCalledWith(
				'plan-123',
				undefined,
				expect.any(Object)
			);
		});

		it('re-throws errors for JobProcessor to handle', async () => {
			const customError = new Error('Custom backup error');
			mockBackupManagerPerformBackupExecution.mockRejectedValueOnce(customError);

			const job: Job = {
				id: 'job-1',
				name: 'Backup',
				payload: {
					planId: 'plan-123',
					backupId: 'backup-456',
				},
				attempts: 2,
				maxAttempts: 3,
				retryDelay: 60000,
				lastAttempt: 0,
			};

			await expect(backupTask.run(job)).rejects.toBe(customError);
		});

		it('logs completion message on success', async () => {
			const mockPlanLoggerInstance = {
				info: jest.fn(),
				error: jest.fn(),
			};
			mockPlanLogger.mockReturnValueOnce(mockPlanLoggerInstance);

			const job: Job = {
				id: 'job-1',
				name: 'Backup',
				payload: {
					planId: 'plan-123',
					backupId: 'backup-456',
				},
				attempts: 0,
				maxAttempts: 3,
				retryDelay: 60000,
				lastAttempt: 0,
			};

			await backupTask.run(job);

			expect(mockPlanLoggerInstance.info).toHaveBeenCalledWith(
				'Backup job for plan plan-123 completed successfully.'
			);
		});

		it('logs error message on failure', async () => {
			const mockPlanLoggerInstance = {
				info: jest.fn(),
				error: jest.fn(),
			};
			mockPlanLogger.mockReturnValueOnce(mockPlanLoggerInstance);

			mockBackupManagerPerformBackupExecution.mockRejectedValueOnce(new Error('Execution error'));

			const job: Job = {
				id: 'job-1',
				name: 'Backup',
				payload: {
					planId: 'plan-123',
					backupId: 'backup-456',
				},
				attempts: 0,
				maxAttempts: 3,
				retryDelay: 60000,
				lastAttempt: 0,
			};

			await expect(backupTask.run(job)).rejects.toThrow();

			expect(mockPlanLoggerInstance.error).toHaveBeenCalledWith(
				expect.stringContaining('Backup job for plan plan-123 failed')
			);
		});
	});
});
