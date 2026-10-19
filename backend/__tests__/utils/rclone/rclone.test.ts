import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { rootCertificates } from 'tls';

jest.mock('child_process');
jest.mock('os');
jest.mock('../../../src/utils/binaryPathResolver');
jest.mock('../../../src/utils/rclone/helpers');
jest.mock('../../../src/services/ConfigService', () => ({
	configService: {
		config: {
			ENCRYPTION_KEY: 'test-encryption-key',
		},
		isSetupPending: jest.fn().mockReturnValue(false),
	},
}));
jest.mock('../../../src/utils/AppPaths', () => ({
	appPaths: {
		getConfigDir: jest.fn().mockReturnValue('/mock/config'),
		getTempDir: jest.fn().mockReturnValue('/mock/temp'),
	},
}));

import { runRcloneCommand, runRcloneCommandWithProgress } from '../../../src/utils/rclone/rclone';
import { getBinaryPath } from '../../../src/utils/binaryPathResolver';
import { getRcloneConfigPath } from '../../../src/utils/rclone/helpers';

describe('runRcloneCommand', () => {
	let mockProcess: any;
	let consoleLogSpy: jest.SpyInstance;
	const mockedOs = os as jest.Mocked<typeof os>;

	beforeEach(() => {
		// Setup mock process
		mockProcess = new EventEmitter();
		mockProcess.stdout = new EventEmitter();
		mockProcess.stderr = new EventEmitter();

		// Setup mocks
		(spawn as jest.Mock).mockReturnValue(mockProcess);
		(getBinaryPath as jest.Mock).mockReturnValue('/usr/local/bin/rclone');
		(getRcloneConfigPath as jest.Mock).mockReturnValue('/home/user/.config/rclone/rclone.conf');
		mockedOs.homedir.mockReturnValue('/home/user');
		mockedOs.tmpdir = jest.fn().mockReturnValue('/tmp');

		// Mock environment variables
		process.env.LOCALAPPDATA = 'C:\\Users\\Test\\AppData\\Local';
		process.env.ENCRYPTION_KEY = 'test-encryption-key';

		consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
	});

	afterEach(() => {
		consoleLogSpy.mockRestore();
		jest.clearAllMocks();
		delete process.env.ENCRYPTION_KEY;
		delete process.env.LOCALAPPDATA;
	});

	it('should execute rclone command successfully with stdout output', async () => {
		const args = ['ls', 'remote:path'];
		const expectedOutput = 'file1.txt\nfile2.txt';

		const promise = runRcloneCommand(args);

		mockProcess.stdout.emit('data', Buffer.from(expectedOutput));
		mockProcess.emit('close', 0);

		const result = await promise;

		expect(result).toBe(expectedOutput);
		expect(spawn).toHaveBeenCalledWith('/usr/local/bin/rclone', args, {
			detached: expect.any(Boolean),
			env: expect.objectContaining({
				RCLONE_CONFIG: '/home/user/.config/rclone/rclone.conf',
				LOCALAPPDATA: 'C:\\Users\\Test\\AppData\\Local',
				RCLONE_CONFIG_PASS: 'test-encryption-key',
			}),
		});
	});

	it('preserves exact file stdout and redacts a credential split across diagnostic chunks', async () => {
		const environment = { RCLONE_CONFIG_MIRROR_01_SECRET_ACCESS_KEY: 'synthetic-secret' };
		const promise = runRcloneCommand(
			['cat', 'mirror_01:fixture-bucket/pluton/file.sql'],
			environment
		);
		mockProcess.stdout.emit('data', Buffer.from('content synthetic-secret bytes'));
		mockProcess.emit('close', 0);
		expect(await promise).toBe('content synthetic-secret bytes');
		const stderr = jest.fn();
		const running = runRcloneCommandWithProgress(
			['copyto', 'source', 'mirror_01:fixture-bucket/pluton/file'],
			{ env: environment, onStderr: stderr }
		);
		mockProcess.stderr.emit('data', Buffer.from('denied synthetic-'));
		mockProcess.stderr.emit('data', Buffer.from('secret\n'));
		mockProcess.emit('close', 1);
		await expect(running.promise).rejects.toThrow('denied [redacted]');
		expect(stderr.mock.calls.map(call => call[0]).join('')).toBe('denied [redacted]\n');
	});

	it('passes validated operator CA trust to the actual child process without TLS bypass', async () => {
		process.env.PLUTON_STORAGE_CA_FILE = path.resolve('operator-storage-ca.pem');
		const stat = jest.spyOn(fs, 'lstatSync').mockReturnValue({
			isFile: () => true,
			isSymbolicLink: () => false,
			size: rootCertificates[0].length,
			mode: 0o600,
		} as any);
		const read = jest.spyOn(fs, 'readFileSync').mockReturnValue(rootCertificates[0]);
		try {
			const promise = runRcloneCommand(['lsd', 'mirror_01:fixture-bucket']);
			mockProcess.emit('close', 0);
			await promise;
			const environment = (spawn as jest.Mock).mock.calls[0][2].env;
			expect(environment).toMatchObject({
				SSL_CERT_FILE: process.env.PLUTON_STORAGE_CA_FILE,
				RCLONE_CA_CERT: process.env.PLUTON_STORAGE_CA_FILE,
			});
			expect(environment.RCLONE_NO_CHECK_CERTIFICATE).toBeUndefined();
		} finally {
			delete process.env.PLUTON_STORAGE_CA_FILE;
			stat.mockRestore();
			read.mockRestore();
		}
	});

	it('should return stderr output when stdout is empty', async () => {
		const args = ['config', 'show'];
		const errorOutput = 'Configuration details here';

		const promise = runRcloneCommand(args);

		mockProcess.stderr.emit('data', Buffer.from(errorOutput));
		mockProcess.emit('close', 0);

		const result = await promise;

		expect(result).toBe(errorOutput);
	});

	it('should return empty string when both stdout and stderr are empty', async () => {
		const args = ['config', 'check'];

		const promise = runRcloneCommand(args);

		mockProcess.emit('close', 0);

		const result = await promise;

		expect(result).toBe('');
	});

	it('should reject on non-zero exit code', async () => {
		const args = ['copy', 'source', 'dest'];
		const errorMessage = 'Failed to copy files';

		const promise = runRcloneCommand(args);

		mockProcess.stderr.emit('data', Buffer.from(errorMessage));
		mockProcess.emit('close', 1);

		await expect(promise).rejects.toThrow(errorMessage);
	});

	it('should reject with default message when error output is empty', async () => {
		const args = ['sync', 'source', 'dest'];

		const promise = runRcloneCommand(args);

		mockProcess.emit('close', 1);

		await expect(promise).rejects.toThrow('Rclone command failed');
	});

	it('should use getBinaryPath to resolve rclone binary', async () => {
		const args = ['version'];

		const promise = runRcloneCommand(args);

		mockProcess.emit('close', 0);

		await promise;

		expect(getBinaryPath).toHaveBeenCalledWith('rclone');
	});

	it('should use getRcloneConfigPath to get config path', async () => {
		const args = ['version'];

		const promise = runRcloneCommand(args);

		mockProcess.emit('close', 0);

		await promise;

		expect(getRcloneConfigPath).toHaveBeenCalled();
	});

	it('should merge custom environment variables', async () => {
		const args = ['config', 'encryption', 'set'];
		const customEnv = {
			CUSTOM_VAR: 'custom-value',
			RCLONE_TEMP_PASS: 'temp-password',
		};

		const promise = runRcloneCommand(args, customEnv);

		mockProcess.emit('close', 0);

		await promise;

		expect(spawn).toHaveBeenCalledWith('/usr/local/bin/rclone', args, {
			detached: expect.any(Boolean),
			env: expect.objectContaining({
				CUSTOM_VAR: 'custom-value',
				RCLONE_TEMP_PASS: 'temp-password',
				RCLONE_CONFIG: '/home/user/.config/rclone/rclone.conf',
				LOCALAPPDATA: 'C:\\Users\\Test\\AppData\\Local',
				RCLONE_CONFIG_PASS: 'test-encryption-key',
			}),
		});
	});

	it('should use homedir as fallback when LOCALAPPDATA is not set', async () => {
		delete process.env.LOCALAPPDATA;
		const args = ['version'];

		const promise = runRcloneCommand(args);

		mockProcess.emit('close', 0);

		await promise;

		expect(spawn).toHaveBeenCalledWith('/usr/local/bin/rclone', args, {
			detached: expect.any(Boolean),
			env: expect.objectContaining({
				LOCALAPPDATA: '/home/user',
			}),
		});
	});

	it('should handle multiple stdout data chunks', async () => {
		const args = ['ls', 'remote:'];
		const chunk1 = 'file1.txt\n';
		const chunk2 = 'file2.txt\n';
		const chunk3 = 'file3.txt';

		const promise = runRcloneCommand(args);

		mockProcess.stdout.emit('data', Buffer.from(chunk1));
		mockProcess.stdout.emit('data', Buffer.from(chunk2));
		mockProcess.stdout.emit('data', Buffer.from(chunk3));
		mockProcess.emit('close', 0);

		const result = await promise;

		expect(result).toBe('file1.txt\nfile2.txt\nfile3.txt');
	});

	it('should handle multiple stderr data chunks', async () => {
		const args = ['sync', 'source', 'dest'];
		const chunk1 = 'Error: ';
		const chunk2 = 'Connection ';
		const chunk3 = 'failed';

		const promise = runRcloneCommand(args);

		mockProcess.stderr.emit('data', Buffer.from(chunk1));
		mockProcess.stderr.emit('data', Buffer.from(chunk2));
		mockProcess.stderr.emit('data', Buffer.from(chunk3));
		mockProcess.emit('close', 1);

		await expect(promise).rejects.toThrow('Error: Connection failed');
	});

	it('should trim output before returning', async () => {
		const args = ['version'];
		const outputWithSpaces = '  rclone v1.0.0  \n  ';

		const promise = runRcloneCommand(args);

		mockProcess.stdout.emit('data', Buffer.from(outputWithSpaces));
		mockProcess.emit('close', 0);

		const result = await promise;

		expect(result).toBe('rclone v1.0.0');
	});

	it('should handle commands with no arguments', async () => {
		const args: string[] = [];

		const promise = runRcloneCommand(args);

		mockProcess.emit('close', 0);

		await promise;

		expect(spawn).toHaveBeenCalledWith('/usr/local/bin/rclone', [], expect.any(Object));
	});

	it('should set RCLONE_CONFIG_PASS from configService', async () => {
		const args = ['config', 'show'];

		const promise = runRcloneCommand(args);

		mockProcess.emit('close', 0);

		await promise;

		expect(spawn).toHaveBeenCalledWith('/usr/local/bin/rclone', args, {
			detached: expect.any(Boolean),
			env: expect.objectContaining({
				RCLONE_CONFIG_PASS: 'test-encryption-key',
			}),
		});
	});

	it('should use ENCRYPTION_KEY from configService', async () => {
		delete process.env.ENCRYPTION_KEY;
		const args = ['version'];

		const promise = runRcloneCommand(args);

		mockProcess.emit('close', 0);

		await promise;

		// RCLONE_CONFIG_PASS comes from configService.config.ENCRYPTION_KEY, not process.env
		expect(spawn).toHaveBeenCalledWith('/usr/local/bin/rclone', args, {
			detached: expect.any(Boolean),
			env: expect.objectContaining({
				RCLONE_CONFIG_PASS: 'test-encryption-key',
			}),
		});
	});

	it('should prefer stdout over stderr when both are present', async () => {
		const args = ['ls', 'remote:'];
		const stdoutData = 'file1.txt';
		const stderrData = 'Warning: something';

		const promise = runRcloneCommand(args);

		mockProcess.stdout.emit('data', Buffer.from(stdoutData));
		mockProcess.stderr.emit('data', Buffer.from(stderrData));
		mockProcess.emit('close', 0);

		const result = await promise;

		expect(result).toBe(stdoutData);
	});

	it('should handle binary path with spaces', async () => {
		(getBinaryPath as jest.Mock).mockReturnValue('C:\\Program Files\\rclone\\rclone.exe');
		const args = ['version'];

		const promise = runRcloneCommand(args);

		mockProcess.emit('close', 0);

		await promise;

		expect(spawn).toHaveBeenCalledWith(
			'C:\\Program Files\\rclone\\rclone.exe',
			args,
			expect.any(Object)
		);
	});

	it('should handle config path with special characters', async () => {
		(getRcloneConfigPath as jest.Mock).mockReturnValue('/home/user/.config/rclone (1)/rclone.conf');
		const args = ['version'];

		const promise = runRcloneCommand(args);

		mockProcess.emit('close', 0);

		await promise;

		expect(spawn).toHaveBeenCalledWith('/usr/local/bin/rclone', args, {
			detached: expect.any(Boolean),
			env: expect.objectContaining({
				RCLONE_CONFIG: '/home/user/.config/rclone (1)/rclone.conf',
			}),
		});
	});

	it('should handle environment variables override', async () => {
		const args = ['version'];
		const customEnv = {
			RCLONE_CONFIG: '/custom/path/rclone.conf',
			RCLONE_CONFIG_PASS: 'custom-password',
		};

		const promise = runRcloneCommand(args, customEnv);

		mockProcess.emit('close', 0);

		await promise;

		// Custom env should override defaults
		expect(spawn).toHaveBeenCalledWith('/usr/local/bin/rclone', args, {
			detached: expect.any(Boolean),
			env: expect.objectContaining({
				RCLONE_CONFIG: '/custom/path/rclone.conf',
				RCLONE_CONFIG_PASS: 'custom-password',
			}),
		});
	});
});
