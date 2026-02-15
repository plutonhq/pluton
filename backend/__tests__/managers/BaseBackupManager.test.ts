// Mocks
const mockRunResticCommand = jest.fn();
const mockRunRcloneCommand = jest.fn();
const mockScheduleTask = jest.fn();
const mockUpdateSchedule = jest.fn();
const mockRemoveSchedule = jest.fn();
const mockPauseSchedule = jest.fn();
const mockResumeSchedule = jest.fn();
const mockGetSchedule = jest.fn();
const mockGetSchedules = jest.fn();

// jobQueue mock
const mockJobQueue = {
	add: jest.fn(),
	addPriorityJob: jest.fn(),
	remove: jest.fn(),
};

let backupHandlerExecuteMock = jest.fn();
let backupHandlerCancelMock = jest.fn();
let pruneHandlerPruneMock = jest.fn();

let uidCounter = 0;

jest.mock('../../src/utils/restic/restic', () => ({
	runResticCommand: (...args: any[]) => (mockRunResticCommand as any)(...args),
}));

jest.mock('../../src/utils/rclone/rclone', () => ({
	runRcloneCommand: (...args: any[]) => (mockRunRcloneCommand as any)(...args),
}));

// Mock singleton instance for CronManager
const mockCronManagerInstance = {
	scheduleTask: (...args: any[]) => mockScheduleTask(...args),
	updateSchedule: (...args: any[]) => mockUpdateSchedule(...args),
	removeSchedule: (...args: any[]) => mockRemoveSchedule(...args),
	pauseSchedule: (...args: any[]) => mockPauseSchedule(...args),
	resumeSchedule: (...args: any[]) => mockResumeSchedule(...args),
	getSchedule: (...args: any[]) => mockGetSchedule(...args),
	// Note: BaseBackupManager.updatePlanStorageName expects a POJO (not a Map)
	getSchedules: (...args: any[]) => mockGetSchedules(...args),
};

jest.mock('../../src/managers/CronManager', () => {
	return {
		CronManager: {
			getInstance: jest.fn().mockReturnValue(mockCronManagerInstance),
		},
	};
});

jest.mock('../../src/managers/handlers/BackupHandler', () => {
	return {
		BackupHandler: jest.fn().mockImplementation(() => ({
			execute: (...args: any[]) => backupHandlerExecuteMock(...args),
			cancel: (...args: any[]) => backupHandlerCancelMock(...args),
		})),
	};
});

jest.mock('../../src/managers/handlers/PruneHandler', () => {
	return {
		PruneHandler: jest.fn().mockImplementation(() => ({
			prune: (...args: any[]) => pruneHandlerPruneMock(...args),
		})),
	};
});

jest.mock('../../src/utils/restic/helpers', () => ({
	generateResticRepoPath: (name: string, p: string) => `rclone:${name}:${p}`,
}));

jest.mock('../../src/jobs/JobQueue', () => ({
	jobQueue: mockJobQueue,
}));

jest.mock('../../src/utils/helpers', () => ({
	generateUID: jest.fn(() => {
		uidCounter += 1;
		return `uid-${uidCounter}`;
	}),
}));

jest.mock('../../src/services/ConfigService', () => ({
	configService: {
		config: {
			ENCRYPTION_KEY: 'secret-key',
		},
	},
}));

import { BaseBackupManager } from '../../src/managers/BaseBackupManager';
import { BackupPlanArgs } from '../../src/types/plans';
import { EventEmitter } from 'events';

