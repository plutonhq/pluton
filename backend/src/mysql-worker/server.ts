import net, { type Socket } from 'net';
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { z } from 'zod';
import { RecoveryDatabaseImporter } from '../utils/recoveryDatabaseImport';
import { RecoveryTestError } from '../utils/recoveryValidation';
import { detectRecoveryClient } from '../utils/recoveryDatabaseClients';
import { runRecoveryProcess } from '../utils/recoveryProcess';
import { executePersistentMysql } from './persistent';
import {
	authorizeInternalMysql,
	InternalMysqlRecoveryImporter,
	internalMysqlDirectoryReady,
	assertInternalMysqlCapacity,
} from './internal';
import {
	assertMysqlWorkerResources,
	withRecoveryResourceGuard,
} from '../utils/recoveryResourceGuard';
import {
	CHUNK_BYTES,
	DEADLINE_MS,
	SOCKET,
	workerFailure,
	refuseBusy,
	requestSchema,
	frames,
	send,
	protocolError,
	workerConfigSchema,
	type WorkerConfig,
} from './protocol';
import type { RecoveryImportLease } from '../db/schema/recoveryTests';
import type { RecoveryDatabaseResult, RecoveryStage } from '../types/recoveryTests';

const chunkSchema = z
	.object({
		type: z.literal('chunk'),
		data: z
			.string()
			.regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/)
			.max(Math.ceil(CHUNK_BYTES / 3) * 4),
	})
	.strict();
const ackSchema = z
	.object({ type: z.literal('lease-ack'), id: z.string().regex(/^[a-f0-9]{24}$/) })
	.strict();
const endSchema = z.object({ type: z.literal('end') }).strict();

