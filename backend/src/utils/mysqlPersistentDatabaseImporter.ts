import { constants } from 'fs';
import fs from 'fs/promises';
import type { Socket } from 'net';
import type {
	DatabaseRestore,
	PersistentTargetApproval,
	PersistentRestoreLease,
	DatabaseRestoreInspection,
} from '../types/databaseRestores';
import type { DatabaseRestoreStore } from '../stores/DatabaseRestoreStore';
import { MysqlWorkerConnection } from './mysqlRecoveryWorkerClient';
import { DatabaseRestoreError } from './persistentRestorePolicy';
import { RecoveryTestError, checkRecoveryCancellation } from './recoveryValidation';
import {
	CHUNK_BYTES,
	frames,
	send,
	requestSchema,
	responseSchema,
	protocolError,
	workerError,
} from '../mysql-worker/protocol';

/** Typed retained RPC over the existing private IPC. No local MySQL fallback. */
export class MysqlPersistentDatabaseImporter extends MysqlWorkerConnection {
	constructor(
		private readonly store: Pick<
			DatabaseRestoreStore,
			'lease' | 'addLease' | 'leaseState' | 'removeLease'
		>,
		private readonly approval: PersistentTargetApproval,
		enabled?: () => boolean
	) {
		super(enabled);
	}
	private async operation(
		operation: 'persistent-import' | 'persistent-inspect' | 'persistent-cleanup',
		row: DatabaseRestore,
		signal: AbortSignal,
		file?: string,
		stage: (value: string) => void = () => {}
	) {
		let socket: Socket | undefined;
		let ready = false,
			transitions = 0;
		let terminal = false,
			result: DatabaseRestoreInspection | undefined;
		const lease = this.store.lease(row.id);
		const { engine, database, bytes, sha256, artifactValidation } = row.artifact;
		const request = requestSchema.safeParse({
			version: 1,
			operation,
			...(row.mode === 'internal' ? { internal: { id: row.id, snapshotId: row.snapshotId } } : {}),
			approval: this.approval,
			context: {
				id: row.id,
				targetId: row.targetId,
				purpose: row.purpose,
				mode: row.mode,
				...(row.mode === 'internal' ? { databaseId: row.databaseId } : {}),
				ownerToken: row.ownerToken,
				snapshotId: row.snapshotId,
				expiresAt: row.expiresAt,
				cancelRequested: row.cancelRequested,
				artifact: { engine, database, bytes, sha256, artifactValidation },
			},
			lease,
		});
		if (
			!request.success ||
			(operation === 'persistent-import' && (artifactValidation !== 'passed' || lease))
		)
			throw new DatabaseRestoreError('target-binding-mismatch');
		try {
			socket = await this.socket(signal);
			await send(socket, request.data);
			for await (const raw of frames(socket)) {
				checkRecoveryCancellation(signal);
				const parsed = responseSchema.safeParse(raw);
				if (!parsed.success) throw protocolError();
				const response = parsed.data;
				if (response.type === 'heartbeat') continue;
				if (terminal) throw protocolError();
				if (response.type === 'error') throw workerError(response.stage, response.code);
				if (response.type === 'stage') {
					stage(response.stage);
					continue;
				}
				if (response.type === 'ready' && operation === 'persistent-import' && !ready && file) {
					ready = true;
					const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
					try {
						const stat = await handle.stat();
						if (!stat.isFile() || stat.size !== bytes)
							throw new DatabaseRestoreError('database-artifact-size-mismatch');
						const stream = handle.createReadStream({
							autoClose: false,
							highWaterMark: CHUNK_BYTES,
						});
						try {
							for await (const chunk of stream) {
								checkRecoveryCancellation(signal);
								await send(socket, { type: 'chunk', data: Buffer.from(chunk).toString('base64') });
							}
							await send(socket, { type: 'end' });
						} finally {
							stream.destroy();
						}
					} finally {
						await handle.close();
					}
				} else if (
					response.type === 'persistent-lease' &&
					operation === 'persistent-import' &&
					ready
				) {
					const next = response.lease;
					if (
						next.restoreId !== row.id ||
						next.targetId !== row.targetId ||
						next.database !== database ||
						next.ownerToken !== row.ownerToken ||
						next.state !== ['intended', 'created', 'validated'][transitions]
					)
						throw protocolError();
					if (!transitions) this.store.addLease(next);
					else {
						const owned = this.store.lease(row.id);
						if (
							!owned ||
							owned.state !== ['intended', 'created'][transitions - 1] ||
							owned.ownerToken !== next.ownerToken ||
							owned.database !== next.database ||
							owned.targetId !== next.targetId
						)
							throw protocolError();
						this.store.leaseState(row.id, next.state);
					}
					transitions++;
					await send(socket, { type: 'persistent-ack', state: next.state });
				} else if (
					response.type === 'persistent-complete' &&
					(operation === 'persistent-inspect' ||
						(operation === 'persistent-import' && transitions === 3))
				) {
					if (
						response.inspection.database !== database ||
						this.store.lease(row.id)?.state !== 'validated'
					)
						throw protocolError();
					terminal = true;
					result = response.inspection;
				} else if (response.type === 'cleaned' && operation === 'persistent-cleanup') {
					terminal = true;
				} else throw protocolError();
			}
			// EOF follows worker file cleanup and releasing its single-operation slot.
			// A truncated frame or transport error still fails, even after a result.
			if (terminal) {
				if (operation === 'persistent-cleanup') this.store.removeLease(row.id);
				return result;
			}
			throw new RecoveryTestError('database-target-preflight', 'mysql-worker-unavailable');
		} catch (error) {
			if (signal.aborted) throw new RecoveryTestError('database-import', 'cancelled');
			if (error instanceof RecoveryTestError || error instanceof DatabaseRestoreError) throw error;
			throw new RecoveryTestError('database-target-preflight', 'mysql-worker-unavailable');
		} finally {
			socket?.destroy();
		}
	}
	async restore(
		row: DatabaseRestore,
		file: string,
		_directory: string,
		signal: AbortSignal,
		stage: (value: string) => void
	) {
		return (await this.operation('persistent-import', row, signal, file, stage))!;
	}
	async inspect(
		row: DatabaseRestore,
		_directory: string,
		signal: AbortSignal
	): Promise<DatabaseRestoreInspection> {
		return (await this.operation('persistent-inspect', row, signal))!;
	}
	async removeOwned(row: DatabaseRestore, _directory: string) {
		// Disconnect cancellation kills import first; busy retries only wait for worker cleanup.
		for (let attempt = 0; ; attempt++) {
			try {
				await this.operation('persistent-cleanup', row, new AbortController().signal);
				return true;
			} catch (error) {
				if (
					!(error instanceof RecoveryTestError) ||
					!['mysql-worker-busy', 'mysql-worker-unavailable'].includes(error.code) ||
					attempt >= 11
				)
					throw error;
			}
			await new Promise(resolve => setTimeout(resolve, 250));
		}
	}
}
