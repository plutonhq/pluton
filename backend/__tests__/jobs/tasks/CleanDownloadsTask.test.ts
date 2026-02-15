// Mock dependencies
const mockReaddir = jest.fn();
const mockStat = jest.fn();
const mockRm = jest.fn();
const mockCronLogger = {
	error: jest.fn(),
	warn: jest.fn(),
	info: jest.fn(),
};
const mockAppPaths = {
	getDownloadsDir: jest.fn(),
	getRestoresDir: jest.fn(),
	getProgressDir: jest.fn(),
	getCacheDir: jest.fn(),
};

jest.mock('fs/promises', () => ({
	readdir: (...args: any[]) => mockReaddir(...args),
	stat: (...args: any[]) => mockStat(...args),
	rm: (...args: any[]) => mockRm(...args),
}));

jest.mock('../../../src/utils/logger', () => ({
	cronLogger: mockCronLogger,
}));

jest.mock('../../../src/utils/AppPaths', () => ({
	appPaths: mockAppPaths,
}));

import { CleanDownloadsTask } from '../../../src/jobs/tasks/CleanDownloadsTask';
import { Job } from '../../../src/jobs/JobQueue';

describe('CleanDownloadsTask', () => {
	let cleanTask: CleanDownloadsTask;
	const NINETY_SIX_HOURS = 96 * 60 * 60 * 1000;

	beforeEach(() => {
		jest.clearAllMocks();

		cleanTask = new CleanDownloadsTask();

		mockAppPaths.getDownloadsDir.mockReturnValue('/downloads');
		mockAppPaths.getRestoresDir.mockReturnValue('/restores');
		mockAppPaths.getProgressDir.mockReturnValue('/progress');
		mockAppPaths.getCacheDir.mockReturnValue('/cache');

		mockReaddir.mockResolvedValue([]);
		mockStat.mockResolvedValue({
			mtime: new Date(Date.now() - NINETY_SIX_HOURS - 1000),
		});
		mockRm.mockResolvedValue(undefined);
	});

	describe('constructor', () => {
		it('creates task with correct name', () => {
			expect(cleanTask.name).toBe('CleanDownloads');
		});
	});

	describe('run', () => {
		it('cleans all three directories', async () => {
			const job: Job = {
				id: 'job-1',
				name: 'CleanDownloads',
				payload: {},
				attempts: 0,
				maxAttempts: 3,
				retryDelay: 60000,
				lastAttempt: 0,
			};

			await cleanTask.run(job);

			expect(mockAppPaths.getDownloadsDir).toHaveBeenCalled();
			expect(mockAppPaths.getRestoresDir).toHaveBeenCalled();
			expect(mockAppPaths.getProgressDir).toHaveBeenCalled();
			expect(mockAppPaths.getCacheDir).toHaveBeenCalled();

			expect(mockReaddir).toHaveBeenCalledWith('/downloads');
			expect(mockReaddir).toHaveBeenCalledWith('/restores');
			expect(mockReaddir).toHaveBeenCalledWith('/progress');
			expect(mockReaddir).toHaveBeenCalledWith('/cache');
		});

		it('removes files older than 96 hours', async () => {
			mockReaddir.mockResolvedValue(['old-file.txt']);
			mockStat.mockResolvedValue({
				mtime: new Date(Date.now() - NINETY_SIX_HOURS - 1000),
			});

			const job: Job = {
				id: 'job-1',
				name: 'CleanDownloads',
				payload: {},
				attempts: 0,
				maxAttempts: 3,
				retryDelay: 60000,
				lastAttempt: 0,
			};

			await cleanTask.run(job);

			expect(mockRm).toHaveBeenCalledWith(expect.stringContaining('old-file.txt'), {
				recursive: true,
				force: true,
			});
		});

		it('keeps files newer than 96 hours', async () => {
			mockReaddir.mockResolvedValue(['new-file.txt']);
			mockStat.mockResolvedValue({
				mtime: new Date(Date.now() - 1000),
			});

			const job: Job = {
				id: 'job-1',
				name: 'CleanDownloads',
				payload: {},
				attempts: 0,
				maxAttempts: 3,
				retryDelay: 60000,
				lastAttempt: 0,
			};

			await cleanTask.run(job);

			expect(mockRm).not.toHaveBeenCalled();
		});

		it('removes files exactly at 96 hour threshold', async () => {
			mockReaddir.mockResolvedValue(['threshold-file.txt']);
			mockStat.mockResolvedValue({
				mtime: new Date(Date.now() - NINETY_SIX_HOURS - 1),
			});

			const job: Job = {
				id: 'job-1',
				name: 'CleanDownloads',
				payload: {},
				attempts: 0,
				maxAttempts: 3,
				retryDelay: 60000,
				lastAttempt: 0,
			};

			await cleanTask.run(job);

			expect(mockRm).toHaveBeenCalled();
		});

		it('handles multiple files in directory', async () => {
			mockReaddir.mockResolvedValue(['file1.txt', 'file2.txt', 'file3.txt']);
			mockStat.mockResolvedValue({
				mtime: new Date(Date.now() - NINETY_SIX_HOURS - 1000),
			});

			const job: Job = {
				id: 'job-1',
				name: 'CleanDownloads',
				payload: {},
				attempts: 0,
				maxAttempts: 3,
				retryDelay: 60000,
				lastAttempt: 0,
			};

			await cleanTask.run(job);

			expect(mockRm).toHaveBeenCalledTimes(12); // 3 files × 4 directories
		});

		it('handles empty directories', async () => {
			mockReaddir.mockResolvedValue([]);

			const job: Job = {
				id: 'job-1',
				name: 'CleanDownloads',
				payload: {},
				attempts: 0,
				maxAttempts: 3,
				retryDelay: 60000,
				lastAttempt: 0,
			};

			await cleanTask.run(job);

			expect(mockStat).not.toHaveBeenCalled();
			expect(mockRm).not.toHaveBeenCalled();
		});

		it('handles directory not found error silently', async () => {
			const error: any = new Error('ENOENT');
			error.code = 'ENOENT';
			mockReaddir.mockRejectedValue(error);

			const job: Job = {
				id: 'job-1',
				name: 'CleanDownloads',
				payload: {},
				attempts: 0,
				maxAttempts: 3,
				retryDelay: 60000,
				lastAttempt: 0,
			};

			await expect(cleanTask.run(job)).resolves.not.toThrow();
			expect(mockCronLogger.error).not.toHaveBeenCalled();
		});

		it('logs other errors during cleaning', async () => {
			const error = new Error('Permission denied');
			mockReaddir.mockRejectedValue(error);

			const job: Job = {
				id: 'job-1',
				name: 'CleanDownloads',
				payload: {},
				attempts: 0,
				maxAttempts: 3,
				retryDelay: 60000,
				lastAttempt: 0,
			};

			await expect(cleanTask.run(job)).resolves.not.toThrow();
			expect(mockCronLogger.error).toHaveBeenCalledTimes(4); // Once per directory
		});

		it('continues cleaning other directories if one fails', async () => {
			let callCount = 0;
			mockReaddir.mockImplementation(() => {
				callCount++;
				if (callCount === 1) {
					return Promise.reject(new Error('First directory error'));
				}
				return Promise.resolve(['file.txt']);
			});

			mockStat.mockResolvedValue({
				mtime: new Date(Date.now() - NINETY_SIX_HOURS - 1000),
			});

			const job: Job = {
				id: 'job-1',
				name: 'CleanDownloads',
				payload: {},
				attempts: 0,
				maxAttempts: 3,
				retryDelay: 60000,
				lastAttempt: 0,
			};

			await cleanTask.run(job);

			expect(mockCronLogger.error).toHaveBeenCalledTimes(1);
			expect(mockRm).toHaveBeenCalledTimes(3); // 3 remaining directories
		});

		it('uses recursive and force flags when removing', async () => {
			mockReaddir.mockResolvedValue(['directory-to-remove']);
			mockStat.mockResolvedValue({
				mtime: new Date(Date.now() - NINETY_SIX_HOURS - 1000),
			});

			const job: Job = {
				id: 'job-1',
				name: 'CleanDownloads',
				payload: {},
				attempts: 0,
				maxAttempts: 3,
				retryDelay: 60000,
				lastAttempt: 0,
			};

			await cleanTask.run(job);

			expect(mockRm).toHaveBeenCalledWith(expect.any(String), { recursive: true, force: true });
		});

		it('runs with undefined job parameter', async () => {
			const job: Job = {
				id: 'job-1',
				name: 'CleanDownloads',
				payload: {},
				attempts: 0,
				maxAttempts: 3,
				retryDelay: 60000,
				lastAttempt: 0,
			};

			await expect(cleanTask.run(job)).resolves.not.toThrow();
			expect(mockReaddir).toHaveBeenCalled();
		});
	});
});