/** UID-only socket volume is the IPC authorization boundary. No TCP listener. */
export async function startMysqlWorker(config: WorkerConfig, trust: () => string) {
	workerConfigSchema.parse(config);
	if (process.platform !== 'linux' || process.getuid?.() !== 10001 || process.getgid?.() !== 10001)
		throw protocolError();
	const binary = detectRecoveryClient('mysql');
	// Narrow worker support to the reviewed LTS client; MariaDB aliases were already refused.
	const { spawnSync } = await import('child_process');
	const probe = spawnSync(binary, ['--no-defaults', '--version'], {
		encoding: 'utf8',
		timeout: 2000,
		env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' },
	});
	if (probe.status !== 0 || !/Ver 8\.4\.11\b.*MySQL Community/.test(probe.stdout))
		throw new RecoveryTestError('database-target-preflight', 'database-client-incompatible');
	const root = path.dirname(SOCKET);
	const stat = await fs.lstat(root);
	if (
		!stat.isDirectory() ||
		stat.isSymbolicLink() ||
		stat.uid !== 10001 ||
		(stat.mode & 0o777) !== 0o700
	)
		throw protocolError();
	try {
		const old = await fs.lstat(SOCKET);
		if (!old.isSocket() || old.uid !== 10001 || (old.mode & 0o777) !== 0o600) throw protocolError();
		// A live worker must never be replaced. Restart removes only its stale socket.
		const active = await new Promise<boolean>(resolve => {
			const client = net.connect(SOCKET);
			client.setTimeout(2000, () => {
				client.destroy();
				resolve(true);
			});
			client.once('connect', () => {
				client.destroy();
				resolve(true);
			});
			client.once('error', (error: NodeJS.ErrnoException) =>
				resolve(!['ECONNREFUSED', 'ENOENT'].includes(error.code || ''))
			);
		});
		if (active) throw protocolError();
		await fs.unlink(SOCKET);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
	}
	process.umask(0o077);
	let busy = false;
	let poisoned = false;
	const operations = new Set<Promise<void>>();
	const connections = new Set<Socket>();
	const server = net.createServer(socket => {
		connections.add(socket);
		socket.on('error', () => {}); // includes clients disconnecting during busy refusal
		socket.once('close', () => connections.delete(socket));
		if (poisoned) {
			socket.destroy();
			return;
		}
		if (busy) {
			void refuseBusy(socket);
			return;
		}
		busy = true;
		const operation = execute(socket)
			.catch(() => {
				process.stderr.write('MySQL recovery worker private staging cleanup failed.\n');
			})
			.finally(() => {
				busy = false;
				socket.destroy();
				operations.delete(operation);
			});
		operations.add(operation);
	});
	server.maxConnections = 2;
	async function execute(socket: Socket) {
		const controller = new AbortController();
		const cancel = () => {
			controller.abort();
			socket.destroy();
		};
		socket.once('close', cancel);
		socket.on('error', () => controller.abort());
		socket.setTimeout(30_000, cancel);
		const timer = setTimeout(cancel, DEADLINE_MS);
		const heartbeat = setInterval(() => {
			void send(socket, { type: 'heartbeat' }).catch(cancel);
		}, 10_000);
		let directory: string | undefined;
		let stage: RecoveryStage = 'database-target-preflight';
		let terminal: unknown;
		try {
			const reader = frames(socket);
			const read = async (timeoutMs: number) => {
				const deadline = setTimeout(cancel, timeoutMs);
				try {
					return await reader.next();
				} finally {
					clearTimeout(deadline);
				}
			};
			const request = requestSchema.safeParse((await read(5000)).value);
			if (!request.success) throw protocolError();
			const input = request.data;
			if (input.operation === 'capabilities') {
				terminal = {
					type: 'capabilities',
					internal: config.internal?.enabled === true && (await internalMysqlDirectoryReady()),
				};
				return;
			}
			const internal = input.internal ? await authorizeInternalMysql(input, config) : undefined;
			const approved = internal?.config || config;
			const approvedTrust = internal ? () => internal.ca : trust;
			if (
				input.operation !== 'import' &&
				input.operation !== 'cleanup' &&
				input.operation !== 'verify-empty'
			) {
				if (input.context.mode === 'internal' && !internal) throw protocolError();
				directory = await fs.mkdtemp('/tmp/pluton-mysql-');
				await fs.chmod(directory, 0o700);
				await executePersistentMysql(input, approved, {
					socket,
					directory,
					signal: controller.signal,
					binary,
					ca: approvedTrust(),
					read,
					finish: result => {
						terminal = result;
					},
					stage: value => {
						stage = value;
						void send(socket, { type: 'stage', stage: value }).catch(cancel);
					},
				});
				return;
			}
			const databases = approved.databases || [];
			if (
				!approved.host ||
				!approved.databases ||
				!approved.maxArtifactBytes ||
				input.target.host.toLowerCase() !== approved.host.toLowerCase() ||
				input.target.port !== approved.port ||
				input.target.username !== approved.username ||
				(('lease' in input ? input.lease.targetId : input.targetId).startsWith('irt_') &&
					!internal) ||
				!input.target.password ||
				!input.target.enabled ||
				(input.operation === 'import'
					? input.allowedDatabases.some(name => !databases.includes(name)) ||
						!input.allowedDatabases.includes(input.entry.database) ||
						input.leases.some(
							lease =>
								lease.testId !== input.testId ||
								lease.targetId !== input.targetId ||
								!databases.includes(lease.database)
						)
					: input.operation === 'cleanup' && !approved.databases.includes(input.lease.database))
			)
				throw new RecoveryTestError(stage, 'recovery-target-unsafe');
			directory = await fs.mkdtemp('/tmp/pluton-mysql-');
			await fs.chmod(directory, 0o700);
			let leases: RecoveryImportLease[] =
				input.operation === 'import'
					? [...input.leases]
					: input.operation === 'cleanup'
						? [input.lease]
						: [];
			const importStore = {
				leases: async () => leases,
				leaseTarget: async () => input.target,
				removeLease: async (id: string) => {
					leases = leases.filter(value => value.id !== id);
				},
				addLease: async (lease: RecoveryImportLease) => {
					await send(socket, { type: 'lease', lease });
					const ack = ackSchema.safeParse((await read(15_000)).value);
					if (!ack.success || ack.data.id !== lease.id) throw protocolError();
					leases.push(lease); // server durable acknowledgement required before CREATE
				},
			};
			const nativeRun: ConstructorParameters<typeof RecoveryDatabaseImporter>[1] = input =>
				runRecoveryProcess({ ...input, args: [...input.args, '--commands=OFF'] });
			const importer = internal
				? new InternalMysqlRecoveryImporter(
						importStore,
						nativeRun,
						() => binary,
						approvedTrust,
						internal.approval
					)
				: new RecoveryDatabaseImporter(importStore, nativeRun, () => binary, approvedTrust);
			if (input.operation === 'verify-empty') {
				if (!internal) throw protocolError();
				stage = 'database-cleanup';
				await importer.verifyEmptyTarget({ ...input.target, id: input.targetId }, directory);
				terminal = { type: 'cleaned' };
				return;
			}
			if (input.operation === 'cleanup') {
				stage = 'database-cleanup';
				await importer.cleanup(input.lease, directory);
				terminal = { type: 'cleaned' };
				return;
			}
			if (input.entry.bytes > approved.maxArtifactBytes)
				throw new RecoveryTestError(
					'database-artifact-validation',
					'database-artifact-size-mismatch'
				);
			await send(socket, { type: 'ready' });
			const file = path.join(directory, 'artifact.sql');
			const handle = await fs.open(file, 'wx', 0o600);
			let size = 0,
				ended = false;
			const hash = crypto.createHash('sha256');
			const uploadDeadline = setTimeout(cancel, 10 * 60_000);
			try {
				while (true) {
					const next = await reader.next();
					if (next.done) break;
					const raw = next.value;
					if (endSchema.safeParse(raw).success) {
						ended = true;
						break;
					}
					const chunk = chunkSchema.safeParse(raw);
					if (!chunk.success) throw protocolError();
					const bytes = Buffer.from(chunk.data.data, 'base64');
					size += bytes.length;
					if (!bytes.length || size > input.entry.bytes)
						throw new RecoveryTestError(
							'database-artifact-validation',
							'database-artifact-size-mismatch'
						);
					hash.update(bytes);
					await handle.writeFile(bytes);
				}
			} finally {
				clearTimeout(uploadDeadline);
				await handle.close();
			}
			if (!ended || size !== input.entry.bytes)
				throw new RecoveryTestError(
					'database-artifact-validation',
					'database-artifact-size-mismatch'
				);
			if (hash.digest('hex') !== input.entry.sha256)
				throw new RecoveryTestError(
					'database-artifact-validation',
					'database-artifact-hash-mismatch'
				);
			const entry: RecoveryDatabaseResult = {
				...input.entry,
				path: '/pluton/database/artifact.sql',
				artifactValidation: 'passed',
				importValidation: 'pending',
			};
			const run = (signal: AbortSignal) =>
				importer.importDatabase({
					testId: input.testId,
					targetId: input.targetId,
					target: input.target,
					entry,
					file,
					directory: directory!,
					signal,
					allowedDatabases: input.allowedDatabases,
					stage: value => {
						stage = value;
						void send(socket, { type: 'stage', stage: value }).catch(cancel);
					},
				});
			if (internal)
				await withRecoveryResourceGuard(
					controller.signal,
					async () => {
						await assertMysqlWorkerResources(directory!);
						await assertInternalMysqlCapacity();
					},
					run
				);
			else await run(controller.signal);
			terminal = { type: 'complete', tables: entry.tables, views: entry.views };
		} catch (error) {
			terminal = undefined;
			const safe = workerFailure(error, stage);
			// No exception text, target, SQL, credential or provider stdout/stderr is logged.
			process.stderr.write(
				JSON.stringify({
					event: 'mysql_recovery_worker_failed',
					stage: safe.stage,
					code: safe.code,
					category:
						error instanceof TypeError
							? 'type-error'
							: error instanceof ReferenceError
								? 'reference-error'
								: 'operation-refused',
				}) + '\n'
			);
			await send(socket, { type: 'error', stage: safe.stage, code: safe.code }).catch(() => {});
		} finally {
			clearTimeout(timer);
			clearInterval(heartbeat);
			controller.abort();
			if (directory) {
				try {
					await fs.rm(directory, { recursive: true, force: true });
				} catch {
					poisoned = true;
					terminal = undefined;
					process.stderr.write(
						JSON.stringify({
							event: 'mysql_recovery_worker_failed',
							stage: 'database-cleanup',
							code: 'workspace-cleanup-failed',
						}) + '\n'
					);
					await send(socket, {
						type: 'error',
						stage: 'database-cleanup',
						code: 'workspace-cleanup-failed',
					}).catch(() => {});
				}
			}
			if (terminal) await send(socket, terminal).catch(() => {});
		}
	}
	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(SOCKET, resolve);
	});
	await fs.chmod(SOCKET, 0o600);
	return {
		server,
		stop: async () => {
			const closed = new Promise<void>(resolve => server.close(() => resolve()));
			for (const connection of connections) connection.destroy();
			await Promise.allSettled([...operations]); // native child close + credentials/SQL cleanup
			await closed;
		},
	};
}
