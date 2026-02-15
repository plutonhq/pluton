import { EventEmitter } from 'events';

// Mock modules BEFORE importing the function under test
jest.mock('child_process');
jest.mock('../../../src/utils/binaryPathResolver');
jest.mock('../../../src/utils/rclone/helpers');
jest.mock('../../../src/utils/AppPaths');
jest.mock('../../../src/utils/restic/helpers');
jest.mock('../../../src/services/ConfigService', () => ({
	configService: {
		config: {
			ENCRYPTION_KEY: 'test-encryption-key',
		},
		isSetupPending: jest.fn().mockReturnValue(false),
	},
}));

import { spawn } from 'child_process';
import {
	runResticCommand,
	getBackupPlanStats,
	getSnapshotByTag,
} from '../../../src/utils/restic/restic';
import { getBinaryPath } from '../../../src/utils/binaryPathResolver';
import { getRcloneConfigPath } from '../../../src/utils/rclone/helpers';
import { appPaths } from '../../../src/utils/AppPaths';
import { generateResticRepoPath } from '../../../src/utils/restic/helpers';

const mockSpawn = spawn as jest.MockedFunction<typeof spawn>;
const mockGetBinaryPath = getBinaryPath as jest.MockedFunction<typeof getBinaryPath>;
const mockGetRcloneConfigPath = getRcloneConfigPath as jest.MockedFunction<
	typeof getRcloneConfigPath
>;
const mockAppPaths = appPaths as jest.Mocked<typeof appPaths>;
const mockGenerateResticRepoPath = generateResticRepoPath as jest.MockedFunction<
	typeof generateResticRepoPath
>;

