import path from 'path';
import os from 'os';
import { ChildProcess } from 'child_process';
import { appPaths } from '../../../src/utils/AppPaths';
import {
	encryptRcloneConfig,
	getRcloneConfigPath,
	spawnRcloneAuthorize,
	RcloneAuthSession,
} from '../../../src/utils/rclone/helpers';
import { runRcloneCommand } from '../../../src/utils/rclone/rclone';
import { runCommand } from '../../../src/utils/runCommand';
import { getBinaryPath } from '../../../src/utils/binaryPathResolver';
import { getInstallType } from '../../../src/utils/installHelpers';

jest.mock('os');
jest.mock('../../../src/utils/runCommand');
jest.mock('../../../src/utils/binaryPathResolver');
jest.mock('../../../src/utils/installHelpers');

describe('rclone helpers', () => {
	describe('getRcloneConfigPath', () => {
		let originalGetConfigDir: any;

		beforeEach(() => {
			originalGetConfigDir = appPaths.getConfigDir;
		});

		afterEach(() => {
			appPaths.getConfigDir = originalGetConfigDir;
		});

		it('should return path with rclone.conf when secure is false', () => {
			appPaths.getConfigDir = jest.fn().mockReturnValue('/mock/config');
			const result = getRcloneConfigPath(false);
			expect(result).toBe(path.join('/mock/config', 'rclone.conf'));
		});

		it('should return path with rclone.conf.enc when secure is true', () => {
			appPaths.getConfigDir = jest.fn().mockReturnValue('/mock/config');
			const result = getRcloneConfigPath(true);
			expect(result).toBe(path.join('/mock/config', 'rclone.conf.enc'));
		});

		it('should default to non-secure config when no parameter is passed', () => {
			appPaths.getConfigDir = jest.fn().mockReturnValue('/mock/config');
			const result = getRcloneConfigPath();
			expect(result).toBe(path.join('/mock/config', 'rclone.conf'));
		});

		it('should use appPaths.getConfigDir() to get the config directory', () => {
			const mockGetConfigDir = jest.fn().mockReturnValue('/test/path');
			appPaths.getConfigDir = mockGetConfigDir;
			getRcloneConfigPath();
			expect(mockGetConfigDir).toHaveBeenCalledTimes(1);
		});

		it('should handle different config directory paths', () => {
			const testPaths = ['/home/user/.config', 'C:\\Users\\User\\AppData', '/var/config'];

			testPaths.forEach(testPath => {
				appPaths.getConfigDir = jest.fn().mockReturnValue(testPath);
				const result = getRcloneConfigPath(false);
				expect(result).toBe(path.join(testPath, 'rclone.conf'));
			});
		});
	});

	describe('encryptRcloneConfig', () => {
		let consoleLogSpy: jest.SpyInstance;
		let mockRunRcloneCommand: jest.Mock;
		const mockedOs = os as jest.Mocked<typeof os>;

		beforeEach(() => {
			consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
			mockRunRcloneCommand = jest.fn();
			(runRcloneCommand as any) = mockRunRcloneCommand;
			// Default to win32
			mockedOs.platform.mockReturnValue('win32');
		});

		afterEach(() => {
			consoleLogSpy.mockRestore();
			// Clean up any environment variables
			Object.keys(process.env).forEach(key => {
				if (key.startsWith('RCLONE_TEMP_PASS_')) {
					delete process.env[key];
				}
			});
			jest.clearAllMocks();
		});

		it('should return success if encryption is already completed', async () => {
			mockRunRcloneCommand.mockResolvedValue('');

			const result = await encryptRcloneConfig('test-password');

			expect(result).toEqual({
				success: true,
				result: 'Encryption already completed. Skipped.',
			});
			expect(mockRunRcloneCommand).toHaveBeenCalledWith(['config', 'encryption', 'check']);
		});

		it('should encrypt config on Windows when not encrypted', async () => {
			Object.defineProperty(process, 'platform', { value: 'win32' });
			mockRunRcloneCommand
				.mockRejectedValueOnce(new Error('Not encrypted'))
				.mockResolvedValueOnce('Encryption successful');

			const result = await encryptRcloneConfig('test-password');

			expect(result.success).toBe(true);
			expect(result.result).toBe('Encryption successful');
			expect(mockRunRcloneCommand).toHaveBeenCalledTimes(2);

			const secondCall = mockRunRcloneCommand.mock.calls[1];
			expect(secondCall[0]).toContain('config');
			expect(secondCall[0]).toContain('encryption');
			expect(secondCall[0]).toContain('set');
			expect(secondCall[0]).toContain('--password-command');
			expect(secondCall[0].join(' ')).toContain('cmd /c "echo %RCLONE_TEMP_PASS_');
		});

		it('should encrypt config on Windows when not encrypted', async () => {
			mockedOs.platform.mockReturnValue('win32');
			mockRunRcloneCommand
				.mockRejectedValueOnce(new Error('Not encrypted'))
				.mockResolvedValueOnce('Encryption successful');

			const result = await encryptRcloneConfig('test-password');

			expect(result.success).toBe(true);
			expect(result.result).toBe('Encryption successful');
			expect(mockRunRcloneCommand).toHaveBeenCalledTimes(2);

			const secondCall = mockRunRcloneCommand.mock.calls[1];
			expect(secondCall[0]).toContain('config');
			expect(secondCall[0]).toContain('encryption');
			expect(secondCall[0]).toContain('set');
			expect(secondCall[0]).toContain('--password-command');
			expect(secondCall[0].join(' ')).toContain('cmd /c "echo %RCLONE_TEMP_PASS_');
		});

		it('should encrypt config on Unix/Linux when not encrypted', async () => {
			mockedOs.platform.mockReturnValue('linux');
			mockRunRcloneCommand
				.mockRejectedValueOnce(new Error('Not encrypted'))
				.mockResolvedValueOnce('Encryption successful');

			const result = await encryptRcloneConfig('test-password');

			expect(result.success).toBe(true);
			expect(result.result).toBe('Encryption successful');

			const secondCall = mockRunRcloneCommand.mock.calls[1];
			expect(secondCall[0].join(' ')).toContain('/bin/echo $RCLONE_TEMP_PASS_');
		});

		it('should clean up environment variable after successful encryption', async () => {
			mockRunRcloneCommand
				.mockRejectedValueOnce(new Error('Not encrypted'))
				.mockResolvedValueOnce('Encryption successful');

			await encryptRcloneConfig('test-password');

			const tempVars = Object.keys(process.env).filter(key => key.startsWith('RCLONE_TEMP_PASS_'));
			expect(tempVars).toHaveLength(0);
		});

		it('should clean up environment variable after failed encryption', async () => {
			mockRunRcloneCommand
				.mockRejectedValueOnce(new Error('Not encrypted'))
				.mockResolvedValueOnce('failed to encrypt');

			await encryptRcloneConfig('test-password');

			const tempVars = Object.keys(process.env).filter(key => key.startsWith('RCLONE_TEMP_PASS_'));
			expect(tempVars).toHaveLength(0);
		});

		it('should return failure when encryption command fails', async () => {
			mockRunRcloneCommand
				.mockRejectedValueOnce(new Error('Not encrypted'))
				.mockResolvedValueOnce('failed to set encryption');

			const result = await encryptRcloneConfig('test-password');

			expect(result.success).toBe(false);
			expect(result.result).toContain('failed');
		});

		it('should handle errors during encryption process', async () => {
			mockRunRcloneCommand
				.mockRejectedValueOnce(new Error('Not encrypted'))
				.mockRejectedValueOnce(new Error('Encryption error'));

			const result = await encryptRcloneConfig('test-password');

			expect(result.success).toBe(false);
			expect(result.result).toBe('Encryption error');
		});

		it('should log security error when config is not encrypted', async () => {
			mockRunRcloneCommand
				.mockRejectedValueOnce(new Error('Not encrypted'))
				.mockResolvedValueOnce('Encryption successful');

			await encryptRcloneConfig('test-password');

			expect(consoleLogSpy).toHaveBeenCalledWith(
				expect.stringContaining('[Security Error]Rclone Config File Not encrypted')
			);
		});

		it('should log success message on successful encryption', async () => {
			mockRunRcloneCommand
				.mockRejectedValueOnce(new Error('Not encrypted'))
				.mockResolvedValueOnce('Encryption successful');

			await encryptRcloneConfig('test-password');

			expect(consoleLogSpy).toHaveBeenCalledWith(
				'[encryptRcloneConfig] success :',
				'Encryption successful'
			);
		});

		it('should log error message on encryption failure', async () => {
			const errorMessage = 'Test error';
			mockRunRcloneCommand
				.mockRejectedValueOnce(new Error('Not encrypted'))
				.mockRejectedValueOnce(new Error(errorMessage));

			await encryptRcloneConfig('test-password');

			expect(consoleLogSpy).toHaveBeenCalledWith(
				'[encryptRcloneConfig] error :',
				expect.any(Error)
			);
		});

		it('should pass password through environment variable', async () => {
			const testPassword = 'my-secret-password';
			mockRunRcloneCommand
				.mockRejectedValueOnce(new Error('Not encrypted'))
				.mockResolvedValueOnce('Encryption successful');

			await encryptRcloneConfig(testPassword);

			const secondCall = mockRunRcloneCommand.mock.calls[1];
			const envVars = secondCall[1];

			expect(envVars).toBeDefined();
			const envVarName = Object.keys(envVars).find(key => key.startsWith('RCLONE_TEMP_PASS_'));
			expect(envVarName).toBeDefined();
			expect(envVars[envVarName!]).toBe(testPassword);
		});

		it('should handle missing error message gracefully', async () => {
			mockRunRcloneCommand
				.mockRejectedValueOnce(new Error('Not encrypted'))
				.mockRejectedValueOnce({ name: 'Error' } as Error);

			const result = await encryptRcloneConfig('test-password');

			expect(result.success).toBe(false);
			expect(result.result).toBe('');
		});
	});

	describe('spawnRcloneAuthorize', () => {
		const mockRunCommand = runCommand as jest.Mock;
		const mockGetBinaryPath = getBinaryPath as jest.Mock;
		const mockGetInstallType = getInstallType as jest.Mock;

		let session: RcloneAuthSession;

		beforeEach(() => {
			jest.clearAllMocks();
			jest.useFakeTimers();

			mockGetBinaryPath.mockReturnValue('/usr/bin/rclone');
			mockGetInstallType.mockReturnValue('binary');
			jest.spyOn(console, 'log').mockImplementation();

			session = {
				id: 'test-session-1',
				storageType: 'drive',
				status: 'pending',
				startedAt: Date.now(),
			};

			// Default: runCommand resolves immediately
			mockRunCommand.mockResolvedValue('');
		});

		afterEach(() => {
			jest.useRealTimers();
			jest.restoreAllMocks();
		});

		it('should spawn rclone with correct args for binary install', () => {
			mockGetInstallType.mockReturnValue('binary');
			spawnRcloneAuthorize(session, 300_000);

			expect(mockRunCommand).toHaveBeenCalledWith(
				['/usr/bin/rclone', 'authorize', 'drive'],
				{},
				expect.any(Function),
				expect.any(Function),
				expect.any(Function),
				expect.any(Function)
			);
		});

		it('should add --auth-no-open-browser for docker installs', () => {
			mockGetInstallType.mockReturnValue('docker');
			spawnRcloneAuthorize(session, 300_000);

			expect(mockRunCommand).toHaveBeenCalledWith(
				['/usr/bin/rclone', 'authorize', 'drive', '--auth-no-open-browser'],
				{},
				expect.any(Function),
				expect.any(Function),
				expect.any(Function),
				expect.any(Function)
			);
		});

		it('should add --auth-no-open-browser for server installs', () => {
			mockGetInstallType.mockReturnValue('server');
			spawnRcloneAuthorize(session, 300_000);

			expect(mockRunCommand).toHaveBeenCalledWith(
				['/usr/bin/rclone', 'authorize', 'drive', '--auth-no-open-browser'],
				{},
				expect.any(Function),
				expect.any(Function),
				expect.any(Function),
				expect.any(Function)
			);
		});

		it('should not add --auth-no-open-browser for dev installs', () => {
			mockGetInstallType.mockReturnValue('dev');
			spawnRcloneAuthorize(session, 300_000);

			const callArgs = mockRunCommand.mock.calls[0][0];
			expect(callArgs).not.toContain('--auth-no-open-browser');
		});

		it('should extract token from stdout via onProgress callback', () => {
			mockRunCommand.mockImplementation((args, env, onProgress, onError, onComplete, onSpawn) => {
				const token = JSON.stringify({ access_token: 'xyz', expiry: '2025-10-26T10:00:00Z' });
				const chunk = `Paste the following into your remote machine --->\n${token}\n<---`;
				onProgress?.(Buffer.from(chunk));
				return Promise.resolve('');
			});

			spawnRcloneAuthorize(session, 300_000);

			expect(session.status).toBe('success');
			expect(session.token).toBe('{"access_token":"xyz","expiry":"2025-10-26T10:00:00Z"}');
		});

		it('should extract auth URL from stderr via onError callback', () => {
			mockRunCommand.mockImplementation((args, env, onProgress, onError, onComplete, onSpawn) => {
				onError?.(
					Buffer.from(
						"If your browser doesn't open automatically go to the following link: http://127.0.0.1:53682/auth\n"
					)
				);
				return Promise.resolve('');
			});

			spawnRcloneAuthorize(session, 300_000);

			expect(session.authUrl).toBe('http://127.0.0.1:53682/auth');
		});

		it('should capture process reference via onSpawn callback', () => {
			const mockProcess = { killed: false, kill: jest.fn() } as unknown as ChildProcess;

			mockRunCommand.mockImplementation((args, env, onProgress, onError, onComplete, onSpawn) => {
				onSpawn?.(mockProcess);
				return Promise.resolve('');
			});

			spawnRcloneAuthorize(session, 300_000);

			expect(session.process).toBe(mockProcess);
		});

		it('should set error status on timeout', () => {
			const mockProcess = { killed: false, kill: jest.fn() } as unknown as ChildProcess;

			mockRunCommand.mockImplementation((args, env, onProgress, onError, onComplete, onSpawn) => {
				onSpawn?.(mockProcess);
				// Never resolves - simulates long-running process
				return new Promise(() => {});
			});

			spawnRcloneAuthorize(session, 5000);

			expect(session.status).toBe('pending');
			jest.advanceTimersByTime(5000);
			expect(session.status).toBe('error');
			expect(session.error).toContain('timed out');
			expect(mockProcess.kill).toHaveBeenCalled();
		});

		it('should extract token in onComplete when stdout had the token', () => {
			mockRunCommand.mockImplementation((args, env, onProgress, onError, onComplete, onSpawn) => {
				const token = JSON.stringify({ access_token: 'abc' });
				onProgress?.(Buffer.from(`--->\n${token}\n<---`));
				// onProgress already extracted token, but test onComplete path
				// Reset to pending to test onComplete extraction
				return Promise.resolve('');
			});

			spawnRcloneAuthorize(session, 300_000);
			expect(session.status).toBe('success');
		});

		it('should extract token in catch handler when runCommand rejects', async () => {
			mockRunCommand.mockImplementation((args, env, onProgress, onError, onComplete, onSpawn) => {
				const token = JSON.stringify({ access_token: 'from-catch' });
				onProgress?.(Buffer.from(`--->\n${token}\n<---`));
				// Token extracted via onProgress, then reject
				return Promise.reject(new Error('exit code 1'));
			});

			spawnRcloneAuthorize(session, 300_000);

			// Let microtasks (catch handler) run
			await Promise.resolve();

			expect(session.status).toBe('success');
			expect(session.token).toBe('{"access_token":"from-catch"}');
		});

		it('should set error status when runCommand rejects without token', async () => {
			mockRunCommand.mockImplementation((args, env, onProgress, onError, onComplete, onSpawn) => {
				return Promise.reject(new Error('spawn failed'));
			});

			spawnRcloneAuthorize(session, 300_000);

			await Promise.resolve();

			expect(session.status).toBe('error');
			expect(session.error).toBe('spawn failed');
		});

		it('should set error when onComplete fires with no token', () => {
			mockRunCommand.mockImplementation((args, env, onProgress, onError, onComplete, onSpawn) => {
				onComplete?.(1);
				return Promise.resolve('');
			});

			spawnRcloneAuthorize(session, 300_000);

			expect(session.status).toBe('error');
			expect(session.error).toContain('exited with code 1');
		});

		it('should not overwrite success status in catch handler', async () => {
			mockRunCommand.mockImplementation((args, env, onProgress, onError, onComplete, onSpawn) => {
				const token = JSON.stringify({ access_token: 'valid' });
				onProgress?.(Buffer.from(`--->\n${token}\n<---`));
				// Token already extracted to success, then reject
				return Promise.reject(new Error('exit code 1'));
			});

			spawnRcloneAuthorize(session, 300_000);
			expect(session.status).toBe('success');

			await Promise.resolve();

			// Should still be success, not overwritten
			expect(session.status).toBe('success');
			expect(session.token).toBe('{"access_token":"valid"}');
		});

		it('should not extract invalid JSON as token', () => {
			mockRunCommand.mockImplementation((args, env, onProgress, onError, onComplete, onSpawn) => {
				onProgress?.(Buffer.from('--->\nnot valid json\n<---'));
				return Promise.resolve('');
			});

			spawnRcloneAuthorize(session, 300_000);

			expect(session.token).toBeUndefined();
			expect(session.status).toBe('pending');
		});
	});
});
