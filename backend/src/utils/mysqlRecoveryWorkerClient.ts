import { connect, type Socket } from 'net';
import { constants } from 'fs';
import fs from 'fs/promises';
import type { RecoveryTestStore } from '../stores/RecoveryTestStore';
import type { RecoveryImportLease } from '../db/schema/recoveryTests';
import { RecoveryDatabaseImporter } from './recoveryDatabaseImport';
import { RecoveryTestError } from './recoveryValidation';
import {
	CHUNK_BYTES,
	DEADLINE_MS,
	SOCKET,
	frames,
	send,
	requestSchema,
	responseSchema,
	protocolError,
	workerError,
} from '../mysql-worker/protocol';

type ImportInput = Parameters<RecoveryDatabaseImporter['importDatabase']>[0];
type ImportStore = Pick<RecoveryTestStore, 'addLease' | 'removeLease' | 'leases' | 'leaseTarget'>;
type InternalContext = { id: string; snapshotId: string };
/** Optional Unix IPC only. No generic process proxy, executable/argv/path RPC or network API. */
export class MysqlWorkerConnection {
	constructor(protected readonly enabled = () => process.env.PLUTON_MYSQL_WORKER === 'enabled') {}
	async internalReady() {
		let socket: Socket | undefined;
		const controller = new AbortController(),
			timer = setTimeout(() => controller.abort(), 1000);
		try {
			socket = await this.socket(controller.signal);
			await send(socket, { version: 1, operation: 'capabilities' });
			for await (const raw of frames(socket)) {
				const response = responseSchema.parse(raw);
				if (response.type === 'heartbeat') continue;
				return response.type === 'capabilities' && response.internal;
			}
		} catch {
			/* Old or Custom-only workers are not Internal approval. */
		} finally {
			clearTimeout(timer);
			socket?.destroy();
		}
		return false;
	}
	protected async socket(signal: AbortSignal) {
		if (!this.enabled())
			throw new RecoveryTestError('database-target-preflight', 'mysql-worker-not-configured');
		if (signal.aborted) throw new RecoveryTestError('database-import', 'cancelled');
		try {
			const parent = await fs.lstat('/run/pluton-mysql-worker');
			const stat = await fs.lstat(SOCKET);
			if (
				process.platform !== 'linux' ||
				process.getuid?.() !== 10001 ||
				!parent.isDirectory() ||
				parent.isSymbolicLink() ||
				parent.uid !== 10001 ||
				(parent.mode & 0o777) !== 0o700 ||
				!stat.isSocket() ||
				stat.uid !== 10001 ||
				(stat.mode & 0o777) !== 0o600
			)
				throw protocolError();
			const socket = connect(SOCKET);
			const abort = () => socket.destroy(new RecoveryTestError('database-import', 'cancelled'));
			signal.addEventListener('abort', abort, { once: true });
			const timer = setTimeout(
				() => socket.destroy(new RecoveryTestError('database-import', 'database-import-timeout')),
				DEADLINE_MS
			);
			socket.setTimeout(30_000, () =>
				socket.destroy(new RecoveryTestError('database-import', 'mysql-worker-unavailable'))
			);
			socket.once('close', () => {
				clearTimeout(timer);
				signal.removeEventListener('abort', abort);
			});
			await new Promise<void>((resolve, reject) => {
				socket.once('connect', resolve);
				socket.once('error', reject);
				socket.once('close', () => reject(protocolError()));
			});
			if (signal.aborted) abort();
			return socket;
		} catch {
			throw new RecoveryTestError('database-target-preflight', 'mysql-worker-unavailable');
		}
	}
}
export class MysqlRecoveryWorkerClient extends MysqlWorkerConnection {
	constructor(
		private readonly store: ImportStore,
		enabled?: () => boolean,
		private readonly internal?: (testId: string) => Promise<InternalContext>
	) {
		super(enabled);
	}
	private wireLease(lease: RecoveryImportLease) {
		// Internal storage namespaces IDs as il_<wire-id>. Keep the established
		// 24-hex wire contract and never allow store mutation to alter its ACK.
		return {
			...lease,
			id: this.internal && /^il_[a-f0-9]{24}$/.test(lease.id) ? lease.id.slice(3) : lease.id,
		};
	}
	async importDatabase(input: ImportInput) {
		let socket: Socket | undefined;
		let handle: fs.FileHandle | undefined;
		let ready = false,
			leased = false;
		try {
			if (!this.enabled())
				throw new RecoveryTestError('database-target-preflight', 'mysql-worker-not-configured');
			const request = requestSchema.safeParse({
				version: 1,
				operation: 'import',
				...(this.internal ? { internal: await this.internal(input.testId) } : {}),
				target: input.target,
				testId: input.testId,
				targetId: input.targetId,
				entry: {
					...(this.internal ? { databaseId: input.entry.databaseId } : {}),
					engine: input.entry.engine,
					database: input.entry.database,
					bytes: input.entry.bytes,
					sha256: input.entry.sha256,
				},
				allowedDatabases: input.allowedDatabases,
				leases: (await this.store.leases(input.testId))
					.filter(lease => lease.targetId === input.targetId)
					.map(lease => this.wireLease(lease)),
			});
			if (!request.success || input.entry.artifactValidation !== 'passed')
				throw new RecoveryTestError('database-target-preflight', 'recovery-target-unsafe');
			socket = await this.socket(input.signal);
			await send(socket, request.data);
			for await (const raw of frames(socket)) {
				const parsed = responseSchema.safeParse(raw);
				if (!parsed.success) throw protocolError();
				const response = parsed.data;
				if (response.type === 'heartbeat') continue;
				if (response.type === 'error') throw workerError(response.stage, response.code);
				if (response.type === 'ready' && !ready) {
					ready = true;
					handle = await fs.open(input.file, constants.O_RDONLY | constants.O_NOFOLLOW);
					const stat = await handle.stat();
					if (!stat.isFile() || stat.size !== input.entry.bytes)
						throw new RecoveryTestError(
							'database-artifact-validation',
							'database-artifact-size-mismatch'
						);
					const stream = handle.createReadStream({ autoClose: false, highWaterMark: CHUNK_BYTES });
					try {
						for await (const chunk of stream) {
							if (input.signal.aborted) throw new RecoveryTestError('database-import', 'cancelled');
							await send(socket, { type: 'chunk', data: Buffer.from(chunk).toString('base64') });
						}
						await send(socket, { type: 'end' });
					} finally {
						stream.destroy();
						await handle.close();
						handle = undefined;
					}
				} else if (response.type === 'stage' && ready) input.stage(response.stage);
				else if (response.type === 'lease' && ready && !leased) {
					const lease = response.lease;
					if (
						lease.testId !== input.testId ||
						lease.targetId !== input.targetId ||
						lease.database !== input.entry.database
					)
						throw protocolError();
					await this.store.addLease({ ...lease }); // committed BEFORE authorizing worker CREATE; store may namespace its clone
					leased = true;
					await send(socket, { type: 'lease-ack', id: lease.id });
				} else if (response.type === 'complete' && leased) {
					input.entry.importValidation = 'passed';
					input.entry.tables = response.tables;
					input.entry.views = response.views;
					return;
				} else throw protocolError();
			}
			throw new RecoveryTestError(
				'database-import',
				input.signal.aborted ? 'cancelled' : 'mysql-worker-unavailable'
			);
		} catch (error) {
			const safe = input.signal.aborted
				? new RecoveryTestError('database-import', 'cancelled')
				: error instanceof RecoveryTestError
					? error
					: new RecoveryTestError('database-import', 'mysql-worker-unavailable');
			input.entry.importValidation = 'failed';
			input.entry.failureCode = safe.code;
			throw safe;
		} finally {
			socket?.destroy();
			await handle?.close();
		}
	}
	async cleanup(lease: RecoveryImportLease) {
		const target = await this.store.leaseTarget(lease.targetId);
		const request = requestSchema.safeParse({
			version: 1,
			operation: 'cleanup',
			target,
			lease: this.wireLease(lease),
			...(this.internal ? { internal: await this.internal(lease.testId) } : {}),
		});
		if (!request.success)
			throw new RecoveryTestError('database-cleanup', 'database-cleanup-failed');
		// A cancelled import is killed first. Bound retries for the worker's local file cleanup.
		for (let attempt = 0; attempt < 12; attempt++) {
			let socket: Socket | undefined;
			try {
				socket = await this.socket(new AbortController().signal);
				await send(socket, request.data);
				for await (const raw of frames(socket)) {
					const parsed = responseSchema.safeParse(raw);
					if (!parsed.success) throw protocolError();
					const response = parsed.data;
					if (response.type === 'heartbeat') continue;
					if (response.type === 'error') throw workerError(response.stage, response.code);
					if (response.type !== 'cleaned') throw protocolError();
					await this.store.removeLease(lease.id);
					return;
				}
				throw new RecoveryTestError('database-cleanup', 'mysql-worker-unavailable');
			} catch (error) {
				if (
					!(error instanceof RecoveryTestError) ||
					!['mysql-worker-busy', 'mysql-worker-unavailable'].includes(error.code) ||
					attempt === 11
				)
					throw error;
			} finally {
				socket?.destroy();
			}
			await new Promise(resolve => setTimeout(resolve, 250));
		}
	}
	async verifyEmptyTarget(
		target: Parameters<RecoveryDatabaseImporter['verifyEmptyTarget']>[0],
		testId: string
	) {
		if (!this.internal) throw protocolError();
		const { id: targetId, ...config } = target;
		const request = requestSchema.parse({
			version: 1,
			operation: 'verify-empty',
			target: config,
			targetId,
			testId,
			internal: await this.internal(testId),
		});
		const socket = await this.socket(new AbortController().signal);
		try {
			await send(socket, request);
			for await (const raw of frames(socket)) {
				const response = responseSchema.parse(raw);
				if (response.type === 'heartbeat') continue;
				if (response.type === 'error') throw workerError(response.stage, response.code);
				if (response.type !== 'cleaned') throw protocolError();
				return;
			}
			throw protocolError();
		} finally {
			socket.destroy();
		}
	}
}

/** All local MariaDB/PostgreSQL behavior remains in the original importer. */
export class WorkerRecoveryDatabaseImporter extends RecoveryDatabaseImporter {
	private readonly worker: MysqlRecoveryWorkerClient;
	constructor(private readonly importStore: ImportStore) {
		super(importStore);
		this.worker = new MysqlRecoveryWorkerClient(importStore);
	}
	override async importDatabase(input: ImportInput) {
		return input.target.engine === 'mysql'
			? this.worker.importDatabase(input)
			: super.importDatabase(input);
	}
	override async cleanup(lease: RecoveryImportLease, directory: string) {
		const target = await this.importStore.leaseTarget(lease.targetId);
		return target?.engine === 'mysql'
			? this.worker.cleanup(lease)
			: super.cleanup(lease, directory);
	}
}
