import { ChildProcess } from 'child_process';
import { runCommand } from '../../src/utils/runCommand';

// Mock the child_process module
jest.mock('child_process');
import * as childProcess from 'child_process';

describe('runCommand', () => {
	let mockChildProcess: Partial<ChildProcess>;
	let mockStdout: any;
	let mockStderr: any;
	let mockStdin: any;

	beforeEach(() => {
		// Reset mocks
		jest.clearAllMocks();

		// Create mock event emitters for stdout, stderr, and stdin
		mockStdout = {
			on: jest.fn(),
		};

		mockStderr = {
			on: jest.fn(),
		};

		mockStdin = {
			write: jest.fn(),
			end: jest.fn(),
		};

		// Create a mock child process
		mockChildProcess = {
			stdout: mockStdout as any,
			stderr: mockStderr as any,
			stdin: mockStdin as any,
			on: jest.fn(),
		};

		// Mock spawn to return our mock child process
		(childProcess.spawn as jest.Mock).mockReturnValue(mockChildProcess);
	});

	it('should successfully execute a command and resolve with output', async () => {
		// Arrange
		const args = ['echo', 'hello'];
		const expectedOutput = 'hello\n';

		// Simulate stdout data and process close
		mockStdout.on.mockImplementation((event: string, callback: Function) => {
			if (event === 'data') {
				callback(Buffer.from(expectedOutput));
			}
		});

		(mockChildProcess.on as jest.Mock).mockImplementation((event: string, callback: Function) => {
			if (event === 'close') {
				callback(0); // Exit code 0
			}
		});

		// Act
		const result = await runCommand(args);

		// Assert
		expect(childProcess.spawn).toHaveBeenCalledWith('echo', ['hello'], {
			env: expect.objectContaining(process.env),
		});
		expect(result).toBe(expectedOutput);
	});

	it('should reject with an error when command fails with non-zero exit code', async () => {
		// Arrange
		const args = ['false'];
		const exitCode = 1;

		(mockChildProcess.on as jest.Mock).mockImplementation((event: string, callback: Function) => {
			if (event === 'close') {
				callback(exitCode);
			}
		});

		// Act & Assert
		await expect(runCommand(args)).rejects.toThrow(`Command failed with code ${exitCode}`);
	});

	it('should accumulate output from multiple stdout data events', async () => {
		// Arrange
		const args = ['cat', 'file.txt'];
		const chunk1 = 'first chunk\n';
		const chunk2 = 'second chunk\n';

		mockStdout.on.mockImplementation((event: string, callback: Function) => {
			if (event === 'data') {
				callback(Buffer.from(chunk1));
				callback(Buffer.from(chunk2));
			}
		});

		(mockChildProcess.on as jest.Mock).mockImplementation((event: string, callback: Function) => {
			if (event === 'close') {
				callback(0);
			}
		});

		// Act
		const result = await runCommand(args);

		// Assert
		expect(result).toBe(chunk1 + chunk2);
	});

	it('should call onProgress callback for each stdout data event', async () => {
		// Arrange
		const args = ['ls'];
		const onProgress = jest.fn();
		const dataBuffer = Buffer.from('output');

		mockStdout.on.mockImplementation((event: string, callback: Function) => {
			if (event === 'data') {
				callback(dataBuffer);
			}
		});

		(mockChildProcess.on as jest.Mock).mockImplementation((event: string, callback: Function) => {
			if (event === 'close') {
				callback(0);
			}
		});

		// Act
		await runCommand(args, {}, onProgress);

		// Assert
		expect(onProgress).toHaveBeenCalledWith(dataBuffer);
	});

	it('should call onError callback for stderr data events', async () => {
		// Arrange
		const args = ['ls', '/nonexistent'];
		const onError = jest.fn();
		const errorBuffer = Buffer.from('error message');

		mockStderr.on.mockImplementation((event: string, callback: Function) => {
			if (event === 'data') {
				callback(errorBuffer);
			}
		});

		(mockChildProcess.on as jest.Mock).mockImplementation((event: string, callback: Function) => {
			if (event === 'close') {
				callback(0);
			}
		});

		// Act
		await runCommand(args, {}, undefined, onError);

		// Assert
		expect(onError).toHaveBeenCalledWith(errorBuffer);
	});

	it('should call onComplete callback with exit code when process closes', async () => {
		// Arrange
		const args = ['pwd'];
		const onComplete = jest.fn();
		const exitCode = 0;

		(mockChildProcess.on as jest.Mock).mockImplementation((event: string, callback: Function) => {
			if (event === 'close') {
				callback(exitCode);
			}
		});

		// Act
		await runCommand(args, {}, undefined, undefined, onComplete);

		// Assert
		expect(onComplete).toHaveBeenCalledWith(exitCode);
	});

	it('should not call onComplete when exit code is null', async () => {
		// Arrange
		const args = ['pwd'];
		const onComplete = jest.fn();

		(mockChildProcess.on as jest.Mock).mockImplementation((event: string, callback: Function) => {
			if (event === 'close') {
				callback(null);
			}
		});

		// Act
		await runCommand(args, {}, undefined, undefined, onComplete);

		// Assert
		expect(onComplete).not.toHaveBeenCalled();
	});

	it('should call onSpawn callback with the child process', async () => {
		// Arrange
		const args = ['echo', 'test'];
		const onSpawn = jest.fn();

		(mockChildProcess.on as jest.Mock).mockImplementation((event: string, callback: Function) => {
			if (event === 'close') {
				callback(0);
			}
		});

		// Act
		await runCommand(args, {}, undefined, undefined, undefined, onSpawn);

		// Assert
		expect(onSpawn).toHaveBeenCalledWith(mockChildProcess);
	});

	it('should write stdin data to the child process', async () => {
		// Arrange
		const args = ['grep', 'pattern'];
		const stdinData = 'input data';

		(mockChildProcess.on as jest.Mock).mockImplementation((event: string, callback: Function) => {
			if (event === 'close') {
				callback(0);
			}
		});

		// Act
		await runCommand(args, {}, undefined, undefined, undefined, undefined, stdinData);

		// Assert
		expect(mockStdin.write).toHaveBeenCalledWith(stdinData);
		expect(mockStdin.end).toHaveBeenCalled();
	});

	it('should not write to stdin if stdin is not provided', async () => {
		// Arrange
		const args = ['echo', 'test'];

		(mockChildProcess.on as jest.Mock).mockImplementation((event: string, callback: Function) => {
			if (event === 'close') {
				callback(0);
			}
		});

		// Act
		await runCommand(args);

		// Assert
		expect(mockStdin.write).not.toHaveBeenCalled();
		expect(mockStdin.end).not.toHaveBeenCalled();
	});

	it('should not write to stdin if childProcess.stdin is null', async () => {
		// Arrange
		const args = ['echo', 'test'];
		const stdinData = 'input data';
		mockChildProcess.stdin = null as any;

		(mockChildProcess.on as jest.Mock).mockImplementation((event: string, callback: Function) => {
			if (event === 'close') {
				callback(0);
			}
		});

		// Act
		await runCommand(args, {}, undefined, undefined, undefined, undefined, stdinData);

		// Assert
		expect(mockStdin.write).not.toHaveBeenCalled();
	});

	it('should merge custom environment variables with process.env', async () => {
		// Arrange
		const args = ['printenv'];
		const customEnv = { CUSTOM_VAR: 'custom_value', PATH: '/custom/path' };

		(mockChildProcess.on as jest.Mock).mockImplementation((event: string, callback: Function) => {
			if (event === 'close') {
				callback(0);
			}
		});

		// Act
		await runCommand(args, customEnv);

		// Assert
		expect(childProcess.spawn).toHaveBeenCalledWith('printenv', [], {
			env: { ...process.env, ...customEnv },
		});
	});

	it('should handle empty environment object', async () => {
		// Arrange
		const args = ['ls'];

		(mockChildProcess.on as jest.Mock).mockImplementation((event: string, callback: Function) => {
			if (event === 'close') {
				callback(0);
			}
		});

		// Act
		await runCommand(args, {});

		// Assert
		expect(childProcess.spawn).toHaveBeenCalledWith('ls', [], {
			env: process.env,
		});
	});

	it('should handle commands with multiple arguments', async () => {
		// Arrange
		const args = ['git', 'commit', '-m', 'test message'];

		(mockChildProcess.on as jest.Mock).mockImplementation((event: string, callback: Function) => {
			if (event === 'close') {
				callback(0);
			}
		});

		// Act
		await runCommand(args);

		// Assert
		expect(childProcess.spawn).toHaveBeenCalledWith('git', ['commit', '-m', 'test message'], {
			env: process.env,
		});
	});

	it('should call all callbacks in the correct order', async () => {
		// Arrange
		const args = ['test'];
		const onSpawn = jest.fn();
		const onProgress = jest.fn();
		const onError = jest.fn();
		const onComplete = jest.fn();
		const callOrder: string[] = [];

		onSpawn.mockImplementation(() => callOrder.push('spawn'));
		onProgress.mockImplementation(() => callOrder.push('progress'));
		onError.mockImplementation(() => callOrder.push('error'));
		onComplete.mockImplementation(() => callOrder.push('complete'));

		mockStdout.on.mockImplementation((event: string, callback: Function) => {
			if (event === 'data') {
				callback(Buffer.from('output'));
			}
		});

		mockStderr.on.mockImplementation((event: string, callback: Function) => {
			if (event === 'data') {
				callback(Buffer.from('error'));
			}
		});

		(mockChildProcess.on as jest.Mock).mockImplementation((event: string, callback: Function) => {
			if (event === 'close') {
				callback(0);
			}
		});

		// Act
		await runCommand(args, {}, onProgress, onError, onComplete, onSpawn);

		// Assert
		expect(callOrder).toEqual(['spawn', 'progress', 'error', 'complete']);
	});
});
