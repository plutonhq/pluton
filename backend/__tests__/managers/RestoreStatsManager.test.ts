import { RestoreStatsManager } from '../../src/managers/RestoreStatsManager';
import { appPaths } from '../../src/utils/AppPaths';
import getBackupSourceFiles from '../../src/utils/getBackupSourceFiles';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { ResticRestoredFile, SnapShotFile } from '../../src/types/restic';
import { RestoreStats } from '../../src/types/restores';

// Mock all dependencies
jest.mock('../../src/utils/AppPaths', () => ({
	appPaths: {
		getStatsDir: jest.fn(),
	},
}));

jest.mock('../../src/services/ConfigService', () => ({
	configService: {
		get: jest.fn().mockReturnValue(undefined),
		getAll: jest.fn().mockReturnValue({}),
		config: {
			ENCRYPTION_KEY: 'test-encryption-key',
		},
	},
	ConfigService: {
		getInstance: jest.fn().mockReturnValue({
			get: jest.fn().mockReturnValue(undefined),
			getAll: jest.fn().mockReturnValue({}),
			config: {
				ENCRYPTION_KEY: 'test-encryption-key',
			},
		}),
	},
}));

jest.mock('../../src/utils/getBackupSourceFiles');
jest.mock('fs/promises');
jest.mock('fs');