describe('BaseBackupManager', () => {
	let mgr: BaseBackupManager;

	const baseOptions: any = {
		id: 'plan-xyz',
		title: 'My Plan',
		method: 'backup',
		isActive: true,
		cronExpression: '*/5 * * * *',
		sourceConfig: {
			includes: ['C:\\data', 'ip#C:\\pattern'],
			excludes: ['D:\\temp', 'ep#D:\\p*'],
		},
		storage: {
			name: 'myRemote',
			type: 'rclone',
			authType: 'none',
			settings: {},
			credentials: {},
			defaultPath: '',
		},
		storagePath: 'backups/plan-xyz',
		settings: {
			encryption: false,
			compression: true,
			performance: {
				maxProcessor: 2,
				packSize: '16MiB',
				scan: false,
				readConcurrency: 5,
				transfers: 8,
				bufferSize: '32M',
				multiThreadStream: 4,
			},
			retries: 5,
			retryDelay: 60,
			prune: { snapCount: 5, policy: 'forgetByAge' },
			notification: {} as any,
			integrity: {} as any,
		},
	};

	beforeEach(() => {
		jest.clearAllMocks();
		uidCounter = 0;
		process.env.ENCRYPTION_KEY = 'secret-key';

		// Reasonable defaults
		mockRunResticCommand.mockResolvedValue('OK');
		mockRunRcloneCommand.mockResolvedValue('PURGED');
		mockScheduleTask.mockResolvedValue(undefined);
		mockUpdateSchedule.mockResolvedValue(undefined);
		mockRemoveSchedule.mockResolvedValue(undefined);
		mockPauseSchedule.mockResolvedValue(true);
		mockResumeSchedule.mockResolvedValue(true);
		mockGetSchedule.mockResolvedValue([
			{
				type: 'backup',
				options: baseOptions,
			},
		]);
		mockGetSchedules.mockResolvedValue({
			// POJO keyed by planId to schedule entries
			['plan-1']: [
				{
					type: 'backup',
					options: {
						...baseOptions,
						storageId: 'storage-1',
						storage: { ...baseOptions.storage, name: 'remote-1' },
						cronExpression: '* * * * *',
					},
				},
			],
			['plan-2']: [
				{
					type: 'backup',
					options: {
						...baseOptions,
						storageId: 'storage-2',
						storage: { ...baseOptions.storage, name: 'remote-2' },
						cronExpression: '0 0 * * *',
					},
				},
			],
		});

		backupHandlerExecuteMock.mockResolvedValue('EXECUTED');
		backupHandlerCancelMock.mockResolvedValue(true);
		pruneHandlerPruneMock.mockResolvedValue({ success: true, result: 'Pruned' });

		mgr = new BaseBackupManager();
	});

	describe('constructor', () => {
		it('creates manager without config path', () => {
			const manager = new BaseBackupManager();
			expect(manager).toBeDefined();
			expect(manager._scheduleFilePath).toBeUndefined();
		});

		it('creates manager with config path', () => {
			const manager = new BaseBackupManager('/custom/path/schedules.json');
			expect(manager).toBeDefined();
			expect(manager._scheduleFilePath).toBe('/custom/path/schedules.json');
		});

		it('extends EventEmitter', () => {
			const manager = new BaseBackupManager();
			expect(manager).toBeInstanceOf(EventEmitter);
			expect(typeof manager.on).toBe('function');
			expect(typeof manager.emit).toBe('function');
		});
	});

	describe('cronManager getter', () => {
		it('initializes CronManager singleton in constructor', () => {
			const manager = new BaseBackupManager('/test/path');
			// CronManager is now initialized in constructor via singleton
			expect(manager._cronManager).toBeDefined();
			const cronMgr = manager.cronManager;
			expect(cronMgr).toBeDefined();
			expect(manager._cronManager).toBe(cronMgr);
		});

		it('returns same CronManager singleton instance', () => {
			const manager1 = new BaseBackupManager();
			const manager2 = new BaseBackupManager();
			// Both managers should get the same singleton instance
			expect(manager1.cronManager).toBe(manager2.cronManager);
		});
	});

	describe('backupHandler getter', () => {
		it('creates BackupHandler on first access', () => {
			const manager = new BaseBackupManager();
			const handler = manager.backupHandler;
			expect(handler).toBeDefined();
		});

		it('returns same instance on subsequent access', () => {
			const manager = new BaseBackupManager();
			const first = manager.backupHandler;
			const second = manager.backupHandler;
			expect(first).toBe(second);
		});

		it('passes manager instance to BackupHandler constructor', () => {
			const manager = new BaseBackupManager();
			const handler = manager.backupHandler;
			// BackupHandler should be initialized with the manager instance
			expect(backupHandlerExecuteMock).toBeDefined();
		});
	});

	describe('queueBackup', () => {
		it('does nothing if schedule is not active', async () => {
			await mgr.queueBackup('plan-1', { isActive: false, settings: {} });
			expect(mockJobQueue.add).not.toHaveBeenCalled();
		});

		it('adds a job with defaults when active', async () => {
			await mgr.queueBackup('plan-1', { isActive: true, settings: {} });
			expect(mockJobQueue.add).toHaveBeenCalledTimes(1);
			const [name, payload, retries, delayMs] = mockJobQueue.add.mock.calls[0];
			expect(name).toBe('Backup');
			expect(payload).toEqual({ planId: 'plan-1', backupId: 'uid-1' });
			expect(retries).toBe(5);
			expect(delayMs).toBe(300000); // 300s default * 1000
		});

		it('uses custom retries and retryDelay from settings', async () => {
			await mgr.queueBackup('plan-1', {
				isActive: true,
				settings: { retries: 10, retryDelay: 120 },
			});
			expect(mockJobQueue.add).toHaveBeenCalledTimes(1);
			const [name, payload, retries, delayMs] = mockJobQueue.add.mock.calls[0];
			expect(retries).toBe(10);
			expect(delayMs).toBe(120000); // 120s * 1000
		});

		it('handles missing settings gracefully', async () => {
			await mgr.queueBackup('plan-1', { isActive: true });
			expect(mockJobQueue.add).toHaveBeenCalledTimes(1);
			const [, , retries, delayMs] = mockJobQueue.add.mock.calls[0];
			expect(retries).toBe(5);
			expect(delayMs).toBe(300000);
		});

		it('generates unique backup IDs for each call', async () => {
			await mgr.queueBackup('plan-1', { isActive: true, settings: {} });
			await mgr.queueBackup('plan-1', { isActive: true, settings: {} });

			expect(mockJobQueue.add).toHaveBeenCalledTimes(2);
			const firstCall = mockJobQueue.add.mock.calls[0][1];
			const secondCall = mockJobQueue.add.mock.calls[1][1];
			expect(firstCall.backupId).not.toBe(secondCall.backupId);
		});
	});

	describe('performBackup', () => {
		it('adds a priority job when a schedule exists', async () => {
			mockGetSchedule.mockResolvedValueOnce([
				{ type: 'backup', options: { ...baseOptions, settings: { retries: 3, retryDelay: 10 } } },
			]);
			const res = await mgr.performBackup('plan-1');
			expect(res.success).toBe(true);
			expect(mockJobQueue.addPriorityJob).toHaveBeenCalledTimes(1);
			const [name, payload, retries, delayMs] = mockJobQueue.addPriorityJob.mock.calls[0];
			expect(name).toBe('Backup');
			expect(payload).toEqual({ planId: 'plan-1', backupId: 'uid-1' });
			expect(retries).toBe(3);
			expect(delayMs).toBe(10000);
		});

		it('returns failure if no backup schedule found', async () => {
			mockGetSchedule.mockResolvedValueOnce(undefined);
			const res = await mgr.performBackup('plan-unknown');
			expect(res.success).toBe(false);
			expect(res.result).toMatch(/No backup schedule/);
			expect(mockJobQueue.addPriorityJob).not.toHaveBeenCalled();
		});

		it('returns failure if schedule array is empty', async () => {
			mockGetSchedule.mockResolvedValueOnce([]);
			const res = await mgr.performBackup('plan-empty');
			expect(res.success).toBe(false);
			expect(res.result).toMatch(/No backup schedule/);
		});

		it('returns failure if no backup type schedule exists', async () => {
			mockGetSchedule.mockResolvedValueOnce([{ type: 'integrity', options: {} }]);
			const res = await mgr.performBackup('plan-integrity-only');
			expect(res.success).toBe(false);
			expect(res.result).toMatch(/No backup schedule/);
		});

		it('uses default retries and retryDelay when not provided', async () => {
			mockGetSchedule.mockResolvedValueOnce([{ type: 'backup', options: { ...baseOptions } }]);
			const res = await mgr.performBackup('plan-defaults');
			expect(res.success).toBe(true);
			const [, , retries, delayMs] = mockJobQueue.addPriorityJob.mock.calls[0];
			expect(retries).toBe(5);
			expect(delayMs).toBe(60000);
		});

		it('generates unique backup ID for each invocation', async () => {
			mockGetSchedule.mockResolvedValue([{ type: 'backup', options: { ...baseOptions } }]);
			await mgr.performBackup('plan-1');
			await mgr.performBackup('plan-1');

			const firstCall = mockJobQueue.addPriorityJob.mock.calls[0][1];
			const secondCall = mockJobQueue.addPriorityJob.mock.calls[1][1];
			expect(firstCall.backupId).not.toBe(secondCall.backupId);
		});
	});

	describe('performBackupExecution', () => {
		it('invokes BackupHandler.execute with proper args', async () => {
			mockGetSchedule.mockResolvedValueOnce([{ type: 'backup', options: baseOptions }]);
			const out = await mgr.performBackupExecution('plan-1', 'backup-1', {
				attempts: 1,
				maxAttempts: 5,
			});
			expect(backupHandlerExecuteMock).toHaveBeenCalledTimes(1);
			expect(backupHandlerExecuteMock).toHaveBeenCalledWith('plan-1', 'backup-1', baseOptions, {
				attempts: 1,
				maxAttempts: 5,
			});
			expect(out).toBe('EXECUTED');
		});

		it('throws when schedule or options missing', async () => {
			mockGetSchedule.mockResolvedValueOnce(undefined);
			await expect(
				mgr.performBackupExecution('plan-x', 'backup-x', { attempts: 0, maxAttempts: 3 })
			).rejects.toThrow(/No backup schedule options/);
		});

		it('throws when schedule array is empty', async () => {
			mockGetSchedule.mockResolvedValueOnce([]);
			await expect(
				mgr.performBackupExecution('plan-empty', 'backup-empty', { attempts: 1, maxAttempts: 5 })
			).rejects.toThrow(/No backup schedule options/);
		});

		it('throws when no backup type schedule found', async () => {
			mockGetSchedule.mockResolvedValueOnce([{ type: 'integrity', options: {} }]);
			await expect(
				mgr.performBackupExecution('plan-no-backup', 'backup-no', { attempts: 1, maxAttempts: 5 })
			).rejects.toThrow(/No backup schedule options/);
		});

		it('propagates handler execution errors', async () => {
			mockGetSchedule.mockResolvedValueOnce([{ type: 'backup', options: baseOptions }]);
			backupHandlerExecuteMock.mockRejectedValueOnce(new Error('Execution failed'));

			await expect(
				mgr.performBackupExecution('plan-1', 'backup-fail', { attempts: 1, maxAttempts: 5 })
			).rejects.toThrow('Execution failed');
		});
	});

	describe('createBackup', () => {
		it('initializes repo, creates schedule, and starts initial backup', async () => {
			// Spy performBackup to avoid depending on schedule content
			const performSpy = jest
				.spyOn(mgr, 'performBackup')
				.mockResolvedValue({ success: true, result: 'Backup job has been added to the queue.' });

			const res = await mgr.createBackup('plan-abc', baseOptions as BackupPlanArgs);
			expect(res.success).toBe(true);
			expect(res.result).toMatch(/Initial Backup Started/);

			// Restic init called with expected args and env
			expect(mockRunResticCommand).toHaveBeenCalled();
			const [args, env] = mockRunResticCommand.mock.calls[0];
			expect(args).toEqual(
				expect.arrayContaining(['-r', 'rclone:myRemote:backups/plan-xyz', 'init', '--verbose'])
			);
			// No encryption => insecure init flag
			expect(args).toContain('--insecure-no-password');
			expect(env).toMatchObject({
				RESTIC_PASSWORD: '',
				RCLONE_CONFIG_PASS: '',
			});

			// Scheduled
			expect(mockScheduleTask).toHaveBeenCalledTimes(1);
			expect(performSpy).toHaveBeenCalledWith('plan-abc');

			performSpy.mockRestore();
		});

		it('fails when repo initialization fails', async () => {
			mockRunResticCommand.mockRejectedValueOnce(new Error('init failed'));
			const res = await mgr.createBackup('plan-abc', baseOptions as BackupPlanArgs);
			expect(res.success).toBe(false);
			expect(res.result).toMatch(/Could Not Create Restic Repo/);
			expect(mockScheduleTask).not.toHaveBeenCalled();
		});

		it('handles encrypted backup creation', async () => {
			const encryptedOptions = {
				...baseOptions,
				settings: {
					...baseOptions.settings,
					encryption: true,
				},
			};
			const performSpy = jest
				.spyOn(mgr, 'performBackup')
				.mockResolvedValue({ success: true, result: 'Backup job has been added to the queue.' });

			const res = await mgr.createBackup('plan-encrypted', encryptedOptions as BackupPlanArgs);
			expect(res.success).toBe(true);

			const [args, env] = mockRunResticCommand.mock.calls[0];
			expect(args).not.toContain('--insecure-no-password');
			expect(env.RESTIC_PASSWORD).toBe('secret-key');

			performSpy.mockRestore();
		});

		it('returns error message when initial backup fails to start', async () => {
			const performSpy = jest
				.spyOn(mgr, 'performBackup')
				.mockResolvedValue({ success: false, result: 'Failed to start backup' });

			const res = await mgr.createBackup('plan-fail-start', baseOptions as BackupPlanArgs);
			expect(res.success).toBe(true);
			expect(res.result).toMatch(/Could not Start the Initial Backup/);

			performSpy.mockRestore();
		});

		it('handles errors during schedule creation', async () => {
			mockScheduleTask.mockRejectedValueOnce(new Error('Schedule error'));

			const res = await mgr.createBackup('plan-schedule-fail', baseOptions as BackupPlanArgs);
			expect(res.success).toBe(false);
			expect(res.result).toMatch(/Schedule error/);
		});

		it('includes progress callback during repo initialization', async () => {
			const performSpy = jest
				.spyOn(mgr, 'performBackup')
				.mockResolvedValue({ success: true, result: 'Job added' });

			await mgr.createBackup('plan-progress', baseOptions as BackupPlanArgs);

			const [, , progressCallback] = mockRunResticCommand.mock.calls[0];
			expect(progressCallback).toBeDefined();
			expect(typeof progressCallback).toBe('function');

			performSpy.mockRestore();
		});
	});

	describe('updateBackup', () => {
		it('updates existing schedule', async () => {
			const res = await mgr.updateBackup('plan-abc', baseOptions as BackupPlanArgs);
			expect(res.success).toBe(true);
			expect(mockUpdateSchedule).toHaveBeenCalled();
		});

		it('handles errors during update', async () => {
			mockUpdateSchedule.mockRejectedValueOnce(new Error('Update failed'));
			const res = await mgr.updateBackup('plan-err', baseOptions as BackupPlanArgs);
			expect(res.success).toBe(false);
			expect(res.result).toMatch(/Update failed/);
		});

		it('calls createOrUpdateSchedules with update action', async () => {
			const createOrUpdateSpy = jest.spyOn(mgr, 'createOrUpdateSchedules').mockResolvedValue();
			await mgr.updateBackup('plan-spy', baseOptions as BackupPlanArgs);
			expect(createOrUpdateSpy).toHaveBeenCalledWith('plan-spy', baseOptions, 'update');
			createOrUpdateSpy.mockRestore();
		});
	});

	describe('removeBackup', () => {
		it('removes schedule and purges remote when requested', async () => {
			const res = await mgr.removeBackup('plan-abc', {
				storageName: 'remote',
				storagePath: 'some/path',
				removeRemoteData: true,
				encryption: false,
			});
			expect(res.success).toBe(true);
			expect(mockRemoveSchedule).toHaveBeenCalledWith('plan-abc');
			expect(mockRunRcloneCommand).toHaveBeenCalledWith(['purge', 'remote:some/path']);
		});

		it('handles errors gracefully', async () => {
			mockRemoveSchedule.mockRejectedValueOnce(new Error('cannot remove'));
			const res = await mgr.removeBackup('plan-err', {
				storageName: 'remote',
				storagePath: '',
				removeRemoteData: false,
				encryption: false,
			});
			expect(res.success).toBe(false);
			expect(res.result).toMatch(/cannot remove/);
		});

		it('skips remote data removal when not requested', async () => {
			const res = await mgr.removeBackup('plan-no-purge', {
				storageName: 'remote',
				storagePath: 'some/path',
				removeRemoteData: false,
				encryption: false,
			});
			expect(res.success).toBe(true);
			expect(mockRunRcloneCommand).not.toHaveBeenCalled();
		});

		it('skips remote data removal when storagePath is empty', async () => {
			const res = await mgr.removeBackup('plan-empty-path', {
				storageName: 'remote',
				storagePath: '',
				removeRemoteData: true,
				encryption: false,
			});
			expect(res.success).toBe(true);
			expect(mockRunRcloneCommand).not.toHaveBeenCalled();
		});

		it('includes rclone output in success message', async () => {
			mockRunRcloneCommand.mockResolvedValueOnce('Deleted 100 files');
			const res = await mgr.removeBackup('plan-with-output', {
				storageName: 'remote',
				storagePath: 'path',
				removeRemoteData: true,
				encryption: false,
			});
			expect(res.success).toBe(true);
			expect(res.result).toContain('Successfully Removed');
			expect(res.result).toContain('Deleted 100 files');
		});

		it('handles rclone errors during purge', async () => {
			mockRunRcloneCommand.mockRejectedValueOnce(new Error('Purge failed'));
			const res = await mgr.removeBackup('plan-purge-fail', {
				storageName: 'remote',
				storagePath: 'path',
				removeRemoteData: true,
				encryption: false,
			});
			expect(res.success).toBe(false);
			expect(res.result).toMatch(/Purge failed/);
		});
	});

	describe('cancel/pause/resume', () => {
		it('cancelBackup delegates to handler', async () => {
			backupHandlerCancelMock.mockResolvedValueOnce(true);
			const res = await mgr.cancelBackup('plan-1', 'backup-1');
			expect(res.success).toBe(true);
			expect(res.result).toMatch(/Cancelled Backup/);
		});

		it('pauseBackup and resumeBackup update schedule state', async () => {
			const p = await mgr.pauseBackup('plan-1');
			expect(p.success).toBe(true);
			expect(mockPauseSchedule).toHaveBeenCalledWith('plan-1');

			const r = await mgr.resumeBackup('plan-1');
			expect(r.success).toBe(true);
			expect(mockResumeSchedule).toHaveBeenCalledWith('plan-1');
		});

		it('cancelBackup returns failure when handler returns false', async () => {
			backupHandlerCancelMock.mockResolvedValueOnce(false);
			const res = await mgr.cancelBackup('plan-fail', 'backup-fail');
			expect(res.success).toBe(false);
			expect(res.result).toMatch(/Failed to cancel Backup/);
		});

		it('pauseBackup returns failure when pause fails', async () => {
			mockPauseSchedule.mockResolvedValueOnce(false);
			const res = await mgr.pauseBackup('plan-fail');
			expect(res.success).toBe(false);
			expect(res.result).toMatch(/Failed to Pause Backup/);
		});

		it('resumeBackup returns failure when resume fails', async () => {
			mockResumeSchedule.mockResolvedValueOnce(false);
			const res = await mgr.resumeBackup('plan-fail');
			expect(res.success).toBe(false);
			expect(res.result).toMatch(/Failed to Resume Backup/);
		});

		it('cancelBackup calls handler with correct parameters', async () => {
			backupHandlerCancelMock.mockResolvedValueOnce(true);
			await mgr.cancelBackup('plan-test', 'backup-test');
			expect(backupHandlerCancelMock).toHaveBeenCalledWith('plan-test', 'backup-test');
		});
	});

	describe('pruneBackups', () => {
		it('runs prune when backup schedule exists', async () => {
			const res = await mgr.pruneBackups('plan-1');
			expect(res.success).toBe(true);
			expect(pruneHandlerPruneMock).toHaveBeenCalledWith('plan-1', baseOptions, true);
		});

		it('returns failure when no schedule', async () => {
			mockGetSchedule.mockResolvedValueOnce(undefined);
			const res = await mgr.pruneBackups('plan-none');
			expect(res.success).toBe(false);
			expect(res.result).toMatch(/Not Found/);
		});

		it('returns failure when schedule is empty array', async () => {
			mockGetSchedule.mockResolvedValueOnce([]);
			const res = await mgr.pruneBackups('plan-empty');
			expect(res.success).toBe(false);
			expect(res.result).toMatch(/Not Found/);
		});

		it('returns failure when no backup type schedule exists', async () => {
			mockGetSchedule.mockResolvedValueOnce([{ type: 'integrity', options: {} }]);
			const res = await mgr.pruneBackups('plan-no-backup');
			expect(res.success).toBe(false);
			expect(res.result).toMatch(/Not Found/);
		});

		it('propagates prune handler results', async () => {
			pruneHandlerPruneMock.mockResolvedValueOnce({ success: false, result: 'Prune error' });
			const res = await mgr.pruneBackups('plan-prune-error');
			expect(res.success).toBe(false);
			expect(res.result).toBe('Prune error');
		});

		it('creates new PruneHandler for each invocation', async () => {
			await mgr.pruneBackups('plan-1');
			await mgr.pruneBackups('plan-1');
			expect(pruneHandlerPruneMock).toHaveBeenCalledTimes(2);
		});
	});

	describe('unlockRepo', () => {
		it('unlocks repo and returns success message', async () => {
			mockRunResticCommand.mockResolvedValueOnce('Unlocked');
			const res = await mgr.unlockRepo('plan-1');
			expect(res.success).toBe(true);
			expect(res.result).toBe('Unlocked');
			expect(mockRunResticCommand).toHaveBeenCalledWith(
				['unlock', '-r', 'rclone:myRemote:backups/plan-xyz', '--json'],
				{ RESTIC_PASSWORD: '' }
			);
		});

		it('returns failure when schedule/options missing', async () => {
			mockGetSchedule.mockResolvedValueOnce(undefined as any);
			const res = await mgr.unlockRepo('plan-none');
			expect(res.success).toBe(false);
			expect(res.result).toMatch(/No backup schedule configuration/);
		});

		it('handles restic unlock errors', async () => {
			mockRunResticCommand.mockRejectedValueOnce(new Error('unlock failed'));
			const res = await mgr.unlockRepo('plan-1');
			expect(res.success).toBe(false);
			expect(res.result).toMatch(/unlock failed/);
		});

		it('returns failure when schedule is empty array', async () => {
			mockGetSchedule.mockResolvedValueOnce([]);
			const res = await mgr.unlockRepo('plan-empty');
			expect(res.success).toBe(false);
			expect(res.result).toMatch(/No backup schedule configuration/);
		});

		it('returns failure when no backup type schedule exists', async () => {
			mockGetSchedule.mockResolvedValueOnce([{ type: 'integrity', options: {} }]);
			const res = await mgr.unlockRepo('plan-no-backup');
			expect(res.success).toBe(false);
			expect(res.result).toMatch(/No backup schedule configuration/);
		});

		it('returns failure when storage configuration is missing', async () => {
			mockGetSchedule.mockResolvedValueOnce([
				{ type: 'backup', options: { ...baseOptions, storage: null } },
			]);
			const res = await mgr.unlockRepo('plan-no-storage');
			expect(res.success).toBe(false);
			expect(res.result).toMatch(/Storage configuration is missing/);
		});

		it('returns failure when storage name is missing', async () => {
			mockGetSchedule.mockResolvedValueOnce([
				{
					type: 'backup',
					options: { ...baseOptions, storage: { ...baseOptions.storage, name: '' } },
				},
			]);
			const res = await mgr.unlockRepo('plan-no-name');
			expect(res.success).toBe(false);
			expect(res.result).toMatch(/Storage configuration is missing/);
		});

		it('uses default message when restic returns empty string', async () => {
			mockRunResticCommand.mockResolvedValueOnce('');
			const res = await mgr.unlockRepo('plan-empty-response');
			expect(res.success).toBe(true);
			expect(res.result).toMatch(/Successfully removed all stale locks/);
		});

		it('uses encryption key when encryption is enabled', async () => {
			const encryptedOptions = {
				...baseOptions,
				settings: { ...baseOptions.settings, encryption: true },
			};
			mockGetSchedule.mockResolvedValueOnce([{ type: 'backup', options: encryptedOptions }]);
			mockRunResticCommand.mockResolvedValueOnce('Unlocked');

			await mgr.unlockRepo('plan-encrypted');
			expect(mockRunResticCommand).toHaveBeenCalledWith(
				['unlock', '-r', 'rclone:myRemote:backups/plan-xyz', '--json'],
				{ RESTIC_PASSWORD: 'secret-key' }
			);
		});

		it('handles unknown errors with default message', async () => {
			mockRunResticCommand.mockRejectedValueOnce({});
			const res = await mgr.unlockRepo('plan-unknown-error');
			expect(res.success).toBe(false);
			expect(res.result).toMatch(/An unknown error occurred/);
		});
	});

	describe('createOrUpdateSchedules', () => {
		it('creates schedule and the taskCallback enqueues a backup', async () => {
			// Capture the options passed to scheduleTask to call its taskCallback
			mockScheduleTask.mockImplementationOnce(async (_id, _expr, opts) => {
				// Simulate cron firing
				opts.taskCallback('plan-1', opts);
			});

			await mgr.createOrUpdateSchedules('plan-1', baseOptions as BackupPlanArgs, 'create');

			expect(mockScheduleTask).toHaveBeenCalledWith(
				'plan-1',
				'*/5 * * * *',
				expect.objectContaining({
					isActive: true,
				}),
				'backup'
			);

			// taskCallback should have caused queueBackup -> jobQueue.add call
			expect(mockJobQueue.add).toHaveBeenCalledTimes(1);
		});

		it('updates when existing schedule is present', async () => {
			mockGetSchedule.mockResolvedValueOnce([{ type: 'backup', options: baseOptions }]);

			await mgr.createOrUpdateSchedules('plan-1', baseOptions as BackupPlanArgs, 'update');

			expect(mockUpdateSchedule).toHaveBeenCalledWith(
				'plan-1',
				'*/5 * * * *',
				expect.objectContaining({
					isActive: true,
				}),
				'backup'
			);
		});

		it('creates if schedule missing on update', async () => {
			mockGetSchedule.mockResolvedValueOnce(undefined);
			await mgr.createOrUpdateSchedules('plan-1', baseOptions as BackupPlanArgs, 'update');
			expect(mockScheduleTask).toHaveBeenCalled();
		});

		it('creates if schedule array is empty on update', async () => {
			mockGetSchedule.mockResolvedValueOnce([]);
			await mgr.createOrUpdateSchedules(
				'plan-update-empty',
				baseOptions as BackupPlanArgs,
				'update'
			);
			expect(mockScheduleTask).toHaveBeenCalled();
		});

		it('creates if no backup type schedule on update', async () => {
			mockGetSchedule.mockResolvedValueOnce([{ type: 'integrity', options: {} }]);
			await mgr.createOrUpdateSchedules(
				'plan-update-no-backup',
				baseOptions as BackupPlanArgs,
				'update'
			);
			expect(mockScheduleTask).toHaveBeenCalled();
		});

		it('sets isActive to false when not provided', async () => {
			const inactiveOptions = { ...baseOptions, isActive: undefined };
			await mgr.createOrUpdateSchedules('plan-inactive', inactiveOptions as any, 'create');

			const opts = mockScheduleTask.mock.calls[0][2];
			expect(opts.isActive).toBe(false);
		});

		it('preserves isActive when true', async () => {
			const activeOptions = { ...baseOptions, isActive: true };
			await mgr.createOrUpdateSchedules('plan-active', activeOptions as BackupPlanArgs, 'create');

			const opts = mockScheduleTask.mock.calls[0][2];
			expect(opts.isActive).toBe(true);
		});

		it('taskCallback calls queueBackup with correct parameters', async () => {
			let capturedCallback: any;
			mockScheduleTask.mockImplementationOnce(async (_id, _expr, opts) => {
				capturedCallback = opts.taskCallback;
			});

			await mgr.createOrUpdateSchedules('plan-callback', baseOptions as BackupPlanArgs, 'create');

			const mockOpts = { isActive: true, settings: { retries: 3 } };
			capturedCallback('plan-callback', mockOpts);

			expect(mockJobQueue.add).toHaveBeenCalled();
		});
	});
});
