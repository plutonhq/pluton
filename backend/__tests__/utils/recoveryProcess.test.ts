import { EventEmitter } from 'events';
import { PassThrough, Readable } from 'stream';
import { spawn } from 'child_process';
import { runRecoveryProcess } from '../../src/utils/recoveryProcess';
import { killProcessTree } from '../../src/utils/processTree';
jest.mock('child_process', () => ({ spawn: jest.fn() }));
jest.mock('../../src/utils/processTree', () => ({ killProcessTree: jest.fn() }));
jest.mock('../../src/managers/ProcessManager', () => ({
	processManager: { trackProcess: jest.fn(), untrackProcess: jest.fn() },
}));
describe('Recovery native process bounds and sanitized errors', () => {
	let child: any;
	const input = () => ({
		binary: '/usr/bin/mariadb',
		args: ['--binary-mode'],
		env: { LANG: 'C' },
		cwd: '/tmp/example',
		signal: new AbortController().signal,
		stage: 'database-import' as const,
		timeoutMs: 5000,
		capture: true,
	});
	beforeEach(() => {
		child = Object.assign(new EventEmitter(), {
			stdin: new PassThrough(),
			stdout: new PassThrough(),
			stderr: new PassThrough(),
		});
		(spawn as jest.Mock).mockReturnValue(child);
	});
	afterEach(async () => {
		child.stdin.destroy();
		child.stdout.destroy();
		child.stderr.destroy();
		await new Promise(resolve => setImmediate(resolve));
		// Mock call/results must not retain this disposable process after its test.
		jest.clearAllMocks();
		child = undefined;
	});
	it('uses native argv/minimal environment, never shell execution', async () => {
		const running = runRecoveryProcess({ ...input(), input: 'SELECT 1;' });
		child.stdout.write('0\t0');
		child.emit('close', 0);
		expect(await running).toBe('0\t0');
		expect(spawn).toHaveBeenCalledWith(
			'/usr/bin/mariadb',
			['--binary-mode'],
			expect.objectContaining({ shell: false, env: { LANG: 'C' }, windowsHide: true })
		);
	});
	it('classifies a proven native allocation failure without guessing that every killed process was OOM', async () => {
		const running = runRecoveryProcess(input());
		child.emit(
			'error',
			Object.assign(new Error('private allocation diagnostic'), { code: 'ENOMEM' })
		);
		child.emit('close', -1);
		await expect(running).rejects.toMatchObject({ code: 'database-out-of-memory' });
		await running.catch(error => expect(error.message).not.toContain('private'));
	});
	it.each([
		['Access denied synthetic-password', 'database-authentication-failed'],
		['connection refused private-host', 'database-target-unavailable'],
		['certificate verification failed private-data', 'database-tls-failed'],
		['ERROR 2026 (HY000): TLS/SSL error: Failed to verify peer certificate', 'database-tls-failed'],
		['role "synthetic_role" does not exist', 'database-role-missing'],
		['corrupt SQL secret', 'database-import-failed'],
		[
			'ERROR 1021 (HY000): Disk is full; No space left on device; private canary',
			'database-storage-full',
		],
		['ERROR 1037 (HY001): Out of memory; private canary', 'database-out-of-memory'],
	])('classifies provider output without exposing it', async (stderr, code) => {
		const running = runRecoveryProcess(input());
		child.stderr.write(stderr);
		child.emit('close', 1);
		await expect(running).rejects.toMatchObject({ code });
		await running.catch(error => expect(error.message).not.toContain(stderr));
	});
	it('fails on bounded output and terminates the process tree', async () => {
		const running = runRecoveryProcess(input());
		child.stdout.write(Buffer.alloc(65537));
		child.emit('close', 0);
		await expect(running).rejects.toMatchObject({ code: 'database-output-limit' });
		expect(killProcessTree).toHaveBeenCalledWith(child, 'SIGKILL');
	});
	it('explicit timeout terminates the process tree', async () => {
		jest.useFakeTimers();
		try {
			const running = runRecoveryProcess({ ...input(), timeoutMs: 50 });
			jest.advanceTimersByTime(51);
			child.emit('close', null);
			await expect(running).rejects.toMatchObject({ code: 'database-import-timeout' });
			expect(killProcessTree).toHaveBeenCalled();
		} finally {
			jest.useRealTimers();
		}
	});
	it('cancellation is sanitized and kills all native descendants', async () => {
		const controller = new AbortController();
		const running = runRecoveryProcess({ ...input(), signal: controller.signal });
		controller.abort();
		child.emit('close', null);
		await expect(running).rejects.toMatchObject({ code: 'cancelled' });
		expect(killProcessTree).toHaveBeenCalledWith(child, 'SIGKILL');
	});
	it('a dump read failure cannot pass even when the client exits zero', async () => {
		const stream = new Readable({
			read() {
				this.destroy(new Error('synthetic-private-file-read-error'));
			},
		});
		const running = runRecoveryProcess({ ...input(), input: stream });
		await new Promise(resolve => setImmediate(resolve));
		child.emit('close', 0);
		await expect(running).rejects.toMatchObject({ code: 'database-import-failed' });
	});
	it('streams the entire SQL input before accepting a zero client exit', async () => {
		let received = '';
		child.stdin.on('data', chunk => {
			received += chunk.toString();
		});
		const complete = new Promise<void>(resolve => child.stdin.once('finish', resolve));
		const running = runRecoveryProcess({ ...input(), input: Readable.from(['SELECT ', '1;\n']) });
		await complete;
		child.emit('close', 0);
		await expect(running).resolves.toBe('');
		expect(received).toBe('SELECT 1;\n');
	});
	it('an early zero exit stops the source and cannot report a partially delivered dump as passed', async () => {
		const source = new Readable({ read() {} });
		const running = runRecoveryProcess({ ...input(), input: source });
		child.emit('close', 0);
		await expect(running).rejects.toMatchObject({ code: 'database-import-failed' });
		expect(source.destroyed).toBe(true);
	});
	it.each(['EPIPE', 'ERR_STREAM_PREMATURE_CLOSE'])(
		'a truncated input (%s) cannot pass on a zero client exit',
		async code => {
			const stream = new Readable({
				read() {
					this.destroy(Object.assign(new Error('synthetic-interrupted-input'), { code }));
				},
			});
			const running = runRecoveryProcess({ ...input(), input: stream });
			await new Promise(resolve => setImmediate(resolve));
			child.emit('close', 0);
			await expect(running).rejects.toMatchObject({ code: 'database-import-failed' });
		}
	);
	it('early client rejection retains the sanitized authentication category', async () => {
		const stream = new Readable({
			read() {
				this.destroy(Object.assign(new Error('synthetic-input-closed'), { code: 'EPIPE' }));
			},
		});
		const running = runRecoveryProcess({ ...input(), input: stream });
		await new Promise(resolve => setImmediate(resolve));
		child.stderr.write('Access denied synthetic-private-value');
		child.emit('close', 1);
		await expect(running).rejects.toMatchObject({ code: 'database-authentication-failed' });
	});
});
