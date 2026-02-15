// Mocks
const mockRunResticCommand = jest.fn();
const mockGetBackupPlanStats = jest.fn();
const mockGenerateResticRepoPath = jest.fn();
const mockTrackProcess = jest.fn();
const mockKillProcess = jest.fn();
const mockInitialize = jest.fn();
const mockInitializeProgress = jest.fn();
const mockUpdateAction = jest.fn();
const mockUpdateResticProgress = jest.fn();
const mockGetResticProgress = jest.fn();
const mockMarkCompleted = jest.fn();

jest.mock('../../../src/utils/restic/restic', () => ({
	runResticCommand: (...args: any[]) => mockRunResticCommand(...args),
	getBackupPlanStats: (...args: any[]) => mockGetBackupPlanStats(...args),
}));

jest.mock('../../../src/utils/restic/helpers', () => ({
	generateResticRepoPath: (...args: any[]) => mockGenerateResticRepoPath(...args),
}));

jest.mock('../../../src/managers/ProcessManager', () => ({
	processManager: {
		trackProcess: (...args: any[]) => mockTrackProcess(...args),
		killProcess: (...args: any[]) => mockKillProcess(...args),
	},
}));

jest.mock('../../../src/managers/handlers/PruneHandler', () => ({
	PruneHandler: jest.fn().mockImplementation(() => ({
		prune: jest.fn().mockResolvedValue({ success: true, result: 'Pruned' }),
	})),
}));

jest.mock('../../../src/managers/ProgressManager', () => ({
	ProgressManager: jest.fn().mockImplementation(() => ({
		initialize: mockInitialize,
		initializeProgress: mockInitializeProgress,
		updateAction: mockUpdateAction,
		updateResticProgress: mockUpdateResticProgress,
		getResticProgress: mockGetResticProgress,
		markCompleted: mockMarkCompleted,
	})),
}));

