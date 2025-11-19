import path from 'path';
import os from 'os';
import { appPaths } from '../../../src/utils/AppPaths';
import { encryptRcloneConfig, getRcloneConfigPath } from '../../../src/utils/rclone/helpers';
import { runRcloneCommand } from '../../../src/utils/rclone/rclone';

jest.mock('os');

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
});
