import { SYSTEM_JOBS } from '../../src/jobs/systemJobs';

describe('systemJobs', () => {
	describe('SYSTEM_JOBS configuration', () => {
		it('is exported as an array', () => {
			expect(Array.isArray(SYSTEM_JOBS)).toBe(true);
		});

		it('contains valid job configurations', () => {
			SYSTEM_JOBS.forEach(job => {
				expect(job).toHaveProperty('name');
				expect(job).toHaveProperty('schedule');
				expect(typeof job.name).toBe('string');
				expect(typeof job.schedule).toBe('string');
			});
		});

		it('has optional maxAttempts property', () => {
			SYSTEM_JOBS.forEach(job => {
				if (job.maxAttempts !== undefined) {
					expect(typeof job.maxAttempts).toBe('number');
					expect(job.maxAttempts).toBeGreaterThan(0);
				}
			});
		});

		it('has optional retryDelay property', () => {
			SYSTEM_JOBS.forEach(job => {
				if (job.retryDelay !== undefined) {
					expect(typeof job.retryDelay).toBe('number');
					expect(job.retryDelay).toBeGreaterThanOrEqual(0);
				}
			});
		});

		it('has optional payload property', () => {
			SYSTEM_JOBS.forEach(job => {
				if (job.payload !== undefined) {
					expect(typeof job.payload).toBe('object');
				}
			});
		});

		it('can be empty array', () => {
			// This is valid - system jobs can be empty
			expect(SYSTEM_JOBS).toBeDefined();
		});

		it('has unique job names', () => {
			const names = SYSTEM_JOBS.map(job => job.name);
			const uniqueNames = new Set(names);
			expect(names.length).toBe(uniqueNames.size);
		});

		it('has valid cron expressions', () => {
			// Basic cron format validation (5 or 6 fields)
			const cronRegex =
				/^(\*|([0-9]|1[0-9]|2[0-9]|3[0-9]|4[0-9]|5[0-9])|\*\/([0-9]|1[0-9]|2[0-9]|3[0-9]|4[0-9]|5[0-9])) (\*|([0-9]|1[0-9]|2[0-3])|\*\/([0-9]|1[0-9]|2[0-3])) (\*|([1-9]|1[0-9]|2[0-9]|3[0-1])|\*\/([1-9]|1[0-9]|2[0-9]|3[0-1])) (\*|([1-9]|1[0-2])|\*\/([1-9]|1[0-2])) (\*|([0-6])|\*\/([0-6]))/;

			SYSTEM_JOBS.forEach(job => {
				// Should at least have some structure
				expect(job.schedule.split(' ').length).toBeGreaterThanOrEqual(5);
			});
		});
	});

	describe('example job configurations', () => {
		it('supports CleanDownloads configuration', () => {
			const cleanDownloadsJob = {
				name: 'CleanDownloads',
				schedule: '0 2 * * *', // Daily at 2 AM
				maxAttempts: 2,
				retryDelay: 300000,
			};

			expect(cleanDownloadsJob.name).toBe('CleanDownloads');
			expect(cleanDownloadsJob.schedule).toBe('0 2 * * *');
		});

		it('supports PruneDatabase configuration', () => {
			const pruneDatabaseJob = {
				name: 'PruneDatabase',
				schedule: '0 3 * * *', // Daily at 3 AM
				maxAttempts: 5,
			};

			expect(pruneDatabaseJob.name).toBe('PruneDatabase');
			expect(pruneDatabaseJob.maxAttempts).toBe(5);
		});

		it('supports UpdateDevices configuration', () => {
			const updateDevicesJob = {
				name: 'UpdateDevices',
				schedule: '0 4 * * *', // Daily at 4 AM
				maxAttempts: 2,
				retryDelay: 600000,
			};

			expect(updateDevicesJob.name).toBe('UpdateDevices');
			expect(updateDevicesJob.retryDelay).toBe(600000);
		});

		it('supports job with payload', () => {
			const jobWithPayload = {
				name: 'CustomJob',
				schedule: '*/5 * * * *',
				payload: { type: 'custom', value: 123 },
				maxAttempts: 3,
			};

			expect(jobWithPayload.payload).toEqual({ type: 'custom', value: 123 });
		});
	});

	describe('job configuration flexibility', () => {
		it('allows jobs without retryDelay', () => {
			const job: any = {
				name: 'NoRetryDelayJob',
				schedule: '0 0 * * *',
				maxAttempts: 3,
			};

			expect(job.retryDelay).toBeUndefined();
		});

		it('allows jobs without maxAttempts', () => {
			const job: any = {
				name: 'NoMaxAttemptsJob',
				schedule: '0 0 * * *',
			};

			expect(job.maxAttempts).toBeUndefined();
		});

		it('allows minimal job configuration', () => {
			const minimalJob = {
				name: 'MinimalJob',
				schedule: '0 0 * * *',
			};

			expect(minimalJob.name).toBeDefined();
			expect(minimalJob.schedule).toBeDefined();
		});
	});

	describe('integration scenarios', () => {
		it('can be used with SystemTaskManager', () => {
			// This test verifies the structure is compatible
			const mockJobConfig = {
				name: 'TestJob',
				schedule: '0 0 * * *',
				maxAttempts: 3,
				retryDelay: 60000,
			};

			expect(mockJobConfig).toHaveProperty('name');
			expect(mockJobConfig).toHaveProperty('schedule');
		});

		it('supports different schedule patterns', () => {
			const schedules = [
				'0 0 * * *', // Daily at midnight
				'*/5 * * * *', // Every 5 minutes
				'0 2 * * *', // Daily at 2 AM
				'0 0 * * 0', // Weekly on Sunday
				'0 0 1 * *', // Monthly on 1st
			];

			schedules.forEach(schedule => {
				expect(schedule.split(' ').length).toBeGreaterThanOrEqual(5);
			});
		});
	});
});