describe('RestoreStatsManager', () => {
	let restoreStatsManager: RestoreStatsManager;
	let mockFileSystem: Record<string, string>; // In-memory file system

	const statsDir = '/tmp/pluton-stats';
	const planId = 'plan-123';
	const backupId = 'backup-abc';
	const restoreId = 'restore-xyz';
	const statsFilePath = path.join(statsDir, `restore-${restoreId}.json`);

	beforeEach(() => {
		// Reset mocks and the virtual file system before each test
		jest.clearAllMocks();
		mockFileSystem = {};

		// Setup mock implementations
		(appPaths.getStatsDir as jest.Mock).mockReturnValue(statsDir);

		(existsSync as jest.Mock).mockImplementation(filePath => !!mockFileSystem[filePath as string]);

		(fs.writeFile as jest.Mock).mockImplementation(async (filePath, data) => {
			mockFileSystem[filePath as string] = data as string;
		});

		(fs.readFile as jest.Mock).mockImplementation(async filePath => {
			if (mockFileSystem[filePath as string]) {
				return mockFileSystem[filePath as string];
			}
			throw new Error(`ENOENT: no such file or directory, open '${filePath}'`);
		});

		(getBackupSourceFiles as jest.Mock).mockResolvedValue({
			success: true,
			result: [
				{ name: 'file1.txt', path: '/source/file1.txt', size: 1024, isDirectory: false },
				{ name: 'file2.log', path: '/source/file2.log', size: 2048, isDirectory: false },
			] as SnapShotFile[],
		});

		restoreStatsManager = new RestoreStatsManager();
	});

	describe('initialize', () => {
		const sources = ['/source/dir1'];
		const restoreConfig = { target: '/dest', overwrite: 'always' };

		it('should create a new stats file with source files if it does not exist', async () => {
			// Arrange
			(existsSync as jest.Mock).mockReturnValue(false);

			// Act
			await restoreStatsManager.initialize(planId, backupId, restoreId, sources, restoreConfig);

			// Assert
			expect(getBackupSourceFiles).toHaveBeenCalledWith(sources);
			expect(fs.writeFile).toHaveBeenCalledTimes(1);
			expect(fs.writeFile).toHaveBeenCalledWith(statsFilePath, expect.any(String), 'utf-8');

			const fileContent = JSON.parse(mockFileSystem[statsFilePath]);

			expect(fileContent.planId).toBe(planId);
			expect(fileContent.backupId).toBe(backupId);
			expect(fileContent.restoreId).toBe(restoreId);
			expect(fileContent.config).toEqual(restoreConfig);
			expect(fileContent.sourcePaths).toHaveLength(2);
			expect(fileContent.sourcePaths[0].name).toBe('file1.txt');
			expect(fileContent.restoredPaths).toEqual([]);
			expect(fileContent.stats.total_files).toBe(0);
		});

		it('should not overwrite an existing stats file', async () => {
			// Arrange
			(existsSync as jest.Mock).mockReturnValue(true);

			// Act
			await restoreStatsManager.initialize(planId, backupId, restoreId, sources, restoreConfig);

			// Assert
			expect(getBackupSourceFiles).not.toHaveBeenCalled();
			expect(fs.writeFile).not.toHaveBeenCalled();
		});

		it('should create a file with empty sourcePaths if getBackupSourceFiles fails', async () => {
			// Arrange
			(existsSync as jest.Mock).mockReturnValue(false);
			(getBackupSourceFiles as jest.Mock).mockResolvedValue({
				success: false,
				result: 'Rclone failed',
			});

			// Act
			await restoreStatsManager.initialize(planId, backupId, restoreId, sources, restoreConfig);

			// Assert
			const fileContent = JSON.parse(mockFileSystem[statsFilePath]);
			expect(fileContent.sourcePaths).toEqual([]);
		});

		it('should log an error if writeFile fails', async () => {
			// Arrange
			(existsSync as jest.Mock).mockReturnValue(false);
			const writeError = new Error('Permission denied');
			(fs.writeFile as jest.Mock).mockRejectedValue(writeError);
			const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

			// Act
			await restoreStatsManager.initialize(planId, backupId, restoreId, sources, restoreConfig);

			// Assert
			expect(consoleErrorSpy).toHaveBeenCalledWith(
				`[RestoreHandler]: Failed to write initial stats for restoreId: ${restoreId}. Error: ${writeError.message}`
			);

			consoleErrorSpy.mockRestore();
		});
	});

	describe('update', () => {
		const initialContent = {
			planId,
			backupId,
			restoreId,
			sources: ['/source'],
			config: {},
			sourcePaths: [{ name: 'file1.txt', path: '/source/file1.txt' }],
			restoredPaths: [],
			stats: { total_files: 0 },
		};

		beforeEach(() => {
			// Pre-populate the file system with an initial stats file for update tests
			mockFileSystem[statsFilePath] = JSON.stringify(initialContent, null, 2);
		});

		it('should read, update, and write back the stats file', async () => {
			// Arrange
			const newFiles: ResticRestoredFile[] = [
				{ path: '/dest/newfile.txt', size: 500, action: 'create' },
			];
			const newStats: RestoreStats = {
				total_files: 1,
				files_restored: 1,
				total_bytes: 500,
				bytes_restored: 500,
			};

			// Act
			await restoreStatsManager.update(restoreId, newFiles, newStats);

			// Assert
			expect(fs.readFile).toHaveBeenCalledWith(statsFilePath, 'utf-8');
			expect(fs.writeFile).toHaveBeenCalledWith(statsFilePath, expect.any(String), 'utf-8');

			const finalContent = JSON.parse(mockFileSystem[statsFilePath]);

			// Check that new data was added
			expect(finalContent.restoredPaths).toEqual(newFiles);
			expect(finalContent.stats).toEqual(newStats);

			// Check that old data was preserved
			expect(finalContent.planId).toBe(planId);
			expect(finalContent.sourcePaths).toEqual(initialContent.sourcePaths);
		});

		it('should log an error if readFile fails', async () => {
			// Arrange
			const readError = new Error('File not found');
			(fs.readFile as jest.Mock).mockRejectedValue(readError);
			const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

			// Act
			await restoreStatsManager.update(restoreId, [], {} as RestoreStats);

			// Assert
			expect(consoleErrorSpy).toHaveBeenCalledWith(
				`[RestoreHandler]: Failed to update stats for restoreId: ${restoreId}. Error: ${readError.message}`
			);
			expect(fs.writeFile).not.toHaveBeenCalled(); // Should not attempt to write if read failed

			consoleErrorSpy.mockRestore();
		});
	});
});
