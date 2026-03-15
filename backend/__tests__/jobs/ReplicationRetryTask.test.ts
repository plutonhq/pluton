import { ReplicationRetryTask } from '../../src/jobs/tasks/ReplicationRetryTask';
import { BaseBackupManager } from '../../src/managers/BaseBackupManager';
import { Job } from '../../src/jobs/JobQueue';

jest.mock('../../src/managers/BaseBackupManager');
jest.mock('../../src/utils/logger', () => ({
	logger: {
		info: jest.fn(),
		error: jest.fn(),
		warn: jest.fn(),
	},
	planLogger: jest.fn().mockReturnValue({
		info: jest.fn(),
		error: jest.fn(),
		warn: jest.fn(),
	}),
}));

const createJob = (payload: any): Job => ({
	id: 'job-1',
	name: 'ReplicationRetry',
	payload,
	attempts: 0,
	maxAttempts: 3,
	retryDelay: 1000,
	lastAttempt: 0,
});

describe('ReplicationRetryTask', () => {
	let task: ReplicationRetryTask;
	let mockBackupManager: jest.Mocked<BaseBackupManager>;

	beforeEach(() => {
		jest.clearAllMocks();
		mockBackupManager = new BaseBackupManager() as jest.Mocked<BaseBackupManager>;
		mockBackupManager.retryFailedReplications = jest.fn().mockResolvedValue(undefined);
		task = new ReplicationRetryTask(mockBackupManager);
	});

	it('should have the correct task name', () => {
		expect(task.name).toBe('ReplicationRetry');
	});

	describe('run', () => {
		it('should call retryFailedReplications with the correct arguments', async () => {
			const job = createJob({
				planId: 'plan-1',
				backupId: 'backup-1',
				failedReplicationIds: ['rep-1', 'rep-2'],
			});

			await task.run(job);

			expect(mockBackupManager.retryFailedReplications).toHaveBeenCalledWith('plan-1', 'backup-1', [
				'rep-1',
				'rep-2',
			]);
		});

		it('should throw an error if planId is missing', async () => {
			const job = createJob({ backupId: 'backup-1' });
			await expect(task.run(job)).rejects.toThrow('Missing planId or backupId in job payload');
		});

		it('should throw an error if backupId is missing', async () => {
			const job = createJob({ planId: 'plan-1' });
			await expect(task.run(job)).rejects.toThrow('Missing planId or backupId in job payload');
		});

		it('should throw an error if payload is null', async () => {
			const job = createJob(null);
			await expect(task.run(job)).rejects.toThrow('Missing planId or backupId in job payload');
		});

		it('should propagate errors from retryFailedReplications', async () => {
			mockBackupManager.retryFailedReplications.mockRejectedValue(
				new Error('Replication retry failed')
			);

			const job = createJob({
				planId: 'plan-1',
				backupId: 'backup-1',
				failedReplicationIds: ['rep-1'],
			});

			await expect(task.run(job)).rejects.toThrow('Replication retry failed');
		});
	});
});