describe('runResticCommand', () => {
	let mockProcess: any;

	beforeEach(() => {
		jest.clearAllMocks();

		// Setup default mock implementations
		mockGetBinaryPath.mockImplementation((binary: string) => `/mock/path/${binary}`);
		mockGetRcloneConfigPath.mockReturnValue('/mock/rclone.conf');
		mockAppPaths.getTempDir = jest.fn(() => '/mock/temp');

		// Create a mock process with EventEmitter
		mockProcess = new EventEmitter();
		mockProcess.stdout = new EventEmitter();
		mockProcess.stderr = new EventEmitter();
		mockProcess.kill = jest.fn();
		mockProcess.pid = 12345;

		mockSpawn.mockReturnValue(mockProcess as any);

		process.env.ENCRYPTION_KEY = 'test-encryption-key';
		process.env.LOCALAPPDATA = '/mock/localappdata';
	});

	afterEach(() => {
		delete process.env.ENCRYPTION_KEY;
		delete process.env.LOCALAPPDATA;
	});

	it('should resolve with output on successful execution', async () => {
		const expectedOutput = 'backup completed successfully';

		const promise = runResticCommand(['backup', '/test/path']);

		// Simulate process execution
		setImmediate(() => {
			mockProcess.stdout.emit('data', Buffer.from(expectedOutput));
			mockProcess.emit('close', 0);
		});

		const result = await promise;
		expect(result).toBe(expectedOutput);
	});

	it('should reject with error when restic command fails', async () => {
		const errorMessage = 'repository not found';

		const promise = runResticCommand(['backup', '/invalid/path']);

		setImmediate(() => {
			mockProcess.stderr.emit('data', Buffer.from(errorMessage));
			mockProcess.emit('close', 1);
		});

		await expect(promise).rejects.toThrow(errorMessage);
	});

	it('should call onProgress callback with throttled progress updates', async () => {
		const onProgress = jest.fn();
		const progressData = JSON.stringify({
			message_type: 'status',
			percent_done: 0.5,
			bytes_done: 1000,
		});

		const promise = runResticCommand(['backup', '/test'], {}, onProgress);

		setImmediate(() => {
			// Simulate multiple rapid progress updates
			mockProcess.stdout.emit('data', Buffer.from(progressData));
			mockProcess.stdout.emit('data', Buffer.from(progressData));
			mockProcess.stdout.emit('data', Buffer.from(progressData));

			setTimeout(() => {
				mockProcess.emit('close', 0);
			}, 10);
		});

		await promise;

		// Should be called but throttled (not 3 times due to THROTTLE_INTERVAL)
		expect(onProgress).toHaveBeenCalled();
		expect(onProgress.mock.calls.length).toBeLessThan(3);
	});

	it('should call onError callback when error occurs', async () => {
		const onError = jest.fn();
		const errorMessage = 'connection timeout';

		const promise = runResticCommand(['backup', '/test'], {}, undefined, onError);

		setImmediate(() => {
			mockProcess.stderr.emit('data', Buffer.from(errorMessage));
			mockProcess.emit('close', 1);
		});

		try {
			await promise;
		} catch (error) {
			// Expected to throw
		}

		expect(onError).toHaveBeenCalledWith(expect.any(Buffer));
	});

	it('should call onComplete callback with exit code', async () => {
		const onComplete = jest.fn();

		const promise = runResticCommand(['backup', '/test'], {}, undefined, undefined, onComplete);

		setImmediate(() => {
			mockProcess.stdout.emit('data', Buffer.from('done'));
			mockProcess.emit('close', 0);
		});

		await promise;

		expect(onComplete).toHaveBeenCalledWith(0);
	});

	it('should call onProcess callback with spawned process', async () => {
		const onProcess = jest.fn();

		const promise = runResticCommand(
			['backup', '/test'],
			{},
			undefined,
			undefined,
			undefined,
			onProcess
		);

		setImmediate(() => {
			mockProcess.stdout.emit('data', Buffer.from('done'));
			mockProcess.emit('close', 0);
		});

		await promise;

		expect(onProcess).toHaveBeenCalledWith(mockProcess);
	});

	it('should resolve with termination message when process receives SIGTERM', async () => {
		const promise = runResticCommand(['backup', '/test']);

		setImmediate(() => {
			mockProcess.emit('exit', null, 'SIGTERM');
		});

		const result = await promise;
		expect(result).toBe('Process terminated by user');
	});

	it('should reject when spawn fails', async () => {
		const spawnError = new Error('spawn ENOENT');

		const promise = runResticCommand(['backup', '/test']);

		setImmediate(() => {
			mockProcess.emit('error', spawnError);
		});

		await expect(promise).rejects.toThrow('Failed to run restic : spawn ENOENT');
	});

	it('should merge custom environment variables', async () => {
		const customEnv = {
			CUSTOM_VAR: 'custom-value',
			RESTIC_PASSWORD: 'test-password',
		};

		const promise = runResticCommand(['backup', '/test'], customEnv);

		setImmediate(() => {
			mockProcess.stdout.emit('data', Buffer.from('done'));
			mockProcess.emit('close', 0);
		});

		await promise;

		// Verify spawn was called with merged env vars
		expect(mockSpawn).toHaveBeenCalled();
		const spawnOptions = mockSpawn.mock.calls[0][2];
		expect(spawnOptions?.env).toMatchObject(customEnv);
		expect(spawnOptions?.env?.RCLONE_CONFIG_PASS).toBe('test-encryption-key');
	});

	it('should handle non-JSON progress data', async () => {
		const onProgress = jest.fn();
		const plainTextData = 'plain text progress message';

		const promise = runResticCommand(['backup', '/test'], {}, onProgress);

		setImmediate(() => {
			mockProcess.stdout.emit('data', Buffer.from(plainTextData));
			mockProcess.emit('close', 0);
		});

		await promise;

		expect(onProgress).toHaveBeenCalledWith(Buffer.from(plainTextData));
	});

	// This test requires Windows path semantics (path.basename with backslashes)
	const windowsIt = process.platform === 'win32' ? it : it.skip;
	windowsIt('should replace backslashes in rclone binary path on Windows', async () => {
		const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
		Object.defineProperty(process, 'platform', {
			value: 'win32',
			configurable: true,
		});

		mockGetBinaryPath.mockImplementation((binary: string) =>
			binary === 'rclone' ? 'C:\\mock\\path\\rclone.exe' : `/mock/path/${binary}`
		);

		const promise = runResticCommand(['backup', '/test']);

		setImmediate(() => {
			mockProcess.stdout.emit('data', Buffer.from('done'));
			mockProcess.emit('close', 0);
		});

		await promise;

		// Verify the final args use only the basename (no backslashes)
		const spawnArgs = mockSpawn.mock.calls[0][1];
		const rcloneProgramArg = spawnArgs.find((arg: string) => arg.startsWith('rclone.program='));
		expect(rcloneProgramArg).toBeDefined();
		expect(rcloneProgramArg).not.toContain('\\');
		expect(rcloneProgramArg).toBe('rclone.program=rclone.exe');

		// Restore original platform
		if (originalPlatform) {
			Object.defineProperty(process, 'platform', originalPlatform);
		} else {
			delete (process as any).platform;
		}
	});

	it('should not call onError when process is cancelled', async () => {
		const onError = jest.fn();

		const promise = runResticCommand(['backup', '/test'], {}, undefined, onError);

		setImmediate(() => {
			mockProcess.emit('exit', null, 'SIGTERM');
			mockProcess.stderr.emit('data', Buffer.from('some error after cancellation'));
		});

		await promise;

		expect(onError).not.toHaveBeenCalled();
	});

	it('should include cache-dir in spawn arguments', async () => {
		const promise = runResticCommand(['backup', '/test']);

		setImmediate(() => {
			mockProcess.stdout.emit('data', Buffer.from('done'));
			mockProcess.emit('close', 0);
		});

		await promise;

		const spawnArgs = mockSpawn.mock.calls[0][1];
		expect(spawnArgs).toContain('--cache-dir');
		const cacheDirIndex = spawnArgs.indexOf('--cache-dir');
		expect(spawnArgs[cacheDirIndex + 1]).toContain('restic-cache');
	});

	it('should accumulate multiple stdout data chunks', async () => {
		const chunks = ['chunk1', 'chunk2', 'chunk3'];
		const expectedOutput = chunks.join('');

		const promise = runResticCommand(['backup', '/test']);

		setImmediate(() => {
			chunks.forEach(chunk => {
				mockProcess.stdout.emit('data', Buffer.from(chunk));
			});
			mockProcess.emit('close', 0);
		});

		const result = await promise;
		expect(result).toBe(expectedOutput);
	});

	it('should handle verbose_status message type', async () => {
		const onProgress = jest.fn();
		const verboseStatusData = JSON.stringify({
			message_type: 'verbose_status',
			action: 'scan',
			item: '/test/file.txt',
		});

		const promise = runResticCommand(['backup', '/test'], {}, onProgress);

		setImmediate(() => {
			mockProcess.stdout.emit('data', Buffer.from(verboseStatusData));
			mockProcess.emit('close', 0);
		});

		await promise;

		expect(onProgress).toHaveBeenCalled();
	});

	it('should handle process exit before close', async () => {
		const promise = runResticCommand(['backup', '/test']);

		setImmediate(() => {
			mockProcess.emit('exit', 0, null);
			mockProcess.stdout.emit('data', Buffer.from('output'));
			mockProcess.emit('close', 0);
		});

		await expect(promise).resolves.toBe('output');
	});

	it('should handle empty stdout output', async () => {
		const promise = runResticCommand(['backup', '/test']);

		setImmediate(() => {
			mockProcess.emit('close', 0);
		});

		const result = await promise;
		expect(result).toBe('');
	});

	it('should pass correct restic binary path to spawn', async () => {
		mockGetBinaryPath.mockImplementation((binary: string) =>
			binary === 'restic' ? '/custom/restic/path' : `/mock/path/${binary}`
		);

		const promise = runResticCommand(['backup', '/test']);

		setImmediate(() => {
			mockProcess.stdout.emit('data', Buffer.from('done'));
			mockProcess.emit('close', 0);
		});

		await promise;

		expect(mockSpawn).toHaveBeenCalledWith(
			'/custom/restic/path',
			expect.any(Array),
			expect.any(Object)
		);
	});
});

