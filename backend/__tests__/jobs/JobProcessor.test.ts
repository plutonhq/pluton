// Mock dependencies
const mockLogger = {
	info: jest.fn(),
	debug: jest.fn(),
	error: jest.fn(),
	warn: jest.fn(),
};

const mockConfigService = {
	config: {
		MAX_CONCURRENT_BACKUPS: 2,
	},
};

let mockUid = 0;
jest.mock('../../src/utils/helpers', () => ({
	generateUID: () => `uid-${++mockUid}`,
}));

jest.mock('../../src/utils/logger', () => ({
	logger: mockLogger,
	cronLogger: mockLogger,
}));

jest.mock('../../src/jobs/SystemTaskManager', () => ({
	SystemTaskManager: { isSystemJob: (name: string) => name === 'SelfBackup' },
}));

jest.mock('../../src/services/ConfigService', () => ({
	configService: mockConfigService,
}));

import { jobProcessor } from '../../src/jobs/JobProcessor';
import { jobQueue, Job } from '../../src/jobs/JobQueue';
import { Task } from '../../src/jobs/tasks/AbstractTask';

async function flush(): Promise<void> {
	for (let i = 0; i < 20; i++) await Promise.resolve();
}

// Runs one processor tick and lets the started jobs settle.
async function processOneJob(): Promise<void> {
	(jobProcessor as any).processQueue();
	await flush();
}

