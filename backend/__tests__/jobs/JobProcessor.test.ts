// Mock dependencies
const mockJobQueueGetNext = jest.fn();
const mockJobQueueReQueue = jest.fn();
const mockJobQueueRequeueAtFront = jest.fn();
const mockJobQueueCompleteJob = jest.fn();
const mockJobQueueFailJob = jest.fn();

const mockLogger = {
	info: jest.fn(),
	error: jest.fn(),
	warn: jest.fn(),
};

const mockConfigService = {
	config: {
		MAX_CONCURRENT_BACKUPS: 2,
	},
};

jest.mock('../../src/jobs/JobQueue', () => ({
	jobQueue: {
		getNext: () => mockJobQueueGetNext(),
		reQueue: (job: any) => mockJobQueueReQueue(job),
		requeueAtFront: (job: any) => mockJobQueueRequeueAtFront(job),
		completeJob: () => mockJobQueueCompleteJob(),
		failJob: (job: any) => mockJobQueueFailJob(job),
	},
}));

jest.mock('../../src/utils/logger', () => ({
	logger: mockLogger,
}));

jest.mock('../../src/services/ConfigService', () => ({
	configService: mockConfigService,
}));

import { jobProcessor } from '../../src/jobs/JobProcessor';
import { Job } from '../../src/jobs/JobQueue';
import { Task } from '../../src/jobs/tasks/AbstractTask';

// Helper function to process one cycle of the job processor
async function processOneJob(): Promise<void> {
	// Manually call the private processQueue method
	await (jobProcessor as any).processQueue();
}

class MockTask extends Task {
	name = 'MockTask';
	executeFunc: jest.Mock;

	constructor(name: string, executeFunc: jest.Mock) {
		super();
		this.name = name;
		this.executeFunc = executeFunc;
	}

	async run(job?: Job): Promise<void> {
		return this.executeFunc(job);
	}
}

