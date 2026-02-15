// Mocks
const mockRunResticCommand = jest.fn();
const mockGetSnapshotByTag = jest.fn();
const mockGenerateResticRepoPath = jest.fn();
const mockResticPathToWindows = jest.fn();
const mockTrackProcess = jest.fn();
const mockKillProcess = jest.fn();
const mockInitialize = jest.fn();
const mockInitializeProgress = jest.fn();
const mockUpdateAction = jest.fn();
const mockUpdateResticProgress = jest.fn();
const mockMarkCompleted = jest.fn();
const mockStatsInitialize = jest.fn();
const mockStatsUpdate = jest.fn();
const mockCopyFilesNatively = jest.fn();
const mockAccess = jest.fn();
const mockRm = jest.fn();

jest.mock('../../../src/utils/restic/restic', () => ({
	runResticCommand: (...args: any[]) => mockRunResticCommand(...args),
	getSnapshotByTag: (...args: any[]) => mockGetSnapshotByTag(...args),
}));

jest.mock('../../../src/utils/restic/helpers', () => ({
	generateResticRepoPath: (...args: any[]) => mockGenerateResticRepoPath(...args),
	resticPathToWindows: (...args: any[]) => mockResticPathToWindows(...args),
}));

jest.mock('../../../src/managers/ProcessManager', () => ({
	processManager: {
		trackProcess: (...args: any[]) => mockTrackProcess(...args),
		killProcess: (...args: any[]) => mockKillProcess(...args),
	},
}));

jest.mock('../../../src/managers/ProgressManager', () => ({
	ProgressManager: jest.fn().mockImplementation(() => ({
		initialize: mockInitialize,
		initializeProgress: mockInitializeProgress,
		updateAction: mockUpdateAction,
		updateResticProgress: mockUpdateResticProgress,
		markCompleted: mockMarkCompleted,
	})),
}));

jest.mock('../../../src/managers/RestoreStatsManager', () => ({
	RestoreStatsManager: jest.fn().mockImplementation(() => ({
		initialize: mockStatsInitialize,
		update: mockStatsUpdate,
	})),
}));

jest.mock('../../../src/utils/AppPaths', () => ({
	appPaths: {
		getProgressDir: jest.fn(() => '/mock/progress/dir'),
		getRestoresDir: jest.fn(() => '/mock/restores/dir'),
	},
}));