function deferred() {
	let resolve!: () => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<void>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

class MockTask extends Task {
	name = 'MockTask';
	executeFunc: jest.Mock;

	constructor(name: string, executeFunc: jest.Mock, isBackup = false) {
		super();
		this.name = name;
		this.executeFunc = executeFunc;
		this.isBackup = isBackup;
	}

	async run(job?: Job): Promise<void> {
		return this.executeFunc(job);
	}
}

// Puts a job straight into the queue, so tests control every field.
function queueJob(name: string, payload: any = {}, overrides: Partial<Job> = {}): Job {
	const job: Job = {
		id: `${name}-${payload.planId ?? 'none'}-${++mockUid}`,
		name,
		payload,
		attempts: 0,
		maxAttempts: 3,
		retryDelay: 60000,
		lastAttempt: 0,
		...overrides,
	};
	jobQueue.reQueue(job);
	return job;
}

const runningNames = () => jobQueue.getRunning().map(j => `${j.name}:${j.payload?.planId}`);

describe('JobProcessor', () => {
	let mockTask: MockTask;
	let mockExecute: jest.Mock;

	beforeEach(() => {
		jest.clearAllMocks();
		jest.restoreAllMocks();
		jest.useFakeTimers();

		mockExecute = jest.fn().mockResolvedValue(undefined);
		mockTask = new MockTask('TestTask', mockExecute);
		mockConfigService.config.MAX_CONCURRENT_BACKUPS = 2;

		// Reset processor state
		jobProcessor.stop();

		// Clear tasks map - access private property for testing
		(jobProcessor as any).tasks = new Map();
		(jobProcessor as any).intervalId = null;

		(jobQueue as any).queue = [];
		(jobQueue as any).running = new Map();
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

	describe('processing log level', () => {
		it('logs system jobs at debug level', async () => {
			jobProcessor.addTask(new MockTask('SelfBackup', mockExecute));
			queueJob('SelfBackup');

			await processOneJob();

			expect(mockLogger.debug).toHaveBeenCalledWith(
				{ module: 'JobProcessor' },
				'Processing job: SelfBackup. Active backups: 0'
			);
			expect(mockLogger.info).not.toHaveBeenCalledWith(
				{ module: 'JobProcessor' },
				expect.stringContaining('Processing job')
			);
		});

		it('logs other jobs at info level', async () => {
			jobProcessor.addTask(mockTask);
			queueJob('TestTask');

			await processOneJob();

			expect(mockLogger.info).toHaveBeenCalledWith(
				{ module: 'JobProcessor' },
				'Processing job: TestTask. Active backups: 0'
			);
			expect(mockLogger.debug).not.toHaveBeenCalled();
		});
	});

	describe('registerTasks', () => {
		it('registers tasks with dependencies', () => {
			const mockBackupManager = {} as any;
			const mockRestoreManager = {} as any;

			jobProcessor.registerTasks({
				backupManager: mockBackupManager,
				restoreManager: mockRestoreManager,
			});

			expect(Array.from((jobProcessor as any).tasks.keys())).toEqual([
				'CleanDownloads',
				'Backup',
				'ReplicationRetry',
				'Restore',
			]);
		});

		it('marks only the Backup task as a backup task', () => {
			jobProcessor.registerTasks({ backupManager: {} as any, restoreManager: {} as any });

			const tasks: Map<string, Task> = (jobProcessor as any).tasks;
			const backupTasks = [...tasks.values()].filter(t => t.isBackup).map(t => t.name);
			expect(backupTasks).toEqual(['Backup']);
		});

		it('registers only CleanDownloadsTask without dependencies', () => {
			jobProcessor.registerTasks({});

			expect(Array.from((jobProcessor as any).tasks.keys())).toEqual(['CleanDownloads']);
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
			const getNextSpy = jest.spyOn(jobQueue, 'getNext');
			jobProcessor.addTask(mockTask);
			jobProcessor.start(3000);

			jest.advanceTimersByTime(3000);
			expect(getNextSpy).toHaveBeenCalled();
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
			const getNextSpy = jest.spyOn(jobQueue, 'getNext');
			jobProcessor.addTask(mockTask);
			jobProcessor.start(1000);

			jest.advanceTimersByTime(1000);
			expect(getNextSpy).toHaveBeenCalledTimes(1);

			jest.advanceTimersByTime(1000);
			expect(getNextSpy).toHaveBeenCalledTimes(2);
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
			const completeSpy = jest.spyOn(jobQueue, 'completeJob');
			jobProcessor.addTask(mockTask);
			const job = queueJob('TestTask', { data: 'test' });

			await processOneJob();

			expect(mockExecute).toHaveBeenCalledWith(job);
			expect(completeSpy).toHaveBeenCalledWith(job);
			expect(jobQueue.getRunning()).toEqual([]);
		});

		it('logs error when task not registered', async () => {
			queueJob('UnknownTask', {}, { maxAttempts: 1 });

			await processOneJob();

			expect(mockLogger.error).toHaveBeenCalledWith(
				{ module: 'JobProcessor' },
				expect.stringContaining('No task registered')
			);
			expect(jobQueue.getRunning()).toEqual([]);
		});

		it('handles job failure and retries', async () => {
			const failSpy = jest.spyOn(jobQueue, 'failJob');
			mockExecute.mockRejectedValueOnce(new Error('Task failed'));
			jobProcessor.addTask(mockTask);
			const job = queueJob('TestTask');

			await processOneJob();

			expect(mockLogger.error).toHaveBeenCalledWith(
				{ module: 'JobProcessor', job: 'TestTask', error: 'Task failed' },
				expect.stringContaining('Job failed')
			);
			expect(failSpy).toHaveBeenCalledWith(job);
			expect(jobQueue.getRunning()).toEqual([]);
			expect(jobQueue.hasPending('TestTask')).toBe(true);
		});

		it('emits failure event on permanent failure', async () => {
			mockExecute.mockRejectedValueOnce(new Error('Permanent failure'));
			const emitSpy = jest.spyOn(jobProcessor, 'emit');
			jobProcessor.addTask(mockTask);
			queueJob('TestTask', { planId: 'plan-1' }, { attempts: 2 });

			await processOneJob();

			expect(emitSpy).toHaveBeenCalledWith('testtask_failed', {
				planId: 'plan-1',
				error: 'Permanent failure',
			});
		});

		it('does not retry a non-retryable error and fails immediately', async () => {
			// Error tagged as non-retryable (e.g. restic wrong-password exit code 12).
			const nonRetryableError = Object.assign(new Error('wrong password'), {
				code: 12,
				retryable: false,
			});

			const backupTask = new MockTask('Backup', jest.fn(), true);
			backupTask.executeFunc.mockRejectedValueOnce(nonRetryableError);

			const failSpy = jest.spyOn(jobQueue, 'failJob');
			const completeSpy = jest.spyOn(jobQueue, 'completeJob');
			const emitSpy = jest.spyOn(jobProcessor, 'emit');
			jobProcessor.addTask(backupTask);
			const job = queueJob('Backup', { planId: 'plan-1', backupId: 'backup-1' }, { maxAttempts: 5 });

			await processOneJob();

			// Must NOT go through the retry path.
			expect(failSpy).not.toHaveBeenCalled();
			// Job is cleared without re-queuing.
			expect(completeSpy).toHaveBeenCalledWith(job);
			expect(jobQueue.hasPending('Backup')).toBe(false);
			// A warning is logged and a permanent failure is emitted immediately.
			expect(mockLogger.warn).toHaveBeenCalledWith(
				{ module: 'JobProcessor', job: 'Backup' },
				expect.stringContaining('non-retryable')
			);
			expect(emitSpy).toHaveBeenCalledWith('backup_failed', {
				planId: 'plan-1',
				backupId: 'backup-1',
				error: 'wrong password',
			});
		});

		it('still retries a retryable error (retryable !== false)', async () => {
			// Error tagged as retryable (e.g. restic lock-failed exit code 11).
			const retryableError = Object.assign(new Error('unable to lock repository'), {
				code: 11,
				retryable: true,
			});

			const backupTask = new MockTask('Backup', jest.fn(), true);
			backupTask.executeFunc.mockRejectedValueOnce(retryableError);
			const failSpy = jest.spyOn(jobQueue, 'failJob');
			jobProcessor.addTask(backupTask);
			const job = queueJob('Backup', { planId: 'plan-1' }, { maxAttempts: 5 });

			await processOneJob();

			expect(failSpy).toHaveBeenCalledWith(job);
		});

		it('waits for the retry delay before it runs a job again', async () => {
			jobProcessor.addTask(mockTask);
			queueJob('TestTask', {}, { attempts: 1, retryDelay: 10000, lastAttempt: Date.now() });

			await processOneJob();
			expect(mockExecute).not.toHaveBeenCalled();
			expect(jobQueue.hasPending('TestTask')).toBe(true);

			jest.advanceTimersByTime(10000);
			await processOneJob();
			expect(mockExecute).toHaveBeenCalledTimes(1);
		});

		it('handles backup cancellation gracefully', async () => {
			const backupTask = new MockTask('Backup', jest.fn(), true);
			backupTask.executeFunc.mockRejectedValueOnce(new Error('BACKUP_CANCELLED: User cancelled'));
			const completeSpy = jest.spyOn(jobQueue, 'completeJob');
			jobProcessor.addTask(backupTask);
			const job = queueJob('Backup', { planId: 'plan-1' });

			await processOneJob();

			expect(mockLogger.info).toHaveBeenCalledWith(
				{ module: 'JobProcessor', job: 'Backup' },
				'Job was cancelled by user'
			);
			expect(completeSpy).toHaveBeenCalledWith(job);
		});

		it('handles restore cancellation gracefully', async () => {
			const restoreTask = new MockTask('Restore', jest.fn());
			restoreTask.executeFunc.mockRejectedValueOnce(new Error('RESTORE_CANCELLED: User cancelled'));
			jobProcessor.addTask(restoreTask);
			queueJob('Restore');

			await processOneJob();

			expect(mockLogger.info).toHaveBeenCalledWith(
				{ module: 'JobProcessor', job: 'Restore' },
				'Job was cancelled by user'
			);
			expect(jobQueue.getRunning()).toEqual([]);
		});
	});

	describe('concurrency', () => {
		let backupRuns: Map<string, ReturnType<typeof deferred>>;
		let backupExecute: jest.Mock;
		let restoreExecute: jest.Mock;

		// Each started job waits until the test resolves or rejects it.
		const blockingExecute = (runs: Map<string, ReturnType<typeof deferred>>) =>
			jest.fn((job: Job) => {
				const run = deferred();
				runs.set(job.payload.planId, run);
				return run.promise;
			});

		beforeEach(() => {
			backupRuns = new Map();
			backupExecute = blockingExecute(backupRuns);
			restoreExecute = blockingExecute(backupRuns);
			jobProcessor.addTask(new MockTask('Backup', backupExecute, true));
			jobProcessor.addTask(new MockTask('Restore', restoreExecute));
		});

		it('with MAX=2 starts two backups in one tick and the third after one finishes', async () => {
			queueJob('Backup', { planId: 'p1' });
			queueJob('Backup', { planId: 'p2' });
			queueJob('Backup', { planId: 'p3' });

			await processOneJob();

			expect(runningNames()).toEqual(['Backup:p1', 'Backup:p2']);
			expect(backupExecute).toHaveBeenCalledTimes(2);
			expect(jobProcessor.getActiveBackupJobs()).toBe(2);

			await processOneJob();
			expect(backupExecute).toHaveBeenCalledTimes(2);

			backupRuns.get('p1')!.resolve();
			await flush();
			await processOneJob();

			expect(runningNames()).toEqual(['Backup:p2', 'Backup:p3']);
			expect(backupExecute).toHaveBeenCalledTimes(3);
		});

		it('with MAX=1 starts only one backup', async () => {
			mockConfigService.config.MAX_CONCURRENT_BACKUPS = 1;
			queueJob('Backup', { planId: 'p1' });
			queueJob('Backup', { planId: 'p2' });

			await processOneJob();

			expect(runningNames()).toEqual(['Backup:p1']);
			expect(jobProcessor.getActiveBackupJobs()).toBe(1);
		});

		it('never runs two jobs of the same plan together', async () => {
			queueJob('Backup', { planId: 'p1' });
			queueJob('Restore', { planId: 'p1' });
			queueJob('Backup', { planId: 'p1', backupId: 'second' });

			await processOneJob();

			expect(runningNames()).toEqual(['Backup:p1']);
			expect(restoreExecute).not.toHaveBeenCalled();

			backupRuns.get('p1')!.resolve();
			await flush();
			await processOneJob();

			expect(runningNames()).toEqual(['Restore:p1']);
			expect(backupExecute).toHaveBeenCalledTimes(1);
		});

		it('runs only one non-backup job at a time, beside backup jobs', async () => {
			queueJob('Restore', { planId: 'p1' });
			queueJob('Restore', { planId: 'p2' });
			queueJob('Backup', { planId: 'p3' });

			await processOneJob();

			expect(runningNames()).toEqual(['Restore:p1', 'Backup:p3']);

			backupRuns.get('p1')!.resolve();
			await flush();
			await processOneJob();

			expect(runningNames()).toEqual(['Backup:p3', 'Restore:p2']);
		});

		it('does not let a job in its retry delay block a later job', async () => {
			queueJob('Backup', { planId: 'p1' }, { attempts: 1, retryDelay: 10000, lastAttempt: Date.now() });
			queueJob('Backup', { planId: 'p2' });

			await processOneJob();

			expect(runningNames()).toEqual(['Backup:p2']);

			jest.advanceTimersByTime(10000);
			await processOneJob();

			expect(runningNames()).toEqual(['Backup:p2', 'Backup:p1']);
		});

		it.each([
			['a cancel error', new Error('BACKUP_CANCELLED: User cancelled'), 3],
			['a non-retryable error', Object.assign(new Error('wrong password'), { retryable: false }), 3],
			['a permanent failure', new Error('boom'), 1],
		])('frees the slot after %s', async (_label, error, maxAttempts) => {
			mockConfigService.config.MAX_CONCURRENT_BACKUPS = 1;
			queueJob('Backup', { planId: 'p1' }, { maxAttempts });
			queueJob('Backup', { planId: 'p2' });

			await processOneJob();
			expect(runningNames()).toEqual(['Backup:p1']);

			backupRuns.get('p1')!.reject(error);
			await flush();

			expect(jobProcessor.getActiveBackupJobs()).toBe(0);
			expect(jobQueue.hasPending('Backup')).toBe(true);

			await processOneJob();
			expect(runningNames()).toEqual(['Backup:p2']);
		});

		it('getActiveBackupJobs counts only backup tasks', async () => {
			jobProcessor.addTask(new MockTask('VmBackup', blockingExecute(backupRuns), true));
			queueJob('Restore', { planId: 'p1' });
			queueJob('VmBackup', { planId: 'p2' });
			queueJob('Backup', { planId: 'p3' });

			await processOneJob();

			expect(jobQueue.getRunning()).toHaveLength(3);
			expect(jobProcessor.getActiveBackupJobs()).toBe(2);

			backupRuns.get('p2')!.resolve();
			backupRuns.get('p3')!.resolve();
			await flush();

			expect(jobProcessor.getActiveBackupJobs()).toBe(0);
		});
	});
});
