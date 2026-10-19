/**
 * Opt-in real-binary smoke test. Run with pinned Restic/Rclone in an isolated
 * Linux container, never against user data. Jest covers mocked error paths.
 * Fixture setup writes only a fresh mkdtemp repository. Recovery itself reads
 * that repository through a loopback-only, READ-ONLY SFTP server.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { execFile, spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { Writable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { promisify } from 'node:util';
import Cryptr from 'cryptr';
import { RemoteBackupService } from '../../src/services/RemoteBackupService';
import { RemoteRepositoryRecoveryService } from '../../src/services/RemoteRepositoryRecoveryService';
import {
	ManagedSftpRepositorySession,
	ManagedRepositoryAccessError,
	type ManagedRepositorySessionProvider,
} from '../../src/utils/restic/ManagedSftpRepositorySession';

const executeFile = promisify(execFile);
const restic = '/usr/local/bin/restic';
const rclone = '/usr/local/bin/rclone';
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'managed-sftp-smoke-'));
const repository = path.join(scratch, 'sftp-root', 'application');
const source = path.join(scratch, 'source', 'app-01');
// Generated fixture credentials are disposable, never printed or checked in.
const password = crypto.randomBytes(32).toString('base64url');
const sftpPassword = crypto.randomBytes(32).toString('base64url');
const secret = crypto.randomBytes(32).toString('base64url');
const crypt = new Cryptr(secret);
const fixtureEnv = { ...process.env, RESTIC_PASSWORD: password };

async function execute(binary: string, args: string[], env = fixtureEnv) {
	try {
		return (await executeFile(binary, args, { env, maxBuffer: 32 * 1024 * 1024 })).stdout;
	} catch {
		throw new Error(`Synthetic fixture process failed: ${path.basename(binary)}.`);
	}
}
async function hashTree(root: string): Promise<Record<string, string>> {
	const result: Record<string, string> = {};
	async function visit(directory: string) {
		for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
			const file = path.join(directory, entry.name);
			if (entry.isDirectory()) await visit(file);
			else if (entry.isFile())
				result[path.relative(root, file)] = crypto
					.createHash('sha256')
					.update(await fs.readFile(file))
					.digest('hex');
			else throw new Error('Unexpected fixture node.');
		}
	}
	await visit(root);
	return result;
}
async function availablePort() {
	const server = net.createServer();
	await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
	const port = (server.address() as net.AddressInfo).port;
	await new Promise<void>(resolve => server.close(() => resolve()));
	return port;
}
async function waitForServer(port: number) {
	for (let attempt = 0; attempt < 200; attempt++) {
		const available = await new Promise<boolean>(resolve => {
			const socket = net.createConnection({ host: '127.0.0.1', port });
			socket.once('connect', () => {
				socket.destroy();
				resolve(true);
			});
			socket.once('error', () => {
				socket.destroy();
				resolve(false);
			});
		});
		if (available) return;
		await new Promise(resolve => setTimeout(resolve, 50));
	}
	throw new Error('Synthetic SFTP server did not start.');
}

let sftp: ReturnType<typeof spawn> | undefined;
try {
	assert.match(await execute(restic, ['version']), /restic 0\.19\.1/);
	assert.match(await execute(rclone, ['version']), /rclone v1\.75\.1/);
	await fs.mkdir(repository, { recursive: true, mode: 0o700 });
	await fs.mkdir(path.join(source, 'nested'), { recursive: true, mode: 0o700 });
	for (let index = 0; index < 14; index++) {
		await fs.writeFile(
			path.join(source, index < 7 ? '' : 'nested', `file-${index}.txt`),
			`Synthetic app-01 fixture ${index}\n`,
			{ mode: 0o600 }
		);
	}
	await execute(restic, ['--no-cache', '--repo', repository, 'init']);
	const snapshots: string[] = [];
	for (const backupId of ['backup-01', 'backup-02']) {
		const output = await execute(restic, [
			'--no-cache',
			'--repo',
			repository,
			'--json',
			'backup',
			source,
			'--tag',
			'pluton-plan-plan-01',
			'--tag',
			`pluton-backup-${backupId}`,
		]);
		const summary = output
			.trim()
			.split('\n')
			.map(line => JSON.parse(line))
			.find(item => item.message_type === 'summary');
		assert.equal(summary.total_files_processed, 14);
		snapshots.push(summary.snapshot_id);
	}
	const beforeRepository = await hashTree(repository);
	const beforeSource = await hashTree(source);
	const beforeTemp = new Set(
		(await fs.readdir(os.tmpdir())).filter(name => name.startsWith('pluton-recovery-'))
	);
	const port = await availablePort();
	sftp = spawn(
		rclone,
		[
			'serve',
			'sftp',
			path.dirname(repository),
			'--addr',
			`127.0.0.1:${port}`,
			'--user',
			'fixture-user',
			'--pass',
			sftpPassword,
			'--read-only',
			'--cache-dir',
			path.join(scratch, 'rclone-cache'),
		],
		{ shell: false, stdio: ['ignore', 'ignore', 'ignore'] }
	);
	await waitForServer(port);
	const repo = {
		id: 'remote-repo-01',
		planId: 'plan-01',
		agentId: 'agent-01',
		storageId: 'storage-01',
		storagePath: 'application',
		initializedAt: new Date(),
		encryptedPassword: crypt.encrypt(password),
	};
	const plan = {
		id: 'plan-01',
		sourceId: 'app-01',
		sourceType: 'device',
		method: 'backup',
		storageId: 'storage-01',
		storagePath: 'application',
	};
	const backups = new Map(
		['backup-01', 'backup-02'].map((id, index) => [
			id,
			{
				...plan,
				id,
				planId: plan.id,
				status: 'completed',
				success: true,
				inProgress: false,
				completionStats: { snapshot_id: snapshots[index] },
			},
		])
	);
	const rows = new Map<string, any>();
	const stores = {
		repositories: { getByPlanId: async () => repo },
		backups: { getById: async (id: string) => backups.get(id) },
		plans: { getById: async () => plan },
		agents: { getAgentById: async () => ({ agentId: 'agent-01', deviceId: 'app-01' }) },
		restores: {
			isRestoreRunning: async () => false,
			create: async (row: any) => {
				rows.set(row.id, row);
				return row;
			},
			update: async (id: string, changes: any) => {
				const row = { ...rows.get(id), ...changes };
				rows.set(id, row);
				return row;
			},
		},
		storage: {
			getById: async () => ({
				type: 'sftp',
				settings: {
					disable_hashcheck: false,
					known_hosts_file: '',
					path_override: '',
					ssh: '',
					key_use_agent: false,
					use_insecure_cipher: false,
				},
				credentials: {
					host: crypt.encrypt('127.0.0.1'),
					port: crypt.encrypt(String(port)),
					user: crypt.encrypt('fixture-user'),
					pass: crypt.encrypt(sftpPassword),
				},
			}),
		},
	};
	const remote = new RemoteBackupService(
		stores.repositories as any,
		stores.agents as any,
		stores.plans as any,
		stores.backups as any,
		stores.storage as any,
		secret
	);
	const sessions: ManagedRepositorySessionProvider = {
		withSession: (access, consume, signal) =>
			new ManagedSftpRepositorySession().withSession(
				access,
				async session => {
					const directories = (await fs.readdir(os.tmpdir())).filter(
						name => name.startsWith('pluton-recovery-') && !beforeTemp.has(name)
					);
					assert.equal(
						directories.length,
						1,
						'Exactly one private credential workspace per session.'
					);
					const directory = path.join(os.tmpdir(), directories[0]);
					assert.equal((await fs.stat(directory)).mode & 0o777, 0o700);
					assert.equal((await fs.stat(path.join(directory, 'rclone.conf'))).mode & 0o777, 0o600);
					return consume(session);
				},
				signal
			),
	};
	const service = new RemoteRepositoryRecoveryService(
		stores.repositories as any,
		stores.backups as any,
		stores.plans as any,
		stores.restores as any,
		remote,
		stores.agents as any,
		sessions,
		secret,
		path.join(scratch, 'staging')
	);
	const files = await service.browse('backup-01');
	assert.equal(files.filter(file => file.type === 'file').length, 14);
	assert.equal(
		files.filter(file => file.path.startsWith(`${source}/nested/`) && file.type === 'file').length,
		7
	);
	assert.equal((await service.browse('backup-02')).filter(file => file.type === 'file').length, 14);
	assert.deepEqual(await service.prepareDownload('backup-01'), { streaming: true });
	// Full native TAR downloads of both historical snapshots: no staged restore.
	for (const backupId of ['backup-01', 'backup-02']) {
		const descriptor = await service.download(backupId);
		assert.match(descriptor.fileName, /^backup-[a-z0-9_-]+\.tar$/);
		const archivePath = path.join(scratch, descriptor.fileName);
		const output = createWriteStream(archivePath, { flags: 'wx', mode: 0o600 });
		const done = finished(output);
		let ready = false;
		try {
			await descriptor.streamTo(output, new AbortController().signal, () => {
				ready = true;
			});
			output.end();
			await done;
		} catch (error) {
			output.destroy();
			await done.catch(() => undefined);
			throw error;
		}
		assert.equal(ready, true);
		assert.equal((await fs.stat(archivePath)).mode & 0o777, 0o600);
		const extraction = path.join(scratch, `extract-${backupId}`);
		await fs.mkdir(extraction, { mode: 0o700 });
		await execute('/bin/tar', ['-xf', archivePath, '-C', extraction]);
		assert.deepEqual(await hashTree(path.join(extraction, source.slice(1))), beforeSource);
		assert.equal(rows.size, 0, 'Download never creates a staged restore job.');
	}
	// Cancel a real dump while its consumer is blocked: terminate Restic/Rclone,
	// then remove scoped credentials. The read-only repository remains untouched.
	const controller = new AbortController();
	const blocked = new Writable({
		highWaterMark: 1,
		write(_chunk, _encoding, _done) {
			controller.abort();
		},
	});
	await assert.rejects(
		(await service.download('backup-01')).streamTo(blocked, controller.signal, () => {}),
		(error: unknown) => error instanceof ManagedRepositoryAccessError && error.code === 'cancelled'
	);
	blocked.destroy();
	await assert.rejects(
		sessions.withSession(
			{
				options: await remote.getSftpRecoveryOptions('storage-01'),
				password: crypto.randomBytes(32).toString('base64url'),
				repositoryPath: 'application',
			},
			session => session.snapshot(snapshots[0])
		),
		(error: unknown) =>
			error instanceof ManagedRepositoryAccessError && error.code === 'wrong-password'
	);
	const selection = {
		target: '',
		overwrite: 'never' as const,
		includes: [] as string[],
		excludes: [] as string[],
		delete: false,
	};
	const preview = await service.preview('backup-01', selection, 'plan-01');
	assert.equal(preview.stats.files_restored, 14);
	const id = await service.restore('backup-01', selection, 'plan-01');
	await (service as any).jobs.get(id)?.done;
	const row = rows.get(id);
	assert.equal(row.status, 'completed', row.errorMsg);
	const restoredSource = path.join(row.config.target, source.slice(1));
	assert.deepEqual(await hashTree(restoredSource), beforeSource);
	assert.equal((await fs.stat(path.dirname(row.config.target))).mode & 0o777, 0o700);
	assert.equal((await service.stats(row)).success, true);
	const selectedFile = `${source}/nested/file-7.txt`;
	const partialId = await service.restore(
		'backup-02',
		{ ...selection, target: 'custom/check', includes: [selectedFile] },
		'plan-01'
	);
	await (service as any).jobs.get(partialId)?.done;
	const partial = rows.get(partialId);
	assert.equal(partial.status, 'completed', partial.errorMsg);
	assert.equal(partial.taskStats.files_restored, 1);
	assert.equal(Object.keys(await hashTree(partial.config.target)).length, 1);
	assert.deepEqual(
		await hashTree(repository),
		beforeRepository,
		'Recovery must not mutate the repository.'
	);
	assert.deepEqual(
		await hashTree(source),
		beforeSource,
		'Recovery must not modify the original source.'
	);
	assert.deepEqual(
		new Set((await fs.readdir(os.tmpdir())).filter(name => name.startsWith('pluton-recovery-'))),
		beforeTemp,
		'Every temporary Rclone config must be cleaned.'
	);
	console.log(
		'PASS: real Restic 0.19.1 + Rclone 1.75.1, read-only SFTP, two historical TAR downloads, cancellation, 14 files, full/granular/custom staging, matching hashes, repository/source unchanged, credential cleanup.'
	);
} finally {
	if (sftp && sftp.exitCode === null && sftp.signalCode === null) {
		const closed = new Promise<void>(resolve => sftp!.once('close', () => resolve()));
		sftp.kill('SIGTERM');
		await closed;
	}
	await fs.rm(scratch, { recursive: true, force: true });
}
