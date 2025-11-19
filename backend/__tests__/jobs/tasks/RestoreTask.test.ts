// Mock dependencies
const mockRestoreManagerPerformRestoreExecution = jest.fn();
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

import { RestoreTask } from '../../../src/jobs/tasks/RestoreTask';
import { Job } from '../../../src/jobs/JobQueue';
import { BaseRestoreManager } from '../../../src/managers/BaseRestoreManager';

describe('RestoreTask', () => {
	let restoreTask: RestoreTask;
	let mockRestoreManager: jest.Mocked<BaseRestoreManager>;

	beforeEach(() => {
		jest.clearAllMocks();

		mockRestoreManager = {
			performRestoreExecution: mockRestoreManagerPerformRestoreExecution,
		} as any;

		restoreTask = new RestoreTask(mockRestoreManager);

		mockRestoreManagerPerformRestoreExecution.mockResolvedValue(undefined);
	});

	describe('constructor', () => {
		it('creates task with correct name', () => {
			expect(restoreTask.name).toBe('Restore');
		});

		it('stores restore manager reference', () => {
			expect((restoreTask as any).backupManager).toBe(mockRestoreManager);
		});
	});

	describe('run', () => {
		it('throws error when backupId is missing', async () => {
			const job: Job = {
				id: 'job-1',
				name: 'Restore',
				payload: {
					options: { planId: 'plan-1' },
				},
				attempts: 0,
				maxAttempts: 3,
				retryDelay: 60000,
				lastAttempt: 0,
			};

			await expect(restoreTask.run(job)).rejects.toThrow('Missing backupId in job payload');

			expect(mockLogger.error).toHaveBeenCalledWith(
				'RestoreTask failed: backupId is missing from the payload.'
			);
		});

		it('throws error when payload is undefined', async () => {
			const job: Job = {
				id: 'job-1',
				name: 'Restore',
				payload: undefined,
				attempts: 0,
				maxAttempts: 3,
				retryDelay: 60000,
				lastAttempt: 0,
			};

			await expect(restoreTask.run(job)).rejects.toThrow('Missing backupId in job payload');
		});

		it('executes restore successfully', async () => {
			const job: Job = {
				id: 'job-1',
				name: 'Restore',
				payload: {
					restoreId: 'restore-123',
					backupId: 'backup-456',
					options: {
						planId: 'plan-789',
						destination: '/restore/path',
					},
				},
				attempts: 1,
				maxAttempts: 5,
				retryDelay: 60000,
				lastAttempt: 0,
			};

			await restoreTask.run(job);

			expect(mockLogger.info).toHaveBeenCalledWith('Starting restore job for plan: plan-789');

			expect(mockRestoreManagerPerformRestoreExecution).toHaveBeenCalledWith(
				'backup-456',
				'restore-123',
				{
					planId: 'plan-789',
					destination: '/restore/path',
				},
				{
					attempts: 1,
					maxAttempts: 5,
				}
			);

			expect(mockPlanLogger).toHaveBeenCalledWith('restore', 'plan-789', 'backup-456');
		});

		it('handles restore execution errors', async () => {
			const error = new Error('Restore failed');
			mockRestoreManagerPerformRestoreExecution.mockRejectedValueOnce(error);

			const job: Job = {
				id: 'job-1',
				name: 'Restore',
				payload: {
					restoreId: 'restore-123',
					backupId: 'backup-456',
					options: {
						planId: 'plan-789',
					},
				},
				attempts: 0,
				maxAttempts: 3,
				retryDelay: 60000,
				lastAttempt: 0,
			};

			await expect(restoreTask.run(job)).rejects.toThrow('Restore failed');

			expect(mockPlanLogger).toHaveBeenCalledWith('restore', 'plan-789', 'backup-456');
		});

		it('passes attempt information correctly', async () => {
			const job: Job = {
				id: 'job-1',
				name: 'Restore',
				payload: {
					restoreId: 'restore-999',
					backupId: 'backup-888',
					options: {
						planId: 'plan-777',
					},
				},
				attempts: 3,
				maxAttempts: 10,
				retryDelay: 120000,
				lastAttempt: 0,
			};

			await restoreTask.run(job);

			expect(mockRestoreManagerPerformRestoreExecution).toHaveBeenCalledWith(
				'backup-888',
				'restore-999',
				expect.any(Object),
				{
					attempts: 3,
					maxAttempts: 10,
				}
			);
		});

		it('handles restore without restoreId', async () => {
			const job: Job = {
				id: 'job-1',
				name: 'Restore',
				payload: {
					backupId: 'backup-123',
					options: {
						planId: 'plan-456',
					},
				},
				attempts: 0,
				maxAttempts: 3,
				retryDelay: 60000,
				lastAttempt: 0,
			};

			await restoreTask.run(job);

			expect(mockRestoreManagerPerformRestoreExecution).toHaveBeenCalledWith(
				'backup-123',
				undefined,
				expect.any(Object),
				expect.any(Object)
			);
		});

		it('re-throws errors for JobProcessor to handle', async () => {
			const customError = new Error('Custom restore error');
			mockRestoreManagerPerformRestoreExecution.mockRejectedValueOnce(customError);

			const job: Job = {
				id: 'job-1',
				name: 'Restore',
				payload: {
					restoreId: 'restore-123',
					backupId: 'backup-456',
					options: {
						planId: 'plan-789',
					},
				},
				attempts: 2,
				maxAttempts: 3,
				retryDelay: 60000,
				lastAttempt: 0,
			};

			await expect(restoreTask.run(job)).rejects.toBe(customError);
		});

		it('logs completion message on success', async () => {
			const mockPlanLoggerInstance = {
				info: jest.fn(),
				error: jest.fn(),
			};
			mockPlanLogger.mockReturnValueOnce(mockPlanLoggerInstance);

			const job: Job = {
				id: 'job-1',
				name: 'Restore',
				payload: {
					restoreId: 'restore-123',
					backupId: 'backup-456',
					options: {
						planId: 'plan-789',
					},
				},
				attempts: 0,
				maxAttempts: 3,
				retryDelay: 60000,
				lastAttempt: 0,
			};

			await restoreTask.run(job);

			expect(mockPlanLoggerInstance.info).toHaveBeenCalledWith(
				'Restore job for backup backup-456 completed successfully.'
			);
		});

		it('logs error message on failure', async () => {
			const mockPlanLoggerInstance = {
				info: jest.fn(),
				error: jest.fn(),
			};
			mockPlanLogger.mockReturnValueOnce(mockPlanLoggerInstance);

			mockRestoreManagerPerformRestoreExecution.mockRejectedValueOnce(new Error('Execution error'));

			const job: Job = {
				id: 'job-1',
				name: 'Restore',
				payload: {
					restoreId: 'restore-123',
					backupId: 'backup-456',
					options: {
						planId: 'plan-789',
					},
				},
				attempts: 0,
				maxAttempts: 3,
				retryDelay: 60000,
				lastAttempt: 0,
			};

			await expect(restoreTask.run(job)).rejects.toThrow();

			expect(mockPlanLoggerInstance.error).toHaveBeenCalledWith(
				expect.stringContaining('Restore job for backup backup-456 failed')
			);
		});

		it('passes options to restore manager', async () => {
			const job: Job = {
				id: 'job-1',
				name: 'Restore',
				payload: {
					restoreId: 'restore-123',
					backupId: 'backup-456',
					options: {
						planId: 'plan-789',
						destination: '/custom/path',
						includes: ['file1.txt'],
						excludes: ['file2.txt'],
					},
				},
				attempts: 0,
				maxAttempts: 3,
				retryDelay: 60000,
				lastAttempt: 0,
			};

			await restoreTask.run(job);

			expect(mockRestoreManagerPerformRestoreExecution).toHaveBeenCalledWith(
				'backup-456',
				'restore-123',
				{
					planId: 'plan-789',
					destination: '/custom/path',
					includes: ['file1.txt'],
					excludes: ['file2.txt'],
				},
				expect.any(Object)
			);
		});
	});
});