describe('getBackupPlanStats', () => {
	let mockProcess: any;

	beforeEach(() => {
		jest.clearAllMocks();

		mockGetBinaryPath.mockImplementation((binary: string) => `/mock/path/${binary}`);
		mockGetRcloneConfigPath.mockReturnValue('/mock/rclone.conf');
		mockAppPaths.getTempDir = jest.fn(() => '/mock/temp');
		mockGenerateResticRepoPath.mockReturnValue('rclone:storage-name:storage-path');

		mockProcess = new EventEmitter();
		mockProcess.stdout = new EventEmitter();
		mockProcess.stderr = new EventEmitter();
		mockProcess.kill = jest.fn();
		mockProcess.pid = 12345;

		mockSpawn.mockReturnValue(mockProcess as any);

		process.env.ENCRYPTION_KEY = 'test-encryption-key';
	});

	afterEach(() => {
		delete process.env.ENCRYPTION_KEY;
	});

	it('should return stats and snapshot IDs for valid plan', async () => {
		const planId = 'test-plan-123';
		const statsOutput = JSON.stringify({
			total_size: 1024000,
			total_file_count: 100,
		});
		const snapshotsOutput = JSON.stringify([
			{
				id: 'snap1',
				tags: ['plan-test-plan-123', 'backup-backup1'],
			},
			{
				id: 'snap2',
				tags: ['plan-test-plan-123', 'backup-backup2'],
			},
		]);

		let callCount = 0;
		mockSpawn.mockImplementation(() => {
			callCount++;
			const process = new EventEmitter() as any;
			process.stdout = new EventEmitter();
			process.stderr = new EventEmitter();
			process.kill = jest.fn();

			setImmediate(() => {
				if (callCount === 1) {
					// First call: stats
					process.stdout.emit('data', Buffer.from(statsOutput));
				} else {
					// Second call: snapshots
					process.stdout.emit('data', Buffer.from(snapshotsOutput));
				}
				process.emit('close', 0);
			});

			return process;
		});

		const result = await getBackupPlanStats(planId, 'storage-name', 'storage-path', true);

		expect(result).toEqual({
			total_size: 1024000,
			snapshots: ['backup1', 'backup2'],
		});
		expect(mockGenerateResticRepoPath).toHaveBeenCalledWith('storage-name', 'storage-path');
	});

	it('should return false when planId is missing', async () => {
		const result = await getBackupPlanStats('', 'storage-name', 'storage-path', true);
		expect(result).toBe(false);
	});

	it('should return false when storageName is missing', async () => {
		const result = await getBackupPlanStats('plan-id', '', 'storage-path', true);
		expect(result).toBe(false);
	});

	it('should return false when storagePath is missing', async () => {
		const result = await getBackupPlanStats('plan-id', 'storage-name', '', true);
		expect(result).toBe(false);
	});

	it('should return false when restic command fails', async () => {
		mockSpawn.mockImplementation(() => {
			const process = new EventEmitter() as any;
			process.stdout = new EventEmitter();
			process.stderr = new EventEmitter();
			process.kill = jest.fn();

			setImmediate(() => {
				process.stderr.emit('data', Buffer.from('repository not found'));
				process.emit('close', 1);
			});

			return process;
		});

		const result = await getBackupPlanStats('plan-id', 'storage-name', 'storage-path', true);
		expect(result).toBe(false);
	});

	it('should handle snapshots without backup tags', async () => {
		const statsOutput = JSON.stringify({ total_size: 5000 });
		const snapshotsOutput = JSON.stringify([
			{
				id: 'snap1',
				tags: ['plan-test-plan', 'other-tag'],
			},
			{
				id: 'snap2',
				tags: ['plan-test-plan'],
			},
		]);

		let callCount = 0;
		mockSpawn.mockImplementation(() => {
			callCount++;
			const process = new EventEmitter() as any;
			process.stdout = new EventEmitter();
			process.stderr = new EventEmitter();
			process.kill = jest.fn();

			setImmediate(() => {
				if (callCount === 1) {
					process.stdout.emit('data', Buffer.from(statsOutput));
				} else {
					process.stdout.emit('data', Buffer.from(snapshotsOutput));
				}
				process.emit('close', 0);
			});

			return process;
		});

		const result = await getBackupPlanStats('test-plan', 'storage', 'path', false);

		expect(result).toEqual({
			total_size: 5000,
			snapshots: [],
		});
	});

	it('should use empty password when encryption is false', async () => {
		const statsOutput = JSON.stringify({ total_size: 1000 });
		const snapshotsOutput = JSON.stringify([]);

		let callCount = 0;
		let capturedEnv: any;

		mockSpawn.mockImplementation((binary, args, options) => {
			callCount++;
			capturedEnv = options?.env;
			const process = new EventEmitter() as any;
			process.stdout = new EventEmitter();
			process.stderr = new EventEmitter();
			process.kill = jest.fn();

			setImmediate(() => {
				process.stdout.emit('data', Buffer.from(callCount === 1 ? statsOutput : snapshotsOutput));
				process.emit('close', 0);
			});

			return process;
		});

		await getBackupPlanStats('plan-id', 'storage', 'path', false);

		expect(capturedEnv?.RESTIC_PASSWORD).toBe('');
	});

	it('should handle invalid JSON in stats output', async () => {
		mockSpawn.mockImplementation(() => {
			const process = new EventEmitter() as any;
			process.stdout = new EventEmitter();
			process.stderr = new EventEmitter();
			process.kill = jest.fn();

			setImmediate(() => {
				process.stdout.emit('data', Buffer.from('invalid json'));
				process.emit('close', 0);
			});

			return process;
		});

		const result = await getBackupPlanStats('plan-id', 'storage', 'path', true);
		expect(result).toBe(false);
	});

	it('should extract multiple backup IDs from snapshots', async () => {
		const statsOutput = JSON.stringify({ total_size: 10000 });
		const snapshotsOutput = JSON.stringify([
			{
				id: 'snap1',
				tags: ['plan-myplan', 'backup-id1', 'device-abc'],
			},
			{
				id: 'snap2',
				tags: ['plan-myplan', 'backup-id2'],
			},
			{
				id: 'snap3',
				tags: ['plan-myplan', 'backup-id3', 'backup-id4'], // Multiple backup tags
			},
		]);

		let callCount = 0;
		mockSpawn.mockImplementation(() => {
			callCount++;
			const process = new EventEmitter() as any;
			process.stdout = new EventEmitter();
			process.stderr = new EventEmitter();
			process.kill = jest.fn();

			setImmediate(() => {
				process.stdout.emit('data', Buffer.from(callCount === 1 ? statsOutput : snapshotsOutput));
				process.emit('close', 0);
			});

			return process;
		});

		const result = await getBackupPlanStats('myplan', 'storage', 'path', true);

		expect(result).toEqual({
			total_size: 10000,
			snapshots: ['id1', 'id2', 'id3'], // First backup- tag from each snapshot
		});
	});
});

