import { spawn } from 'child_process';
import { access, constants } from 'fs/promises';
import copyFiles from '../../src/utils/copyFiles';
import { EventEmitter } from 'events';

// Mock modules
jest.mock('child_process');
jest.mock('fs/promises');

const mockSpawn = spawn as jest.MockedFunction<typeof spawn>;
const mockAccess = access as jest.MockedFunction<typeof access>;

// Helper to create a mock ChildProcess
class MockChildProcess extends EventEmitter {
	stdout = new EventEmitter();
	stderr = new EventEmitter();
	stdin = new EventEmitter();
}

describe('copyFiles', () => {
	const originalPlatform = process.platform;

	beforeEach(() => {
		jest.clearAllMocks();
	});

	afterEach(() => {
		Object.defineProperty(process, 'platform', {
			value: originalPlatform,
			writable: true,
		});
	});

	describe('Windows (Robocopy)', () => {
		beforeEach(() => {
			Object.defineProperty(process, 'platform', {
				value: 'win32',
				writable: true,
			});
		});

		describe('successful operations', () => {
			it('should copy files with default "always" policy', async () => {
				const mockProcess = new MockChildProcess();
				mockSpawn.mockReturnValue(mockProcess as any);

				const copyPromise = copyFiles('C:\\source', 'C:\\dest');

				// Simulate successful robocopy (exit code 1 = files copied successfully)
				setTimeout(() => mockProcess.emit('close', 1), 10);

				await expect(copyPromise).resolves.toBeUndefined();
				expect(mockSpawn).toHaveBeenCalledWith(
					'powershell.exe',
					expect.arrayContaining(['-NoProfile', '-NoLogo', '-Command']),
					expect.objectContaining({ stdio: ['ignore', 'pipe', 'pipe'] })
				);
			});

			it('should handle exit code 0 (no files copied, all in sync)', async () => {
				const mockProcess = new MockChildProcess();
				mockSpawn.mockReturnValue(mockProcess as any);

				const copyPromise = copyFiles('C:\\source', 'C:\\dest');

				setTimeout(() => mockProcess.emit('close', 0), 10);

				await expect(copyPromise).resolves.toBeUndefined();
			});

			it('should handle exit codes 0-7 as success', async () => {
				const successCodes = [0, 1, 2, 3, 4, 5, 6, 7];

				for (const code of successCodes) {
					const mockProcess = new MockChildProcess();
					mockSpawn.mockReturnValue(mockProcess as any);

					const copyPromise = copyFiles('C:\\source', 'C:\\dest');
					setTimeout(() => mockProcess.emit('close', code), 10);

					await expect(copyPromise).resolves.toBeUndefined();
				}
			});
		});

		describe('overwrite policies', () => {
			it('should use correct arguments for "always" policy', async () => {
				const mockProcess = new MockChildProcess();
				mockSpawn.mockReturnValue(mockProcess as any);

				const copyPromise = copyFiles('C:\\source', 'C:\\dest', 'always');

				setTimeout(() => mockProcess.emit('close', 1), 10);
				await copyPromise;

				const callArgs = mockSpawn.mock.calls[0];
				const psCommand = callArgs[1][3]; // The -Command argument
				expect(psCommand).toContain('/COPY:DAT');
				expect(psCommand).toContain('/W:1');
				expect(psCommand).toContain('/R:1');
			});

			it('should use correct arguments for "if-changed" policy', async () => {
				const mockProcess = new MockChildProcess();
				mockSpawn.mockReturnValue(mockProcess as any);

				const copyPromise = copyFiles('C:\\source', 'C:\\dest', 'if-changed');

				setTimeout(() => mockProcess.emit('close', 1), 10);
				await copyPromise;

				const callArgs = mockSpawn.mock.calls[0];
				const psCommand = callArgs[1][3];
				expect(psCommand).toContain('/XO');
				expect(psCommand).toContain('/XC');
			});

			it('should use correct arguments for "if-newer" policy', async () => {
				const mockProcess = new MockChildProcess();
				mockSpawn.mockReturnValue(mockProcess as any);

				const copyPromise = copyFiles('C:\\source', 'C:\\dest', 'if-newer');

				setTimeout(() => mockProcess.emit('close', 1), 10);
				await copyPromise;

				const callArgs = mockSpawn.mock.calls[0];
				const psCommand = callArgs[1][3];
				expect(psCommand).toContain('/XO');
			});

			it('should use correct arguments for "never" policy', async () => {
				const mockProcess = new MockChildProcess();
				mockSpawn.mockReturnValue(mockProcess as any);

				const copyPromise = copyFiles('C:\\source', 'C:\\dest', 'never');

				setTimeout(() => mockProcess.emit('close', 1), 10);
				await copyPromise;

				const callArgs = mockSpawn.mock.calls[0];
				const psCommand = callArgs[1][3];
				expect(psCommand).toContain('/XC');
				expect(psCommand).toContain('/XN');
				expect(psCommand).toContain('/XO');
			});
		});

		describe('error handling', () => {
			it('should reject on robocopy error (exit code >= 8)', async () => {
				const mockProcess = new MockChildProcess();
				mockSpawn.mockReturnValue(mockProcess as any);

				const copyPromise = copyFiles('C:\\source', 'C:\\dest');

				setTimeout(() => mockProcess.emit('close', 8), 10);

				await expect(copyPromise).rejects.toThrow('Robocopy process exited with code 8');
			});

			it('should reject on robocopy fatal error (exit code 16)', async () => {
				const mockProcess = new MockChildProcess();
				mockSpawn.mockReturnValue(mockProcess as any);

				const copyPromise = copyFiles('C:\\source', 'C:\\dest');

				setTimeout(() => {
					mockProcess.stderr.emit('data', Buffer.from('Fatal error occurred'));
					mockProcess.emit('close', 16);
				}, 10);

				await expect(copyPromise).rejects.toThrow('Robocopy process exited with code 16');
			});

			it('should handle PowerShell script execution failure (code 2000)', async () => {
				const mockProcess = new MockChildProcess();
				mockSpawn.mockReturnValue(mockProcess as any);

				const copyPromise = copyFiles('C:\\source', 'C:\\dest');

				setTimeout(() => {
					mockProcess.stderr.emit('data', Buffer.from('PowerShell error'));
					mockProcess.emit('close', 2000);
				}, 10);

				await expect(copyPromise).rejects.toThrow('PowerShell script execution failed');
			});

			it('should handle UAC denial (code 2001)', async () => {
				const mockProcess = new MockChildProcess();
				mockSpawn.mockReturnValue(mockProcess as any);

				const copyPromise = copyFiles('C:\\source', 'C:\\dest');

				setTimeout(() => {
					mockProcess.stderr.emit('data', Buffer.from('UAC denied'));
					mockProcess.emit('close', 2001);
				}, 10);

				await expect(copyPromise).rejects.toThrow('Failed to get Robocopy process object');
				await expect(copyPromise).rejects.toThrow('UAC might have been denied');
			});

			it('should reject when PowerShell process fails to start', async () => {
				const mockProcess = new MockChildProcess();
				mockSpawn.mockReturnValue(mockProcess as any);

				const copyPromise = copyFiles('C:\\source', 'C:\\dest');

				setTimeout(() => {
					mockProcess.emit('error', new Error('ENOENT: command not found'));
				}, 10);

				await expect(copyPromise).rejects.toThrow('Failed to start PowerShell process');
			});

			it('should include stderr in error message', async () => {
				const mockProcess = new MockChildProcess();
				mockSpawn.mockReturnValue(mockProcess as any);

				const copyPromise = copyFiles('C:\\source', 'C:\\dest');

				setTimeout(() => {
					mockProcess.stderr.emit('data', Buffer.from('Permission denied'));
					mockProcess.emit('close', 8);
				}, 10);

				await expect(copyPromise).rejects.toThrow('Permission denied');
			});
		});

		describe('path handling', () => {
			it('should handle paths with spaces', async () => {
				const mockProcess = new MockChildProcess();
				mockSpawn.mockReturnValue(mockProcess as any);

				const copyPromise = copyFiles('C:\\My Source', 'C:\\My Destination');

				setTimeout(() => mockProcess.emit('close', 1), 10);
				await copyPromise;

				const callArgs = mockSpawn.mock.calls[0];
				const psCommand = callArgs[1][3];
				expect(psCommand).toContain('My Source');
				expect(psCommand).toContain('My Destination');
			});

			it('should handle paths with quotes', async () => {
				const mockProcess = new MockChildProcess();
				mockSpawn.mockReturnValue(mockProcess as any);

				const copyPromise = copyFiles('C:\\source"test', 'C:\\dest');

				setTimeout(() => mockProcess.emit('close', 1), 10);
				await copyPromise;

				expect(mockSpawn).toHaveBeenCalled();
			});
		});
	});

	describe('Unix (rsync)', () => {
		beforeEach(() => {
			Object.defineProperty(process, 'platform', {
				value: 'linux',
				writable: true,
			});
			mockAccess.mockResolvedValue(undefined);
		});

		describe('successful operations', () => {
			it('should copy files with rsync successfully', async () => {
				const mockProcess = new MockChildProcess();
				mockSpawn.mockReturnValue(mockProcess as any);

				const copyPromise = copyFiles('/source', '/dest');

				setTimeout(() => mockProcess.emit('close', 0), 10);

				await expect(copyPromise).resolves.toBeUndefined();
				expect(mockSpawn).toHaveBeenCalledWith(
					'rsync',
					expect.arrayContaining(['-a', '--progress']),
					expect.objectContaining({ stdio: 'inherit' })
				);
			});

			it('should verify source path exists before copying', async () => {
				const mockProcess = new MockChildProcess();
				mockSpawn.mockReturnValue(mockProcess as any);

				const copyPromise = copyFiles('/source', '/dest');

				setTimeout(() => mockProcess.emit('close', 0), 10);
				await copyPromise;

				expect(mockAccess).toHaveBeenCalledWith('/dest', constants.F_OK);
			});

			it('should normalize source path with trailing slash', async () => {
				const mockProcess = new MockChildProcess();
				mockSpawn.mockReturnValue(mockProcess as any);

				const copyPromise = copyFiles('/source', '/dest');

				setTimeout(() => mockProcess.emit('close', 0), 10);
				await copyPromise;

				const rsyncArgs = mockSpawn.mock.calls[0][1];
				expect(rsyncArgs).toContain('/dest/');
			});
		});

		describe('overwrite policies', () => {
			it('should use default arguments for "always" policy', async () => {
				const mockProcess = new MockChildProcess();
				mockSpawn.mockReturnValue(mockProcess as any);

				const copyPromise = copyFiles('/source', '/dest', 'always');

				setTimeout(() => mockProcess.emit('close', 0), 10);
				await copyPromise;

				const rsyncArgs = mockSpawn.mock.calls[0][1];
				expect(rsyncArgs).toContain('-a');
				expect(rsyncArgs).toContain('--progress');
				expect(rsyncArgs).not.toContain('--checksum');
				expect(rsyncArgs).not.toContain('--update');
				expect(rsyncArgs).not.toContain('--ignore-existing');
			});

			it('should use --checksum for "if-changed" policy', async () => {
				const mockProcess = new MockChildProcess();
				mockSpawn.mockReturnValue(mockProcess as any);

				const copyPromise = copyFiles('/source', '/dest', 'if-changed');

				setTimeout(() => mockProcess.emit('close', 0), 10);
				await copyPromise;

				const rsyncArgs = mockSpawn.mock.calls[0][1];
				expect(rsyncArgs).toContain('--checksum');
			});

			it('should use --update for "if-newer" policy', async () => {
				const mockProcess = new MockChildProcess();
				mockSpawn.mockReturnValue(mockProcess as any);

				const copyPromise = copyFiles('/source', '/dest', 'if-newer');

				setTimeout(() => mockProcess.emit('close', 0), 10);
				await copyPromise;

				const rsyncArgs = mockSpawn.mock.calls[0][1];
				expect(rsyncArgs).toContain('--update');
			});

			it('should use --ignore-existing for "never" policy', async () => {
				const mockProcess = new MockChildProcess();
				mockSpawn.mockReturnValue(mockProcess as any);

				const copyPromise = copyFiles('/source', '/dest', 'never');

				setTimeout(() => mockProcess.emit('close', 0), 10);
				await copyPromise;

				const rsyncArgs = mockSpawn.mock.calls[0][1];
				expect(rsyncArgs).toContain('--ignore-existing');
			});
		});

		describe('error handling', () => {
			it('should reject when source path does not exist', async () => {
				mockAccess.mockRejectedValue(new Error('ENOENT'));

				await expect(copyFiles('/source', '/dest')).rejects.toThrow(
					'Restore path does not exist: /dest'
				);
			});

			it('should reject on rsync failure', async () => {
				const mockProcess = new MockChildProcess();
				mockSpawn.mockReturnValue(mockProcess as any);

				const copyPromise = copyFiles('/source', '/dest');

				setTimeout(() => mockProcess.emit('close', 1), 10);

				await expect(copyPromise).rejects.toThrow('rsync failed with code 1');
			});

			it('should fall back to cp when rsync is not found', async () => {
				const mockRsyncProcess = new MockChildProcess();
				const mockCpProcess = new MockChildProcess();

				let spawnCallCount = 0;
				mockSpawn.mockImplementation((command: string) => {
					spawnCallCount++;
					if (spawnCallCount === 1 && command === 'rsync') {
						setTimeout(() => {
							mockRsyncProcess.emit('error', new Error('rsync: command not found ENOENT'));
						}, 10);
						return mockRsyncProcess as any;
					}
					if (spawnCallCount === 2 && command === 'cp') {
						setTimeout(() => mockCpProcess.emit('close', 0), 10);
						return mockCpProcess as any;
					}
					return mockRsyncProcess as any;
				});

				await expect(copyFiles('/source', '/dest')).resolves.toBeUndefined();
				expect(spawnCallCount).toBe(2);
			});
		});
	});

	describe('Unix fallback (cp)', () => {
		beforeEach(() => {
			Object.defineProperty(process, 'platform', {
				value: 'linux',
				writable: true,
			});
			mockAccess.mockResolvedValue(undefined);
		});

		it('should use cp with correct arguments for "always" policy', async () => {
			const mockRsyncProcess = new MockChildProcess();
			const mockCpProcess = new MockChildProcess();

			mockSpawn
				.mockReturnValueOnce(mockRsyncProcess as any)
				.mockReturnValueOnce(mockCpProcess as any);

			const copyPromise = copyFiles('/source', '/dest', 'always');

			setTimeout(() => {
				mockRsyncProcess.emit('error', new Error('ENOENT'));
			}, 10);

			setTimeout(() => mockCpProcess.emit('close', 0), 20);

			await copyPromise;

			expect(mockSpawn).toHaveBeenCalledWith(
				'cp',
				expect.arrayContaining(['-R', '-f']),
				expect.any(Object)
			);
		});

		it('should use -u flag for "if-newer" and "if-changed" policies', async () => {
			const mockRsyncProcess = new MockChildProcess();
			const mockCpProcess = new MockChildProcess();

			mockSpawn
				.mockReturnValueOnce(mockRsyncProcess as any)
				.mockReturnValueOnce(mockCpProcess as any);

			const copyPromise = copyFiles('/source', '/dest', 'if-newer');

			setTimeout(() => mockRsyncProcess.emit('error', new Error('ENOENT')), 10);
			setTimeout(() => mockCpProcess.emit('close', 0), 20);

			await copyPromise;

			const cpArgs = mockSpawn.mock.calls[1][1];
			expect(cpArgs).toContain('-u');
		});

		it('should use -n flag for "never" policy', async () => {
			const mockRsyncProcess = new MockChildProcess();
			const mockCpProcess = new MockChildProcess();

			mockSpawn
				.mockReturnValueOnce(mockRsyncProcess as any)
				.mockReturnValueOnce(mockCpProcess as any);

			const copyPromise = copyFiles('/source', '/dest', 'never');

			setTimeout(() => mockRsyncProcess.emit('error', new Error('ENOENT')), 10);
			setTimeout(() => mockCpProcess.emit('close', 0), 20);

			await copyPromise;

			const cpArgs = mockSpawn.mock.calls[1][1];
			expect(cpArgs).toContain('-n');
		});

		it('should reject when cp fails', async () => {
			const mockRsyncProcess = new MockChildProcess();
			const mockCpProcess = new MockChildProcess();

			mockSpawn
				.mockReturnValueOnce(mockRsyncProcess as any)
				.mockReturnValueOnce(mockCpProcess as any);

			const copyPromise = copyFiles('/source', '/dest');

			setTimeout(() => mockRsyncProcess.emit('error', new Error('ENOENT')), 10);
			setTimeout(() => mockCpProcess.emit('close', 1), 20);

			await expect(copyPromise).rejects.toThrow('cp failed with code 1');
		});

		it('should reject when cp fails to start', async () => {
			const mockRsyncProcess = new MockChildProcess();
			const mockCpProcess = new MockChildProcess();

			mockSpawn
				.mockReturnValueOnce(mockRsyncProcess as any)
				.mockReturnValueOnce(mockCpProcess as any);

			const copyPromise = copyFiles('/source', '/dest');

			setTimeout(() => mockRsyncProcess.emit('error', new Error('ENOENT')), 10);
			setTimeout(() => mockCpProcess.emit('error', new Error('cp not found')), 20);

			await expect(copyPromise).rejects.toThrow('Failed to start cp');
		});
	});

	describe('macOS platform', () => {
		it('should use Unix implementation for macOS', async () => {
			Object.defineProperty(process, 'platform', {
				value: 'darwin',
				writable: true,
			});

			mockAccess.mockResolvedValue(undefined);
			const mockProcess = new MockChildProcess();
			mockSpawn.mockReturnValue(mockProcess as any);

			const copyPromise = copyFiles('/source', '/dest');

			setTimeout(() => mockProcess.emit('close', 0), 10);

			await copyPromise;

			expect(mockSpawn).toHaveBeenCalledWith('rsync', expect.any(Array), expect.any(Object));
		});
	});
});
