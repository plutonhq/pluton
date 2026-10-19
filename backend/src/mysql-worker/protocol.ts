import { z } from 'zod';
import type { Socket } from 'net';
import { recoveryTargetSchema } from '../utils/recoveryTestPolicy';
import { RecoveryTestError } from '../utils/recoveryValidation';
import { persistentApprovalSchema, DatabaseRestoreError } from '../utils/persistentRestorePolicy';
import type { RecoveryCode } from '../types/recoveryTests';
import { RESTORE_PURPOSE } from '../types/databaseRestores';

export const SOCKET = '/run/pluton-mysql-worker/worker.sock';
export const FRAME_LIMIT = 96 * 1024;
export const CHUNK_BYTES = 32 * 1024;
export const DEADLINE_MS = 75 * 60_000;
const id = z.string().regex(/^[a-f0-9]{24}$/);
const database = z.string().regex(/^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$/);
export const internalContextSchema = z
	.object({ id, snapshotId: z.string().regex(/^[a-f0-9]{64}$/) })
	.strict();
const recoveryTargetId = z.string().regex(/^(?:[a-f0-9]{24}|irt_[a-f0-9]{24})$/);
export const leaseSchema = z
	.object({
		id,
		testId: id,
		targetId: recoveryTargetId,
		database,
		ownerToken: z.string().regex(/^[a-f0-9]{48}$/),
	})
	.strict();
const target = recoveryTargetSchema.safeExtend({
	engine: z.literal('mysql'),
	tls: z.literal('verify-identity'),
	password: recoveryTargetSchema.shape.password.unwrap(),
});
export const persistentLeaseSchema = z
	.object({
		restoreId: id,
		targetId: id,
		database,
		ownerToken: z.string().regex(/^[a-f0-9]{48}$/),
		state: z.enum(['intended', 'created', 'validated']),
	})
	.strict();
export const persistentContextSchema = z
	.object({
		id,
		targetId: id,
		purpose: z.literal(RESTORE_PURPOSE),
		mode: z.enum(['custom', 'internal']),
		databaseId: z
			.string()
			.regex(/^db_[A-Za-z0-9_-]{1,80}$/)
			.optional(),
		ownerToken: z.string().regex(/^[a-f0-9]{48}$/),
		snapshotId: z.string().regex(/^[a-f0-9]{64}$/),
		expiresAt: z.number().int().positive(),
		cancelRequested: z.boolean(),
		artifact: z
			.object({
				engine: z.literal('mysql'),
				database,
				bytes: z
					.number()
					.int()
					.positive()
					.max(448 * 1024 ** 2),
				sha256: z.string().regex(/^[a-f0-9]{64}$/),
				artifactValidation: z.enum(['pending', 'passed', 'failed']),
			})
			.strict(),
	})
	.strict();
export const persistentInspectionSchema = z
	.object({
		engine: z.literal('mysql'),
		version: z.string().regex(/^8\.4\.\d+$/),
		database,
		tables: z.number().int().nonnegative(),
		views: z.number().int().nonnegative(),
		bytes: z.number().int().nonnegative().nullable(),
		observedAt: z.number().int().positive(),
		catalogTruncated: z.boolean(),
		catalog: z
			.array(
				z
					.object({
						schema: z
							.string()
							.max(256)
							.regex(/^[^\0\r\n]+$/),
						name: z
							.string()
							.max(256)
							.regex(/^[^\0\r\n]+$/),
						type: z.enum(['BASE TABLE', 'VIEW']),
					})
					.strict()
			)
			.max(200),
	})
	.strict();
export const persistentAckSchema = z
	.object({
		type: z.literal('persistent-ack'),
		state: persistentLeaseSchema.shape.state,
	})
	.strict();