jest.mock('../../../src/utils/AppPaths', () => ({
	appPaths: {
		getProgressDir: jest.fn(() => '/mock/progress/dir'),
		getTempDir: jest.fn(() => '/mock/temp/dir'),
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

import { EventEmitter } from 'events';
import { BackupHandler } from '../../../src/managers/handlers/BackupHandler';
import os from 'os';
import fs from 'fs';

describe('BackupHandler', () => {
	let handler: BackupHandler;
	let emitter: EventEmitter;

	const baseOptions = {
		id: 'plan-1',
		title: 'Test Plan',
		method: 'backup',
		storage: { name: 'test-storage', type: 'rclone' },
		storagePath: 'backups/test',
		settings: {
			encryption: false,
			compression: true,
			performance: {
				maxProcessor: 2,
				packSize: '16MiB',
			},
		},
		sourceConfig: {
			includes: ['C:\\data'],
			excludes: ['C:\\temp'],
		},
		resticArgs: ['backup', 'C:\\data', '-r', 'test-repo'],
		resticEnv: { GOMAXPROCS: '2' },
	};

	beforeEach(() => {
		jest.clearAllMocks();
		emitter = new EventEmitter();
		handler = new BackupHandler(emitter);

		// Default mock implementations
		mockRunResticCommand.mockResolvedValue('{"message_type":"summary"}');
		mockGetBackupPlanStats.mockResolvedValue({
			total_size: 1000000,
			snapshots: ['backup-1'],
		});
		mockGenerateResticRepoPath.mockReturnValue('rclone:test-storage:backups/test');
		mockInitialize.mockResolvedValue(undefined);
		mockInitializeProgress.mockResolvedValue(undefined);
		mockUpdateAction.mockResolvedValue(undefined);
		mockUpdateResticProgress.mockResolvedValue(undefined);
		mockGetResticProgress.mockResolvedValue({ percent_done: 1 });
		mockMarkCompleted.mockResolvedValue(undefined);
		mockKillProcess.mockReturnValue(true);

		process.env.ENCRYPTION_KEY = 'test-key';

		// Mock fs.promises.access
		jest.spyOn(fs.promises, 'access').mockResolvedValue(undefined);
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	describe('execute', () => {
		it('should successfully execute backup with all phases', async () => {
			const backupCreatedListener = jest.fn();
			emitter.on('backup_created', backupCreatedListener);

			// Simulate backup_created event after dry run
			mockRunResticCommand.mockImplementationOnce(async () => {
				setTimeout(() => {
					emitter.emit('backup_created', { planId: 'plan-1', backupId: 'backup-1' });
				}, 10);
				return '{"files_new":10,"total_files_processed":10}';
			});

			const result = await handler.execute('plan-1', 'backup-1', baseOptions, {
				attempts: 0,
				maxAttempts: 3,
			});

			expect(result).toBeDefined();
			expect(mockInitializeProgress).toHaveBeenCalledWith('plan-1', 'backup-1', {
				attempts: 0,
				maxAttempts: 3,
			});
			expect(mockUpdateAction).toHaveBeenCalledWith(
				'plan-1',
				'backup-1',
				'pre-backup',
				'PRE_BACKUP_START',
				false,
				undefined
			);
			expect(mockMarkCompleted).toHaveBeenCalledWith('plan-1', 'backup-1', true);
		});

		it('should prevent concurrent backups for same plan', async () => {
			// Make the check deterministic by pre-populating the runningBackups set
			handler['runningBackups'].add('plan-1');

			await expect(
				handler.execute('plan-1', 'backup-2', baseOptions, { attempts: 0, maxAttempts: 3 })
			).rejects.toThrow('Backup is already in progress for plan: plan-1');

			// cleanup
			handler['runningBackups'].delete('plan-1');
		});

		it('should handle retry attempts correctly', async () => {
			emitter.on('backup_created', () => {});
			setTimeout(() => {
				emitter.emit('backup_created', { planId: 'plan-1', backupId: 'backup-1' });
			}, 10);

			await handler.execute('plan-1', 'backup-1', baseOptions, { attempts: 2, maxAttempts: 5 });

			expect(mockUpdateAction).toHaveBeenCalledWith(
				'plan-1',
				'backup-1',
				'pre-backup',
				'RETRY_ATTEMPT_2_OF_5_START',
				false,
				undefined
			);
		});

		it('should handle cancellation during execution', async () => {
			mockRunResticCommand.mockImplementationOnce(async () => {
				throw new Error('BACKUP_CANCELLED: Backup was cancelled');
			});

			// Because the error is wrapped by dryRunBackup as "Dry run failed: BACKUP_CANCELLED...",
			// it won't be recognized as a cancellation and will throw
			await expect(
				handler.execute('plan-1', 'backup-1', baseOptions, {
					attempts: 0,
					maxAttempts: 3,
				})
			).rejects.toThrow('Dry run failed: BACKUP_CANCELLED');
		});

		it('should emit error event and schedule retry on non-final failure', async () => {
			const errorListener = jest.fn();
			emitter.on('backup_error', errorListener);

			emitter.on('backup_created', () => {});
			setTimeout(() => {
				emitter.emit('backup_created', { planId: 'plan-1', backupId: 'backup-1' });
			}, 10);

			mockRunResticCommand.mockRejectedValueOnce(new Error('Network error'));

			await expect(
				handler.execute('plan-1', 'backup-1', baseOptions, { attempts: 0, maxAttempts: 3 })
			).rejects.toThrow();

			expect(errorListener).toHaveBeenCalledWith({
				planId: 'plan-1',
				backupId: 'backup-1',
				error: 'Dry run failed: Network error',
			});

			expect(mockMarkCompleted).toHaveBeenCalledWith(
				'plan-1',
				'backup-1',
				false,
				'Dry run failed: Network error',
				false
			);

			expect(mockUpdateAction).toHaveBeenCalledWith(
				'plan-1',
				'backup-1',
				'retry',
				'BACKUP_RETRY_1_OF_3_SCHEDULED',
				false,
				undefined
			);
		});

		it('should mark as permanently failed on final attempt', async () => {
			emitter.on('backup_created', () => {});
			setTimeout(() => {
				emitter.emit('backup_created', { planId: 'plan-1', backupId: 'backup-1' });
			}, 10);

			mockRunResticCommand.mockRejectedValueOnce(new Error('Fatal error'));

			await expect(
				handler.execute('plan-1', 'backup-1', baseOptions, { attempts: 3, maxAttempts: 3 })
			).rejects.toThrow();

			expect(mockMarkCompleted).toHaveBeenCalledWith(
				'plan-1',
				'backup-1',
				false,
				'Dry run failed: Fatal error',
				true
			);
		});

		it('should timeout if backup_created event not received (waitForBackupCreation)', async () => {
			// Test the private waitForBackupCreation directly using fake timers
			jest.useFakeTimers();

			const waitPromise = handler['waitForBackupCreation']('plan-1', 'backup-1');

			// advance timers past the 30s timeout
			jest.advanceTimersByTime(30000 + 1000);

			await expect(waitPromise).rejects.toThrow(
				'Timeout: Did not receive backup_created confirmation for ID: backup-1'
			);

			jest.useRealTimers();
		});
	});

	describe('createResticBackupArgs', () => {
		it('builds correct restic args and env', () => {
			const { resticArgs, resticEnv } = handler.createResticBackupArgs(
				'plan-123',
				baseOptions as any
			);

			// Includes
			expect(resticArgs).toContain('C:\\data');

			// Excludes
			const excludeArgsStr = resticArgs.join(' ');
			expect(excludeArgsStr).toContain('--exclude');
			expect(excludeArgsStr).toContain('C:\\temp');

			// Repo path
			expect(resticArgs).toContain('-r');
			expect(resticArgs).toContain('rclone:test-storage:backups/test');

			// Compression
			expect(resticArgs).toContain('--compression');
			expect(resticArgs).toContain('auto');

			// Performance
			expect(resticArgs).toContain('--pack-size');
			expect(resticArgs).toContain('16MiB');

			// Env variables for performance
			expect(resticEnv.GOMAXPROCS).toBe('2');

			// No encryption => insecure flag
			expect(resticArgs).toContain('--insecure-no-password');

			// Tag and json
			expect(resticArgs).toContain('--tag');
			expect(resticArgs).toContain('plan-plan-123');
			expect(resticArgs).toContain('--json');
		});

		it('handles empty includes and excludes', () => {
			const optionsWithoutPaths = {
				...baseOptions,
				sourceConfig: {
					includes: [],
					excludes: [],
				},
			};
			const { resticArgs } = handler.createResticBackupArgs(
				'plan-empty',
				optionsWithoutPaths as any
			);

			expect(resticArgs).toContain('backup');
			expect(resticArgs).toContain('-r');
			expect(resticArgs).not.toContain('--exclude');
		});

		it('handles missing sourceConfig', () => {
			const optionsWithoutSource = {
				...baseOptions,
				sourceConfig: undefined,
			};
			const { resticArgs } = handler.createResticBackupArgs(
				'plan-no-source',
				optionsWithoutSource as any
			);

			expect(resticArgs).toContain('backup');
			expect(resticArgs).toContain('-r');
		});

		it('skips paths starting with dash', () => {
			const optionsWithDashPaths = {
				...baseOptions,
				sourceConfig: {
					includes: ['C:\\data', '-skipped', 'C:\\included'],
					excludes: ['C:\\temp', '-also-skipped'],
				},
			};
			const { resticArgs } = handler.createResticBackupArgs(
				'plan-dash',
				optionsWithDashPaths as any
			);

			expect(resticArgs).toContain('C:\\data');
			expect(resticArgs).toContain('C:\\included');
			expect(resticArgs).not.toContain('-skipped');
			expect(resticArgs).not.toContain('-also-skipped');
		});

		it('handles encryption enabled', () => {
			const encryptedOptions = {
				...baseOptions,
				settings: {
					...baseOptions.settings,
					encryption: true,
				},
			};
			const { resticArgs } = handler.createResticBackupArgs(
				'plan-encrypted',
				encryptedOptions as any
			);

			expect(resticArgs).not.toContain('--insecure-no-password');
		});

		it('handles missing compression', () => {
			const noCompressionOptions = {
				...baseOptions,
				settings: {
					...baseOptions.settings,
					compression: false,
				},
			};
			const { resticArgs } = handler.createResticBackupArgs(
				'plan-no-compression',
				noCompressionOptions as any
			);

			expect(resticArgs).not.toContain('--compression');
		});

		it('handles minimal performance settings', () => {
			const minimalPerformance = {
				...baseOptions,
				settings: {
					...baseOptions.settings,
					performance: {
						scan: true, // scan enabled, no --no-scan flag
					},
				},
			};
			const { resticArgs, resticEnv } = handler.createResticBackupArgs(
				'plan-minimal',
				minimalPerformance as any
			);

			expect(resticArgs).not.toContain('--no-scan');
			expect(resticArgs).not.toContain('--pack-size');
			expect(resticEnv.GOMAXPROCS).toBeUndefined();
		});

		it('handles missing storage name', () => {
			const noStorageName = {
				...baseOptions,
				storage: {
					...baseOptions.storage,
					name: '',
				},
			};
			const { resticArgs } = handler.createResticBackupArgs(
				'plan-no-storage',
				noStorageName as any
			);

			expect(resticArgs).not.toContain('-r');
		});

		it('handles empty storagePath', () => {
			const emptyPath = {
				...baseOptions,
				storagePath: '',
			};

			const { resticArgs } = handler.createResticBackupArgs('plan-empty-path', emptyPath as any);

			// Verify generateResticRepoPath was called with empty storagePath
			expect(mockGenerateResticRepoPath).toHaveBeenCalledWith('test-storage', '');
			// The mock will return whatever it's configured to return (the default from beforeEach)
			// but the important thing is that it was called with the correct parameters
		});

		it('handles ip# pattern in includes', () => {
			const optionsWithPattern = {
				...baseOptions,
				sourceConfig: {
					includes: ['ip#C:\\pattern\\*'],
					excludes: [],
				},
			};
			const { resticArgs } = handler.createResticBackupArgs(
				'plan-pattern',
				optionsWithPattern as any
			);

			expect(resticArgs).toContain('C:\\pattern\\*');
			expect(resticArgs).not.toContain('ip#');
		});

		it('handles ep# pattern in excludes', () => {
			const optionsWithPattern = {
				...baseOptions,
				sourceConfig: {
					includes: ['C:\\data'],
					excludes: ['ep#C:\\exclude\\*'],
				},
			};
			const { resticArgs } = handler.createResticBackupArgs(
				'plan-exclude-pattern',
				optionsWithPattern as any
			);

			const argsStr = resticArgs.join(' ');
			expect(argsStr).toContain('C:\\exclude\\*');
			expect(argsStr).not.toContain('ep#');
		});

		it('sets performance env variables correctly', () => {
			const optionsWithPerf = {
				...baseOptions,
				settings: {
					...baseOptions.settings,
					performance: {
						maxProcessor: 4,
						transfers: 10,
						bufferSize: '64M',
						multiThreadStream: 8,
					},
				},
			};
			const { resticEnv } = handler.createResticBackupArgs('plan-perf', optionsWithPerf as any);

			expect(resticEnv.GOMAXPROCS).toBe('4');
			expect(resticEnv.RCLONE_TRANSFERS).toBe('10');
			expect(resticEnv.RCLONE_BUFFER_SIZE).toBe('64M');
			expect(resticEnv.RCLONE_MULTI_THREAD_STREAMS).toBe('8');
		});
	});

	describe('canRun', () => {
		it('should pass all checks when conditions are met', async () => {
			jest.spyOn(os, 'freemem').mockReturnValue(1024 * 1024 * 1024);
			jest.spyOn(os, 'cpus').mockReturnValue(new Array(4));

			const resticArgsAndEnv = handler.createResticBackupArgs('plan-1', baseOptions as any);
			const result = await handler.canRun(baseOptions, resticArgsAndEnv);
			expect(result).toBe(true);
		});

		it('should throw error when insufficient memory', async () => {
			jest.spyOn(os, 'freemem').mockReturnValue(1024);
			jest.spyOn(os, 'cpus').mockReturnValue(new Array(4));

			const resticArgsAndEnv = handler.createResticBackupArgs('plan-1', baseOptions as any);
			await expect(handler.canRun(baseOptions, resticArgsAndEnv)).rejects.toThrow(
				'Insufficient memory'
			);
		});

		it('should throw error when encryption enabled but key missing', async () => {
			const { configService: cs } = require('../../../src/services/ConfigService');
			const origKey = cs.config.ENCRYPTION_KEY;
			cs.config.ENCRYPTION_KEY = '';
			// The maxProcessor is 2, so required memory is 64MB * 2 = 128MB
			// Provide way more than needed to ensure this check passes
			jest.spyOn(os, 'freemem').mockReturnValue(1024 * 1024 * 1024); // 1GB

			const encryptedOptions = {
				...baseOptions,
				settings: {
					...baseOptions.settings,
					encryption: true,
				},
			};
			const resticArgsAndEnv = handler.createResticBackupArgs('plan-1', encryptedOptions as any);

			await expect(handler.canRun(encryptedOptions, resticArgsAndEnv)).rejects.toThrow(
				'Encryption enabled but ENCRYPTION_KEY not found'
			);

			cs.config.ENCRYPTION_KEY = origKey;
		});

		it('should throw error when source paths not accessible', async () => {
			jest.spyOn(os, 'freemem').mockReturnValue(1024 * 1024 * 1024);
			jest.spyOn(fs.promises, 'access').mockRejectedValue(new Error('Path not found'));

			const resticArgsAndEnv = handler.createResticBackupArgs('plan-1', baseOptions as any);
			await expect(handler.canRun(baseOptions, resticArgsAndEnv)).rejects.toThrow(
				'Source paths not accessible'
			);
		});
	});

	describe('cancel', () => {
		it('should cancel backup and kill process', async () => {
			const result = await handler.cancel('plan-1', 'backup-1');

			expect(result).toBe(true);
			expect(mockMarkCompleted).toHaveBeenCalledWith(
				'plan-1',
				'backup-1',
				false,
				'Backup was cancelled by user',
				true
			);
			expect(mockKillProcess).toHaveBeenCalledWith('backup-backup-1');
		});

		it('should return true even when kill process fails', async () => {
			mockKillProcess.mockReturnValue(false);

			const result = await handler.cancel('plan-1', 'backup-1');

			expect(result).toBe(true);
		});
	});

	describe('dryRunBackup', () => {
		it('should perform dry run and return summary', async () => {
			const summary = { files_new: 10, total_files_processed: 10 };
			mockRunResticCommand.mockResolvedValue(`line1\nline2\n${JSON.stringify(summary)}`);

			const resticArgsAndEnv = handler.createResticBackupArgs('plan-1', baseOptions as any);
			const result = await handler['dryRunBackup']('plan-1', baseOptions, resticArgsAndEnv);

			expect(result).toEqual(summary);
			expect(mockRunResticCommand).toHaveBeenCalledWith(
				expect.arrayContaining(['--dry-run']),
				expect.any(Object)
			);
		});

		it('should throw error on dry run failure', async () => {
			mockRunResticCommand.mockRejectedValue(new Error('Dry run failed'));

			const resticArgsAndEnv = handler.createResticBackupArgs('plan-1', baseOptions as any);
			await expect(
				handler['dryRunBackup']('plan-1', baseOptions, resticArgsAndEnv)
			).rejects.toThrow('Dry run failed');
		});

		it('should add --one-file-system for rescue method', async () => {
			const summary = { files_new: 5 };
			mockRunResticCommand.mockResolvedValue(`${JSON.stringify(summary)}`);

			const rescueOptions = { ...baseOptions, method: 'rescue' };
			const resticArgsAndEnv = handler.createResticBackupArgs('plan-1', rescueOptions as any);
			await handler['dryRunBackup']('plan-1', rescueOptions, resticArgsAndEnv);

			expect(mockRunResticCommand).toHaveBeenCalledWith(
				expect.arrayContaining(['--one-file-system']),
				expect.any(Object)
			);
		});
	});

	describe('createHandlers', () => {
		it('should create handlers that emit proper events', async () => {
			const progressListener = jest.fn();
			const errorListener = jest.fn();
			const completeListener = jest.fn();

			emitter.on('backup_progress', progressListener);
			emitter.on('backup_error', errorListener);
			emitter.on('backup_complete', completeListener);

			const handlers = handler['createHandlers']('plan-1', 'backup-1');

			// Test progress handler
			const progressData = JSON.stringify({ percent_done: 0.5 });
			handlers.onProgress(Buffer.from(progressData));
			expect(progressListener).toHaveBeenCalledWith({
				planId: 'plan-1',
				backupId: 'backup-1',
				data: { percent_done: 0.5 },
			});

			// Test error handler
			handlers.onError(Buffer.from('Error message'));
			expect(errorListener).toHaveBeenCalledWith({
				planId: 'plan-1',
				backupId: 'backup-1',
				error: 'Error message',
			});

			// Test complete handler (it's async)
			await handlers.onComplete(0);
			expect(completeListener).toHaveBeenCalledWith({
				planId: 'plan-1',
				backupId: 'backup-1',
				success: true,
				summary: expect.any(Object),
			});
		});

		it('should handle non-JSON progress lines gracefully', () => {
			const handlers = handler['createHandlers']('plan-1', 'backup-1');

			// Should not throw
			expect(() => {
				handlers.onProgress(Buffer.from('non-json line'));
			}).not.toThrow();
		});
	});

	describe('executeBackupPhase', () => {
		it('should execute backup with correct arguments and track process', async () => {
			const mockProcess = { pid: 1234 };
			mockRunResticCommand.mockImplementation(
				async (args, env, onProgress, onError, onComplete, onProcess) => {
					onProcess(mockProcess);
					return '{}';
				}
			);

			const resticArgsAndEnv = handler.createResticBackupArgs('plan-1', baseOptions as any);
			await handler['executeBackupPhase']('plan-1', 'backup-1', baseOptions, resticArgsAndEnv);

			expect(mockRunResticCommand).toHaveBeenCalledWith(
				expect.arrayContaining(['--tag', 'backup-backup-1']),
				expect.objectContaining({ RESTIC_PASSWORD: '' }),
				expect.any(Function),
				expect.any(Function),
				expect.any(Function),
				expect.any(Function)
			);

			expect(mockTrackProcess).toHaveBeenCalledWith('backup-backup-1', mockProcess);
		});

		it('should use encryption key when encryption is enabled', async () => {
			const encryptedOptions = {
				...baseOptions,
				settings: { ...baseOptions.settings, encryption: true },
			};

			const resticArgsAndEnv = handler.createResticBackupArgs('plan-1', encryptedOptions as any);
			await handler['executeBackupPhase']('plan-1', 'backup-1', encryptedOptions, resticArgsAndEnv);

			expect(mockRunResticCommand).toHaveBeenCalledWith(
				expect.any(Array),
				expect.objectContaining({ RESTIC_PASSWORD: 'test-encryption-key' }),
				expect.any(Function),
				expect.any(Function),
				expect.any(Function),
				expect.any(Function)
			);
		});
	});

	describe('postBackupPhase', () => {
		it('should complete all post-backup operations successfully', async () => {
			const statsUpdateListener = jest.fn();
			emitter.on('backup_stats_update', statsUpdateListener);

			await handler['postBackupPhase']('plan-1', 'backup-1', baseOptions);

			expect(mockUpdateAction).toHaveBeenCalledWith(
				'plan-1',
				'backup-1',
				'post-backup',
				'POST_BACKUP_START',
				false,
				undefined
			);

			expect(mockGetBackupPlanStats).toHaveBeenCalled();
			expect(statsUpdateListener).toHaveBeenCalledWith({
				planId: 'plan-1',
				backupId: 'backup-1',
				total_size: 1000000,
				snapshots: ['backup-1'],
			});

			expect(mockUpdateAction).toHaveBeenCalledWith(
				'plan-1',
				'backup-1',
				'post-backup',
				'POST_BACKUP_COMPLETE',
				true,
				undefined
			);
		});

		it('should handle prune failure gracefully', async () => {
			const { PruneHandler } = require('../../../src/managers/handlers/PruneHandler');
			PruneHandler.mockImplementation(() => ({
				prune: jest.fn().mockRejectedValue(new Error('Prune failed')),
			}));

			const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

			await handler['postBackupPhase']('plan-1', 'backup-1', baseOptions);

			expect(consoleWarnSpy).toHaveBeenCalledWith(
				expect.stringContaining('Failed to prune repository')
			);

			expect(mockUpdateAction).toHaveBeenCalledWith(
				'plan-1',
				'backup-1',
				'post-backup',
				'POST_BACKUP_PRUNE_FAILED',
				true,
				'Prune failed'
			);

			consoleWarnSpy.mockRestore();
		});

		it('should handle stats update failure gracefully', async () => {
			mockGetBackupPlanStats.mockResolvedValue(false);

			const statsUpdateListener = jest.fn();
			emitter.on('backup_stats_update', statsUpdateListener);

			await handler['postBackupPhase']('plan-1', 'backup-1', baseOptions);

			// Should still complete the phase
			const calls = mockUpdateAction.mock.calls;
			const completeCall = calls.find(call => call[3] === 'POST_BACKUP_REPO_STATS_COMPLETE');
			expect(completeCall).toBeDefined();
		});

		it('should emit stats update event with error on stats failure', async () => {
			const statsUpdateListener = jest.fn();
			emitter.on('backup_stats_update', statsUpdateListener);

			mockGetBackupPlanStats.mockRejectedValueOnce(new Error('Stats error'));

			await handler['postBackupPhase']('plan-1', 'backup-1', baseOptions);

			expect(statsUpdateListener).toHaveBeenCalledWith({
				planId: 'plan-1',
				backupId: 'backup-1',
				error: 'Stats error',
			});
		});
	});

	describe('preBackupPhase', () => {
		it('should complete all pre-backup operations successfully', async () => {
			const backupStartListener = jest.fn();
			emitter.on('backup_start', backupStartListener);

			mockRunResticCommand.mockResolvedValueOnce('{"files_new":10,"total_files_processed":10}');

			setTimeout(() => {
				emitter.emit('backup_created', { planId: 'plan-1', backupId: 'backup-1' });
			}, 10);

			const resticArgsAndEnv = handler.createResticBackupArgs('plan-1', baseOptions as any);
			await handler['preBackupPhase']('plan-1', 'backup-1', baseOptions, resticArgsAndEnv);

			expect(mockUpdateAction).toHaveBeenCalledWith(
				'plan-1',
				'backup-1',
				'pre-backup',
				'PRE_BACKUP_START',
				false,
				undefined
			);

			expect(mockUpdateAction).toHaveBeenCalledWith(
				'plan-1',
				'backup-1',
				'pre-backup',
				'PRE_BACKUP_COMPLETE',
				true,
				undefined
			);

			expect(backupStartListener).toHaveBeenCalled();
		});

		it('should handle dry run errors correctly', async () => {
			mockRunResticCommand.mockRejectedValueOnce(new Error('Dry run error'));

			const resticArgsAndEnv = handler.createResticBackupArgs('plan-1', baseOptions as any);
			await expect(
				handler['preBackupPhase']('plan-1', 'backup-1', baseOptions, resticArgsAndEnv)
			).rejects.toThrow('Dry run failed: Dry run error');

			expect(mockUpdateAction).toHaveBeenCalledWith(
				'plan-1',
				'backup-1',
				'pre-backup',
				'PRE_BACKUP_DRY_RUN_ERROR',
				false,
				'Dry run failed: Dry run error'
			);
		});

		it('should unlock stale locks during pre-backup', async () => {
			mockRunResticCommand
				.mockResolvedValueOnce('{"files_new":5,"total_files_processed":5}')
				.mockResolvedValueOnce('unlocked'); // unlock command

			setTimeout(() => {
				emitter.emit('backup_created', { planId: 'plan-1', backupId: 'backup-1' });
			}, 10);

			const resticArgsAndEnv = handler.createResticBackupArgs('plan-1', baseOptions as any);
			await handler['preBackupPhase']('plan-1', 'backup-1', baseOptions, resticArgsAndEnv);

			expect(mockGenerateResticRepoPath).toHaveBeenCalledWith('test-storage', 'backups/test');

			// Verify unlock command was called
			const unlockCall = mockRunResticCommand.mock.calls.find(call => call[0].includes('unlock'));
			expect(unlockCall).toBeDefined();
		});
	});

	describe('unlockStaleLocks', () => {
		it('should unlock stale locks with correct arguments', async () => {
			const resticArgsAndEnv = handler.createResticBackupArgs('plan-1', baseOptions as any);
			await handler['unlockStaleLocks']('plan-1', baseOptions, resticArgsAndEnv);

			expect(mockRunResticCommand).toHaveBeenCalledWith(
				['unlock', '-r', 'rclone:test-storage:backups/test'],
				expect.objectContaining({ RESTIC_PASSWORD: '' })
			);
		});

		it('should use encryption key when encryption is enabled', async () => {
			const encryptedOptions = {
				...baseOptions,
				settings: { ...baseOptions.settings, encryption: true },
			};

			const resticArgsAndEnv = handler.createResticBackupArgs('plan-1', encryptedOptions as any);
			await handler['unlockStaleLocks']('plan-1', encryptedOptions, resticArgsAndEnv);

			expect(mockRunResticCommand).toHaveBeenCalledWith(
				expect.any(Array),
				expect.objectContaining({ RESTIC_PASSWORD: 'test-encryption-key' })
			);
		});

		it('should handle unlock failures gracefully', async () => {
			const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
			mockRunResticCommand.mockRejectedValueOnce(new Error('Unlock failed'));

			const resticArgsAndEnv = handler.createResticBackupArgs('plan-1', baseOptions as any);
			await handler['unlockStaleLocks']('plan-1', baseOptions, resticArgsAndEnv);

			expect(consoleWarnSpy).toHaveBeenCalledWith(
				expect.stringContaining('Failed to unlock stale locks')
			);

			consoleWarnSpy.mockRestore();
		});

		it('should not attempt unlock if storage is missing', async () => {
			const optionsNoStorage = { ...baseOptions, storage: null };

			// Create a minimal resticArgsAndEnv since createResticBackupArgs won't work with null storage
			const resticArgsAndEnv = { resticArgs: [], resticEnv: {} };
			await handler['unlockStaleLocks']('plan-1', optionsNoStorage, resticArgsAndEnv);

			expect(mockRunResticCommand).not.toHaveBeenCalled();
		});

		it('should not attempt unlock if storagePath is missing', async () => {
			const optionsNoPath = { ...baseOptions, storagePath: null };

			// Create a minimal resticArgsAndEnv for this test
			const resticArgsAndEnv = { resticArgs: [], resticEnv: {} };
			await handler['unlockStaleLocks']('plan-1', optionsNoPath, resticArgsAndEnv);

			expect(mockRunResticCommand).not.toHaveBeenCalled();
		});
	});

	describe('updateProgress', () => {
		it('should update progress without throwing errors', async () => {
			await handler['updateProgress']('plan-1', 'backup-1', 'backup', 'TEST_ACTION', true);

			expect(mockUpdateAction).toHaveBeenCalledWith(
				'plan-1',
				'backup-1',
				'backup',
				'TEST_ACTION',
				true,
				undefined
			);
		});

		it('should handle progress update failures gracefully', async () => {
			mockUpdateAction.mockRejectedValueOnce(new Error('Update failed'));
			const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

			await handler['updateProgress']('plan-1', 'backup-1', 'backup', 'TEST_ACTION', true);

			expect(consoleWarnSpy).toHaveBeenCalledWith(
				expect.stringContaining('Failed to update progress')
			);

			consoleWarnSpy.mockRestore();
		});

		it('should include error message when provided', async () => {
			await handler['updateProgress'](
				'plan-1',
				'backup-1',
				'backup',
				'TEST_ACTION',
				false,
				'Test error'
			);

			expect(mockUpdateAction).toHaveBeenCalledWith(
				'plan-1',
				'backup-1',
				'backup',
				'TEST_ACTION',
				false,
				'Test error'
			);
		});
	});

	describe('updateResticProgress', () => {
		it('should update restic progress without errors', async () => {
			const resticLine = '{"percent_done":0.5,"bytes_done":500000}';

			await handler['updateResticProgress']('plan-1', 'backup-1', resticLine);

			expect(mockUpdateResticProgress).toHaveBeenCalledWith('plan-1', 'backup-1', resticLine);
		});

		it('should handle restic progress update failures gracefully', async () => {
			mockUpdateResticProgress.mockRejectedValueOnce(new Error('Update failed'));
			const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

			await handler['updateResticProgress']('plan-1', 'backup-1', 'progress data');

			expect(consoleWarnSpy).toHaveBeenCalledWith(
				expect.stringContaining('Failed to update restic progress')
			);

			consoleWarnSpy.mockRestore();
		});
	});

	describe('waitForBackupCreation', () => {
		it('should resolve when backup_created event is received', async () => {
			setTimeout(() => {
				emitter.emit('backup_created', { planId: 'plan-1', backupId: 'backup-1' });
			}, 10);

			await expect(handler['waitForBackupCreation']('plan-1', 'backup-1')).resolves.toBeUndefined();
		});

		it('should ignore events with different backupId', async () => {
			jest.useFakeTimers();

			const waitPromise = handler['waitForBackupCreation']('plan-1', 'backup-1');

			// Emit event with wrong backupId
			emitter.emit('backup_created', { planId: 'plan-1', backupId: 'backup-2' });

			jest.advanceTimersByTime(5000);

			// Should still be pending
			const timeoutPromise = Promise.race([
				waitPromise,
				new Promise(resolve => setTimeout(() => resolve('timeout'), 100)),
			]);

			jest.advanceTimersByTime(100);
			const result = await timeoutPromise;
			expect(result).toBe('timeout');

			jest.useRealTimers();
		});

		it('should ignore events with different planId', async () => {
			jest.useFakeTimers();

			const waitPromise = handler['waitForBackupCreation']('plan-1', 'backup-1');

			// Emit event with wrong planId
			emitter.emit('backup_created', { planId: 'plan-2', backupId: 'backup-1' });

			jest.advanceTimersByTime(5000);

			// Should still be pending
			const timeoutPromise = Promise.race([
				waitPromise,
				new Promise(resolve => setTimeout(() => resolve('timeout'), 100)),
			]);

			jest.advanceTimersByTime(100);
			const result = await timeoutPromise;
			expect(result).toBe('timeout');

			jest.useRealTimers();
		});
	});

	describe('canRun - additional tests', () => {
		it('should pass when GOMAXPROCS is set in resticEnv', async () => {
			jest.spyOn(os, 'freemem').mockReturnValue(1024 * 1024 * 1024);

			const optionsWithGOMAXPROCS = {
				...baseOptions,
				resticEnv: { GOMAXPROCS: '8' },
			};

			const resticArgsAndEnv = handler.createResticBackupArgs(
				'plan-1',
				optionsWithGOMAXPROCS as any
			);
			const result = await handler.canRun(optionsWithGOMAXPROCS, resticArgsAndEnv);
			expect(result).toBe(true);
		});

		it('should pass when sourceConfig is missing', async () => {
			jest.spyOn(os, 'freemem').mockReturnValue(1024 * 1024 * 1024);

			const optionsNoSource = {
				...baseOptions,
				sourceConfig: undefined,
			};

			const resticArgsAndEnv = handler.createResticBackupArgs('plan-1', optionsNoSource as any);
			const result = await handler.canRun(optionsNoSource, resticArgsAndEnv);
			expect(result).toBe(true);
		});

		it('should list all inaccessible paths in error message', async () => {
			jest.spyOn(os, 'freemem').mockReturnValue(1024 * 1024 * 1024);
			jest.spyOn(fs.promises, 'access').mockRejectedValue(new Error('Not accessible'));

			const optionsMultiplePaths = {
				...baseOptions,
				sourceConfig: {
					includes: ['C:\\path1', 'C:\\path2', 'C:\\path3'],
					excludes: [],
				},
			};

			const resticArgsAndEnv = handler.createResticBackupArgs(
				'plan-1',
				optionsMultiplePaths as any
			);
			await expect(handler.canRun(optionsMultiplePaths, resticArgsAndEnv)).rejects.toThrow(
				'Source paths not accessible: C:\\path1, C:\\path2, C:\\path3'
			);
		});

		it('should check each source path individually', async () => {
			jest.spyOn(os, 'freemem').mockReturnValue(1024 * 1024 * 1024);
			const accessSpy = jest.spyOn(fs.promises, 'access').mockResolvedValue(undefined);

			const optionsMultiplePaths = {
				...baseOptions,
				sourceConfig: {
					includes: ['C:\\path1', 'C:\\path2'],
					excludes: [],
				},
			};

			const resticArgsAndEnv = handler.createResticBackupArgs(
				'plan-1',
				optionsMultiplePaths as any
			);
			await handler.canRun(optionsMultiplePaths, resticArgsAndEnv);

			expect(accessSpy).toHaveBeenCalledTimes(2);
			expect(accessSpy).toHaveBeenCalledWith('C:\\path1', fs.constants.R_OK);
			expect(accessSpy).toHaveBeenCalledWith('C:\\path2', fs.constants.R_OK);
		});
	});

	describe('cancel - additional tests', () => {
		it('should add planId to cancelledBackups', async () => {
			await handler.cancel('plan-1', 'backup-1');

			// The cancelledBackups should be cleaned up in finally block,
			// but we can verify it was added by checking the call to markCompleted
			expect(mockMarkCompleted).toHaveBeenCalled();
		});

		it('should handle kill process errors', async () => {
			const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
			mockKillProcess.mockImplementation(() => {
				throw new Error('Kill error');
			});

			const result = await handler.cancel('plan-1', 'backup-1');

			expect(result).toBe(false);
			expect(consoleLogSpy).toHaveBeenCalledWith(
				expect.stringContaining('Error Cancelling Backup')
			);

			consoleLogSpy.mockRestore();
		});
	});

	describe('dryRunBackup - additional tests', () => {
		it('should use encryption key when encryption is enabled', async () => {
			const encryptedOptions = {
				...baseOptions,
				settings: { ...baseOptions.settings, encryption: true },
			};

			const summary = { files_new: 15 };
			mockRunResticCommand.mockResolvedValue(JSON.stringify(summary));

			const resticArgsAndEnv = handler.createResticBackupArgs('plan-1', encryptedOptions as any);
			await handler['dryRunBackup']('plan-1', encryptedOptions, resticArgsAndEnv);

			expect(mockRunResticCommand).toHaveBeenCalledWith(
				expect.any(Array),
				expect.objectContaining({ RESTIC_PASSWORD: 'test-encryption-key' })
			);
		});

		it('should not add one-file-system for non-rescue methods', async () => {
			const summary = { files_new: 8 };
			mockRunResticCommand.mockResolvedValue(JSON.stringify(summary));

			const resticArgsAndEnv = handler.createResticBackupArgs('plan-1', baseOptions as any);
			await handler['dryRunBackup']('plan-1', baseOptions, resticArgsAndEnv);

			expect(mockRunResticCommand).toHaveBeenCalledWith(
				expect.not.arrayContaining(['--one-file-system']),
				expect.any(Object)
			);
		});

		it('should handle invalid JSON in output', async () => {
			mockRunResticCommand.mockResolvedValue('invalid json\n{broken');

			const resticArgsAndEnv = handler.createResticBackupArgs('plan-1', baseOptions as any);
			await expect(
				handler['dryRunBackup']('plan-1', baseOptions, resticArgsAndEnv)
			).rejects.toThrow('Dry run failed');
		});

		it('should log summary when successful', async () => {
			const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
			const summary = { files_new: 20, total_files_processed: 50 };
			mockRunResticCommand.mockResolvedValue(JSON.stringify(summary));

			const resticArgsAndEnv = handler.createResticBackupArgs('plan-1', baseOptions as any);
			await handler['dryRunBackup']('plan-1', baseOptions, resticArgsAndEnv);

			expect(consoleLogSpy).toHaveBeenCalledWith('dryRunBackup :', summary);

			consoleLogSpy.mockRestore();
		});
	});

	describe('createHandlers - additional tests', () => {
		it('should update restic progress on progress event', async () => {
			const handlers = handler['createHandlers']('plan-1', 'backup-1');

			const progressData = JSON.stringify({ percent_done: 0.75 });
			handlers.onProgress(Buffer.from(progressData));

			expect(mockUpdateResticProgress).toHaveBeenCalledWith('plan-1', 'backup-1', progressData);
		});

		it('should handle complete event with non-zero exit code', async () => {
			const completeListener = jest.fn();
			emitter.on('backup_complete', completeListener);

			const handlers = handler['createHandlers']('plan-1', 'backup-1');

			await handlers.onComplete(1);

			expect(completeListener).toHaveBeenCalledWith({
				planId: 'plan-1',
				backupId: 'backup-1',
				success: false,
				summary: expect.any(Object),
			});
		});

		it('should retrieve restic progress on complete', async () => {
			const handlers = handler['createHandlers']('plan-1', 'backup-1');

			await handlers.onComplete(0);

			expect(mockGetResticProgress).toHaveBeenCalledWith('plan-1', 'backup-1');
		});
	});

	describe('executeBackupPhase - additional tests', () => {
		it('should handle backup errors correctly', async () => {
			mockRunResticCommand.mockRejectedValueOnce(new Error('Backup execution error'));

			const resticArgsAndEnv = handler.createResticBackupArgs('plan-1', baseOptions as any);
			await expect(
				handler['executeBackupPhase']('plan-1', 'backup-1', baseOptions, resticArgsAndEnv)
			).rejects.toThrow('Backup execution error');

			expect(mockUpdateAction).toHaveBeenCalledWith(
				'plan-1',
				'backup-1',
				'backup',
				'BACKUP_OPERATION_ERROR',
				true,
				'Backup execution error'
			);
		});

		it('should include resticEnv in command execution', async () => {
			const resticArgsAndEnv = handler.createResticBackupArgs('plan-1', baseOptions as any);
			await handler['executeBackupPhase']('plan-1', 'backup-1', baseOptions, resticArgsAndEnv);

			expect(mockRunResticCommand).toHaveBeenCalledWith(
				expect.any(Array),
				expect.objectContaining({ GOMAXPROCS: '2' }),
				expect.any(Function),
				expect.any(Function),
				expect.any(Function),
				expect.any(Function)
			);
		});

		it('should not update completion if backup is cancelled', async () => {
			handler['cancelledBackups'].add('plan-1');

			const resticArgsAndEnv = handler.createResticBackupArgs('plan-1', baseOptions as any);
			await handler['executeBackupPhase']('plan-1', 'backup-1', baseOptions, resticArgsAndEnv);

			const completeCalls = mockUpdateAction.mock.calls.filter(
				call => call[3] === 'BACKUP_OPERATION_COMPLETE'
			);
			expect(completeCalls.length).toBe(0);

			handler['cancelledBackups'].delete('plan-1');
		});
	});

	describe('execute - additional edge cases', () => {
		it('should handle cancellation during backup phase', async () => {
			mockRunResticCommand.mockResolvedValueOnce('{"files_new":5}');

			setTimeout(() => {
				emitter.emit('backup_created', { planId: 'plan-1', backupId: 'backup-1' });
			}, 10);

			mockRunResticCommand.mockImplementationOnce(async () => {
				handler['cancelledBackups'].add('plan-1');
				return '{}';
			});

			const result = await handler.execute('plan-1', 'backup-1', baseOptions, {
				attempts: 0,
				maxAttempts: 3,
			});

			expect(result).toBe('');
		});

		it('should clean up runningBackups on success', async () => {
			mockRunResticCommand.mockResolvedValueOnce('{"files_new":5}');

			setTimeout(() => {
				emitter.emit('backup_created', { planId: 'plan-1', backupId: 'backup-1' });
			}, 10);

			await handler.execute('plan-1', 'backup-1', baseOptions, {
				attempts: 0,
				maxAttempts: 3,
			});

			expect(handler['runningBackups'].has('plan-1')).toBe(false);
		});

		it('should clean up runningBackups on failure', async () => {
			mockRunResticCommand.mockRejectedValueOnce(new Error('Test failure'));

			await expect(
				handler.execute('plan-1', 'backup-1', baseOptions, {
					attempts: 0,
					maxAttempts: 3,
				})
			).rejects.toThrow();

			expect(handler['runningBackups'].has('plan-1')).toBe(false);
		});

		it('should handle unknown error types', async () => {
			mockRunResticCommand.mockRejectedValueOnce('Not an Error object');

			await expect(
				handler.execute('plan-1', 'backup-1', baseOptions, {
					attempts: 0,
					maxAttempts: 3,
				})
			).rejects.toThrow();

			expect(mockMarkCompleted).toHaveBeenCalledWith(
				'plan-1',
				'backup-1',
				false,
				expect.stringContaining('Dry run failed'),
				false
			);
		});
	});
});
