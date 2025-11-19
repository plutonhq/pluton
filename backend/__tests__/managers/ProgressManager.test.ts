import { ProgressManager, BackupProgressFile } from '../../src/managers/ProgressManager';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

// Mock the entire fs/promises and fs modules
jest.mock('fs/promises');
jest.mock('fs');

describe('ProgressManager', () => {
	const progressDir = '/tmp/progress';
	let progressManager: ProgressManager;
	let mockFileSystem: Record<string, string>; // Our in-memory file system

	const planId = 'plan-123';
	const backupId = 'backup-abc';
	const progressFilePath = path.join(progressDir, `backup-${backupId}.json`);

	beforeEach(() => {
		// Reset the in-memory file system for each test
		mockFileSystem = {};

		// Reset all mocks
		jest.clearAllMocks();

		// Set up mock implementations for fs modules
		(fs.mkdir as jest.Mock).mockImplementation(async (dirPath, options) => {
			// Simulate mkdir -p
		});

		(fs.writeFile as jest.Mock).mockImplementation(async (filePath, data) => {
			mockFileSystem[filePath as string] = data as string;
		});

		(fs.readFile as jest.Mock).mockImplementation(async filePath => {
			if (mockFileSystem[filePath as string]) {
				return mockFileSystem[filePath as string];
			}
			throw { code: 'ENOENT' }; // Simulate file not found
		});

		(existsSync as jest.Mock).mockImplementation(filePath => {
			return !!mockFileSystem[filePath as string];
		});

		// Mock readdir, stat, and unlink for cleanup tests
		(fs.readdir as jest.Mock).mockImplementation(async dirPath => {
			return Object.keys(mockFileSystem).map(p => path.basename(p));
		});

		(fs.stat as jest.Mock).mockImplementation(async filePath => {
			// A simplified stat mock that only returns mtime
			const content = mockFileSystem[filePath as string];
			const fileData: BackupProgressFile = JSON.parse(content);
			return {
				mtime: new Date(fileData.lastUpdate),
			};
		});

		(fs.unlink as jest.Mock).mockImplementation(async filePath => {
			delete mockFileSystem[filePath as string];
		});

		// Use fake timers to control timestamps
		jest.useFakeTimers();
		jest.setSystemTime(new Date('2025-10-20T10:00:00.000Z'));

		progressManager = new ProgressManager(progressDir);
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	describe('initialize', () => {
		it('should create the progress directory if it does not exist', async () => {
			// Arrange
			(existsSync as jest.Mock).mockReturnValue(false);

			// Act
			await progressManager.initialize();

			// Assert
			expect(fs.mkdir).toHaveBeenCalledWith(progressDir, { recursive: true });
		});
	});

	describe('initializeProgress', () => {
		it('should create a new progress file on the first attempt', async () => {
			// Arrange
			const retryInfo = { attempts: 0, maxAttempts: 3 };

			// Act
			await progressManager.initializeProgress(planId, backupId, retryInfo);
			// FIX: No longer need to manually advance the event loop.

			// Assert
			expect(fs.writeFile).toHaveBeenCalledTimes(1);
			const fileContent = JSON.parse(mockFileSystem[progressFilePath]);
			expect(fileContent).toEqual({
				planId,
				backupId,
				status: 'running',
				startTime: '2025-10-20T10:00:00.000Z',
				lastUpdate: '2025-10-20T10:00:00.000Z',
				events: [
					{
						timestamp: '2025-10-20T10:00:00.000Z',
						phase: 'initializing',
						action: 'INITIALIZE',
						completed: true,
					},
				],
			});
		});

		it('should NOT create a new progress file on a retry attempt', async () => {
			// Arrange
			const retryInfo = { attempts: 1, maxAttempts: 3 };

			// Act
			await progressManager.initializeProgress(planId, backupId, retryInfo);

			// Assert
			expect(fs.writeFile).not.toHaveBeenCalled();
		});
	});

	describe('updateAction', () => {
		it('should add a new event to the events array', async () => {
			// Arrange
			await progressManager.initializeProgress(planId, backupId, { attempts: 0, maxAttempts: 3 });
			jest.setSystemTime(new Date('2025-10-20T10:05:00.000Z')); // Advance time

			// Act
			await progressManager.updateAction(planId, backupId, 'pre-backup', 'DRY_RUN', true);

			// Assert
			const fileContent = JSON.parse(mockFileSystem[progressFilePath]);
			expect(fileContent.events).toHaveLength(2);
			expect(fileContent.events[1]).toEqual({
				timestamp: '2025-10-20T10:05:00.000Z',
				phase: 'pre-backup',
				action: 'DRY_RUN',
				completed: true,
			});
			expect(fileContent.lastUpdate).toBe('2025-10-20T10:05:00.000Z');
		});
	});

	describe('updateResticProgress', () => {
		it('should update resticData for the last active backup event', async () => {
			// Arrange
			await progressManager.initializeProgress(planId, backupId, { attempts: 0, maxAttempts: 3 });
			await progressManager.updateAction(planId, backupId, 'backup', 'BACKUP_OPERATION', false);
			const resticLine = JSON.stringify({ message_type: 'status', percent_done: 0.5 });

			// Act
			await progressManager.updateResticProgress(planId, backupId, resticLine);

			// Assert
			const fileContent = JSON.parse(mockFileSystem[progressFilePath]);
			const backupEvent = fileContent.events.find((e: any) => e.phase === 'backup');
			expect(backupEvent).toBeDefined();
			expect(backupEvent.resticData).toEqual({ message_type: 'status', percent_done: 0.5 });
		});

		it('should handle multi-line restic output', async () => {
			// Arrange
			await progressManager.initializeProgress(planId, backupId, { attempts: 0, maxAttempts: 3 });
			await progressManager.updateAction(planId, backupId, 'backup', 'BACKUP_OPERATION', false);
			const resticChunk = `${JSON.stringify({ message_type: 'status', percent_done: 0.1 })}\n${JSON.stringify({ message_type: 'status', percent_done: 0.2 })}`;

			// Act
			await progressManager.updateResticProgress(planId, backupId, resticChunk);

			// Assert
			const fileContent = JSON.parse(mockFileSystem[progressFilePath]);
			const backupEvent = fileContent.events.find((e: any) => e.phase === 'backup');
			expect(backupEvent).toBeDefined();
			expect(backupEvent.resticData).toEqual({ message_type: 'status', percent_done: 0.2 });
		});
	});

	describe('markCompleted', () => {
		it('should mark a backup as successfully completed', async () => {
			// Arrange
			await progressManager.initializeProgress(planId, backupId, { attempts: 0, maxAttempts: 3 });
			jest.setSystemTime(new Date('2025-10-20T10:30:00.000Z')); // 30 minutes later

			// Act
			await progressManager.markCompleted(planId, backupId, true);

			// Assert
			const fileContent = JSON.parse(mockFileSystem[progressFilePath]);
			expect(fileContent.status).toBe('completed');
			expect(fileContent.duration).toBe(30 * 60 * 1000);
			expect(fileContent.events.pop().action).toBe('TASK_COMPLETED');
		});

		it('should mark a backup as failed (permanently)', async () => {
			// Arrange
			await progressManager.initializeProgress(planId, backupId, { attempts: 0, maxAttempts: 3 });
			const errorMessage = 'Connection failed';

			// Act
			await progressManager.markCompleted(planId, backupId, false, errorMessage, true);

			// Assert
			const fileContent = JSON.parse(mockFileSystem[progressFilePath]);
			expect(fileContent.status).toBe('failed');
			const finalEvent = fileContent.events.pop();
			expect(finalEvent.action).toBe('FAILED_PERMANENTLY');
			expect(finalEvent.error).toBe(errorMessage);
		});
	});

	describe('readProgress (Resilience)', () => {
		it('should return a default object if the file does not exist', async () => {
			// Arrange
			// Act
			const progress = await progressManager.readProgress(planId, backupId);

			// Assert
			expect(progress).not.toBeNull();
			expect(progress?.status).toBe('running');
			expect(progress?.backupId).toBe(backupId);
		});

		it('should return a default object for invalid JSON and log an error', async () => {
			// Arrange
			const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
			mockFileSystem[progressFilePath] = '{invalid json';

			// Act
			const progress = await progressManager.readProgress(planId, backupId);

			// Assert
			expect(progress).not.toBeNull();
			expect(progress?.status).toBe('running');
			expect(consoleErrorSpy).toHaveBeenCalled();
			consoleErrorSpy.mockRestore();
		});
	});

	describe('Synchronized Updates (Concurrency)', () => {
		it('should handle multiple concurrent updates without losing data', async () => {
			// Arrange
			await progressManager.initializeProgress(planId, backupId, { attempts: 0, maxAttempts: 3 });

			// Act
			const updatePromises = [
				progressManager.updateAction(planId, backupId, 'phase1', 'ACTION_1', true),
				progressManager.updateAction(planId, backupId, 'phase2', 'ACTION_2', true),
				progressManager.updateAction(planId, backupId, 'phase3', 'ACTION_3', true),
			];
			await Promise.all(updatePromises);

			// Assert
			const finalContent = JSON.parse(mockFileSystem[progressFilePath]);
			expect(finalContent.events).toHaveLength(4);
			expect(finalContent.events[1].action).toBe('ACTION_1');
			expect(finalContent.events[2].action).toBe('ACTION_2');
			expect(finalContent.events[3].action).toBe('ACTION_3');
		});
	});

	describe('cleanupOldProgress', () => {
		it('should delete progress files older than the specified max age', async () => {
			// Arrange
			const oldBackupId = 'backup-old';
			const newBackupId = 'backup-new';
			const oldFilePath = path.join(progressDir, `backup-${oldBackupId}.json`);
			const newFilePath = path.join(progressDir, `backup-${newBackupId}.json`);
			mockFileSystem[oldFilePath] = JSON.stringify({
				lastUpdate: '2025-10-17T10:00:00.000Z',
			});
			mockFileSystem[newFilePath] = JSON.stringify({
				lastUpdate: '2025-10-20T10:00:00.000Z',
			});
			const maxAgeMs = 2 * 24 * 60 * 60 * 1000;

			// Act
			await progressManager.cleanupOldProgress(maxAgeMs);

			// Assert
			expect(fs.unlink).toHaveBeenCalledWith(oldFilePath);
			expect(fs.unlink).not.toHaveBeenCalledWith(newFilePath);
		});
	});
});