export const requestSchema = z.discriminatedUnion('operation', [
	z.object({ version: z.literal(1), operation: z.literal('capabilities') }).strict(),
	z
		.object({
			version: z.literal(1),
			operation: z.literal('import'),
			internal: internalContextSchema.optional(),
			target,
			testId: id,
			targetId: recoveryTargetId,
			entry: z
				.object({
					databaseId: z
						.string()
						.regex(/^db_[A-Za-z0-9_-]{1,80}$/)
						.optional(),
					engine: z.literal('mysql'),
					database,
					bytes: z
						.number()
						.int()
						.positive()
						.max(100 * 1024 ** 3),
					sha256: z.string().regex(/^[a-f0-9]{64}$/),
				})
				.strict(),
			allowedDatabases: z.array(database).min(1).max(8),
			leases: z.array(leaseSchema).max(8),
		})
		.strict(),
	z
		.object({
			version: z.literal(1),
			operation: z.literal('cleanup'),
			target,
			lease: leaseSchema,
			internal: internalContextSchema.optional(),
		})
		.strict(),
	z
		.object({
			version: z.literal(1),
			operation: z.literal('verify-empty'),
			target,
			targetId: recoveryTargetId,
			testId: id,
			internal: internalContextSchema,
		})
		.strict(),
	z
		.object({
			version: z.literal(1),
			operation: z.enum(['persistent-import', 'persistent-inspect', 'persistent-cleanup']),
			internal: internalContextSchema.optional(),
			approval: persistentApprovalSchema.safeExtend({
				engine: z.literal('mysql'),
				mode: z.enum(['custom', 'internal']),
			}),
			context: persistentContextSchema,
			lease: persistentLeaseSchema.nullable(),
		})
		.strict(),
]);
export type WorkerRequest = z.infer<typeof requestSchema>;
export const workerConfigSchema = z
	.object({
		host: recoveryTargetSchema.shape.host.optional(),
		port: recoveryTargetSchema.shape.port.optional(),
		username: recoveryTargetSchema.shape.username.optional(),
		databases: z.array(database).min(1).max(8).optional(),
		maxArtifactBytes: z
			.number()
			.int()
			.positive()
			.max(100 * 1024 ** 3)
			.optional(),
		internal: z
			.object({ enabled: z.literal(true), maxArtifactBytes: z.literal(128 * 1024 ** 2) })
			.strict()
			.optional(),
		// Explicit independent operator approval; existing disposable workers remain unchanged.
		persistent: z
			.object({
				targetId: id,
				activationId: z.string().regex(/^[a-f0-9]{32}$/),
				storageId: z.string().regex(/^[a-f0-9-]{32,36}$/),
				host: recoveryTargetSchema.shape.host,
				port: recoveryTargetSchema.shape.port,
				username: recoveryTargetSchema.shape.username,
				database,
				maxArtifactBytes: z
					.number()
					.int()
					.positive()
					.max(448 * 1024 ** 2),
			})
			.strict()
			.optional(),
	})
	.strict()
	.superRefine((value, context) => {
		const fields = [
			value.host,
			value.port,
			value.username,
			value.databases,
			value.maxArtifactBytes,
		];
		if (
			(!value.internal && fields.some(v => v === undefined)) ||
			(fields.some(v => v !== undefined) && fields.some(v => v === undefined)) ||
			(value.persistent && !value.host) ||
			(value.internal &&
				(value.maxArtifactBytes || value.persistent?.maxArtifactBytes || 0) > 128 * 1024 ** 2) ||
			(value.internal && (value.persistent?.maxArtifactBytes || 0) > 128 * 1024 ** 2)
		)
			context.addIssue({ code: 'custom', message: 'Incomplete approved worker policy.' });
	});
export type WorkerConfig = z.infer<typeof workerConfigSchema>;
export const stages = [
	'database-artifact-validation',
	'database-target-preflight',
	'database-import',
	'database-import-validation',
	'database-cleanup',
] as const;
const recoveryCodes = [
	'cancelled',
	'database-client-missing',
	'database-client-incompatible',
	'database-tls-failed',
	'database-authentication-failed',
	'database-target-unavailable',
	'database-import-failed',
	'database-import-timeout',
	'database-out-of-memory',
	'database-storage-full',
	'mysql-worker-resource-limit',
	'internal-resources-insufficient',
	'database-import-validation-failed',
	'database-output-limit',
	'database-already-exists',
	'recovery-target-unsafe',
	'recovery-target-not-configured',
	'database-cleanup-failed',
	'database-artifact-size-mismatch',
	'database-artifact-hash-mismatch',
	'mysql-worker-busy',
	'mysql-worker-unavailable',
	'workspace-cleanup-failed',
	'mysql-worker-protocol-failed',
] as const;
const persistentCodes = [
	'target-binding-mismatch',
	'target-tls-binding-mismatch',
	'restore-purpose-guard-mismatch',
	'target-privileges-unsafe',
	'target-catalog-not-dedicated',
	'restore-ownership-uncertain',
	'database-engine-or-artifact-mismatch',
	'database-version-unavailable',
	'inspection-output-invalid',
	'restore-access-not-active',
	'restore-expired',
] as const;
export const codes = [...recoveryCodes, ...persistentCodes] as const;
export function workerError(stage: (typeof stages)[number], code: (typeof codes)[number]) {
	return (persistentCodes as readonly string[]).includes(code)
		? new DatabaseRestoreError(code, stage)
		: new RecoveryTestError(stage, code as RecoveryCode);
}
/** A shared cancellation check uses stage "job", which is not a wire stage.
 * Remap ONLY that explicit cancellation, never an unexpected process failure. */
