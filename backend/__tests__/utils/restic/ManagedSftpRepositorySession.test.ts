import { EventEmitter } from 'events';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import { PassThrough, Writable } from 'stream';
import { killProcessTree } from '../../../src/utils/processTree';
import { processManager } from '../../../src/managers/ProcessManager';
import { getBinaryPath } from '../../../src/utils/binaryPathResolver';
import { ManagedSftpRepositorySession } from '../../../src/utils/restic/ManagedSftpRepositorySession';

jest.mock('child_process');
jest.mock('../../../src/utils/binaryPathResolver');
jest.mock('../../../src/utils/processTree', () => ({ killProcessTree: jest.fn() }));

const access = {
	options: {
		host: '192.0.2.10',
		user: 'fixture-user',
		pass: 'synthetic-sftp-password',
		port: '22',
	},
	repositoryPath: 'application',
	password: 'synthetic-repository-password',
};
const id = 'a'.repeat(64);
const snapshot = {
	id,
	tags: ['pluton-plan-plan-01', 'pluton-backup-backup-01'],
	paths: ['/srv/example-app'],
};
const node = {
	struct_type: 'node',
	path: '/srv/example-app/index.txt',
	name: 'index.txt',
	type: 'file',
	size: 7,
	mtime: '2026-01-01T00:00:00Z',
	mode: 420,
};

