/** Disposable real Restic/Rclone/SFTP only; never accepts a production target. */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import {
	executeFilesystemBackup,
	BackupFilesystemError,
	type BackupFilesystemStageEvent,
} from '../../../agent/dist/backupFilesystem.js';
const exec = promisify(execFile);
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'parent-lookup-'));
const restic = '/usr/local/bin/restic';
const rclone = '/usr/local/bin/rclone';
let server: ReturnType<typeof spawn> | undefined;
const env = {
	PATH: '/usr/local/bin:/usr/bin:/bin',
	RESTIC_PASSWORD: crypto.randomBytes(32).toString('base64url'),
	RCLONE_CONFIG: path.join(scratch, 'rclone.conf'),
	RESTIC_CACHE_DIR: path.join(scratch, 'cache'),
};
async function run(args: string[], timeout = 8000) {
	const started = Date.now();
	try {
		const result = await exec(restic, args, { env, timeout, maxBuffer: 1024 ** 2 });
		return { ok: true, stdout: result.stdout, elapsed: Date.now() - started, timedOut: false };
	} catch (error: any) {
		const text = String(error.stderr || '');
		const failure = error.killed
			? 'timeout'
			: /wrong password|authenticate/i.test(text)
				? 'authentication'
				: /permission denied|operation not permitted/i.test(text)
					? 'permission'
					: /not supported|unknown flag/i.test(text)
						? 'unsupported-flag'
						: /ciphertext|invalid|corrupt/i.test(text)
							? 'invalid-data'
							: /does not exist|not found/i.test(text)
								? 'not-found'
								: 'execution-failed';
		return {
			ok: false,
			stdout: '',
			elapsed: Date.now() - started,
			timedOut: Boolean(error.killed),
			failure,
			code: error.code,
			missingLoad: /does not exist|not found|no such file|404/i.test(text),
			loadKind: /Load\((snapshot|tree|index|data)\b/.exec(text)?.[1],
		};
	}
}
try {
	assert.notEqual(process.getuid?.(), 0);
	assert.match((await exec(restic, ['version'])).stdout, /restic 0\.19\.1 /);
	const listener = net.createServer();
	await new Promise<void>(resolve => listener.listen(0, '127.0.0.1', resolve));
	const port = (listener.address() as net.AddressInfo).port;
	await new Promise<void>(resolve => listener.close(() => resolve()));
	const root = path.join(scratch, 'sftp');
	await fs.mkdir(root, { mode: 0o700 });
	const password = crypto.randomBytes(24).toString('base64url');
	server = spawn(
		rclone,
		[
			'serve',
			'sftp',
			root,
			'--addr',
			`127.0.0.1:${port}`,
			'--user',
			'fixture-user',
			'--pass',
			password,
			'--cache-dir',
			path.join(scratch, 'rclone-cache'),
		],
		{ stdio: 'ignore' }
	);
	for (let i = 0; i < 100; i++) {
		const ready = await new Promise<boolean>(resolve => {
			const socket = net.createConnection({ host: '127.0.0.1', port });
			socket.once('connect', () => {
				socket.destroy();
				resolve(true);
			});
			socket.once('error', () => resolve(false));
		});
		if (ready) break;
		if (i === 99) throw new Error('Disposable SFTP listener unavailable.');
		await new Promise(resolve => setTimeout(resolve, 50));
	}
	const obscure = exec(rclone, ['obscure', '-']);
	obscure.child.stdin?.end(password + '\n');
	await fs.writeFile(
		env.RCLONE_CONFIG,
		`[pluton]\ntype = sftp\nhost = 127.0.0.1\nport = ${port}\nuser = fixture-user\npass = ${(await obscure).stdout.trim()}\n`,
		{ mode: 0o600 }
	);
	const repository = 'rclone:pluton:managed/app-01';
	assert((await run(['-r', repository, 'init'])).ok);
	const source = path.join(scratch, 'source');
	await fs.mkdir(source);
	await fs.writeFile(path.join(source, 'app.txt'), 'synthetic application\n');
	assert(
		(
			await run([
				'-r',
				repository,
				'backup',
				source,
				'--json',
				'--tag',
				'pluton-plan-plan-01',
				'--tag',
				'pluton-backup-backup-01',
			])
		).ok
	);
	const initial = await run([
		'-r',
		repository,
		'snapshots',
		'--json',
		'--tag',
		'pluton-backup-backup-02',
	]);
	const healthy = await run(['-r', repository, '--no-lock', 'cat', 'config']);
	const listed = await run(['-r', repository, '--no-lock', 'snapshots', '--json']);
	assert(initial.ok && healthy.ok && listed.ok);
	const id = JSON.parse(listed.stdout)[0].id;
	const valid = await run(['-r', repository, '--no-lock', 'snapshots', '--json', id]);
	const missing = await run(
		[
			'-r',
			repository,
			'--no-lock',
			'snapshots',
			'--json',
			...['f', 'e', 'd'].map(c => c.repeat(64)),
		],
		process.argv[2] === 'baseline' ? 60_000 : 8000
	);
	console.log(
		JSON.stringify({
			case: 'real-sftp-parent-probe',
			healthy: healthy.ok,
			enumeration: listed.elapsed,
			valid: { ok: valid.ok, elapsed: valid.elapsed },
			missing: { ok: missing.ok, elapsed: missing.elapsed, timedOut: missing.timedOut },
		})
	);
	assert(
		missing.timedOut,
		'Multiple stale full IDs reproduce retry delay despite healthy repository.'
	);
	if (process.argv[2] !== 'baseline') {
		const state = path.join(scratch, 'agent');
		await fs.mkdir(state, { mode: 0o700 });
		const input = {
			payload: {
				version: 1,
				planId: 'plan-01',
				backupId: 'native-01',
				sourcePath: source,
				excludes: [],
				repository: { remoteName: 'pluton', path: 'managed/app-01', initialize: false },
				repositoryPassword: env.RESTIC_PASSWORD,
				rclone: {
					type: 'sftp',
					options: { host: '127.0.0.1', port: String(port), user: 'fixture-user', pass: password },
				},
			},
			config: {
				serverUrl: new URL('https://example.invalid'),
				dataDir: state,
				binDir: '/opt/pluton-parent-tools/bin',
				allowedRoots: [source],
				allowInsecureHttp: false,
			},
			allowedRoots: [source],
			shouldCancel: async () => false,
			onEvent: async () => {},
		};
		const metadata = async (repository: string, id: string) => {
			const result = await run(['-r', repository, '--no-lock', 'snapshots', '--json']);
			assert(result.ok);
			return JSON.parse(result.stdout).find((snapshot: any) => snapshot.id === id);
		};
		const first = await executeFilesystemBackup(input);
		assert.equal((await metadata(repository, first.snapshotId)).parent, undefined);
		const second = await executeFilesystemBackup({
			...input,
			payload: { ...input.payload, backupId: 'native-02' },
			successfulSnapshotIds: [first.snapshotId, 'f'.repeat(64), 'e'.repeat(64)],
		});
		assert.equal((await metadata(repository, second.snapshotId)).parent, first.snapshotId);
		assert.equal(second.summary.files_unmodified, 1);
		const earlyRestore = await run(
			[
				'-r',
				repository,
				'--no-lock',
				'restore',
				first.snapshotId,
				'--target',
				path.join(scratch, 'early-restore'),
				'--overwrite',
				'never',
			],
			30_000
		);
		console.log(
			JSON.stringify({
				case: 'before-fault-restore',
				ok: earlyRestore.ok,
				...(!earlyRestore.ok
					? {
							failure: earlyRestore.failure,
							missingLoad: earlyRestore.missingLoad,
							loadKind: earlyRestore.loadKind,
						}
					: {}),
			})
		);
		assert(earlyRestore.ok);
		console.log(
			'PASS real SFTP first/second unchanged backup; foreign/stale IDs ignored; verified parent selected.'
		);
		let ordinal = 3;
		for (const mode of [
			'missing-receipt',
			'incompatible-plan',
			'incompatible-source',
			'other-repository',
			'malformed',
			'process-failed',
			'timeout',
			'timeout-unavailable',
			'cancelled',
			'authentication',
			'sftp-authentication',
			'repository-unavailable',
			'corrupt-config',
		]) {
			for (const file of ['parent-fixture-mode', 'parent-lookup-started', 'parent-child-pid'])
				await fs.rm(path.join(state, file), { force: true });
			const stages: BackupFilesystemStageEvent[] = [];
			let cancelled = false;
			const payload = { ...input.payload, backupId: `native-${ordinal++}` };
			if (mode === 'incompatible-plan') payload.planId = 'plan-other';
			if (mode === 'incompatible-source') {
				payload.sourcePath = path.join(scratch, 'source-other');
				await fs.mkdir(payload.sourcePath);
				await fs.writeFile(path.join(payload.sourcePath, 'other.txt'), 'synthetic other source');
			}
			if (mode === 'other-repository')
				payload.repository = { ...payload.repository, path: 'managed/app-other', initialize: true };
			if (mode === 'repository-unavailable')
				payload.repository = { ...payload.repository, path: 'managed/missing', initialize: false };
			if (mode === 'authentication')
				payload.repositoryPassword = crypto.randomBytes(32).toString('base64url');
			if (mode === 'sftp-authentication')
				payload.rclone = {
					...payload.rclone,
					options: {
						...payload.rclone.options,
						pass: crypto.randomBytes(24).toString('base64url'),
					},
				};
			if (
				['malformed', 'process-failed', 'timeout', 'timeout-unavailable', 'cancelled'].includes(
					mode
				)
			)
				await fs.writeFile(path.join(state, 'parent-fixture-mode'), mode);
			if (mode === 'corrupt-config') {
				// Corruption belongs in its own disposable repository, never in the
				// healthy baseline that subsequent exact-snapshot recovery exercises.
				payload.repository = { ...payload.repository, path: 'managed/corrupt', initialize: false };
				assert((await run(['-r', 'rclone:pluton:managed/corrupt', 'init'])).ok);
				await fs.writeFile(path.join(root, 'managed/corrupt/config'), 'synthetic corrupt config');
			}
			const fatal = [
				'timeout-unavailable',
				'cancelled',
				'authentication',
				'sftp-authentication',
				'repository-unavailable',
				'corrupt-config',
			].includes(mode);
			{
				const operation = executeFilesystemBackup({
					...input,
					payload,
					allowedRoots: [payload.sourcePath],
					successfulSnapshotIds: mode === 'missing-receipt' ? [] : [first.snapshotId],
					...(mode.startsWith('timeout') || mode === 'cancelled'
						? { parentLookupTimeoutMs: 500 }
						: {}),
					shouldCancel: async () => cancelled,
					onStage: event => {
						stages.push(event);
						if (mode === 'cancelled' && event.stage === 'parent-discovery') cancelled = true;
					},
				});
				if (fatal)
					await assert.rejects(operation, (error: unknown) => {
						assert(error instanceof BackupFilesystemError);
						assert.equal(error.stage, 'repository-check');
						if (mode === 'cancelled') assert.equal(error.code, 'cancelled');
						if (mode === 'authentication' || mode === 'sftp-authentication')
							assert.equal(error.code, 'target-check-auth-failed');
						return true;
					});
				else {
					const result = await operation;
					const target = 'rclone:pluton:' + payload.repository.path;
					assert.equal((await metadata(target, result.snapshotId)).parent, undefined, mode);
					if (payload.sourcePath === source && mode !== 'other-repository')
						assert.equal(
							result.summary.data_blobs,
							0,
							'No-parent fallback retains content deduplication.'
						);
				}
				assert.equal(
					stages.some(event => event.message === 'restic backup started'),
					!fatal,
					mode
				);
				if (mode === 'timeout')
					assert(
						stages.some(
							event =>
								event.message === 'parent lookup fallback; continuing without explicit parent'
						)
					);
				if (mode.startsWith('timeout') || mode === 'cancelled') {
					const pid = Number(await fs.readFile(path.join(state, 'parent-child-pid'), 'utf8'));
					for (let i = 0; i < 40; i++) {
						try {
							process.kill(pid, 0);
						} catch {
							break;
						}
						await new Promise(resolve => setTimeout(resolve, 25));
					}
					assert.throws(() => process.kill(pid, 0), /ESRCH/);
				}
				for (const secret of [
					env.RESTIC_PASSWORD,
					password,
					payload.repositoryPassword,
					payload.rclone.options.pass,
				])
					assert(!JSON.stringify(stages).includes(secret));
				assert.deepEqual(
					(await fs.readdir(state)).filter(name => name.startsWith('rclone-')),
					[]
				);
				console.log(
					`PASS real SFTP parent regression: ${mode}; isolated selection, fail-closed checks and cleanup.`
				);
			}
		}
		const restored = path.join(scratch, 'restore');
		const restore = await run(
			[
				'-r',
				repository,
				'--no-lock',
				'restore',
				first.snapshotId,
				'--target',
				restored,
				'--overwrite',
				'never',
			],
			30_000
		);
		if (!restore.ok)
			console.log(
				JSON.stringify({
					case: 'disposable-restore',
					failure: restore.failure,
					elapsed: restore.elapsed,
					code: restore.code,
					missingLoad: restore.missingLoad,
					loadKind: restore.loadKind,
				})
			);
		assert(restore.ok);
		assert.equal(
			await fs.readFile(path.join(restored, source.slice(1), 'app.txt'), 'utf8'),
			'synthetic application\n'
		);
		assert((await run(['-r', repository, '--no-lock', 'ls', '--json', first.snapshotId])).ok);
		console.log(
			'PASS original exact snapshot Browse/staged Restore and source content preserved after parent/fallback cases.'
		);
	}
} finally {
	if (server) {
		server.kill('SIGTERM');
		await new Promise<void>(resolve => server!.once('close', () => resolve()));
	}
	await fs.rm(scratch, { recursive: true, force: true });
}
