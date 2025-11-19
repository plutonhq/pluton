import { EventEmitter } from 'events';
import fs from 'fs';
import { mkdir, rm, unlink } from 'fs/promises';
import path from 'path';

jest.mock('fs', () => ({
	...jest.requireActual('fs'),
	createReadStream: jest.fn(() => ({ fake: 'stream' })),
	existsSync: jest.fn(() => true),
}));

jest.mock('fs/promises', () => ({
	mkdir: jest.fn(),
	rm: jest.fn(),
	unlink: jest.fn(),
	readFile: jest.fn(),
}));

// Mock external utilities used by DownloadHandler
const mockRunResticCommand = jest.fn();
const mockGenerateResticRepoPath = jest.fn(() => 'repo-path');
const mockTrackProcess = jest.fn();
const mockKillProcess = jest.fn(() => true);
const mockRunCommand = jest.fn();

jest.mock('../../../src/utils/restic/restic', () => ({
	runResticCommand: mockRunResticCommand,
}));

jest.mock('../../../src/utils/restic/helpers', () => ({
	generateResticRepoPath: mockGenerateResticRepoPath,
}));

jest.mock('../../../src/managers/ProcessManager', () => ({
	processManager: {
		trackProcess: mockTrackProcess,
		killProcess: mockKillProcess,
	},
}));

jest.mock('../../../src/utils/runCommand', () => ({
	runCommand: mockRunCommand,
}));

jest.mock('../../../src/utils/AppPaths', () => ({
	appPaths: {
		getDownloadsDir: () => path.join(__dirname, 'tmp-downloads'),
	},
}));

import { DownloadHandler } from '../../../src/managers/handlers/DownloadHandler';
import { processManager } from '../../../src/managers/ProcessManager';
import { runResticCommand } from '../../../src/utils/restic/restic';
import { appPaths } from '../../../src/utils/AppPaths';

describe('DownloadHandler', () => {
	let emitter: EventEmitter;
	let handler: DownloadHandler;

	beforeEach(() => {
		jest.clearAllMocks();
		emitter = new EventEmitter();
		handler = new DownloadHandler(emitter);
	});

	test('download: successful flow creates tar and resolves path', async () => {
		// Simulate runResticCommand invoking the completion callback with code 0
		mockRunResticCommand.mockImplementation(
			(_args: any, _env: any, _onProgress: any, _onError: any, onComplete: any, _track) => {
				// call onComplete with code 0 asynchronously
				setImmediate(() => onComplete(0));
				// return a promise that does not resolve so the outer .then(resolve) in the
				// implementation doesn't prematurely resolve the download promise with undefined
				return new Promise(() => {});
			}
		);

		// runCommand resolves (tar created)
		mockRunCommand.mockResolvedValue(undefined as any);

		const progressEvents: any[] = [];
		emitter.on('download_progress', p => progressEvents.push(p));

		const result = await handler.download('plan1', 'backup1', 'snap1', {
			storageName: 's',
			storagePath: '/p',
			encryption: false,
		});

		expect(result).toContain('backup-backup1.tar');
		expect(mockGenerateResticRepoPath).toHaveBeenCalledWith('s', '/p');
		expect(mockRunCommand).toHaveBeenCalled();
	});

	test('download: restic restore failure rejects', async () => {
		mockRunResticCommand.mockImplementation(
			(_args: any, _env: any, _onProgress: any, _onError: any, onComplete: any, _track) => {
				setImmediate(() => onComplete(1));
				return new Promise(() => {});
			}
		);

		await expect(
			handler.download('plan1', 'backup2', 'snap2', {
				storageName: 's',
				storagePath: '',
				encryption: false,
			})
		).rejects.toThrow('Restore failed');
	});

	test('cancel: kills process and removes file when exists', async () => {
		mockKillProcess.mockReturnValue(true);
		// make existsSync true
		(fs.existsSync as jest.Mock).mockReturnValue(true);

		const res = await handler.cancel('plan1', 'backup3');
		expect(processManager.killProcess('download-backup3')).toBeTruthy();
		expect(unlink).toHaveBeenCalled();
		expect(res).toBeTruthy();
	});

	test('get: returns filename and stream', async () => {
		const out = await handler.get('plan1', 'backup4');
		expect(out.fileName).toBe('backup-backup4.tar');
		expect(fs.createReadStream).toHaveBeenCalled();
		expect(out.fileStream).toEqual({ fake: 'stream' });
	});

	test('download: emits progress events when restic writes progress', async () => {
		const progressBuffer = Buffer.from(JSON.stringify({ files: 1 }));

		mockRunResticCommand.mockImplementation(
			(_args: any, _env: any, onProgress: any, _onError: any, onComplete: any, _track) => {
				setImmediate(() => onProgress(progressBuffer));
				setImmediate(() => onComplete(0));
				return new Promise(() => {});
			}
		);

		const progressEvents: any[] = [];
		emitter.on('download_progress', p => progressEvents.push(p));

		mockRunCommand.mockResolvedValue(undefined as any);
		const result = await handler.download('planX', 'backupX', 'snapX', {
			storageName: 's',
			storagePath: '',
			encryption: false,
		});
		expect(progressEvents.length).toBeGreaterThan(0);
		expect(result).toContain('backup-backupX.tar');
	});

	test('download: passes encryption key to restic env when encryption=true', async () => {
		process.env.ENCRYPTION_KEY = 'secret';

		let receivedEnv: any = null;
		mockRunResticCommand.mockImplementation(
			(_args: any, env: any, _onProgress: any, _onError: any, onComplete: any, _track) => {
				receivedEnv = env;
				setImmediate(() => onComplete(0));
				return new Promise(() => {});
			}
		);

		mockRunCommand.mockResolvedValue(undefined as any);
		await handler.download('planE', 'backupE', 'snapE', {
			storageName: 's',
			storagePath: '',
			encryption: true,
		});
		expect(receivedEnv).toHaveProperty('RESTIC_PASSWORD', 'secret');
		expect(receivedEnv).toHaveProperty('RCLONE_CONFIG_PASS', 'secret');
	});

	test('download: continues and resolves even if rm fails (cleanup error logged)', async () => {
		mockRunResticCommand.mockImplementation(
			(_args: any, _env: any, _onProgress: any, _onError: any, onComplete: any, _track) => {
				setImmediate(() => onComplete(0));
				return new Promise(() => {});
			}
		);

		// make rm reject to simulate cleanup failure
		(rm as jest.Mock).mockRejectedValueOnce(new Error('rm failed'));
		mockRunCommand.mockResolvedValue(undefined as any);

		const result = await handler.download('planR', 'backupR', 'snapR', {
			storageName: 's',
			storagePath: '',
			encryption: false,
		});
		expect(result).toContain('backup-backupR.tar');
		// rm was attempted
		expect(rm).toHaveBeenCalled();
	});

	test('cancel: returns true even if killProcess returns false (no file removal)', async () => {
		mockKillProcess.mockReturnValue(false);
		(fs.existsSync as jest.Mock).mockReturnValue(true);

		const res = await handler.cancel('plan1', 'backup-no-kill');
		expect(processManager.killProcess('download-backup-no-kill')).toBeFalsy();
		// unlink should not be called because kill failed
		expect(unlink).not.toHaveBeenCalled();
		expect(res).toBeTruthy();
	});
});
