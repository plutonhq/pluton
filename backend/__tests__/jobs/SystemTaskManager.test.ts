// Mock dependencies
const mockJobQueueAdd = jest.fn();
const mockCronLogger = {
	error: jest.fn(),
	warn: jest.fn(),
	info: jest.fn(),
};

let mockCronInstances: any[] = [];

jest.mock('../../src/jobs/JobQueue', () => ({
	jobQueue: {
		add: (...args: any[]) => mockJobQueueAdd(...args),
	},
}));

jest.mock('../../src/utils/logger', () => ({
	cronLogger: mockCronLogger,
}));

jest.mock('croner', () => {
	return {
		Cron: jest.fn().mockImplementation((schedule: string, callback: Function) => {
			const mockCron = {
				schedule,
				callback,
				stop: jest.fn(),
				isStopped: false,
			};
			mockCronInstances.push(mockCron);
			return mockCron;
		}),
	};
});

import { SystemTaskManager } from '../../src/jobs/SystemTaskManager';
import { SystemJobConfig } from '../../src/types/global';

describe('SystemTaskManager', () => {
	let systemJobs: SystemJobConfig[];

	beforeEach(() => {
		jest.clearAllMocks();
		mockCronInstances = [];

		systemJobs = [
			{
				name: 'CleanDownloads',
				schedule: '0 2 * * *',
				maxAttempts: 3,
				retryDelay: 300000,
			},
			{
				name: 'PruneDatabase',
				schedule: '0 3 * * *',
				maxAttempts: 5,
			},
		];

		// Reset singleton
		(SystemTaskManager as any).instance = undefined;
	});

	describe('getInstance', () => {
		it('creates instance with system jobs', () => {
			const manager = SystemTaskManager.getInstance(systemJobs);
			expect(manager).toBeDefined();
		});

		it('returns same instance on subsequent calls', () => {
			const manager1 = SystemTaskManager.getInstance(systemJobs);
			const manager2 = SystemTaskManager.getInstance();
			expect(manager1).toBe(manager2);
		});

		it('throws error if first call without system jobs', () => {
			expect(() => SystemTaskManager.getInstance()).toThrow(
				'SystemTaskManager must be initialized with systemJobs on first call'
			);
		});
	});

	describe('initialize', () => {
		it('schedules all system jobs', () => {
			const manager = SystemTaskManager.getInstance(systemJobs);
			manager.initialize();

			expect(mockCronInstances).toHaveLength(2);
			expect(mockCronInstances[0].schedule).toBe('0 2 * * *');
			expect(mockCronInstances[1].schedule).toBe('0 3 * * *');
		});

		it('adds jobs to queue when cron fires', () => {
			const manager = SystemTaskManager.getInstance(systemJobs);
			manager.initialize();

			// Simulate cron firing
			mockCronInstances[0].callback();

			expect(mockJobQueueAdd).toHaveBeenCalledWith('CleanDownloads', undefined, 3, 300000);
		});

		it('uses default values when not provided', () => {
			const jobsWithDefaults: SystemJobConfig[] = [
				{
					name: 'TestJob',
					schedule: '0 0 * * *',
				},
			];

			const manager = SystemTaskManager.getInstance(jobsWithDefaults);
			manager.initialize();

			mockCronInstances[0].callback();

			expect(mockJobQueueAdd).toHaveBeenCalledWith('TestJob', undefined, undefined, undefined);
		});

		it('includes payload when provided', () => {
			const jobsWithPayload: SystemJobConfig[] = [
				{
					name: 'JobWithPayload',
					schedule: '0 0 * * *',
					payload: { key: 'value' },
					maxAttempts: 3,
				},
			];

			const manager = SystemTaskManager.getInstance(jobsWithPayload);
			manager.initialize();

			mockCronInstances[0].callback();

			expect(mockJobQueueAdd).toHaveBeenCalledWith(
				'JobWithPayload',
				{ key: 'value' },
				3,
				undefined
			);
		});

		it('handles cron creation errors gracefully', () => {
			const Cron = require('croner').Cron;
			Cron.mockImplementationOnce(() => {
				throw new Error('Invalid cron expression');
			});

			const manager = SystemTaskManager.getInstance(systemJobs);
			manager.initialize();

			expect(mockCronLogger.error).toHaveBeenCalledWith(
				expect.stringContaining('Failed to schedule job: CleanDownloads')
			);
		});

		it('schedules multiple jobs successfully', () => {
			const multipleJobs: SystemJobConfig[] = [
				{ name: 'Job1', schedule: '0 1 * * *' },
				{ name: 'Job2', schedule: '0 2 * * *' },
				{ name: 'Job3', schedule: '0 3 * * *' },
			];

			const manager = SystemTaskManager.getInstance(multipleJobs);
			manager.initialize();

			expect(mockCronInstances).toHaveLength(3);
		});

		it('handles empty system jobs array', () => {
			const manager = SystemTaskManager.getInstance([]);
			manager.initialize();

			expect(mockCronInstances).toHaveLength(0);
		});
	});

	describe('stopAll', () => {
		it('stops all cron jobs', () => {
			const manager = SystemTaskManager.getInstance(systemJobs);
			manager.initialize();

			manager.stopAll();

			expect(mockCronInstances[0].stop).toHaveBeenCalled();
			expect(mockCronInstances[1].stop).toHaveBeenCalled();
		});

		it('does nothing if no jobs were initialized', () => {
			const manager = SystemTaskManager.getInstance(systemJobs);
			expect(() => manager.stopAll()).not.toThrow();
		});

		it('stops all jobs even after errors', () => {
			const manager = SystemTaskManager.getInstance(systemJobs);
			manager.initialize();

			mockCronInstances[0].stop.mockImplementation(() => {
				throw new Error('Stop failed');
			});

			expect(() => manager.stopAll()).toThrow();
			// Even if first fails, second should still be attempted
		});
	});

	describe('system jobs configuration', () => {
		it('accepts maxAttempts configuration', () => {
			const jobWithAttempts: SystemJobConfig[] = [
				{
					name: 'RetryableJob',
					schedule: '0 0 * * *',
					maxAttempts: 10,
				},
			];

			const manager = SystemTaskManager.getInstance(jobWithAttempts);
			manager.initialize();

			mockCronInstances[0].callback();

			expect(mockJobQueueAdd).toHaveBeenCalledWith('RetryableJob', undefined, 10, undefined);
		});

		it('accepts retryDelay configuration', () => {
			const jobWithDelay: SystemJobConfig[] = [
				{
					name: 'DelayedJob',
					schedule: '0 0 * * *',
					retryDelay: 600000,
				},
			];

			const manager = SystemTaskManager.getInstance(jobWithDelay);
			manager.initialize();

			mockCronInstances[0].callback();

			expect(mockJobQueueAdd).toHaveBeenCalledWith('DelayedJob', undefined, undefined, 600000);
		});

		it('accepts all configuration options', () => {
			const fullConfig: SystemJobConfig[] = [
				{
					name: 'FullConfigJob',
					schedule: '*/15 * * * *',
					payload: { data: 'test' },
					maxAttempts: 7,
					retryDelay: 120000,
				},
			];

			const manager = SystemTaskManager.getInstance(fullConfig);
			manager.initialize();

			mockCronInstances[0].callback();

			expect(mockJobQueueAdd).toHaveBeenCalledWith('FullConfigJob', { data: 'test' }, 7, 120000);
		});
	});
});
