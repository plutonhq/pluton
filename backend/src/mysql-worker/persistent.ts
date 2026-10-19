import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { z } from 'zod';
import type { Socket } from 'net';
import type {
	DatabaseRestore,
	PersistentRestoreLease,
	DatabaseRestoreInspection,
} from '../types/databaseRestores';
import { PersistentDatabaseImporter } from '../utils/persistentDatabaseImporter';
import { DatabaseRestoreError } from '../utils/persistentRestorePolicy';
import { checkRecoveryCancellation, RecoveryTestError } from '../utils/recoveryValidation';
import { runRecoveryProcess } from '../utils/recoveryProcess';
import {
	assertMysqlWorkerResources,
	withRecoveryResourceGuard,
} from '../utils/recoveryResourceGuard';
import { assertInternalMysqlCapacity } from './internal';
import {
	CHUNK_BYTES,
	persistentAckSchema,
	persistentInspectionSchema,
	protocolError,
	send,
	type WorkerConfig,
	type WorkerRequest,
} from './protocol';

type Request = Extract<WorkerRequest, { operation: `persistent-${string}` }>;
const chunkSchema = z
	.object({
		type: z.literal('chunk'),
		data: z
			.string()
			.regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/)
			.max(Math.ceil(CHUNK_BYTES / 3) * 4),
	})
	.strict();

/** Retained operations reuse the SAME native guard, owner, SQL and catalog implementation.
 * No query/path/command RPC. The app must durably ACK every lease transition. */
export async function executePersistentMysql(
	input: Request,
	config: WorkerConfig,
	io: {
		socket: Socket;
		directory: string;
		signal: AbortSignal;
		binary: string;
		ca: string;
		read: (timeoutMs: number) => Promise<IteratorResult<unknown>>;
		finish: (
			value:
				| { type: 'cleaned' }
				| { type: 'persistent-complete'; inspection: DatabaseRestoreInspection }
		) => void;
		stage: (
			value:
				| 'database-target-preflight'
				| 'database-import'
				| 'database-import-validation'
				| 'database-cleanup'
		) => void;
	}
) {
	const { approval, context } = input;
	const policy = config.persistent;
	if (
		!policy ||
		approval.id !== policy.targetId ||
		approval.activationId !== policy.activationId ||
		approval.storage.id !== policy.storageId ||
		approval.target.host.toLowerCase() !== policy.host.toLowerCase() ||
		approval.target.port !== policy.port ||
		approval.target.username !== policy.username ||
		approval.database !== policy.database ||
		context.targetId !== approval.id ||
		context.artifact.database !== approval.database ||
		(input.operation === 'persistent-import' && input.lease)
	)
		throw new DatabaseRestoreError('target-binding-mismatch');
	if (context.artifact.bytes > Math.min(approval.maxSqlBytes, policy.maxArtifactBytes))
		throw new RecoveryTestError('database-artifact-validation', 'database-artifact-size-mismatch');
	if (
		crypto
			.createHash('sha256')
			.update(await fs.readFile(io.ca))
			.digest('hex') !== approval.caSha256
	)
		throw new DatabaseRestoreError('target-tls-binding-mismatch');
	if (
		input.operation === 'persistent-import' &&
		(context.cancelRequested || context.expiresAt <= Date.now())
	)
		throw new DatabaseRestoreError('restore-expired');
	const row = context as DatabaseRestore;
	let lease: PersistentRestoreLease | null = input.lease;
	const transition = async (next: PersistentRestoreLease) => {
		await send(io.socket, { type: 'persistent-lease', lease: next });
		const ack = persistentAckSchema.safeParse((await io.read(15_000)).value);
		if (!ack.success || ack.data.state !== next.state) throw protocolError();
		checkRecoveryCancellation(io.signal);
		lease = next;
	};
	const importer = new PersistentDatabaseImporter(
		{
			lease: () => lease,
			addLease: async next => {
				await transition(next);
			},
			leaseState: async (_id, state) => {
				if (!lease) throw protocolError();
				await transition({ ...lease, state });
			},
			removeLease: () => {
				lease = null;
			},
		},
		approval,
		io.ca,
		query => runRecoveryProcess({ ...query, args: [...query.args, '--commands=OFF'] }),
		() => io.binary
	);
	if (input.operation === 'persistent-cleanup') {
		io.stage('database-cleanup');
		await importer.removeOwned(row, io.directory);
		io.finish({ type: 'cleaned' });
		return;
	}
	if (input.operation === 'persistent-inspect') {
		io.stage('database-import-validation');
		const inspection = persistentInspectionSchema.parse(
			await importer.inspect(row, io.directory, io.signal)
		);
		io.finish({ type: 'persistent-complete', inspection });
		return;
	}
	await send(io.socket, { type: 'ready' });
	const file = path.join(io.directory, 'artifact.sql');
	const handle = await fs.open(file, 'wx', 0o600);
	const hash = crypto.createHash('sha256');
	let size = 0;
	const deadline = Date.now() + 10 * 60_000;
	try {
		while (true) {
			checkRecoveryCancellation(io.signal);
			if (Date.now() >= deadline)
				throw new RecoveryTestError('database-artifact-validation', 'database-import-timeout');
			const next = await io.read(Math.max(1, Math.min(30_000, deadline - Date.now())));
			if (next.done) throw protocolError();
			if (
				z
					.object({ type: z.literal('end') })
					.strict()
					.safeParse(next.value).success
			)
				break;
			const chunk = chunkSchema.safeParse(next.value);
			if (!chunk.success) throw protocolError();
			const bytes = Buffer.from(chunk.data.data, 'base64');
			size += bytes.length;
			if (!bytes.length || size > context.artifact.bytes)
				throw new RecoveryTestError(
					'database-artifact-validation',
					'database-artifact-size-mismatch'
				);
			hash.update(bytes);
			await handle.writeFile(bytes);
		}
	} finally {
		await handle.close();
	}
	if (size !== context.artifact.bytes)
		throw new RecoveryTestError('database-artifact-validation', 'database-artifact-size-mismatch');
	if (hash.digest('hex') !== context.artifact.sha256)
		throw new RecoveryTestError('database-artifact-validation', 'database-artifact-hash-mismatch');
	const restore = (signal: AbortSignal) =>
		importer.restore(row, file, io.directory, signal, stage =>
			io.stage(stage as Parameters<typeof io.stage>[0])
		);
	const inspection =
		context.mode === 'internal'
			? await withRecoveryResourceGuard(
					io.signal,
					async () => {
						await assertMysqlWorkerResources(io.directory);
						await assertInternalMysqlCapacity();
					},
					restore
				)
			: await restore(io.signal);
	checkRecoveryCancellation(io.signal);
	io.finish({
		type: 'persistent-complete',
		inspection: persistentInspectionSchema.parse(inspection),
	});
}
