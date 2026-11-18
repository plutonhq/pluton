jest.mock('../../../src/utils/logger', () => ({
	cronLogger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
	logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
}));

import { SelfBackupTask } from '../../../src/jobs/tasks/SelfBackupTask';
import { Job } from '../../../src/jobs/JobQueue';

function makeJob(payload?: any, attempts = 0): Job {
	return {
		id: 'job-1',
		name: 'SelfBackup',
		payload,
		attempts,
		maxAttempts: 3,
		retryDelay: 600000,
		lastAttempt: 0,
	};
}

describe('SelfBackupTask', () => {
	let service: { isDue: jest.Mock; run: jest.Mock };
	let task: SelfBackupTask;

	beforeEach(() => {
		service = {
			isDue: jest.fn().mockResolvedValue(false),
			run: jest.fn().mockResolvedValue({ status: 'uploaded', blobName: 'b.pluton' }),
		};
		task = new SelfBackupTask(service as any);
	});

	it('registers under the name the system job entry uses', () => {
		// A mismatch here yields "No task registered for job name" and a permanent fail.
		expect(task.name).toBe('SelfBackup');
	});

	it('does not run when the interval gate says it is not due', async () => {
		await task.run(makeJob());
		expect(service.run).not.toHaveBeenCalled();
	});

	it('runs when due', async () => {
		service.isDue.mockResolvedValue(true);
		await task.run(makeJob());
		expect(service.run).toHaveBeenCalledWith({ force: false, isLastAttempt: false });
	});

	it('force in the payload bypasses the gate entirely', async () => {
		service.isDue.mockResolvedValue(false);
		await task.run(makeJob({ force: true }));

		expect(service.isDue).not.toHaveBeenCalled();
		expect(service.run).toHaveBeenCalledWith({ force: true, isLastAttempt: false });
	});

	it('tolerates a job with no payload (the cron tick)', async () => {
		service.isDue.mockResolvedValue(true);
		await task.run(makeJob(undefined));
		expect(service.run).toHaveBeenCalledWith({ force: false, isLastAttempt: false });
	});

	it('marks the final attempt so only that one sends the failure email', async () => {
		await task.run(makeJob(undefined, 2));
		expect(service.run).toHaveBeenCalledWith({ force: false, isLastAttempt: true });
	});

	it('a retry skips the interval gate, which the failed attempt already moved', async () => {
		service.isDue.mockResolvedValue(false);
		await task.run(makeJob(undefined, 1));

		expect(service.isDue).not.toHaveBeenCalled();
		expect(service.run).toHaveBeenCalledWith({ force: false, isLastAttempt: false });
	});

	it('propagates a failure so JobQueue retries', async () => {
		service.isDue.mockResolvedValue(true);
		service.run.mockRejectedValue(new Error('upload failed'));
		await expect(task.run(makeJob())).rejects.toThrow('upload failed');
	});
});
