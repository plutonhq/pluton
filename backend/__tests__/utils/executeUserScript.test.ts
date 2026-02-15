import { EventEmitter } from 'events';
import { PlanScript } from '../../src/types/plans';

// --- Mocks ---

const mockStdout = new EventEmitter();
const mockStderr = new EventEmitter();
const mockChild = Object.assign(new EventEmitter(), {
	stdout: mockStdout,
	stderr: mockStderr,
});

const mockSpawn = jest.fn().mockReturnValue(mockChild);

jest.mock('child_process', () => ({
	spawn: (...args: any[]) => mockSpawn(...args),
}));

const mockDecrypt = jest.fn((val: string) => val);
jest.mock('cryptr', () => {
	return jest.fn().mockImplementation(() => ({
		decrypt: mockDecrypt,
	}));
});

import { executeUserScript, runScriptsForEvent } from '../../src/utils/executeUserScript';

// --- Helpers ---

function buildScript(overrides: Partial<PlanScript> = {}): PlanScript {
	return {
		id: 'script-1',
		type: 'command',
		enabled: true,
		command: 'echo hello',
		logOutput: false,
		...overrides,
	};
}

function freshChild() {
	const stdout = new EventEmitter();
	const stderr = new EventEmitter();
	const child = Object.assign(new EventEmitter(), { stdout, stderr });
	mockSpawn.mockReturnValue(child);
	return child;
}

// --- Tests ---

describe('executeUserScript', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	// Shell selection tests
	describe('shell selection', () => {
		const shellCases: { shell: string | undefined; expectedExe: string; expectedArgs: string[] }[] =
			[
				{ shell: 'bash', expectedExe: 'bash', expectedArgs: ['-c', 'echo hello'] },
				{ shell: '/bin/bash', expectedExe: '/bin/bash', expectedArgs: ['-c', 'echo hello'] },
				{ shell: 'zsh', expectedExe: 'zsh', expectedArgs: ['-c', 'echo hello'] },
				{ shell: '/bin/sh', expectedExe: '/bin/sh', expectedArgs: ['-c', 'echo hello'] },
				{
					shell: 'powershell',
					expectedExe: 'powershell.exe',
					expectedArgs: ['-NoProfile', '-NonInteractive', '-Command', 'echo hello'],
				},
				{ shell: 'cmd', expectedExe: 'cmd.exe', expectedArgs: ['/c', 'echo hello'] },
			];

		it.each(shellCases)(
			'spawns $expectedExe when shell is "$shell"',
			async ({ shell, expectedExe, expectedArgs }) => {
				const child = freshChild();
				const script = buildScript({ shell });
				const promise = executeUserScript(script);

				child.emit('close', 0, null);
				await promise;

				expect(mockSpawn).toHaveBeenCalledWith(expectedExe, expectedArgs, expect.any(Object));
			}
		);

		it('defaults to /bin/sh when shell is not specified', async () => {
			const child = freshChild();
			const script = buildScript({ shell: undefined });
			const promise = executeUserScript(script);

			child.emit('close', 0, null);
			await promise;

			expect(mockSpawn).toHaveBeenCalledWith('/bin/sh', ['-c', 'echo hello'], expect.any(Object));
		});
	});

	// Success case
	it('resolves with stdout and stderr on exit code 0', async () => {
		const child = freshChild();
		const script = buildScript();
		const promise = executeUserScript(script);

		child.stdout.emit('data', Buffer.from('out'));
		child.stderr.emit('data', Buffer.from('err'));
		child.emit('close', 0, null);

		const result = await promise;
		expect(result).toEqual({ stdout: 'out', stderr: 'err' });
	});

	// Failure cases
	it('rejects on non-zero exit code', async () => {
		const child = freshChild();
		const script = buildScript();
		const promise = executeUserScript(script);

		child.stderr.emit('data', Buffer.from('bad'));
		child.emit('close', 1, null);

		await expect(promise).rejects.toThrow('bad');
	});

	it('rejects with generic message when stderr and stdout are empty and exit code is non-zero', async () => {
		const child = freshChild();
		const script = buildScript();
		const promise = executeUserScript(script);

		child.emit('close', 2, null);

		await expect(promise).rejects.toThrow('Script exited with code 2');
	});

	it('rejects on SIGTERM (timeout)', async () => {
		const child = freshChild();
		const script = buildScript({ timeout: 5000 });
		const promise = executeUserScript(script);

		child.emit('close', null, 'SIGTERM');

		await expect(promise).rejects.toThrow('Script timed out after 5000ms');
	});

	it('uses default timeout message when timeout is not set', async () => {
		const child = freshChild();
		const script = buildScript();
		const promise = executeUserScript(script);

		child.emit('close', null, 'SIGTERM');

		await expect(promise).rejects.toThrow('Script timed out after 60000ms');
	});

	it('rejects on spawn error', async () => {
		const child = freshChild();
		const script = buildScript();
		const promise = executeUserScript(script);

		child.emit('error', new Error('ENOENT'));

		await expect(promise).rejects.toThrow('Failed to start script process: ENOENT');
	});

	it('passes the timeout option to spawn', async () => {
		const child = freshChild();
		const script = buildScript({ timeout: 3000 });
		const promise = executeUserScript(script);

		child.emit('close', 0, null);
		await promise;

		expect(mockSpawn).toHaveBeenCalledWith(
			expect.any(String),
			expect.any(Array),
			expect.objectContaining({ timeout: 3000 })
		);
	});
});