describe('JobProcessor', () => {
	let mockTask: MockTask;
	let mockExecute: jest.Mock;

	beforeEach(() => {
		jest.clearAllMocks();
		jest.useFakeTimers();

		mockExecute = jest.fn().mockResolvedValue(undefined);
		mockTask = new MockTask('TestTask', mockExecute);

		// Reset processor state
		jobProcessor.stop();

		// Clear tasks map - access private property for testing
		(jobProcessor as any).tasks = new Map();
		(jobProcessor as any).activeBackupJobs = 0;
		(jobProcessor as any).isRunning = false;
		(jobProcessor as any).intervalId = null;

		mockJobQueueGetNext.mockReturnValue(null);
		mockJobQueueFailJob.mockReturnValue(false);
		mockJobQueueCompleteJob.mockReturnValue(undefined);
		mockJobQueueReQueue.mockReturnValue(undefined);
		mockJobQueueRequeueAtFront.mockReturnValue(undefined);
	});

	afterEach(async () => {
		jobProcessor.stop();
		jest.useRealTimers();
	});

	describe('getInstance', () => {
		it('returns singleton instance', () => {
			const instance1 = jobProcessor;
			const instance2 = jobProcessor;
			expect(instance1).toBe(instance2);
		});
	});

	describe('registerTasks', () => {
		it('registers tasks with dependencies', () => {
			const mockBackupManager = {} as any;
			const mockRestoreManager = {} as any;

			const logSpy = jest.spyOn(console, 'log').mockImplementation();

			jobProcessor.registerTasks({
				backupManager: mockBackupManager,
				restoreManager: mockRestoreManager,
			});

			// Should log registered tasks (CleanDownloads, Backup, Restore)
			expect(logSpy).toHaveBeenCalled();

			logSpy.mockRestore();
		});

		it('registers only CleanDownloadsTask without dependencies', () => {
			const logSpy = jest.spyOn(console, 'log').mockImplementation();

			jobProcessor.registerTasks({});

			expect(logSpy).toHaveBeenCalledWith('🎀 task :', 'CleanDownloads');

			logSpy.mockRestore();
		});
	});

	describe('addTask', () => {
		it('adds task to processor', () => {
			jobProcessor.addTask(mockTask);
			expect(mockLogger.warn).not.toHaveBeenCalled();
		});

		it('warns when overwriting existing task', () => {
			jobProcessor.addTask(mockTask);
			jobProcessor.addTask(mockTask);

			expect(mockLogger.warn).toHaveBeenCalledWith(
				{ module: 'JobProcessor', task: 'TestTask' },
				expect.stringContaining('already registered')
			);
		});
	});

	describe('start', () => {
		it('starts job processor with default interval', () => {
			jobProcessor.addTask(mockTask);
			jobProcessor.start();

			expect(mockLogger.info).toHaveBeenCalledWith(
				{ module: 'JobProcessor' },
				'Starting job processor.'
			);
		});

		it('starts with custom interval', () => {
			jobProcessor.addTask(mockTask);
			jobProcessor.start(3000);

			jest.advanceTimersByTime(3000);
			expect(mockJobQueueGetNext).toHaveBeenCalled();
		});

		it('warns when already running', () => {
			jobProcessor.addTask(mockTask);
			jobProcessor.start();
			jobProcessor.start();

			expect(mockLogger.warn).toHaveBeenCalledWith(
				{ module: 'JobProcessor' },
				'Job processor is already running.'
			);
		});

		it('warns when no tasks registered', () => {
			jobProcessor.start();

			expect(mockLogger.warn).toHaveBeenCalledWith(
				{ module: 'JobProcessor' },
				'No tasks registered. Job processor will not start.'
			);
		});

		it('processes queue at specified interval', () => {
			jobProcessor.addTask(mockTask);
			jobProcessor.start(1000);

			jest.advanceTimersByTime(1000);
			expect(mockJobQueueGetNext).toHaveBeenCalledTimes(1);

			jest.advanceTimersByTime(1000);
			expect(mockJobQueueGetNext).toHaveBeenCalledTimes(2);
		});
	});

	describe('stop', () => {
		it('stops job processor', () => {
			jobProcessor.addTask(mockTask);
			jobProcessor.start();
			jobProcessor.stop();

			expect(mockLogger.info).toHaveBeenCalledWith(
				{ module: 'JobProcessor' },
				'Stopped job processor.'
			);
		});

		it('does nothing if not running', () => {
			jobProcessor.stop();
			expect(mockLogger.info).not.toHaveBeenCalled();
		});
	});

	describe('processQueue', () => {
		it('does nothing when no jobs in queue', async () => {
			jobProcessor.addTask(mockTask);
			jobProcessor.start();

			jest.advanceTimersByTime(5000);

			expect(mockExecute).not.toHaveBeenCalled();
		});

		it('processes job successfully', async () => {
			const job: Job = {
				id: 'job-1',
				name: 'TestTask',
				payload: { data: 'test' },
				attempts: 0,
				maxAttempts: 3,
				retryDelay: 60000,
				lastAttempt: 0,
			};

			mockJobQueueGetNext.mockReturnValueOnce(job).mockReturnValue(null);
			mockExecute.mockResolvedValueOnce(undefined);

			jobProcessor.addTask(mockTask);

			await processOneJob();

			expect(mockExecute).toHaveBeenCalledWith(job);
			expect(mockJobQueueCompleteJob).toHaveBeenCalled();
		});
		it('logs error when task not registered', async () => {
			const job: Job = {
				id: 'job-1',
				name: 'UnknownTask',
				payload: {},
				attempts: 0,
				maxAttempts: 3,
				retryDelay: 60000,
				lastAttempt: 0,
			};

			mockJobQueueGetNext.mockReturnValueOnce(job).mockReturnValue(null);
			mockJobQueueFailJob.mockReturnValueOnce(true);

			await processOneJob();

			expect(mockLogger.error).toHaveBeenCalledWith(
				{ module: 'JobProcessor' },
				expect.stringContaining('No task registered')
			);
		});

		it('handles job failure and retries', async () => {
			const job: Job = {
				id: 'job-1',
				name: 'TestTask',
				payload: {},
				attempts: 0,
				maxAttempts: 3,
				retryDelay: 60000,
				lastAttempt: 0,
			};

			mockJobQueueGetNext.mockReturnValueOnce(job).mockReturnValue(null);
			mockExecute.mockRejectedValueOnce(new Error('Task failed'));
			mockJobQueueFailJob.mockReturnValueOnce(false);

			jobProcessor.addTask(mockTask);

			await processOneJob();

			expect(mockLogger.error).toHaveBeenCalledWith(
				{ module: 'JobProcessor', job: 'TestTask', error: 'Task failed' },
				expect.stringContaining('Job failed')
			);
			expect(mockJobQueueFailJob).toHaveBeenCalledWith(job);
		});

		it('emits failure event on permanent failure', async () => {
			const job: Job = {
				id: 'job-1',
				name: 'TestTask',
				payload: { planId: 'plan-1' },
				attempts: 2,
				maxAttempts: 3,
				retryDelay: 60000,
				lastAttempt: 0,
			};

			mockJobQueueGetNext.mockReturnValueOnce(job).mockReturnValue(null);
			mockExecute.mockRejectedValueOnce(new Error('Permanent failure'));
			mockJobQueueFailJob.mockReturnValueOnce(true);

			const emitSpy = jest.spyOn(jobProcessor, 'emit');

			jobProcessor.addTask(mockTask);

			await processOneJob();

			expect(emitSpy).toHaveBeenCalledWith('testtask_failed', {
				planId: 'plan-1',
				error: 'Permanent failure',
			});
		});

		it('delays retry based on retryDelay', async () => {
			const job: Job = {
				id: 'job-1',
				name: 'TestTask',
				payload: {},
				attempts: 1,
				maxAttempts: 3,
				retryDelay: 10000,
				lastAttempt: Date.now(),
			};

			mockJobQueueGetNext.mockReturnValueOnce(job).mockReturnValue(null);

			jobProcessor.addTask(mockTask);

			await processOneJob();

			expect(mockLogger.info).toHaveBeenCalledWith(
				{ module: 'JobProcessor' },
				expect.stringContaining('Delaying retry')
			);
			expect(mockJobQueueReQueue).toHaveBeenCalledWith(job);
		});

		it('enforces backup concurrency limit', async () => {
			const job: Job = {
				id: 'job-1',
				name: 'Backup',
				payload: {},
				attempts: 0,
				maxAttempts: 3,
				retryDelay: 60000,
				lastAttempt: 0,
			};

			// Set active backups to max
			(jobProcessor as any).activeBackupJobs = 2;

			mockJobQueueGetNext.mockReturnValueOnce(job).mockReturnValue(null);

			await processOneJob();

			expect(mockJobQueueRequeueAtFront).toHaveBeenCalledWith(job);
			expect(mockExecute).not.toHaveBeenCalled();
		});

		it('handles backup cancellation gracefully', async () => {
			const job: Job = {
				id: 'job-1',
				name: 'Backup',
				payload: { planId: 'plan-1' },
				attempts: 0,
				maxAttempts: 3,
				retryDelay: 60000,
				lastAttempt: 0,
			};

			const backupTask = new MockTask('Backup', jest.fn());
			backupTask.executeFunc.mockRejectedValueOnce(new Error('BACKUP_CANCELLED: User cancelled'));

			mockJobQueueGetNext.mockReturnValueOnce(job).mockReturnValue(null);

			jobProcessor.addTask(backupTask);

			await processOneJob();

			expect(mockLogger.info).toHaveBeenCalledWith(
				{ module: 'JobProcessor', job: 'Backup' },
				'Job was cancelled by user'
			);
			expect(mockJobQueueCompleteJob).toHaveBeenCalled();
		});

		it('handles restore cancellation gracefully', async () => {
			const job: Job = {
				id: 'job-1',
				name: 'Restore',
				payload: {},
				attempts: 0,
				maxAttempts: 3,
				retryDelay: 60000,
				lastAttempt: 0,
			};

			const restoreTask = new MockTask('Restore', jest.fn());
			restoreTask.executeFunc.mockRejectedValueOnce(new Error('RESTORE_CANCELLED: User cancelled'));

			mockJobQueueGetNext.mockReturnValueOnce(job).mockReturnValue(null);

			jobProcessor.addTask(restoreTask);

			await processOneJob();

			expect(mockLogger.info).toHaveBeenCalledWith(
				{ module: 'JobProcessor', job: 'Restore' },
				'Job was cancelled by user'
			);
		});

		it('increments and decrements backup counter', async () => {
			const job: Job = {
				id: 'job-1',
				name: 'Backup',
				payload: {},
				attempts: 0,
				maxAttempts: 3,
				retryDelay: 60000,
				lastAttempt: 0,
			};

			const backupTask = new MockTask('Backup', jest.fn().mockResolvedValue(undefined));

			mockJobQueueGetNext.mockReturnValueOnce(job).mockReturnValue(null);

			jobProcessor.addTask(backupTask);

			expect((jobProcessor as any).activeBackupJobs).toBe(0);

			await processOneJob();

			expect((jobProcessor as any).activeBackupJobs).toBe(0);
		});
	});
});
