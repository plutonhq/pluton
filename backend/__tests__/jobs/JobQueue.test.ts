// Mock dependencies
const mockGenerateUID = jest.fn();
const mockCronLogger = {
	error: jest.fn(),
	warn: jest.fn(),
	info: jest.fn(),
};

jest.mock('../../src/utils/helpers', () => ({
	generateUID: () => mockGenerateUID(),
}));

jest.mock('../../src/utils/logger', () => ({
	cronLogger: mockCronLogger,
}));

import { jobQueue as jobQueueInstance, Job } from '../../src/jobs/JobQueue';

describe('JobQueue', () => {
	let jobQueue: typeof jobQueueInstance;
	let uidCounter: number;

	const anyJob = () => true;
	const next = () => jobQueue.getNext(anyJob);
	const runningNames = () => jobQueue.getRunning().map(j => j.name);

	beforeEach(() => {
		jest.clearAllMocks();
		uidCounter = 0;
		mockGenerateUID.mockImplementation(() => {
			uidCounter++;
			return `uid-${uidCounter}`;
		});

		// Get the singleton instance
		jobQueue = jobQueueInstance;

		// Clear the queue state - access private properties for testing
		(jobQueue as any).queue = [];
		(jobQueue as any).running = new Map();
	});

	describe('singleton instance', () => {
		it('is defined and ready to use', () => {
			expect(jobQueue).toBeDefined();
		});
	});

	describe('add', () => {
		it('adds job to queue with default parameters', () => {
			jobQueue.add('TestJob', { data: 'test' });

			const job = next();
			expect(job).toBeDefined();
			expect(job?.name).toBe('TestJob');
			expect(job?.payload).toEqual({ data: 'test' });
			expect(job?.maxAttempts).toBe(3);
			expect(job?.retryDelay).toBe(60000);
			expect(job?.attempts).toBe(0);
		});

		it('adds job with custom parameters', () => {
			jobQueue.add('CustomJob', { id: 1 }, 5, 120000);

			const job = next();
			expect(job?.maxAttempts).toBe(5);
			expect(job?.retryDelay).toBe(120000);
		});

		it('does not add duplicate job with same name and payload', () => {
			jobQueue.add('DuplicateJob', { id: 1 });
			jobQueue.add('DuplicateJob', { id: 1 });

			const job1 = next();
			const job2 = next();

			expect(job1).toBeDefined();
			expect(job2).toBeNull();
		});

		it('adds job with different payload as separate job', () => {
			jobQueue.add('Job', { id: 1 });
			jobQueue.add('Job', { id: 2 });

			const job1 = next();
			const job2 = next();

			expect(job1?.payload).toEqual({ id: 1 });
			expect(job2?.payload).toEqual({ id: 2 });
		});

		it('does not add job if same job is currently running', () => {
			jobQueue.add('RunningJob', { id: 1 });
			const runningJob = next();

			jobQueue.add('RunningJob', { id: 1 });
			const nextJob = next();

			expect(runningJob).toBeDefined();
			expect(nextJob).toBeNull();
		});

		it('adds the same job again after the running one completes', () => {
			jobQueue.add('RunningJob', { id: 1 });
			const first = next()!;
			jobQueue.completeJob(first);

			jobQueue.add('RunningJob', { id: 1 });

			expect(next()?.id).toBe('uid-2');
		});

		it('adds job without payload', () => {
			jobQueue.add('NoPayloadJob');

			const job = next();
			expect(job?.payload).toEqual({});
		});

		it('generates unique ID for each job', () => {
			jobQueue.add('Job1');
			jobQueue.add('Job2');

			const job1 = next();
			const job2 = next();

			expect(job1?.id).toBe('uid-1');
			expect(job2?.id).toBe('uid-2');
		});
	});

	describe('addPriorityJob', () => {
		it('adds job to front of queue', () => {
			jobQueue.add('NormalJob');
			jobQueue.addPriorityJob('PriorityJob');

			const job = next();
			expect(job?.name).toBe('PriorityJob');
		});

		it('does not add duplicate priority job', () => {
			jobQueue.addPriorityJob('PriorityJob', { id: 1 });
			jobQueue.addPriorityJob('PriorityJob', { id: 1 });

			const job1 = next();
			const job2 = next();

			expect(job1).toBeDefined();
			expect(job2).toBeNull();
		});

		it('adds priority job with custom parameters', () => {
			jobQueue.addPriorityJob('UrgentJob', { urgent: true }, 10, 30000);

			const job = next();
			expect(job?.maxAttempts).toBe(10);
			expect(job?.retryDelay).toBe(30000);
		});
	});

	describe('getNext', () => {
		it('returns null when queue is empty', () => {
			const job = next();
			expect(job).toBeNull();
		});

		it('returns first job from queue', () => {
			jobQueue.add('Job1');
			jobQueue.add('Job2');

			const job = next();
			expect(job?.name).toBe('Job1');
		});

		it('removes job from queue and marks it as running', () => {
			jobQueue.add('Job1');
			jobQueue.add('Job2');

			const job1 = next();
			const job2 = next();

			expect(job1?.name).toBe('Job1');
			expect(job2?.name).toBe('Job2');
			expect(runningNames()).toEqual(['Job1', 'Job2']);
			expect(next()).toBeNull();
		});

		it('skips a job the predicate rejects and takes a later one', () => {
			jobQueue.add('Job1');
			jobQueue.add('Job2');
			jobQueue.add('Job3');

			const job = jobQueue.getNext(j => j.name !== 'Job1');

			expect(job?.name).toBe('Job2');
			expect(runningNames()).toEqual(['Job2']);
			// Job1 stays at the head of the queue.
			expect(next()?.name).toBe('Job1');
		});

		it('returns null when the predicate rejects every job', () => {
			jobQueue.add('Job1');
			jobQueue.add('Job2');

			expect(jobQueue.getNext(() => false)).toBeNull();
			expect(jobQueue.getRunning()).toEqual([]);
			expect(jobQueue.hasPending('Job1')).toBe(true);
		});

		it('passes the running jobs to the predicate', () => {
			jobQueue.add('Job1');
			jobQueue.add('Job2');
			const job1 = next();

			const canStart = jest.fn(() => true);
			jobQueue.getNext(canStart);

			expect(canStart).toHaveBeenCalledWith(expect.objectContaining({ name: 'Job2' }), [job1]);
		});
	});

	describe('getRunning', () => {
		it('returns an empty list when no job runs', () => {
			expect(jobQueue.getRunning()).toEqual([]);
		});

		it('returns a copy that does not change the running jobs', () => {
			jobQueue.add('Job1');
			next();

			jobQueue.getRunning().pop();

			expect(runningNames()).toEqual(['Job1']);
		});
	});

	describe('hasPending', () => {
		it('sees a queued job', () => {
			jobQueue.add('Job1');
			expect(jobQueue.hasPending('Job1')).toBe(true);
		});

		it('sees a running job', () => {
			jobQueue.add('Job1');
			next();

			expect(jobQueue.hasPending('Job1')).toBe(true);
		});

		it('returns false after the job completes', () => {
			jobQueue.add('Job1');
			const job = next()!;
			jobQueue.completeJob(job);

			expect(jobQueue.hasPending('Job1')).toBe(false);
		});
	});

	describe('completeJob', () => {
		it('removes only the given running job', () => {
			jobQueue.add('Job1');
			jobQueue.add('Job2');
			const job1 = next()!;
			next();

			jobQueue.completeJob(job1);

			expect(runningNames()).toEqual(['Job2']);
		});

		it('does nothing if the job is not running', () => {
			jobQueue.add('Job1');
			next();
			const other = { id: 'other' } as Job;

			expect(() => jobQueue.completeJob(other)).not.toThrow();
			expect(runningNames()).toEqual(['Job1']);
		});
	});

	describe('reQueue', () => {
		it('adds job back to end of queue', () => {
			const job: Job = {
				id: 'test-1',
				name: 'TestJob',
				payload: {},
				attempts: 0,
				maxAttempts: 3,
				retryDelay: 60000,
				lastAttempt: 0,
			};

			jobQueue.add('AnotherJob');
			jobQueue.reQueue(job);

			const first = next();
			const second = next();

			expect(first?.name).toBe('AnotherJob');
			expect(second?.name).toBe('TestJob');
		});

		it('removes the job from the running jobs', () => {
			jobQueue.add('Job1');
			jobQueue.add('Job2');
			const job1 = next()!;
			next();

			jobQueue.reQueue(job1);

			expect(runningNames()).toEqual(['Job2']);
			expect(next()?.id).toBe(job1.id);
		});
	});

	describe('failJob', () => {
		it('re-queues job when attempts not exhausted', () => {
			const job: Job = {
				id: 'fail-1',
				name: 'FailJob',
				payload: { planId: 'plan-1' },
				attempts: 0,
				maxAttempts: 3,
				retryDelay: 60000,
				lastAttempt: 0,
			};

			const isPermanent = jobQueue.failJob(job);

			expect(isPermanent).toBe(false);
			expect(job.attempts).toBe(1);
			expect(job.lastAttempt).toBeGreaterThan(0);
		});

		it('marks job as permanently failed after max attempts', () => {
			const job: Job = {
				id: 'fail-2',
				name: 'FailJob',
				payload: { planId: 'plan-1' },
				attempts: 3,
				maxAttempts: 3,
				retryDelay: 60000,
				lastAttempt: 0,
			};

			const isPermanent = jobQueue.failJob(job);

			expect(isPermanent).toBe(true);
			expect(mockCronLogger.error).toHaveBeenCalledWith(expect.stringContaining("Job 'FailJob'"));
		});

		it('removes only that job from the running jobs on permanent failure', () => {
			jobQueue.add('FailJob', {}, 1);
			jobQueue.add('OtherJob');
			const job = next()!;
			next();

			const isPermanent = jobQueue.failJob(job);

			expect(isPermanent).toBe(true);
			expect(runningNames()).toEqual(['OtherJob']);
			expect(jobQueue.hasPending('FailJob')).toBe(false);
		});

		it('increments attempts before checking max', () => {
			const job: Job = {
				id: 'fail-4',
				name: 'FailJob',
				payload: {},
				attempts: 2,
				maxAttempts: 3,
				retryDelay: 60000,
				lastAttempt: 0,
			};

			jobQueue.failJob(job);

			expect(job.attempts).toBe(3);
		});

		it('fails permanently when the attempt count reaches maxAttempts (no off-by-one)', () => {
			const job: Job = {
				id: 'fail-boundary',
				name: 'FailJob',
				payload: {},
				attempts: 2,
				maxAttempts: 3,
				retryDelay: 60000,
				lastAttempt: 0,
			};

			// attempts 2 -> 3 == maxAttempts, so this is the final run, not a re-queue.
			const isPermanent = jobQueue.failJob(job);

			expect(job.attempts).toBe(3);
			expect(isPermanent).toBe(true);
		});

		it('sets lastAttempt timestamp', () => {
			const job: Job = {
				id: 'fail-5',
				name: 'FailJob',
				payload: {},
				attempts: 0,
				maxAttempts: 3,
				retryDelay: 60000,
				lastAttempt: 0,
			};

			const before = Date.now();
			jobQueue.failJob(job);
			const after = Date.now();

			expect(job.lastAttempt).toBeGreaterThanOrEqual(before);
			expect(job.lastAttempt).toBeLessThanOrEqual(after);
		});
	});

	describe('remove', () => {
		it('removes job from queue by name and planId', () => {
			jobQueue.add('Backup', { planId: 'plan-1' });
			jobQueue.add('Backup', { planId: 'plan-2' });

			const removed = jobQueue.remove('Backup', 'plan-1');

			expect(removed).toBe(true);

			const job = next();
			expect(job?.payload.planId).toBe('plan-2');
		});

		it('returns false when job not found', () => {
			jobQueue.add('Backup', { planId: 'plan-1' });

			const removed = jobQueue.remove('Backup', 'plan-999');

			expect(removed).toBe(false);
		});

		it('does not touch a running job', () => {
			jobQueue.add('Backup', { planId: 'plan-1' });
			next();

			const removed = jobQueue.remove('Backup', 'plan-1');

			expect(removed).toBe(false);
			expect(runningNames()).toEqual(['Backup']);
			expect(jobQueue.hasPending('Backup')).toBe(true);
		});

		it('removes a queued retry but keeps the running job of the same plan', () => {
			jobQueue.add('Backup', { planId: 'plan-1' });
			next();
			jobQueue.reQueue({
				id: 'retry-1',
				name: 'Backup',
				payload: { planId: 'plan-1', attempt: 2 },
				attempts: 1,
				maxAttempts: 3,
				retryDelay: 60000,
				lastAttempt: 0,
			});

			const removed = jobQueue.remove('Backup', 'plan-1');

			expect(removed).toBe(true);
			expect(runningNames()).toEqual(['Backup']);
			expect(next()).toBeNull();
		});

		it('does not remove job with different name', () => {
			jobQueue.add('Backup', { planId: 'plan-1' });
			jobQueue.add('Restore', { planId: 'plan-1' });

			const removed = jobQueue.remove('Backup', 'plan-1');

			expect(removed).toBe(true);

			const job = next();
			expect(job?.name).toBe('Restore');
		});

		it('handles removal when queue is empty', () => {
			const removed = jobQueue.remove('Backup', 'plan-1');
			expect(removed).toBe(false);
		});
	});
});