describe('runScriptsForEvent', () => {
	let onStart: jest.Mock;
	let onComplete: jest.Mock;
	let onError: jest.Mock;

	beforeEach(() => {
		jest.clearAllMocks();
		onStart = jest.fn().mockResolvedValue(undefined);
		onComplete = jest.fn().mockResolvedValue(undefined);
		onError = jest.fn().mockResolvedValue(undefined);
	});

	it('returns early when no scripts are provided', async () => {
		await runScriptsForEvent(
			'onBackupStart',
			[] as PlanScript[],
			'secret',
			onStart,
			onComplete,
			onError
		);

		expect(onStart).not.toHaveBeenCalled();
		expect(onComplete).not.toHaveBeenCalled();
		expect(mockSpawn).not.toHaveBeenCalled();
	});

	it('returns early when eventName is empty', async () => {
		await runScriptsForEvent('', [buildScript()], 'secret', onStart, onComplete, onError);

		expect(onStart).not.toHaveBeenCalled();
		expect(mockSpawn).not.toHaveBeenCalled();
	});

	it('skips disabled scripts', async () => {
		const child = freshChild();
		const scripts = [buildScript({ enabled: false })];

		await runScriptsForEvent('onBackupStart', scripts, 'secret', onStart, onComplete, onError);

		expect(onStart).not.toHaveBeenCalled();
		expect(mockSpawn).not.toHaveBeenCalled();
	});

	it('skips scripts with empty command', async () => {
		const scripts = [buildScript({ command: '   ' })];

		await runScriptsForEvent('onBackupStart', scripts, 'secret', onStart, onComplete, onError);

		expect(onStart).not.toHaveBeenCalled();
		expect(mockSpawn).not.toHaveBeenCalled();
	});

	it('calls onStart and onComplete callbacks on success', async () => {
		const child = freshChild();
		const scripts = [buildScript()];

		mockDecrypt.mockReturnValue('echo hello');

		const promise = runScriptsForEvent(
			'onBackupStart',
			scripts,
			'secret',
			onStart,
			onComplete,
			onError
		);

		// Simulate successful child process
		child.emit('close', 0, null);

		await promise;

		expect(onStart).toHaveBeenCalledWith('ONBACKUPSTART_SCRIPT_1');
		expect(onComplete).toHaveBeenCalledWith('ONBACKUPSTART_SCRIPT_1');
		expect(onError).not.toHaveBeenCalled();
	});

	it('calls onError callback on script failure', async () => {
		const child = freshChild();
		const scripts = [buildScript({ abortOnError: false })];

		mockDecrypt.mockReturnValue('echo hello');

		const promise = runScriptsForEvent(
			'onBackupStart',
			scripts,
			'secret',
			onStart,
			onComplete,
			onError
		);

		child.stderr.emit('data', Buffer.from('something went wrong'));
		child.emit('close', 1, null);

		await promise;

		expect(onStart).toHaveBeenCalledWith('ONBACKUPSTART_SCRIPT_1');
		expect(onError).toHaveBeenCalledWith(
			'ONBACKUPSTART_SCRIPT_1',
			expect.stringContaining('something went wrong')
		);
		expect(onComplete).not.toHaveBeenCalled();
	});

	it('throws when abortOnError is true and script fails', async () => {
		const child = freshChild();
		const scripts = [buildScript({ abortOnError: true })];

		mockDecrypt.mockReturnValue('echo hello');

		const promise = runScriptsForEvent(
			'onBackupStart',
			scripts,
			'secret',
			onStart,
			onComplete,
			onError
		);

		child.stderr.emit('data', Buffer.from('fatal'));
		child.emit('close', 1, null);

		await expect(promise).rejects.toThrow("Critical 'beforeBackup' hook failed");
		expect(onError).toHaveBeenCalled();
	});

	it('decrypts commands using Cryptr with the provided secret', async () => {
		const child = freshChild();
		const scripts = [buildScript({ command: 'encrypted-cmd' })];

		mockDecrypt.mockReturnValue('decrypted-cmd');

		const promise = runScriptsForEvent(
			'onBackupStart',
			scripts,
			'my-secret',
			onStart,
			onComplete,
			onError
		);

		child.emit('close', 0, null);

		await promise;

		expect(mockDecrypt).toHaveBeenCalledWith('encrypted-cmd');
		expect(mockSpawn).toHaveBeenCalledWith(
			expect.any(String),
			expect.arrayContaining(['decrypted-cmd']),
			expect.any(Object)
		);
	});

	it('processes multiple scripts in order', async () => {
		const children = [freshChild()];
		const scripts = [
			buildScript({ id: 's1', command: 'cmd1' }),
			buildScript({ id: 's2', command: 'cmd2' }),
		];

		mockDecrypt.mockImplementation((v: string) => v);

		// For the second script, we need a new child since the first will close
		const child2 = freshChild();

		// Reset to return children in order
		let callCount = 0;
		mockSpawn.mockImplementation(() => {
			callCount++;
			if (callCount === 1) return children[0];
			return child2;
		});

		const promise = runScriptsForEvent(
			'onBackupStart',
			scripts,
			'secret',
			onStart,
			onComplete,
			onError
		);

		// Complete first script
		children[0].emit('close', 0, null);

		// Wait a tick for the next iteration
		await new Promise(r => setTimeout(r, 0));

		// Complete second script
		child2.emit('close', 0, null);

		await promise;

		expect(onStart).toHaveBeenCalledTimes(2);
		expect(onComplete).toHaveBeenCalledTimes(2);
		expect(onStart).toHaveBeenNthCalledWith(1, 'ONBACKUPSTART_SCRIPT_1');
		expect(onStart).toHaveBeenNthCalledWith(2, 'ONBACKUPSTART_SCRIPT_2');
	});
});