describe('getSnapshotByTag', () => {
	let mockProcess: any;

	beforeEach(() => {
		jest.clearAllMocks();

		mockGetBinaryPath.mockImplementation((binary: string) => `/mock/path/${binary}`);
		mockGetRcloneConfigPath.mockReturnValue('/mock/rclone.conf');
		mockAppPaths.getTempDir = jest.fn(() => '/mock/temp');
		mockGenerateResticRepoPath.mockReturnValue('rclone:storage:path');

		mockProcess = new EventEmitter();
		mockProcess.stdout = new EventEmitter();
		mockProcess.stderr = new EventEmitter();
		mockProcess.kill = jest.fn();

		mockSpawn.mockReturnValue(mockProcess as any);

		process.env.ENCRYPTION_KEY = 'test-key';
	});

	afterEach(() => {
		delete process.env.ENCRYPTION_KEY;
	});

	it('should return snapshot when found', async () => {
		const snapshotData = {
			id: 'abc123',
			time: '2025-10-21T10:00:00Z',
			tags: ['backup-test'],
			paths: ['/test/path'],
		};
		const output = JSON.stringify([snapshotData]);

		mockSpawn.mockImplementation(() => {
			const process = new EventEmitter() as any;
			process.stdout = new EventEmitter();
			process.stderr = new EventEmitter();
			process.kill = jest.fn();

			setImmediate(() => {
				process.stdout.emit('data', Buffer.from(output));
				process.emit('close', 0);
			});

			return process;
		});

		const result = await getSnapshotByTag('backup-test', {
			storagePath: 'path',
			storageName: 'storage',
			encryption: true,
		});

		expect(result).toEqual({
			success: true,
			result: snapshotData,
		});
	});

	it('should return failure when snapshot not found', async () => {
		const output = JSON.stringify([]);

		mockSpawn.mockImplementation(() => {
			const process = new EventEmitter() as any;
			process.stdout = new EventEmitter();
			process.stderr = new EventEmitter();
			process.kill = jest.fn();

			setImmediate(() => {
				process.stdout.emit('data', Buffer.from(output));
				process.emit('close', 0);
			});

			return process;
		});

		const result = await getSnapshotByTag('nonexistent-tag', {
			storagePath: 'path',
			storageName: 'storage',
			encryption: false,
		});

		expect(result).toEqual({
			success: false,
			result: 'Snapshot Not Found',
		});
	});

	it('should return failure when restic command fails', async () => {
		mockSpawn.mockImplementation(() => {
			const process = new EventEmitter() as any;
			process.stdout = new EventEmitter();
			process.stderr = new EventEmitter();
			process.kill = jest.fn();

			setImmediate(() => {
				process.stderr.emit('data', Buffer.from('authentication failed'));
				process.emit('close', 1);
			});

			return process;
		});

		const result = await getSnapshotByTag('tag', {
			storagePath: 'path',
			storageName: 'storage',
			encryption: true,
		});

		expect(result.success).toBe(false);
		expect(result.result).toContain('Snapshot Not Found');
	});

	it('should handle invalid JSON response', async () => {
		mockSpawn.mockImplementation(() => {
			const process = new EventEmitter() as any;
			process.stdout = new EventEmitter();
			process.stderr = new EventEmitter();
			process.kill = jest.fn();

			setImmediate(() => {
				process.stdout.emit('data', Buffer.from('invalid json'));
				process.emit('close', 0);
			});

			return process;
		});

		const result = await getSnapshotByTag('tag', {
			storagePath: 'path',
			storageName: 'storage',
			encryption: false,
		});

		expect(result.success).toBe(false);
		expect(result.result).toContain('Snapshot Not Found');
	});

	it('should use encryption key when encryption is true', async () => {
		const output = JSON.stringify([{ id: 'snap1', tags: ['test'] }]);
		let capturedEnv: any;

		mockSpawn.mockImplementation((binary, args, options) => {
			capturedEnv = options?.env;
			const process = new EventEmitter() as any;
			process.stdout = new EventEmitter();
			process.stderr = new EventEmitter();
			process.kill = jest.fn();

			setImmediate(() => {
				process.stdout.emit('data', Buffer.from(output));
				process.emit('close', 0);
			});

			return process;
		});

		await getSnapshotByTag('test', {
			storagePath: 'path',
			storageName: 'storage',
			encryption: true,
		});

		expect(capturedEnv?.RESTIC_PASSWORD).toBe('test-encryption-key');
	});

	it('should use empty password when encryption is false', async () => {
		const output = JSON.stringify([{ id: 'snap1', tags: ['test'] }]);
		let capturedEnv: any;

		mockSpawn.mockImplementation((binary, args, options) => {
			capturedEnv = options?.env;
			const process = new EventEmitter() as any;
			process.stdout = new EventEmitter();
			process.stderr = new EventEmitter();
			process.kill = jest.fn();

			setImmediate(() => {
				process.stdout.emit('data', Buffer.from(output));
				process.emit('close', 0);
			});

			return process;
		});

		await getSnapshotByTag('test', {
			storagePath: 'path',
			storageName: 'storage',
			encryption: false,
		});

		expect(capturedEnv?.RESTIC_PASSWORD).toBe('');
	});

	it('should handle snapshot array with no id field', async () => {
		const output = JSON.stringify([{ tags: ['test'], time: '2025-10-21' }]);

		mockSpawn.mockImplementation(() => {
			const process = new EventEmitter() as any;
			process.stdout = new EventEmitter();
			process.stderr = new EventEmitter();
			process.kill = jest.fn();

			setImmediate(() => {
				process.stdout.emit('data', Buffer.from(output));
				process.emit('close', 0);
			});

			return process;
		});

		const result = await getSnapshotByTag('test', {
			storagePath: 'path',
			storageName: 'storage',
			encryption: false,
		});

		expect(result).toEqual({
			success: false,
			result: 'Snapshot Not Found',
		});
	});

	it('should return first snapshot when multiple found', async () => {
		const snapshot1 = { id: 'first', tags: ['tag1'] };
		const snapshot2 = { id: 'second', tags: ['tag1'] };
		const output = JSON.stringify([snapshot1, snapshot2]);

		mockSpawn.mockImplementation(() => {
			const process = new EventEmitter() as any;
			process.stdout = new EventEmitter();
			process.stderr = new EventEmitter();
			process.kill = jest.fn();

			setImmediate(() => {
				process.stdout.emit('data', Buffer.from(output));
				process.emit('close', 0);
			});

			return process;
		});

		const result = await getSnapshotByTag('tag1', {
			storagePath: 'path',
			storageName: 'storage',
			encryption: true,
		});

		expect(result).toEqual({
			success: true,
			result: snapshot1,
		});
	});

	it('should include error message in result on exception', async () => {
		const errorMessage = 'Network connection lost';
		mockSpawn.mockImplementation(() => {
			const process = new EventEmitter() as any;
			process.stdout = new EventEmitter();
			process.stderr = new EventEmitter();
			process.kill = jest.fn();

			setImmediate(() => {
				process.stderr.emit('data', Buffer.from(errorMessage));
				process.emit('close', 1);
			});

			return process;
		});

		const result = await getSnapshotByTag('tag', {
			storagePath: 'path',
			storageName: 'storage',
			encryption: true,
		});

		expect(result.success).toBe(false);
		expect(result.result).toContain('Snapshot Not Found');
		expect(result.result).toContain(errorMessage);
	});

	it('should call generateResticRepoPath with correct parameters', async () => {
		const output = JSON.stringify([{ id: 'snap1', tags: ['test'] }]);

		mockSpawn.mockImplementation(() => {
			const process = new EventEmitter() as any;
			process.stdout = new EventEmitter();
			process.stderr = new EventEmitter();
			process.kill = jest.fn();

			setImmediate(() => {
				process.stdout.emit('data', Buffer.from(output));
				process.emit('close', 0);
			});

			return process;
		});

		await getSnapshotByTag('my-tag', {
			storagePath: 'custom-path',
			storageName: 'custom-storage',
			encryption: true,
		});

		expect(mockGenerateResticRepoPath).toHaveBeenCalledWith('custom-storage', 'custom-path');
	});
});
