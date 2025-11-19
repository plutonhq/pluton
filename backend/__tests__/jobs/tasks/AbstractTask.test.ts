import { Task } from '../../../src/jobs/tasks/AbstractTask';
import { Job } from '../../../src/jobs/JobQueue';

class TestTask extends Task {
	name = 'TestTask';

	async run(job?: Job): Promise<void> {
		// Implementation for testing
	}
}

describe('AbstractTask', () => {
	let task: TestTask;

	beforeEach(() => {
		task = new TestTask();
	});

	describe('class structure', () => {
		it('defines abstract name property', () => {
			expect(task.name).toBe('TestTask');
		});

		it('defines abstract run method', () => {
			expect(typeof task.run).toBe('function');
		});

		it('can be instantiated by subclass', () => {
			expect(task).toBeInstanceOf(Task);
		});
	});

	describe('run method', () => {
		it('accepts optional job parameter', async () => {
			await expect(task.run()).resolves.toBeUndefined();
		});

		it('accepts job parameter', async () => {
			const job: Job = {
				id: 'job-1',
				name: 'TestTask',
				payload: { data: 'test' },
				attempts: 0,
				maxAttempts: 3,
				retryDelay: 60000,
				lastAttempt: 0,
			};

			await expect(task.run(job)).resolves.toBeUndefined();
		});

		it('returns a Promise', () => {
			const result = task.run();
			expect(result).toBeInstanceOf(Promise);
		});
	});

	describe('inheritance', () => {
		it('can be extended with custom implementation', async () => {
			class CustomTask extends Task {
				name = 'CustomTask';
				executed = false;

				async run(job?: Job): Promise<void> {
					this.executed = true;
				}
			}

			const customTask = new CustomTask();
			await customTask.run();

			expect(customTask.executed).toBe(true);
		});

		it('can access job payload in subclass', async () => {
			let capturedPayload: any;

			class PayloadTask extends Task {
				name = 'PayloadTask';

				async run(job?: Job): Promise<void> {
					capturedPayload = job?.payload;
				}
			}

			const payloadTask = new PayloadTask();
			const job: Job = {
				id: 'job-1',
				name: 'PayloadTask',
				payload: { test: 'value' },
				attempts: 0,
				maxAttempts: 3,
				retryDelay: 60000,
				lastAttempt: 0,
			};

			await payloadTask.run(job);
			expect(capturedPayload).toEqual({ test: 'value' });
		});

		it('can throw errors in subclass implementation', async () => {
			class ErrorTask extends Task {
				name = 'ErrorTask';

				async run(job?: Job): Promise<void> {
					throw new Error('Task execution failed');
				}
			}

			const errorTask = new ErrorTask();
			await expect(errorTask.run()).rejects.toThrow('Task execution failed');
		});
	});
});
