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
		(jobQueue as any).runningJob = null;
	});

	describe('singleton instance', () => {
		it('is defined and ready to use', () => {
			expect(jobQueue).toBeDefined();
		});
	});

	describe('add', () => {
		it('adds job to queue with default parameters', () => {
			jobQueue.add('TestJob', { data: 'test' });

			const job = jobQueue.getNext();
			expect(job).toBeDefined();
			expect(job?.name).toBe('TestJob');
			expect(job?.payload).toEqual({ data: 'test' });
			expect(job?.maxAttempts).toBe(3);
			expect(job?.retryDelay).toBe(60000);
			expect(job?.attempts).toBe(0);
		});

		it('adds job with custom parameters', () => {
			jobQueue.add('CustomJob', { id: 1 }, 5, 120000);

			const job = jobQueue.getNext();
			expect(job?.maxAttempts).toBe(5);
			expect(job?.retryDelay).toBe(120000);
		});

		it('does not add duplicate job with same name and payload', () => {
			jobQueue.add('DuplicateJob', { id: 1 });
			jobQueue.add('DuplicateJob', { id: 1 });

			const job1 = jobQueue.getNext();
			const job2 = jobQueue.getNext();

			expect(job1).toBeDefined();
			expect(job2).toBeNull();
		});

		it('adds job with different payload as separate job', () => {
			jobQueue.add('Job', { id: 1 });
			jobQueue.add('Job', { id: 2 });

			const job1 = jobQueue.getNext();
			jobQueue.completeJob();
			const job2 = jobQueue.getNext();

			expect(job1?.payload).toEqual({ id: 1 });
			expect(job2?.payload).toEqual({ id: 2 });
		});

		it('does not add job if same job is currently running', () => {
			jobQueue.add('RunningJob', { id: 1 });
			const runningJob = jobQueue.getNext();

			jobQueue.add('RunningJob', { id: 1 });
			const nextJob = jobQueue.getNext();

			expect(runningJob).toBeDefined();
			expect(nextJob).toBeNull();
		});

		it('adds job without payload', () => {
			jobQueue.add('NoPayloadJob');

			const job = jobQueue.getNext();
			expect(job?.payload).toEqual({});
		});

		it('generates unique ID for each job', () => {
			jobQueue.add('Job1');
			jobQueue.add('Job2');

			const job1 = jobQueue.getNext();
			jobQueue.completeJob();
			const job2 = jobQueue.getNext();

			expect(job1?.id).toBe('uid-1');
			expect(job2?.id).toBe('uid-2');
		});
	});

	describe('addPriorityJob', () => {
		it('adds job to front of queue', () => {
			jobQueue.add('NormalJob');
			jobQueue.addPriorityJob('PriorityJob');

			const job = jobQueue.getNext();
			expect(job?.name).toBe('PriorityJob');
		});

		it('does not add duplicate priority job', () => {
			jobQueue.addPriorityJob('PriorityJob', { id: 1 });
			jobQueue.addPriorityJob('PriorityJob', { id: 1 });

			const job1 = jobQueue.getNext();
			const job2 = jobQueue.getNext();

			expect(job1).toBeDefined();
			expect(job2).toBeNull();
		});

		it('adds priority job with custom parameters', () => {
			jobQueue.addPriorityJob('UrgentJob', { urgent: true }, 10, 30000);

			const job = jobQueue.getNext();
			expect(job?.maxAttempts).toBe(10);
			expect(job?.retryDelay).toBe(30000);
		});
	});

	describe('getNext', () => {
		it('returns null when queue is empty', () => {
			const job = jobQueue.getNext();
			expect(job).toBeNull();
		});

		it('returns null when job is already running', () => {
			jobQueue.add('Job1');
			jobQueue.getNext();

			const job = jobQueue.getNext();
			expect(job).toBeNull();
		});

		it('returns first job from queue', () => {
			jobQueue.add('Job1');
			jobQueue.add('Job2');

			const job = jobQueue.getNext();
			expect(job?.name).toBe('Job1');
		});

		it('removes job from queue when returned', () => {
			jobQueue.add('Job1');
			jobQueue.add('Job2');

			jobQueue.getNext();
			jobQueue.completeJob();
			const job = jobQueue.getNext();

			expect(job?.name).toBe('Job2');
		});

		it('marks job as running', () => {
			jobQueue.add('Job1');
			const job1 = jobQueue.getNext();
			const job2 = jobQueue.getNext();

			expect(job1).toBeDefined();
			expect(job2).toBeNull();
		});
	});

	describe('completeJob', () => {
		it('clears running job', () => {
			jobQueue.add('Job1');
			jobQueue.getNext();
			jobQueue.completeJob();

			jobQueue.add('Job2');
			const nextJob = jobQueue.getNext();

			expect(nextJob?.name).toBe('Job2');
		});

		it('does nothing if no job is running', () => {
			expect(() => jobQueue.completeJob()).not.toThrow();
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

			const first = jobQueue.getNext();
			jobQueue.completeJob();
			const second = jobQueue.getNext();

			expect(first?.name).toBe('AnotherJob');
			expect(second?.name).toBe('TestJob');
		});

		it('clears running job', () => {
			jobQueue.add('Job1');
			const job = jobQueue.getNext()!;

			jobQueue.reQueue(job);

			jobQueue.add('Job2');
			const nextJob = jobQueue.getNext();
			expect(nextJob).toBeDefined();
		});
	});

	describe('requeueAtFront', () => {
		it('adds job to front of queue', () => {
			const job: Job = {
				id: 'priority-1',
				name: 'PriorityJob',
				payload: {},
				attempts: 0,
				maxAttempts: 3,
				retryDelay: 60000,
				lastAttempt: 0,
			};

			jobQueue.add('NormalJob');
			jobQueue.requeueAtFront(job);

			const nextJob = jobQueue.getNext();
			expect(nextJob?.name).toBe('PriorityJob');
		});

		it('clears running job', () => {
			jobQueue.add('Job1');
			const job = jobQueue.getNext()!;

			jobQueue.requeueAtFront(job);

			const nextJob = jobQueue.getNext();
			expect(nextJob).toBeDefined();
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

		it('clears running job on permanent failure', () => {
			const job: Job = {
				id: 'fail-3',
				name: 'FailJob',
				payload: {},
				attempts: 5,
				maxAttempts: 5,
				retryDelay: 60000,
				lastAttempt: 0,
			};

			jobQueue.failJob(job);

			jobQueue.add('NextJob');
			const nextJob = jobQueue.getNext();
			expect(nextJob?.name).toBe('NextJob');
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

			const job = jobQueue.getNext();
			expect(job?.payload.planId).toBe('plan-2');
		});

		it('returns false when job not found', () => {
			jobQueue.add('Backup', { planId: 'plan-1' });

			const removed = jobQueue.remove('Backup', 'plan-999');

			expect(removed).toBe(false);
		});

		it('removes running job if it matches', () => {
			jobQueue.add('Backup', { planId: 'plan-1' });
			jobQueue.getNext();

			const removed = jobQueue.remove('Backup', 'plan-1');

			expect(removed).toBe(true);

			jobQueue.add('NextJob');
			const nextJob = jobQueue.getNext();
			expect(nextJob?.name).toBe('NextJob');
		});

		it('does not remove job with different name', () => {
			jobQueue.add('Backup', { planId: 'plan-1' });
			jobQueue.add('Restore', { planId: 'plan-1' });

			const removed = jobQueue.remove('Backup', 'plan-1');

			expect(removed).toBe(true);

			const job = jobQueue.getNext();
			expect(job?.name).toBe('Restore');
		});

		it('handles removal when queue is empty', () => {
			const removed = jobQueue.remove('Backup', 'plan-1');
			expect(removed).toBe(false);
		});
	});
});