export function workerFailure(error: unknown, stage: (typeof stages)[number]) {
	if ((error as NodeJS.ErrnoException)?.code === 'ENOSPC') return { stage, code: 'database-storage-full' as const };
	if (error instanceof RecoveryTestError && error.code === 'cancelled' && error.stage === 'job')
		return { stage, code: 'cancelled' as const };
	if (
		(error instanceof RecoveryTestError || error instanceof DatabaseRestoreError) &&
		(codes as readonly string[]).includes(error.code)
	) {
		const actualStage = error.stage || stage;
		if ((stages as readonly string[]).includes(actualStage))
			return { stage: actualStage, code: error.code };
	}
	return { stage, code: 'mysql-worker-protocol-failed' as const };
}
export const responseSchema = z.discriminatedUnion('type', [
	z.object({ type: z.literal('capabilities'), internal: z.boolean() }).strict(),
	z.object({ type: z.literal('ready') }).strict(),
	z.object({ type: z.literal('heartbeat') }).strict(),
	z.object({ type: z.literal('stage'), stage: z.enum(stages) }).strict(),
	z.object({ type: z.literal('lease'), lease: leaseSchema }).strict(),
	z
		.object({
			type: z.literal('complete'),
			tables: z.number().int().nonnegative(),
			views: z.number().int().nonnegative(),
		})
		.strict(),
	z.object({ type: z.literal('cleaned') }).strict(),
	z.object({ type: z.literal('persistent-lease'), lease: persistentLeaseSchema }).strict(),
	z
		.object({ type: z.literal('persistent-complete'), inspection: persistentInspectionSchema })
		.strict(),
	z.object({ type: z.literal('error'), stage: z.enum(stages), code: z.enum(codes) }).strict(),
]);
export function protocolError(): RecoveryTestError {
	return new RecoveryTestError('database-target-preflight', 'mysql-worker-protocol-failed');
}
/** Length-bounded JSON frames, never raw provider output. Stream backpressure bounds memory. */
export async function* frames(socket: Socket): AsyncGenerator<unknown> {
	let pending = Buffer.alloc(0);
	for await (const chunk of socket) {
		pending = Buffer.concat([pending, chunk]);
		while (pending.length >= 4) {
			const size = pending.readUInt32BE(0);
			if (!size || size > FRAME_LIMIT) throw protocolError();
			if (pending.length < size + 4) break;
			let value: unknown;
			try {
				value = JSON.parse(pending.subarray(4, size + 4).toString('utf8'));
			} catch {
				throw protocolError();
			}
			pending = pending.subarray(size + 4);
			yield value;
		}
	}
	if (pending.length) throw protocolError();
}
export function send(socket: Socket, value: unknown): Promise<void> {
	const body = Buffer.from(JSON.stringify(value));
	if (body.length > FRAME_LIMIT) return Promise.reject(protocolError());
	const header = Buffer.alloc(4);
	header.writeUInt32BE(body.length);
	return new Promise((resolve, reject) =>
		socket.write(Buffer.concat([header, body]), error =>
			error
				? reject(new RecoveryTestError('database-target-preflight', 'mysql-worker-unavailable'))
				: resolve()
		)
	);
}
/** Refuse a second request AND release its slot even if its unread request data
 * keeps the peer's readable side paused. Otherwise maxConnections can stay full. */
export async function refuseBusy(socket: Socket) {
	socket.resume();
	try {
		await send(socket, {
			type: 'error',
			stage: 'database-target-preflight',
			code: 'mysql-worker-busy',
		});
		socket.end(() => socket.destroy());
	} catch {
		socket.destroy();
	}
}