describe('ManagedSftpRepositorySession credential/operation boundary', () => {
	let responses: Array<{
		stdout?: string | Buffer;
		code?: number;
		error?: boolean;
		held?: boolean;
	}>;
	let children: any[];
	beforeEach(() => {
		jest.clearAllMocks();
		responses = [{ stdout: 'Obscured_synthetic-value\n', code: 0 }];
		children = [];
		(killProcessTree as jest.Mock).mockImplementation(child => {
			setImmediate(() => {
				child.stdout.end();
				child.emit('close', null);
			});
		});
		(getBinaryPath as jest.Mock).mockImplementation(name =>
			path.resolve('synthetic-tools', process.platform === 'win32' ? `${name}.exe` : name)
		);
		(spawn as jest.Mock).mockImplementation(() => {
			const response = responses.shift() || { stdout: '', code: 0 };
			const child = Object.assign(new EventEmitter(), {
				stdout: new PassThrough(),
				stderr: new EventEmitter(),
				stdin: Object.assign(new EventEmitter(), { end: jest.fn() }),
				kill: jest.fn(),
			});
			children.push(child);
			setImmediate(() => {
				child.stderr.emit(
					'data',
					Buffer.from(`${access.options.pass} ${access.password} raw provider config`)
				);
				if (response.error) child.emit('error', new Error(`${access.password} spawn failed`));
				if (response.stdout) child.stdout.write(response.stdout);
				if (!response.held) {
					child.stdout.end();
					child.emit('close', response.code ?? 0);
				}
			});
			return child;
		});
	});

	it('uses private config 0600/directory 0700, obscures plaintext on stdin and cleans after browse', async () => {
		responses.push(
			{ stdout: JSON.stringify([snapshot]) },
			{
				stdout: `${JSON.stringify({ struct_type: 'snapshot', ...snapshot })}\n${JSON.stringify(node)}\n`,
			}
		);
		let configPath = '';
		const provider = new ManagedSftpRepositorySession();
		const files = await provider.withSession(access, async session => {
			await expect(session.snapshot(id)).resolves.toEqual(snapshot);
			configPath = (spawn as jest.Mock).mock.calls[1][2].env.RCLONE_CONFIG;
			const content = await fs.readFile(configPath, 'utf8');
			expect(content).toContain('[pluton]\ntype = sftp\n');
			expect(content).toContain('pass = Obscured_synthetic-value');
			expect(content).not.toContain(access.options.pass);
			expect(content).not.toContain(access.password);
			if (process.platform !== 'win32') {
				expect((await fs.stat(configPath)).mode & 0o777).toBe(0o600);
				expect((await fs.stat(path.dirname(configPath))).mode & 0o777).toBe(0o700);
			}
			return session.files(id);
		});
		expect(files).toEqual([node]);
		expect(children[0].stdin.end).toHaveBeenCalledWith(`${access.options.pass}\n`);
		expect((spawn as jest.Mock).mock.calls[0][1]).toEqual(['obscure', '-']);
		for (const [binary, args, options] of (spawn as jest.Mock).mock.calls) {
			expect(path.isAbsolute(binary)).toBe(true);
			expect(options.shell).toBe(false);
			expect(args.join(' ')).not.toContain(access.password);
			expect(args.join(' ')).not.toContain(access.options.pass);
		}
		const args = (spawn as jest.Mock).mock.calls[1][1];
		expect(args).toEqual(
			expect.arrayContaining([
				'--no-lock',
				'--no-cache',
				'--json',
				'--repo',
				'rclone:pluton:application',
				'snapshots',
				id,
			])
		);
		const env = (spawn as jest.Mock).mock.calls[1][2].env;
		expect(env.RESTIC_PASSWORD).toBe(access.password);
		expect(env).not.toHaveProperty('ENCRYPTION_KEY');
		expect(env).not.toHaveProperty('SECRET');
		await expect(fs.stat(configPath)).rejects.toMatchObject({ code: 'ENOENT' });
		await expect(fs.stat(path.dirname(configPath))).rejects.toMatchObject({ code: 'ENOENT' });
	});

	it('exposes only fixed read/staging-write operations and never repo mutation/locks', async () => {
		responses.push({
			stdout: JSON.stringify({ message_type: 'summary', files_restored: 1, bytes_restored: 7 }),
		});
		await new ManagedSftpRepositorySession().withSession(access, async session => {
			expect(Object.keys(session).sort()).toEqual(['archive', 'files', 'restore', 'snapshot']);
			await expect(
				session.restore(id, ['/srv/example-app/index.txt'], path.resolve('synthetic-staging'))
			).resolves.toEqual({ files_restored: 1, bytes_restored: 7 });
		});
		const args = (spawn as jest.Mock).mock.calls[1][1];
		expect(args).toEqual(
			expect.arrayContaining([
				'restore',
				id,
				'--overwrite',
				'never',
				'--include',
				'/srv/example-app/index.txt',
			])
		);
		expect(args).not.toEqual(
			expect.arrayContaining(['init', 'backup', 'forget', 'prune', 'unlock', 'repair', '--delete'])
		);
	});
	function sink() {
		const chunks: Buffer[] = [];
		const destination = new Writable({
			write(chunk, _, done) {
				chunks.push(chunk);
				done();
			},
		});
		return { destination, chunks };
	}
	it('streams binary TAR of the exact snapshot using a fixed read-only dump, then removes credentials', async () => {
		const bytes = Buffer.from([0, 255, 128, 1, 0, 65]);
		responses.push({ stdout: bytes });
		const { destination, chunks } = sink();
		await new ManagedSftpRepositorySession().withSession(access, session =>
			session.archive(id, destination)
		);
		expect(Buffer.concat(chunks)).toEqual(bytes);
		expect(destination.writableEnded).toBe(false); // caller ends HTTP after exit/cleanup
		const [, args, options] = (spawn as jest.Mock).mock.calls[1];
		expect(args.slice(-5)).toEqual(['dump', '--archive', 'tar', id, '/']);
		expect(args).toEqual(
			expect.arrayContaining(['--no-lock', '--no-cache', 'rclone:pluton:application'])
		);
		for (const forbidden of [
			'--json',
			'latest',
			'init',
			'backup',
			'forget',
			'prune',
			'unlock',
			'restore',
		])
			expect(args).not.toContain(forbidden);
		expect(options.shell).toBe(false);
		expect(options.env.RESTIC_PASSWORD).toBe(access.password);
		expect(args.join(' ')).not.toMatch(/synthetic-.*password/);
		await expect(fs.stat(path.dirname(options.env.RCLONE_CONFIG))).rejects.toMatchObject({
			code: 'ENOENT',
		});
		destination.end();
	});
	it.each([
		[1, 'execution-failed'],
		[12, 'wrong-password'],
		[10, 'repository-unavailable'],
	])('sanitizes archive exit %s and cleans after process close', async (code, category) => {
		responses.push({ code: Number(code) });
		const { destination } = sink();
		await expect(
			new ManagedSftpRepositorySession().withSession(access, session =>
				session.archive(id, destination)
			)
		).rejects.toMatchObject({
			code: category,
			message: `Managed repository access failed (${category}).`,
		});
		const configPath = (spawn as jest.Mock).mock.calls[1][2].env.RCLONE_CONFIG;
		await expect(fs.stat(configPath)).rejects.toMatchObject({ code: 'ENOENT' });
		expect(killProcessTree).not.toHaveBeenCalled(); // never kill an already-reaped/reused PID
		destination.destroy();
	});
	it('honors backpressure without buffering a large archive or applying the JSON output cap', async () => {
		responses.push({ held: true });
		let release: (() => void) | undefined;
		let received = 0;
		const destination = new Writable({
			highWaterMark: 1024,
			write(chunk, _, done) {
				received += chunk.length;
				if (!release) release = done;
				else done();
			},
		});
		let completed = false;
		const transfer = new ManagedSftpRepositorySession()
			.withSession(access, session => session.archive(id, destination))
			.then(() => {
				completed = true;
			});
		while (children.length < 2) await new Promise<void>(resolve => setImmediate(resolve));
		const child = children[1];
		child.stdout.write(Buffer.alloc(64 * 1024));
		await new Promise<void>(resolve => setImmediate(resolve));
		expect(completed).toBe(false);
		expect(child.stdout.isPaused()).toBe(true);
		const configPath = (spawn as jest.Mock).mock.calls[1][2].env.RCLONE_CONFIG;
		await expect(fs.stat(configPath)).resolves.toBeDefined();
		release!();
		// Stream beyond the 32 MiB metadata limit, respecting producer backpressure.
		for (let i = 0; i < 520; i++) {
			if (!child.stdout.write(Buffer.alloc(64 * 1024)))
				await new Promise<void>(resolve => child.stdout.once('drain', resolve));
		}
		child.stdout.end();
		child.emit('close', 0);
		await transfer;
		expect(received).toBe(521 * 64 * 1024);
		await expect(fs.stat(configPath)).rejects.toMatchObject({ code: 'ENOENT' });
		destination.end();
	});
	it.each(['abort', 'disconnect'])(
		'kills the process tree and cleans config on %s during streaming',
		async mode => {
			responses.push({ stdout: 'partial-tar', held: true });
			const controller = new AbortController();
			const { destination } = sink();
			const untrack = jest.spyOn(processManager, 'untrackProcess');
			const transfer = new ManagedSftpRepositorySession().withSession(
				access,
				session => session.archive(id, destination),
				controller.signal
			);
			const assertion = expect(transfer).rejects.toMatchObject({
				code: mode === 'abort' ? 'cancelled' : 'execution-failed',
			});
			while (children.length < 2) await new Promise<void>(resolve => setImmediate(resolve));
			const configPath = (spawn as jest.Mock).mock.calls[1][2].env.RCLONE_CONFIG;
			if (mode === 'abort') controller.abort();
			else destination.destroy(new Error(`${access.password} disconnect`));
			await assertion;
			expect(killProcessTree).toHaveBeenCalledWith(children[1], 'SIGKILL');
			expect(untrack).toHaveBeenCalledWith(expect.stringMatching(/^managed-download-/));
			await expect(fs.stat(path.dirname(configPath))).rejects.toMatchObject({ code: 'ENOENT' });
			untrack.mockRestore();
		}
	);
	it('sanitizes archive spawn errors and refuses non-full selectors before dump', async () => {
		responses.push({ error: true });
		const { destination } = sink();
		await expect(
			new ManagedSftpRepositorySession().withSession(access, session =>
				session.archive(id, destination)
			)
		).rejects.toMatchObject({ code: 'execution-failed' });
		const configPath = (spawn as jest.Mock).mock.calls[1][2].env.RCLONE_CONFIG;
		await expect(fs.stat(configPath)).rejects.toMatchObject({ code: 'ENOENT' });
		responses.push({ stdout: 'Obscured_synthetic-value' });
		await expect(
			new ManagedSftpRepositorySession().withSession(access, session =>
				session.archive('latest', destination)
			)
		).rejects.toMatchObject({ code: 'configuration-invalid' });
		expect(spawn).toHaveBeenCalledTimes(3);
		destination.destroy();
	});
	it.each(['cancelled', 'timeout'])(
		'releases a blocked consumer after stdout EOF on %s, without killing a reaped PID',
		async category => {
			responses.push({ stdout: Buffer.alloc(64 * 1024) });
			const originalTimer = global.setTimeout;
			let idle: (() => void) | undefined;
			const timerSpy = jest.spyOn(global, 'setTimeout').mockImplementation(((
				callback: (...args: any[]) => void,
				delay?: number,
				...args: any[]
			) => {
				if (delay === 10 * 60_000) {
					idle = () => callback(...args);
					return { unref: jest.fn() } as any;
				}
				return originalTimer(callback, delay, ...args);
			}) as any);
			const controller = new AbortController();
			let consuming: () => void;
			const started = new Promise<void>(resolve => {
				consuming = resolve;
			});
			const destination = new Writable({
				highWaterMark: 1,
				write(_chunk, _encoding, _done) {
					consuming();
				},
			});
			try {
				const download = new ManagedSftpRepositorySession().withSession(
					access,
					session => session.archive(id, destination),
					controller.signal
				);
				const assertion = expect(download).rejects.toMatchObject({ code: category });
				await started;
				await new Promise<void>(resolve => setImmediate(resolve)); // mock process has closed
				if (category === 'cancelled') controller.abort();
				else idle!();
				await assertion;
				expect(destination.destroyed).toBe(true);
				expect(killProcessTree).not.toHaveBeenCalled();
				await expect(
					fs.stat((spawn as jest.Mock).mock.calls[1][2].env.RCLONE_CONFIG)
				).rejects.toMatchObject({ code: 'ENOENT' });
			} finally {
				timerSpy.mockRestore();
				destination.destroy();
			}
		}
	);
	it.each([
		['auth/transport', 1, 'execution-failed'],
		['password', 12, 'wrong-password'],
		['unavailable', 10, 'repository-unavailable'],
	])('sanitizes %s failure and cleans config', async (_, code, category) => {
		responses.push({ code: Number(code) });
		let configPath = '';
		await expect(
			new ManagedSftpRepositorySession().withSession(access, async session => {
				try {
					return await session.files(id);
				} finally {
					configPath = (spawn as jest.Mock).mock.calls[1][2].env.RCLONE_CONFIG;
				}
			})
		).rejects.toMatchObject({
			code: category,
			message: `Managed repository access failed (${category}).`,
		});
		await expect(fs.stat(configPath)).rejects.toMatchObject({ code: 'ENOENT' });
	});
	it('cleans configuration after callback throws and does not expose raw exception', async () => {
		responses.push({ stdout: JSON.stringify([snapshot]) });
		let configPath = '';
		await expect(
			new ManagedSftpRepositorySession().withSession(access, async session => {
				await session.snapshot(id);
				configPath = (spawn as jest.Mock).mock.calls[1][2].env.RCLONE_CONFIG;
				throw new Error(`${access.password} ${access.options.pass}`);
			})
		).rejects.toMatchObject({ code: 'credentials-unavailable' });
		await expect(fs.stat(path.dirname(configPath))).rejects.toMatchObject({ code: 'ENOENT' });
	});
	it.each(['latest', 'aaaaaaaa', '../snapshot'])(
		'refuses malformed/ambiguous snapshot selector %s before Restic',
		async invalid => {
			await expect(
				new ManagedSftpRepositorySession().withSession(access, session => session.snapshot(invalid))
			).rejects.toMatchObject({ code: 'configuration-invalid' });
			expect(spawn).toHaveBeenCalledTimes(1); // password obscure only
		}
	);
	it('refuses a different or ambiguous returned snapshot', async () => {
		responses.push({ stdout: JSON.stringify([{ ...snapshot, id: 'b'.repeat(64) }]) });
		await expect(
			new ManagedSftpRepositorySession().withSession(access, session => session.snapshot(id))
		).rejects.toMatchObject({ statusCode: 404 });
	});
	it('refuses malformed Restic output without returning raw fields', async () => {
		responses.push({ stdout: JSON.stringify({ password: access.password }) });
		await expect(
			new ManagedSftpRepositorySession().withSession(access, session => session.snapshot(id))
		).rejects.toMatchObject({ code: 'invalid-output' });
	});
	it.each([
		{ options: { ...access.options, ssh: 'arbitrary-command' } },
		{ options: { ...access.options, pass: 'synthetic\ninjection = true' } },
		{ repositoryPath: '../outside' },
		{ repositoryPath: 'application\ncommand' },
	])('refuses arbitrary SFTP/config/path options %p', async invalid => {
		await expect(
			new ManagedSftpRepositorySession().withSession({ ...access, ...invalid }, session =>
				session.snapshot(id)
			)
		).rejects.toMatchObject({ code: 'configuration-invalid' });
		const { destination } = sink();
		await expect(
			new ManagedSftpRepositorySession().withSession({ ...access, ...invalid }, session =>
				session.archive(id, destination)
			)
		).rejects.toMatchObject({ code: 'configuration-invalid' });
		destination.destroy();
		expect(spawn).not.toHaveBeenCalled();
	});
	it('refuses fallback binaries rather than running unpinned PATH tools', async () => {
		(getBinaryPath as jest.Mock).mockReturnValue('restic');
		await expect(
			new ManagedSftpRepositorySession().withSession(access, session => session.snapshot(id))
		).rejects.toMatchObject({ code: 'execution-failed' });
		expect(spawn).not.toHaveBeenCalled();
	});
	it('does not inherit malicious repository/provider/password command environment', async () => {
		const previous = process.env.RESTIC_PASSWORD_COMMAND;
		process.env.RESTIC_PASSWORD_COMMAND = 'arbitrary-command';
		responses.push({ stdout: JSON.stringify([snapshot]) });
		try {
			await new ManagedSftpRepositorySession().withSession(access, session => session.snapshot(id));
			expect((spawn as jest.Mock).mock.calls[1][2].env).not.toHaveProperty(
				'RESTIC_PASSWORD_COMMAND'
			);
		} finally {
			if (previous === undefined) delete process.env.RESTIC_PASSWORD_COMMAND;
			else process.env.RESTIC_PASSWORD_COMMAND = previous;
		}
	});
	it('honors pre-spawn cancellation without starting a process', async () => {
		const controller = new AbortController();
		controller.abort();
		await expect(
			new ManagedSftpRepositorySession().withSession(
				access,
				session => session.snapshot(id),
				controller.signal
			)
		).rejects.toMatchObject({ code: 'cancelled' });
		expect(spawn).not.toHaveBeenCalled();
	});
	it('Phase 6 keeps its private session credentials inside the caller-owned workspace', async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), 'phase6-session-'));
		let configPath = '';
		responses.push({ stdout: JSON.stringify([snapshot]) });
		try {
			await new ManagedSftpRepositorySession().withSession(
				access,
				async session => {
					await session.snapshot(id);
					configPath = (spawn as jest.Mock).mock.calls[1][2].env.RCLONE_CONFIG;
					expect(path.dirname(path.dirname(configPath))).toBe(root);
					if (process.platform !== 'win32') {
						expect((await fs.stat(configPath)).mode & 0o777).toBe(0o600);
						expect((await fs.stat(path.dirname(configPath))).mode & 0o777).toBe(0o700);
					}
				},
				undefined,
				{ restoreTimeoutMs: 24 * 60 * 60_000, temporaryRoot: root }
			);
			expect(await fs.readdir(root)).toEqual([]);
		} finally {
			await fs.rm(root, { recursive: true, force: true });
		}
	});
	it('Phase 6 cleanup failure preserves successful validation and reports only a safe warning', async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), 'phase6-session-'));
		const warning = jest.fn();
		const remove = jest
			.spyOn(fs, 'rm')
			.mockRejectedValue(new Error('synthetic-private-provider-error'));
		try {
			await expect(
				new ManagedSftpRepositorySession().withSession(
					access,
					async () => ({ files: 1 }),
					undefined,
					{ restoreTimeoutMs: 24 * 60 * 60_000, temporaryRoot: root, cleanupWarning: warning }
				)
			).resolves.toEqual({ files: 1 });
			expect(warning).toHaveBeenCalledWith();
		} finally {
			remove.mockRestore();
			await fs.rm(root, { recursive: true, force: true });
		}
	});
	it('Phase 6 cleanup warning does not mask the original sanitized failure', async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), 'phase6-session-'));
		const warning = jest.fn();
		const remove = jest
			.spyOn(fs, 'rm')
			.mockRejectedValue(new Error('synthetic-private-cleanup-error'));
		responses.push({ stdout: 'invalid JSON' });
		try {
			await expect(
				new ManagedSftpRepositorySession().withSession(
					access,
					session => session.snapshot(id),
					undefined,
					{ restoreTimeoutMs: 24 * 60 * 60_000, temporaryRoot: root, cleanupWarning: warning }
				)
			).rejects.toMatchObject({ code: 'invalid-output' });
			expect(warning).toHaveBeenCalledWith();
		} finally {
			remove.mockRestore();
			await fs.rm(root, { recursive: true, force: true });
		}
	});
	it('ordinary Phase 4 callers retain their closed fatal cleanup error', async () => {
		const root = await fs.mkdtemp(path.join(os.tmpdir(), 'phase6-session-'));
		const remove = jest
			.spyOn(fs, 'rm')
			.mockRejectedValue(new Error('synthetic-private-cleanup-error'));
		try {
			await expect(
				new ManagedSftpRepositorySession().withSession(
					access,
					async () => ({ files: 1 }),
					undefined,
					{ restoreTimeoutMs: 30 * 60_000, temporaryRoot: root }
				)
			).rejects.toMatchObject({ code: 'cleanup-failed' });
		} finally {
			remove.mockRestore();
			await fs.rm(root, { recursive: true, force: true });
		}
	});
});