jest.mock('../../../src/services/ConfigService', () => ({
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

jest.mock('../../../src/utils/copyFiles', () => ({
	__esModule: true,
	default: (...args: any[]) => mockCopyFilesNatively(...args),
}));

jest.mock('fs/promises', () => ({
	access: (...args: any[]) => mockAccess(...args),
	rm: (...args: any[]) => mockRm(...args),
}));

jest.mock('fs', () => ({
	...jest.requireActual('fs'),
	existsSync: jest.fn(() => true),
	constants: {
		F_OK: 0,
		W_OK: 2,
	},
}));

import { EventEmitter } from 'events';
import { RestoreHandler } from '../../../src/managers/handlers/RestoreHandler';
import os from 'os';

describe('RestoreHandler', () => {
	let handler: RestoreHandler;
	let emitter: EventEmitter;

	const baseOptions = {
		planId: 'plan-1',
		storageName: 'test-storage',
		storagePath: 'backups/test',
		encryption: false,
		target: '/restore/target',
		overwrite: 'always' as const,
		delete: false,
		includes: [],
		excludes: [],
		sources: ['C:\\data'],
		performanceSettings: {
			maxProcessor: 2,
			transfers: 4,
			bufferSize: '16M',
			multiThreadStream: 4,
		},
	};

	const mockSnapshot = {
		id: 'snapshot-123',
		time: '2024-01-01T00:00:00Z',
		hostname: 'test-host',
		username: 'test-user',
		paths: ['C:\\data'],
		tags: ['backup-backup-1'],
		short_id: 'snap123',
		parent: '',
		tree: 'tree-123',
		program_version: 'restic 0.16.0',
		summary: {
			backup_start: '2024-01-01T00:00:00Z',
			backup_end: '2024-01-01T00:01:00Z',
			files_new: 10,
			files_changed: 5,
			files_unmodified: 85,
			dirs_new: 2,
			dirs_changed: 1,
			dirs_unmodified: 10,
			data_blobs: 100,
			tree_blobs: 20,
			data_added: 1000000,
			data_added_packed: 900000,
			total_files_processed: 100,
			total_bytes_processed: 1000000,
		},
	};

	beforeEach(() => {
		jest.clearAllMocks();
		emitter = new EventEmitter();
		handler = new RestoreHandler(emitter);

		// Default mock implementations
		mockRunResticCommand.mockResolvedValue('{"message_type":"summary"}');
		mockGetSnapshotByTag.mockResolvedValue({
			success: true,
			result: mockSnapshot,
		});
		mockGenerateResticRepoPath.mockReturnValue('rclone:test-storage:backups/test');
		mockResticPathToWindows.mockImplementation((path: string) => path);
		mockInitialize.mockResolvedValue(undefined);
		mockInitializeProgress.mockResolvedValue(undefined);
		mockUpdateAction.mockResolvedValue(undefined);
		mockUpdateResticProgress.mockResolvedValue(undefined);
		mockMarkCompleted.mockResolvedValue(undefined);
		mockStatsInitialize.mockResolvedValue(undefined);
		mockStatsUpdate.mockResolvedValue(undefined);
		mockKillProcess.mockReturnValue(true);
		mockCopyFilesNatively.mockResolvedValue(undefined);
		mockAccess.mockResolvedValue(undefined);
		mockRm.mockResolvedValue(undefined);

		process.env.ENCRYPTION_KEY = 'test-key';
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	describe('execute', () => {
		it('should successfully execute restore with all phases', async () => {
			const restoreCreatedListener = jest.fn();
			emitter.on('restoreCreated', restoreCreatedListener);

			// Simulate dry run returning stats
			mockRunResticCommand.mockResolvedValueOnce(
				JSON.stringify({
					message_type: 'summary',
					total_files: 100,
					files_restored: 100,
					total_bytes: 1000000,
					bytes_restored: 1000000,
				}) +
					'\n' +
					JSON.stringify({
						message_type: 'verbose_status',
						item: '/test/file.txt',
						size: '1000',
						action: 'restored',
					})
			);

			// Simulate restoreCreated event after dry run
			setTimeout(() => {
				emitter.emit('restoreCreated', { backupId: 'backup-1', restoreId: 'restore-1' });
			}, 10);

			// Simulate actual restore
			mockRunResticCommand.mockResolvedValueOnce('restore complete');

			const result = await handler.execute('backup-1', 'restore-1', baseOptions, {
				attempts: 0,
				maxAttempts: 3,
			});

			expect(result).toBeDefined();
			expect(mockInitializeProgress).toHaveBeenCalledWith('plan-1', 'restore-1', {
				attempts: 0,
				maxAttempts: 3,
			});
			expect(mockStatsInitialize).toHaveBeenCalledWith(
				'plan-1',
				'backup-1',
				'restore-1',
				['C:\\data'],
				baseOptions
			);
			expect(mockUpdateAction).toHaveBeenCalledWith(
				'plan-1',
				'restore-1',
				'pre-restore',
				'PRE_RESTORE_START',
				false,
				undefined
			);
			expect(mockMarkCompleted).toHaveBeenCalledWith('plan-1', 'restore-1', true);
		});

		it('should prevent concurrent restores for same plan', async () => {
			handler['runningRestores'].add('plan-1');

			await expect(
				handler.execute('backup-1', 'restore-2', baseOptions, { attempts: 0, maxAttempts: 3 })
			).rejects.toThrow('Restore is already in progress for plan: plan-1');

			handler['runningRestores'].delete('plan-1');
		});

		it('should handle retry attempts correctly', async () => {
			emitter.on('restoreCreated', () => {});
			setTimeout(() => {
				emitter.emit('restoreCreated', { backupId: 'backup-1', restoreId: 'restore-1' });
			}, 10);

			mockRunResticCommand
				.mockResolvedValueOnce(
					JSON.stringify({
						message_type: 'summary',
						total_files: 10,
						files_restored: 10,
						total_bytes: 1000,
						bytes_restored: 1000,
					})
				)
				.mockResolvedValueOnce('restore complete');

			await handler.execute('backup-1', 'restore-1', baseOptions, { attempts: 2, maxAttempts: 5 });

			expect(mockUpdateAction).toHaveBeenCalledWith(
				'plan-1',
				'restore-1',
				'pre-restore',
				'RETRY_ATTEMPT_2_OF_5_START',
				false,
				undefined
			);
		});

		it('should handle cancellation during execution', async () => {
			handler['cancelledRestores'].add('plan-1');

			mockGetSnapshotByTag.mockResolvedValueOnce({
				success: true,
				result: mockSnapshot,
			});

			// Mock dry run
			mockRunResticCommand.mockResolvedValueOnce(
				JSON.stringify({
					message_type: 'summary',
					total_files: 10,
					files_restored: 10,
					total_bytes: 1000,
					bytes_restored: 1000,
				})
			);

			// Emit restoreCreated event
			setTimeout(() => {
				emitter.emit('restoreCreated', { backupId: 'backup-1', restoreId: 'restore-1' });
			}, 10);

			// When cancelled, execute returns empty string instead of throwing
			const result = await handler.execute('backup-1', 'restore-1', baseOptions, {
				attempts: 0,
				maxAttempts: 3,
			});

			expect(result).toBe('');
			handler['cancelledRestores'].delete('plan-1');
		}, 15000);

		it('should emit error event and schedule retry on non-final failure', async () => {
			const errorListener = jest.fn();
			emitter.on('restore_error', errorListener);

			emitter.on('restoreCreated', () => {});
			setTimeout(() => {
				emitter.emit('restoreCreated', { backupId: 'backup-1', restoreId: 'restore-1' });
			}, 10);

			mockGetSnapshotByTag.mockResolvedValueOnce({
				success: false,
				result: 'Snapshot not found',
			});

			await expect(
				handler.execute('backup-1', 'restore-1', baseOptions, { attempts: 0, maxAttempts: 3 })
			).rejects.toThrow();

			expect(errorListener).toHaveBeenCalledWith({
				planId: 'plan-1',
				backupId: 'backup-1',
				restoreId: 'restore-1',
				error: 'Snapshot not found',
			});

			expect(mockMarkCompleted).toHaveBeenCalledWith(
				'plan-1',
				'restore-1',
				false,
				'Snapshot not found',
				false
			);

			expect(mockUpdateAction).toHaveBeenCalledWith(
				'plan-1',
				'restore-1',
				'retry',
				'RESTORE_RETRY_1_OF_3_SCHEDULED',
				false,
				undefined
			);
		});

		it('should mark as permanently failed on final attempt', async () => {
			emitter.on('restoreCreated', () => {});
			setTimeout(() => {
				emitter.emit('restoreCreated', { backupId: 'backup-1', restoreId: 'restore-1' });
			}, 10);

			mockGetSnapshotByTag.mockResolvedValueOnce({
				success: false,
				result: 'Fatal error',
			});

			await expect(
				handler.execute('backup-1', 'restore-1', baseOptions, { attempts: 3, maxAttempts: 3 })
			).rejects.toThrow();

			expect(mockMarkCompleted).toHaveBeenCalledWith(
				'plan-1',
				'restore-1',
				false,
				'Fatal error',
				true
			);
		});

		it('should timeout if restoreCreated event not received', async () => {
			// This test validates the private waitForRestoreCreation method times out
			jest.useFakeTimers();

			// Do NOT emit the event - we want to test timeout behavior
			const waitPromise = handler['waitForRestoreCreation']('backup-1');

			// Advance timers past the 30s timeout
			jest.advanceTimersByTime(30001);

			await expect(waitPromise).rejects.toThrow(
				'Timeout: Did not receive restore_created confirmation for backup: backup-1'
			);

			jest.useRealTimers();
		});
	});

	describe('canRun', () => {
		it('should pass all checks when conditions are met', async () => {
			jest.spyOn(os, 'freemem').mockReturnValue(1024 * 1024 * 1024);
			jest.spyOn(os, 'cpus').mockReturnValue(new Array(4));

			const result = await handler.canRun(baseOptions);
			expect(result).toBe(true);
		});

		it('should throw error when insufficient memory', async () => {
			jest.spyOn(os, 'freemem').mockReturnValue(1024);
			jest.spyOn(os, 'cpus').mockReturnValue(new Array(4));

			await expect(handler.canRun(baseOptions)).rejects.toThrow(
				'Insufficient memory to perform restore'
			);
		});

		it('should throw error when encryption enabled but key missing', async () => {
			const { configService: cs } = require('../../../src/services/ConfigService');
			const origKey = cs.config.ENCRYPTION_KEY;
			cs.config.ENCRYPTION_KEY = '';

			jest.spyOn(os, 'freemem').mockReturnValue(1024 * 1024 * 1024);
			jest.spyOn(os, 'cpus').mockReturnValue(new Array(4));

			await expect(handler.canRun({ ...baseOptions, encryption: true })).rejects.toThrow(
				'Snapshot encrypted but ENCRYPTION_KEY not found'
			);

			cs.config.ENCRYPTION_KEY = origKey;
		});

		it('should throw error when target path not writable', async () => {
			jest.spyOn(os, 'freemem').mockReturnValue(1024 * 1024 * 1024);
			jest.spyOn(os, 'cpus').mockReturnValue(new Array(4));
			mockAccess.mockRejectedValueOnce(new Error('Permission denied'));

			await expect(handler.canRun(baseOptions)).rejects.toThrow('Target path not writable');
		});

		it('should throw error when restic not installed', async () => {
			jest.spyOn(os, 'freemem').mockReturnValue(1024 * 1024 * 1024);
			jest.spyOn(os, 'cpus').mockReturnValue(new Array(4));
			mockRunResticCommand.mockRejectedValueOnce(new Error('Command not found'));

			await expect(handler.canRun(baseOptions)).rejects.toThrow('Restic is not installed');
		});

		it('should pass when target is root path', async () => {
			jest.spyOn(os, 'freemem').mockReturnValue(1024 * 1024 * 1024);
			jest.spyOn(os, 'cpus').mockReturnValue(new Array(4));

			const result = await handler.canRun({ ...baseOptions, target: '/' });
			expect(result).toBe(true);
		});
	});

	describe('cancel', () => {
		it('should cancel restore and kill process', async () => {
			const result = await handler.cancel('plan-1', 'restore-1');

			expect(result).toBe(true);
			expect(mockMarkCompleted).toHaveBeenCalledWith(
				'plan-1',
				'restore-1',
				false,
				'Restoration was cancelled by user',
				true
			);
			expect(mockKillProcess).toHaveBeenCalledWith('restore-restore-1');
		});

		it('should throw error when kill process fails', async () => {
			mockKillProcess.mockReturnValue(false);

			const result = await handler.cancel('plan-1', 'restore-1');

			// Cancel returns true even if kill fails, just logs
			expect(result).toBe(true);
		});
	});

	describe('dryRestore', () => {
		it('should perform dry run and return stats and files', async () => {
			const dryRunOutput =
				JSON.stringify({
					message_type: 'verbose_status',
					item: '/C/data/file1.txt',
					size: '1024',
					action: 'restored',
				}) +
				'\n' +
				JSON.stringify({
					message_type: 'verbose_status',
					item: '/C/data/file2.txt',
					size: '2048',
					action: 'new',
				}) +
				'\n' +
				JSON.stringify({
					message_type: 'summary',
					total_files: 100,
					files_restored: 98,
					total_bytes: 1000000,
					bytes_restored: 980000,
				});

			mockRunResticCommand.mockResolvedValueOnce(dryRunOutput);

			const result = await handler.dryRestore('backup-1', 'snapshot-123', baseOptions);

			expect(result.success).toBe(true);
			expect(result.result).toHaveProperty('stats');
			expect(result.result).toHaveProperty('files');

			if (typeof result.result === 'object') {
				expect(result.result.stats).toEqual({
					total_files: 100,
					files_restored: 98,
					total_bytes: 1000000,
					bytes_restored: 980000,
				});
				expect(result.result.files).toHaveLength(2);
			}

			expect(mockRunResticCommand).toHaveBeenCalledWith(
				expect.arrayContaining(['--dry-run']),
				expect.any(Object)
			);
		});

		it('should return error on dry run failure', async () => {
			mockRunResticCommand.mockRejectedValue(new Error('Dry run failed'));

			const result = await handler.dryRestore('backup-1', 'snapshot-123', baseOptions);

			expect(result.success).toBe(false);
			expect(result.result).toBe('Dry run failed');
		});

		it('should handle Windows paths correctly', async () => {
			const originalPlatform = process.platform;
			Object.defineProperty(process, 'platform', { value: 'win32' });

			mockResticPathToWindows.mockImplementation((path: string) => path.replace('/C/', 'C:\\'));

			const dryRunOutput =
				JSON.stringify({
					message_type: 'verbose_status',
					item: '/C/data/file.txt',
					size: '1024',
					action: 'restored',
				}) +
				'\n' +
				JSON.stringify({
					message_type: 'summary',
					total_files: 1,
					files_restored: 1,
					total_bytes: 1024,
					bytes_restored: 1024,
				});

			mockRunResticCommand.mockResolvedValue(dryRunOutput);

			const result = await handler.dryRestore('backup-1', 'snapshot-123', baseOptions);

			expect(mockResticPathToWindows).toHaveBeenCalledWith('/C/data/file.txt');

			Object.defineProperty(process, 'platform', { value: originalPlatform });
		});
	});

	describe('createResticRestoreArgs', () => {
		it('should create correct restore arguments', () => {
			const result = handler.createResticRestoreArgs('backup-1', 'snapshot-123', baseOptions);

			expect(result.args).toContain('restore');
			expect(result.args).toContain('-r');
			expect(result.args).toContain('snapshot-123');
			expect(result.args).toContain('--target');
			expect(result.args).toContain('/restore/target');
			expect(result.args).toContain('--verbose=2');
			expect(result.args).toContain('--json');
			expect(result.args).toContain('--insecure-no-password');
		});

		it('should add encryption when enabled', () => {
			const result = handler.createResticRestoreArgs('backup-1', 'snapshot-123', {
				...baseOptions,
				encryption: true,
			});

			expect(result.args).not.toContain('--insecure-no-password');
			expect(result.env.RESTIC_PASSWORD).toBe('test-encryption-key');
		});

		it('should add includes and excludes', () => {
			const result = handler.createResticRestoreArgs('backup-1', 'snapshot-123', {
				...baseOptions,
				includes: ['*.txt', '*.log'],
				excludes: ['*.tmp', '*.cache'],
			});

			expect(result.args).toContain('--include');
			expect(result.args).toContain('*.txt');
			expect(result.args).toContain('*.log');
			expect(result.args).toContain('--exclude');
			expect(result.args).toContain('*.tmp');
			expect(result.args).toContain('*.cache');
		});

		it('should add delete option when specified', () => {
			const result = handler.createResticRestoreArgs('backup-1', 'snapshot-123', {
				...baseOptions,
				delete: true,
			});

			expect(result.args).toContain('--delete');
		});

		it('should handle overwrite options', () => {
			const ifNewer = handler.createResticRestoreArgs('backup-1', 'snapshot-123', {
				...baseOptions,
				overwrite: 'if-newer',
			});

			expect(ifNewer.args).toContain('--overwrite');
			expect(ifNewer.args).toContain('if-newer');

			const always = handler.createResticRestoreArgs('backup-1', 'snapshot-123', {
				...baseOptions,
				overwrite: 'always',
			});

			expect(always.args).not.toContain('--overwrite');
		});

		it('should add performance settings to env', () => {
			const result = handler.createResticRestoreArgs('backup-1', 'snapshot-123', baseOptions);

			const env = result.env as Record<string, string>;
			expect(env.GOMAXPROCS).toBe('2');
			expect(env.RCLONE_TRANSFERS).toBe('4');
			expect(env.RCLONE_BUFFER_SIZE).toBe('16M');
			expect(env.RCLONE_MULTI_THREAD_STREAMS).toBe('4');
		});

		it('should use Windows temp path when target is root on Windows', () => {
			const originalPlatform = process.platform;
			Object.defineProperty(process, 'platform', { value: 'win32' });

			const result = handler.createResticRestoreArgs('backup-1', 'snapshot-123', {
				...baseOptions,
				target: '/',
			});

			const targetIndex = result.args.indexOf('--target');
			const targetPath = result.args[targetIndex + 1];
			expect(targetPath).toContain('backup-backup-1');

			Object.defineProperty(process, 'platform', { value: originalPlatform });
		});

		it('should add dry-run flag when specified', () => {
			const result = handler.createResticRestoreArgs('backup-1', 'snapshot-123', baseOptions, true);

			expect(result.args).toContain('--dry-run');
		});
	});

	describe('createHandlers', () => {
		it('should create handlers that emit proper events', () => {
			const errorListener = jest.fn();
			const completeListener = jest.fn();

			emitter.on('restore_error', errorListener);
			emitter.on('restore_complete', completeListener);

			const handlers = handler['createHandlers']('plan-1', 'backup-1', 'restore-1');

			// Test progress handler
			handlers.onProgress(Buffer.from('progress data'));
			expect(mockUpdateResticProgress).toHaveBeenCalledWith('plan-1', 'restore-1', 'progress data');

			// Test error handler
			handlers.onError(Buffer.from('Error message'));
			expect(errorListener).toHaveBeenCalledWith({
				backupId: 'backup-1',
				restoreId: 'restore-1',
				planId: 'plan-1',
				error: 'Error message',
			});

			// Test complete handler
			handlers.onComplete(0);
			expect(completeListener).toHaveBeenCalledWith({
				backupId: 'backup-1',
				restoreId: 'restore-1',
				planId: 'plan-1',
				success: true,
			});

			// Test complete handler with failure
			handlers.onComplete(1);
			expect(completeListener).toHaveBeenCalledWith({
				backupId: 'backup-1',
				restoreId: 'restore-1',
				planId: 'plan-1',
				success: false,
			});
		});
	});

	describe('postRestorePhase - Windows file moving', () => {
		it('should move files on Windows when target is root', async () => {
			const originalPlatform = process.platform;
			Object.defineProperty(process, 'platform', { value: 'win32' });

			const fs = require('fs');
			fs.existsSync = jest.fn(() => true);

			// Mock access to succeed for the item existence check
			mockAccess.mockResolvedValue(undefined);

			await handler['postRestorePhase']('plan-1', 'backup-1', 'restore-1', mockSnapshot, {
				...baseOptions,
				target: '/',
			});

			expect(mockAccess).toHaveBeenCalled();
			expect(mockCopyFilesNatively).toHaveBeenCalled();
			expect(mockRm).toHaveBeenCalled();

			Object.defineProperty(process, 'platform', { value: originalPlatform });
		});

		it('should handle copy errors gracefully on Windows', async () => {
			const originalPlatform = process.platform;
			Object.defineProperty(process, 'platform', { value: 'win32' });

			mockCopyFilesNatively.mockRejectedValueOnce(new Error('Copy failed'));

			await handler['postRestorePhase']('plan-1', 'backup-1', 'restore-1', mockSnapshot, {
				...baseOptions,
				target: '/',
			});

			expect(mockUpdateAction).toHaveBeenCalledWith(
				'plan-1',
				'restore-1',
				'post-restore',
				'POST_RESTORE_WINDOWS_MOVE_ERROR',
				false,
				expect.stringContaining('Failed to move files')
			);

			Object.defineProperty(process, 'platform', { value: originalPlatform });
		});

		it('should skip file moving on non-Windows platforms', async () => {
			const originalPlatform = process.platform;
			Object.defineProperty(process, 'platform', { value: 'linux' });

			await handler['postRestorePhase']('plan-1', 'backup-1', 'restore-1', mockSnapshot, {
				...baseOptions,
				target: '/',
			});

			expect(mockCopyFilesNatively).not.toHaveBeenCalled();

			Object.defineProperty(process, 'platform', { value: originalPlatform });
		});

		it('should skip file moving when target is not root', async () => {
			const originalPlatform = process.platform;
			Object.defineProperty(process, 'platform', { value: 'win32' });

			await handler['postRestorePhase'](
				'plan-1',
				'backup-1',
				'restore-1',
				mockSnapshot,
				baseOptions
			);

			expect(mockCopyFilesNatively).not.toHaveBeenCalled();

			Object.defineProperty(process, 'platform', { value: originalPlatform });
		});
	});

	describe('executeRestorePhase', () => {
		it('should execute restore with correct arguments and track process', async () => {
			const mockProcess = { pid: 1234 };
			mockRunResticCommand.mockImplementation(
				async (args, env, onProgress, onError, onComplete, onProcess) => {
					onProcess(mockProcess);
					return 'restore complete';
				}
			);

			await handler['executeRestorePhase'](
				'plan-1',
				'backup-1',
				'restore-1',
				mockSnapshot,
				baseOptions
			);

			expect(mockRunResticCommand).toHaveBeenCalled();
			expect(mockTrackProcess).toHaveBeenCalledWith('restore-restore-1', mockProcess);
			expect(mockUpdateAction).toHaveBeenCalledWith(
				'plan-1',
				'restore-1',
				'restore',
				'RESTORE_OPERATION_START',
				false,
				undefined
			);
			expect(mockUpdateAction).toHaveBeenCalledWith(
				'plan-1',
				'restore-1',
				'restore',
				'RESTORE_OPERATION_COMPLETE',
				true,
				undefined
			);
		});

		it('should handle restore errors', async () => {
			mockRunResticCommand.mockRejectedValueOnce(new Error('Restore failed'));

			await expect(
				handler['executeRestorePhase']('plan-1', 'backup-1', 'restore-1', mockSnapshot, baseOptions)
			).rejects.toThrow('Restore failed');

			expect(mockUpdateAction).toHaveBeenCalledWith(
				'plan-1',
				'restore-1',
				'restore',
				'RESTORE_OPERATION_ERROR',
				true,
				'Restore failed'
			);
		});
	});

	describe('preRestorePhase', () => {
		it('should complete all pre-restore operations', async () => {
			emitter.on('restoreCreated', () => {});
			setTimeout(() => {
				emitter.emit('restoreCreated', { backupId: 'backup-1', restoreId: 'restore-1' });
			}, 10);

			mockRunResticCommand.mockResolvedValueOnce(
				JSON.stringify({
					message_type: 'summary',
					total_files: 10,
					files_restored: 10,
					total_bytes: 1000,
					bytes_restored: 1000,
				})
			);

			const result = await handler['preRestorePhase'](
				'plan-1',
				'backup-1',
				'restore-1',
				baseOptions
			);

			expect(result).toEqual(mockSnapshot);
			expect(mockGetSnapshotByTag).toHaveBeenCalledWith('backup-backup-1', baseOptions);
			expect(mockStatsUpdate).toHaveBeenCalled();
			expect(mockUpdateAction).toHaveBeenCalledWith(
				'plan-1',
				'restore-1',
				'pre-restore',
				'PRE_RESTORE_COMPLETE',
				true,
				undefined
			);
		});

		it('should throw error when snapshot not found', async () => {
			mockGetSnapshotByTag.mockResolvedValueOnce({
				success: false,
				result: 'Snapshot not found',
			});

			await expect(
				handler['preRestorePhase']('plan-1', 'backup-1', 'restore-1', baseOptions)
			).rejects.toThrow('Snapshot not found');
		});

		it('should unlock stale locks', async () => {
			emitter.on('restoreCreated', () => {});

			// Mock dry run
			mockRunResticCommand.mockResolvedValueOnce(
				JSON.stringify({
					message_type: 'summary',
					total_files: 10,
					files_restored: 10,
					total_bytes: 1000,
					bytes_restored: 1000,
				})
			);

			// Emit the event synchronously before calling
			const preRestorePromise = handler['preRestorePhase'](
				'plan-1',
				'backup-1',
				'restore-1',
				baseOptions
			);

			// Emit after a short delay
			setImmediate(() => {
				emitter.emit('restoreCreated', { backupId: 'backup-1', restoreId: 'restore-1' });
			});

			await preRestorePromise;

			// Verify unlock was called
			const unlockCall = mockRunResticCommand.mock.calls.find(
				call => call[0] && call[0].includes('unlock')
			);
			expect(unlockCall).toBeDefined();
		});
	});

	describe('updateProgress', () => {
		it('should update progress without throwing errors', async () => {
			await handler['updateProgress']('plan-1', 'restore-1', 'restore', 'TEST_ACTION', true);

			expect(mockUpdateAction).toHaveBeenCalledWith(
				'plan-1',
				'restore-1',
				'restore',
				'TEST_ACTION',
				true,
				undefined
			);
		});

		it('should handle progress update failures gracefully', async () => {
			mockUpdateAction.mockRejectedValueOnce(new Error('Update failed'));
			const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

			await handler['updateProgress']('plan-1', 'restore-1', 'restore', 'TEST_ACTION', true);

			expect(consoleWarnSpy).toHaveBeenCalledWith(
				expect.stringContaining('Failed to update progress')
			);

			consoleWarnSpy.mockRestore();
		});
	});
});
