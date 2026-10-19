/** Opt-in disposable Linux DB -> real agent -> real SFTP/Restic -> recovery.
 * No production DB/repository, no host network, credentials generated and discarded.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { Writable } from 'node:stream';
import Cryptr from 'cryptr';
import {
	executeFilesystemBackup,
	BackupFilesystemError,
	type BackupFilesystemStageEvent,
} from '../../../agent/dist/backupFilesystem.js';
import { RemoteBackupService } from '../../src/services/RemoteBackupService';
import { RemoteRepositoryRecoveryService } from '../../src/services/RemoteRepositoryRecoveryService';
import { verifyPhase6Recovery } from './phase6Database.smoke';

const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'phase5-db-smoke-'));
const mode = process.argv[2] || 'single';
assert.ok(
	[
		'single',
		'two-mariadb',
		'mixed',
		'phase6-filesystem',
		'phase6-mariadb',
		'phase6-postgresql',
		'phase6-mixed',
		'phase6-mixed-failure',
	].includes(mode)
);
const phase6 = mode.startsWith('phase6-');
const needsPg =
	mode === 'mixed' || ['phase6-postgresql', 'phase6-mixed', 'phase6-mixed-failure'].includes(mode);
const executeFile = promisify(execFile);
async function execute(binary: string, args: string[], input?: string) {
	try {
		const operation = executeFile(binary, args, {
			maxBuffer: 4 * 1024 ** 2,
			env: { ...process.env, LC_ALL: 'C' },
		});
		if (input !== undefined) operation.child.stdin?.end(input);
		return (await operation).stdout;
	} catch {
		throw new Error(`Disposable fixture operation failed (${path.basename(binary)}).`);
	}
}
async function port() {
	const server = net.createServer();
	await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
	const value = (server.address() as net.AddressInfo).port;
	await new Promise<void>(resolve => server.close(() => resolve()));
	return value;
}
async function waitPort(value: number) {
	for (let i = 0; i < 200; i++) {
		const ready = await new Promise<boolean>(resolve => {
			const socket = net.createConnection({ host: '127.0.0.1', port: value });
			socket.once('connect', () => {
				socket.destroy();
				resolve(true);
			});
			socket.once('error', () => {
				socket.destroy();
				resolve(false);
			});
		});
		if (ready) return;
		await new Promise(resolve => setTimeout(resolve, 50));
	}
	throw new Error('Disposable fixture listener did not start.');
}
const hash = (value: Buffer) => crypto.createHash('sha256').update(value).digest('hex');
const children: ReturnType<typeof spawn>[] = [];
const sourceDatabases: ReturnType<typeof spawn>[] = [];
try {
	assert.notEqual(process.getuid?.(), 0);
	const dbDirectory = path.join(scratch, 'mysql');
	const socket = path.join(scratch, 'mysql.sock');
	await execute('/usr/bin/mariadb-install-db', [
		'--no-defaults',
		`--datadir=${dbDirectory}`,
		'--auth-root-authentication-method=normal',
		'--skip-test-db',
		`--tmpdir=${scratch}`,
	]);
	const dbPort = await port();
	const sftpPort = await port();
	children.push(
		spawn(
			'/usr/bin/mariadbd',
			[
				'--no-defaults',
				`--datadir=${dbDirectory}`,
				`--socket=${socket}`,
				`--port=${dbPort}`,
				'--bind-address=127.0.0.1',
				`--pid-file=${path.join(scratch, 'mysql.pid')}`,
				`--log-error=${path.join(scratch, 'mysql.log')}`,
				'--skip-log-bin',
				'--skip-name-resolve',
				'--innodb-buffer-pool-size=64M',
				`--tmpdir=${scratch}`,
			],
			{ stdio: 'ignore' }
		)
	);
	sourceDatabases.push(children[children.length - 1]);
	await waitPort(dbPort);
	const dbPassword = crypto.randomBytes(24).toString('base64url');
	const logsPassword = crypto.randomBytes(24).toString('base64url');
	await execute(
		'/usr/bin/mariadb',
		['--no-defaults', `--socket=${socket}`, '-u', 'root'],
		`CREATE DATABASE example_db; CREATE TABLE example_db.example (id INT PRIMARY KEY, value VARCHAR(32)) ENGINE=InnoDB; INSERT INTO example_db.example VALUES (1, 'synthetic-fixture');
CREATE USER 'backup_reader'@'127.0.0.1' IDENTIFIED BY '${dbPassword}'; GRANT SELECT, SHOW VIEW, TRIGGER ON example_db.* TO 'backup_reader'@'127.0.0.1';
CREATE DATABASE example_logs; CREATE TABLE example_logs.audit (id INT PRIMARY KEY, value VARCHAR(32)) ENGINE=InnoDB; INSERT INTO example_logs.audit VALUES (2, 'synthetic-logs-fixture');
CREATE USER 'backup_logs'@'127.0.0.1' IDENTIFIED BY '${logsPassword}'; GRANT SELECT, SHOW VIEW, TRIGGER ON example_logs.* TO 'backup_logs'@'127.0.0.1';`
	);
	let pgPort = 0;
	const pgPassword = crypto.randomBytes(24).toString('base64url') + ':with\\escape';
	if (needsPg) {
		const pgDirectory = path.join(scratch, 'postgresql');
		await execute('/usr/bin/initdb', [
			'--pgdata',
			pgDirectory,
			'--username',
			'fixture_admin',
			'--auth-local',
			'trust',
			'--auth-host',
			'scram-sha-256',
			'--no-locale',
			'--encoding',
			'UTF8',
			'--no-sync',
		]);
		pgPort = await port();
		children.push(
			spawn(
				'/usr/bin/postgres',
				[
					'-D',
					pgDirectory,
					'-h',
					'127.0.0.1',
					'-p',
					String(pgPort),
					'-k',
					scratch,
					'-c',
					'shared_buffers=16MB',
					'-c',
					'fsync=off',
					'-c',
					'synchronous_commit=off',
				],
				{ stdio: 'ignore' }
			)
		);
		sourceDatabases.push(children[children.length - 1]);
		await waitPort(pgPort);
		const adminArgs = [
			'--no-password',
			'--host',
			scratch,
			'--port',
			String(pgPort),
			'--username',
			'fixture_admin',
			'--dbname',
			'postgres',
			'--set',
			'ON_ERROR_STOP=1',
		];
		await execute(
			'/usr/bin/psql',
			adminArgs,
			`${phase6 ? 'CREATE ROLE app_owner NOLOGIN;' : ''} CREATE DATABASE analytics ${phase6 ? 'OWNER app_owner' : ''}; CREATE ROLE backup_pg LOGIN PASSWORD '${pgPassword}'; GRANT CONNECT ON DATABASE analytics TO backup_pg;`
		);
		await execute(
			'/usr/bin/psql',
			[...adminArgs.slice(0, -4), '--dbname', 'analytics', '--set', 'ON_ERROR_STOP=1'],
			`${phase6 ? 'SET ROLE app_owner;' : ''} CREATE TABLE public.metrics (id INT PRIMARY KEY, value VARCHAR(64)); INSERT INTO public.metrics VALUES (3, 'synthetic-postgres-fixture'); GRANT USAGE ON SCHEMA public TO backup_pg; GRANT SELECT ON ALL TABLES IN SCHEMA public TO backup_pg;`
		);
	}
	const source = path.join(scratch, 'source', 'app-01');
	await fs.mkdir(source, { recursive: true, mode: 0o700 });
	await fs.writeFile(path.join(source, 'app.txt'), 'synthetic application file\n', { mode: 0o600 });
	const sourceBefore = hash(await fs.readFile(path.join(source, 'app.txt')));
	const state = path.join(scratch, 'agent');
	await fs.mkdir(state, { mode: 0o700 });
	const sftpRoot = path.join(scratch, 'sftp');
	await fs.mkdir(sftpRoot, { mode: 0o700 });
	const sftpPassword = crypto.randomBytes(24).toString('base64url');
	const repositoryPassword = crypto.randomBytes(32).toString('base64url');
	children.push(
		spawn(
			'/usr/local/bin/rclone',
			[
				'serve',
				'sftp',
				sftpRoot,
				'--addr',
				`127.0.0.1:${sftpPort}`,
				'--user',
				'fixture-user',
				'--pass',
				sftpPassword,
				'--cache-dir',
				path.join(scratch, 'rclone-cache'),
			],
			{ stdio: 'ignore' }
		)
	);
	await waitPort(sftpPort);
	const planId = 'plan-01';
	const backupId = 'backup-01';
	const database = {
		engine: 'mariadb' as const,
		host: '127.0.0.1',
		port: dbPort,
		tls: 'local' as const,
		database: 'example_db',
		username: 'backup_reader',
		password: dbPassword,
		dumpFilename: 'app.sql',
		timeoutSeconds: 60,
		maxDumpBytes: 4 * 1024 ** 2,
		includeRoutines: false,
		includeEvents: false,
	};
	const databases = [{ ...database, databaseId: 'db_app' }];
	if (mode === 'two-mariadb')
		databases.push({
			...database,
			databaseId: 'db_logs',
			database: 'example_logs',
			username: 'backup_logs',
			password: logsPassword,
			dumpFilename: 'logs.sql',
		});
	if (needsPg)
		databases.push({
			...database,
			databaseId: 'db_analytics',
			engine: 'postgresql' as any,
			port: pgPort,
			database: 'analytics',
			username: 'backup_pg',
			password: pgPassword,
			dumpFilename: 'analytics.sql',
		});
	if (mode === 'phase6-postgresql') databases.shift();
	if (mode === 'phase6-filesystem') databases.length = 0;
	const input = {
		payload: {
			version: mode === 'phase6-filesystem' ? 1 : mode === 'single' ? 2 : 3,
			backupId,
			planId,
			sourcePath: source,
			excludes: [],
			repository: { remoteName: 'pluton', path: 'managed/app-01', initialize: true },
			repositoryPassword,
			rclone: {
				type: 'sftp',
				options: {
					host: '127.0.0.1',
					port: String(sftpPort),
					user: 'fixture-user',
					pass: sftpPassword,
				},
			},
			...(mode === 'phase6-filesystem'
				? {}
				: { lifecycle: mode === 'single' ? { version: 1, database } : { version: 2, databases } }),
		},
		config: {
			dataDir: state,
			binDir: '/usr/local/bin',
			serverUrl: new URL('https://example.invalid'),
			allowInsecureHttp: false,
			allowedRoots: [source],
		},
		allowedRoots: [source],
		shouldCancel: async () => false,
		onEvent: async () => {},
	};
	const result = await executeFilesystemBackup(input);
	assert.match(result.snapshotId, /^[a-f0-9]{64}$/);
	const incremental = await executeFilesystemBackup({
		...input,
		payload: { ...input.payload, backupId: 'backup-02' },
		successfulSnapshotIds: [result.snapshotId],
	});
	assert.equal(
		incremental.summary.files_new,
		0,
		'second real filesystem/DB backup must reuse the compatible successful parent'
	);
	assert.equal(
		incremental.summary.files_unmodified,
		1,
		'unchanged application file must not be reported as new'
	);
	if (process.argv[3] === 'parent-fallback') {
		// Root-owned injector stalls only optional discovery; dump, backup and
		// snapshot/artifact confirmation continue to use real native tools.
		await fs.writeFile(path.join(state, 'parent-fixture-mode'), 'timeout');
		const stages: BackupFilesystemStageEvent[] = [];
		const fallback = await executeFilesystemBackup({
			...input,
			config: { ...input.config, binDir: '/opt/pluton-parent-tools/bin' },
			payload: { ...input.payload, backupId: 'backup-fallback' },
			successfulSnapshotIds: [result.snapshotId],
			parentLookupTimeoutMs: 500,
			onStage: event => stages.push(event),
		});
		await fs.rm(path.join(state, 'parent-fixture-mode'));
		assert.match(fallback.snapshotId, /^[a-f0-9]{64}$/);
		assert(stages.some(event => event.message === 'database-dump-completed'));
		assert(
			stages.some(
				event => event.message === 'parent lookup fallback; continuing without explicit parent'
			)
		);
		const dumps =
			fallback.lifecycle?.databases ||
			(fallback.lifecycle?.database ? [fallback.lifecycle.database] : []);
		assert.equal(dumps.length, databases.length);
		for (const dump of dumps) {
			assert(dump.bytes > 0);
			assert.match(dump.sha256, /^[a-f0-9]{64}$/);
		}
		const calls = (await fs.readFile(path.join(state, 'parent-restic-calls'), 'utf8'))
			.trim()
			.split('\n')
			.map(line => JSON.parse(line) as string[]);
		const backupArgs = calls.find(args => args.includes('backup'))!;
		assert(backupArgs && !backupArgs.includes('--parent'));
		assert.equal(backupArgs[backupArgs.indexOf('--group-by') + 1], 'host,paths,tags');
		assert.equal(calls.filter(args => args.includes('cat') && args.includes('config')).length, 2);
		for (const secret of [repositoryPassword, sftpPassword, dbPassword, pgPassword, logsPassword])
			assert(!JSON.stringify(stages).includes(secret));
		assert.deepEqual(
			(await fs.readdir(state)).filter(name => name.startsWith('rclone-')),
			[]
		);
		assert.deepEqual(await fs.readdir(path.join(state, 'jobs')), []);
		assert.equal(sourceBefore, hash(await fs.readFile(path.join(source, 'app.txt'))));
		console.log(
			'PASS real MariaDB dump + optional parent timeout + isolated no-parent backup + artifact confirmation/cleanup.'
		);
	}
	const replay = await executeFilesystemBackup(input);
	assert.equal(replay.snapshotId, result.snapshotId);
	for (const key of [
		'files_new',
		'files_changed',
		'files_unmodified',
		'total_files_processed',
		'total_bytes_processed',
		'data_added',
		'data_added_packed',
	] as const)
		assert.equal(
			replay.summary[key],
			result.summary[key],
			'lost-receipt replay must use actual snapshot statistics'
		);
	assert.deepEqual(result.lifecycle?.warnings || [], []);
	assert.deepEqual(
		await fs.readdir(path.join(state, 'jobs')).catch((error: NodeJS.ErrnoException) => {
			// Phase 4 filesystem-only execution has no Phase 5 lifecycle workspace.
			if (mode === 'phase6-filesystem' && error.code === 'ENOENT') return [];
			throw error;
		}),
		[]
	);
	assert.equal(sourceBefore, hash(await fs.readFile(path.join(source, 'app.txt'))));
	const artifacts =
		result.lifecycle?.databases ||
		(result.lifecycle?.database
			? [
					{
						databaseId: 'db_app',
						engine: 'mariadb',
						database: 'example_db',
						...result.lifecycle!.database!,
					},
				]
			: []);
	assert.equal(artifacts.length, phase6 ? databases.length : mode === 'single' ? 1 : 2);
	const secret = crypto.randomBytes(32).toString('base64url');
	const crypt = new Cryptr(secret);
	const plan = {
		id: planId,
		sourceId: 'agent-device-01',
		sourceType: 'device',
		method: 'backup',
		storageId: 'sftp-01',
		storagePath: 'managed/app-01',
		sourceConfig: { includes: [source], excludes: [] },
		settings: { encryption: true },
		stats: { size: 0, snapshots: [result.snapshotId] },
	} as any;
	const backup = {
		id: backupId,
		planId,
		sourceId: plan.sourceId,
		sourceType: 'device',
		method: 'backup',
		storageId: plan.storageId,
		storagePath: plan.storagePath,
		sourceConfig: plan.sourceConfig,
		status: 'completed',
		inProgress: false,
		success: true,
		completionStats: { ...result.summary, lifecycle: result.lifecycle },
	} as any;
	const repository = {
		id: 'repo-01',
		planId,
		agentId: 'agent-01',
		storageId: plan.storageId,
		storagePath: plan.storagePath,
		encryptedPassword: crypt.encrypt(repositoryPassword),
		initializedAt: new Date(),
	} as any;
	const repositories = { getByPlanId: async () => repository } as any;
	const plans = { getById: async () => plan } as any;
	const backups = { getById: async () => backup } as any;
	const agents = {
		getAgentById: async () => ({
			agentId: repository.agentId,
			deviceId: plan.sourceId,
			revokedAt: null,
		}),
	} as any;
	const storage = {
		getById: async () => ({
			id: plan.storageId,
			type: 'sftp',
			settings: {},
			credentials: Object.fromEntries(
				Object.entries({
					host: '127.0.0.1',
					port: String(sftpPort),
					user: 'fixture-user',
					pass: sftpPassword,
				}).map(([key, value]) => [key, crypt.encrypt(value)])
			),
		}),
	} as any;
	const remote = new RemoteBackupService(repositories, agents, plans, backups, storage, secret);
	const rows = new Map<string, any>();
	const restores = {
		isRestoreRunning: async () => false,
		create: async (row: any) => {
			rows.set(row.id, row);
			return row;
		},
		getById: async (id: string) => rows.get(id) || null,
		update: async (id: string, patch: any) => {
			const row = { ...rows.get(id), ...patch };
			rows.set(id, row);
			return row;
		},
	} as any;
	const recovery = new RemoteRepositoryRecoveryService(
		repositories,
		backups,
		plans,
		restores,
		remote,
		agents,
		undefined,
		secret,
		path.join(scratch, 'recovery')
	);
	const browse = await recovery.browse(backupId);
	for (const artifact of artifacts)
		assert.ok(browse.some(node => node.path === artifact.path && node.type === 'file'));
	const download = await recovery.download(backupId);
	const archiveChunks: Buffer[] = [];
	const consumer = new Writable({
		write(chunk: Buffer, _encoding, callback) {
			archiveChunks.push(Buffer.from(chunk));
			callback();
		},
	});
	await download.streamTo(consumer, new AbortController().signal, () => {});
	const tar = path.join(scratch, 'snapshot.tar');
	await fs.writeFile(tar, Buffer.concat(archiveChunks), { mode: 0o600 });
	const extracted = path.join(scratch, 'extracted');
	await fs.mkdir(extracted, { mode: 0o700 });
	await execute('/bin/tar', ['-xf', tar, '-C', extracted]);
	for (const artifact of artifacts) {
		const sql = await fs.readFile(path.join(extracted, artifact.path.slice(1)));
		assert.equal(hash(sql), artifact.sha256);
		assert.equal(sql.length, artifact.bytes);
		assert.match(
			sql.toString(),
			artifact.engine === 'postgresql'
				? /synthetic-postgres-fixture/
				: artifact.database === 'example_logs'
					? /synthetic-logs-fixture/
					: /synthetic-fixture/
		);
	}
	const restoreId = await recovery.restore(
		backupId,
		{ target: '', includes: [], excludes: [], overwrite: 'never', delete: false },
		planId
	);
	for (let i = 0; i < 600; i++) {
		if (!rows.get(restoreId)?.inProgress) break;
		await new Promise(resolve => setTimeout(resolve, 100));
	}
	const restored = rows.get(restoreId);
	assert.equal(restored.status, 'completed');
	// Service-owned restore workspace layout: restore-<id>/files.
	for (const artifact of artifacts) {
		const restoredSql = await fs.readFile(
			path.join(restored.config.target, artifact.path.slice(1))
		);
		assert.equal(hash(restoredSql), artifact.sha256);
	}
	assert.equal(sourceBefore, hash(await fs.readFile(path.join(source, 'app.txt'))));
	if (mode === 'mixed') {
		for (const [patch, code] of [
			[{ password: 'synthetic-wrong-password' }, 'database-auth-failed'],
			[{ port: await port() }, 'database-unavailable'],
			[{ tls: 'verify-identity', host: 'localhost' }, 'database-tls-verification-failed'],
		] as const) {
			await assert.rejects(
				executeFilesystemBackup({
					...input,
					payload: {
						...input.payload,
						backupId: `backup-${code}`,
						lifecycle: { version: 2, databases: [databases[0], { ...databases[1], ...patch }] },
					},
				}),
				error =>
					error instanceof BackupFilesystemError &&
					error.code === code &&
					error.databaseId === 'db_analytics'
			);
			assert.deepEqual(await fs.readdir(path.join(state, 'jobs')), []);
		}
		assert.equal(sourceBefore, hash(await fs.readFile(path.join(source, 'app.txt'))));
	}
	const versions = [
		(await execute('/usr/bin/mariadb-dump', ['--no-defaults', '--version'])).trim(),
		...(needsPg ? [(await execute('/usr/bin/pg_dump', ['--version'])).trim()] : []),
		(await execute('/usr/local/bin/restic', ['version'])).trim(),
		(await execute('/usr/local/bin/rclone', ['version'])).split('\n')[0].trim(),
	];
	// Real Restic/SFTP granular SQL path, independent of any database import mock.
	const restoreMetadata=await recovery.testMetadata(backup.id,plan.id,backup.completionStats!.snapshot_id!);
	const selectedDatabase=restoreMetadata.databases.find(entry=>entry.databaseId);
	if(selectedDatabase?.databaseId){
		const sqlOnly=path.join(scratch,'persistent-selected-sql');await fs.mkdir(sqlOnly,{mode:0o700});
		await recovery.databaseRestoreArtifact({...restoreMetadata,databaseId:selectedDatabase.databaseId,sha256:selectedDatabase.sha256},
			sqlOnly,new AbortController().signal,async()=>{assert((await fs.lstat(sqlOnly)).isDirectory());});
		assert.equal(hash(await fs.readFile(path.join(sqlOnly,selectedDatabase.path.slice(1)))),selectedDatabase.sha256);
		await assert.rejects(fs.lstat(path.join(sqlOnly,'srv')));
		console.log('PASS persistent exact-snapshot SQL-only staging over real SFTP/Restic; no filesystem source staged');
	}
	if (phase6) {
		// Stop source database servers before recovery: credentials/endpoints used
		// for backup cannot possibly supply recovery contents or accept an import.
		for (const child of sourceDatabases) {
			child.kill('SIGTERM');
			await new Promise<void>(resolve => child.once('close', () => resolve()));
		}
		await verifyPhase6Recovery({
			mode,
			scratch,
			plan,
			backup,
			repository,
			recovery,
			secret,
			children,
			execute,
			port,
			waitPort,
			sftpRoot,
		});
		assert.equal(sourceBefore, hash(await fs.readFile(path.join(source, 'app.txt'))));
	}
	console.log(
		JSON.stringify({
			mode,
			versions,
			artifacts: artifacts.map(({ engine, path: artifactPath, bytes, sha256 }) => ({
				engine,
				path: artifactPath,
				bytes,
				sha256,
			})),
		})
	);
	console.log(
		`PASS: ${mode} disposable DBs -> ${artifacts.length} private SQL dumps -> same real SFTP/Restic snapshot -> Browse/Download/staged Restore -> every SQL hash verified; workspace removed; application unchanged.`
	);
} finally {
	for (const child of children) {
		if (child.exitCode === null) {
			child.kill('SIGTERM');
			await new Promise<void>(resolve => child.once('close', () => resolve()));
		}
	}
	await fs.rm(scratch, { recursive: true, force: true });
}
