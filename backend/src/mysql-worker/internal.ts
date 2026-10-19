import crypto from 'crypto';
import fs from 'fs/promises';
import { constants } from 'fs';
import path from 'path';
import { z } from 'zod';
import {
	lifecycleBindingSchema,
	lifecycleReceiptSchema,
	lifecycleHash,
} from '../utils/automaticRecoveryLifecycle';
import { persistentApprovalBase, DatabaseRestoreError } from '../utils/persistentRestorePolicy';
import { RecoveryDatabaseImporter } from '../utils/recoveryDatabaseImport';
import { RecoveryTestError } from '../utils/recoveryValidation';
import type { RecoveryTarget } from '../types/recoveryTests';
import type { WorkerConfig, WorkerRequest } from './protocol';

const ROOT = '/run/pluton-mysql-internal';
export async function internalMysqlDirectoryReady() {
	try {
		const stat = await fs.lstat(ROOT);
		return (
			stat.isDirectory() &&
			!stat.isSymbolicLink() &&
			stat.uid === 0 &&
			stat.gid === 10001 &&
			(stat.mode & 0o777) === 0o750
		);
	} catch {
		return false;
	}
}
export const internalProofSchema = z
	.object({
		version: z.literal(1),
		binding: lifecycleBindingSchema,
		bindingHash: z.string().regex(/^[a-f0-9]{64}$/),
		approval: persistentApprovalBase.extend({
			purpose: z.enum(['pluton-persistent-database-restore-v1', 'pluton-phase6-recovery-only']),
		}),
	})
	.strict();

/** Worker receives ONLY this root-owned public mailbox/CA, never host private keys,
 * /data, Docker, mounts or repository credentials. Bounded, nonblocking no-follow IO. */
export async function readInternalProof(name: string, max: number): Promise<Buffer> {
	if (
		!/^(?:capacity\.json|[a-f0-9]{24}(?:\.mysql\.json|\.receipt\.json|-ca\.pem))$/.test(name) ||
		process.platform !== 'linux' ||
		process.getuid?.() !== 10001
	)
		throw new DatabaseRestoreError('target-binding-mismatch');
	for (let directory = ROOT; ; directory = path.dirname(directory)) {
		const stat = await fs.lstat(directory);
		if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== 0 || stat.mode & 0o022)
			throw new DatabaseRestoreError('target-binding-mismatch');
		if (directory === path.dirname(directory)) break;
	}
	const handle = await fs.open(
		path.join(ROOT, name),
		constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
	);
	try {
		const before = await handle.stat({ bigint: true });
		if (
			!before.isFile() ||
			before.uid !== 0n ||
			before.mode & 0o027n ||
			before.nlink !== 1n ||
			before.size > BigInt(max)
		)
			throw new Error();
		const buffer = Buffer.alloc(max + 1);
		let size = 0,
			count;
		do {
			count = (await handle.read(buffer, size, buffer.length - size, size)).bytesRead;
			size += count;
			if (size > max) throw new Error();
		} while (count);
		const after = await handle.stat({ bigint: true });
		if (
			BigInt(size) !== before.size ||
			before.size !== after.size ||
			before.ctimeNs !== after.ctimeNs ||
			before.mtimeNs !== after.mtimeNs
		)
			throw new Error();
		return buffer.subarray(0, size);
	} finally {
		await handle.close();
	}
}
const same = (a: unknown, b: unknown): boolean => {
	if (a === b) return true;
	if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
	const left = Object.keys(a).sort(),
		right = Object.keys(b).sort();
	return (
		left.join() === right.join() &&
		left.every(k => same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
	);
};
/** Read-only resource observation is separate from target authorization; it
 * never grants a new endpoint or owner. Required afresh only for Internal import. */
export async function assertInternalMysqlCapacity(read = readInternalProof, now = Date.now()) {
	try {
		const numeric = z.number().finite().nonnegative();
		const value = z
			.object({
				version: z.literal(1),
				observedAt: z.number().int().positive(),
				sample: z
					.object({
						total: numeric,
						available: numeric,
						swapUsed: numeric,
						cgroupSwap: numeric,
						pressure: numeric,
						cpuAvailable: numeric,
						diskAvailable: numeric,
					})
					.strict()
					.nullable(),
			})
			.strict()
			.parse(JSON.parse((await read('capacity.json', 2048)).toString()));
		const sample = value.sample;
		if (
			!sample ||
			value.observedAt < now - 30000 ||
			value.observedAt > now + 5000 ||
			sample.total < 3800 * 1024 ** 2 ||
			sample.available < 2944 * 1024 ** 2 ||
			sample.swapUsed > 128 * 1024 ** 2 ||
			sample.cgroupSwap > 0 ||
			sample.pressure > 1 ||
			sample.cpuAvailable < 2 ||
			sample.diskAvailable < 1024 ** 3
		)
			throw new Error();
	} catch {
		throw new RecoveryTestError('database-import', 'internal-resources-insufficient');
	}
}
/** Independently bind ALL authority to root proof; caller-supplied endpoints can
 * never grant new egress. Old Custom configuration does not grant Internal access. */
export async function authorizeInternalMysql(
	input: Exclude<WorkerRequest, { operation: 'capabilities' }>,
	config: WorkerConfig,
	read = readInternalProof,
	now = Date.now()
) {
	if (!input.internal || !config.internal?.enabled)
		throw new DatabaseRestoreError('target-binding-mismatch');
	try {
		const { id, snapshotId } = input.internal;
		const proof = internalProofSchema.parse(
			JSON.parse((await read(id + '.mysql.json', 16384)).toString())
		);
		const { binding, approval } = proof;
		const receipt = lifecycleReceiptSchema.parse(
			JSON.parse((await read(id + '.receipt.json', 2048)).toString())
		);
		const persistent = input.operation.startsWith('persistent-');
		const cleanup = ['cleanup', 'verify-empty', 'persistent-cleanup'].includes(input.operation);
		if (
			binding.id !== id ||
			binding.engine !== 'mysql' ||
			binding.snapshotId !== snapshotId ||
			binding.mode !== (persistent ? 'persistent' : 'disposable') ||
			binding.createdAt > now + 5000 ||
			(!cleanup && binding.expiresAt <= now) ||
			binding.expiresAt <= binding.createdAt ||
			receipt.id !== id ||
			receipt.bindingHash !== proof.bindingHash ||
			receipt.state !== 'ready' ||
			receipt.observedAt > now + 5000 ||
			receipt.observedAt < now - 30000 ||
			approval.id !== id ||
			approval.mode !== 'internal' ||
			approval.engine !== 'mysql' ||
			approval.target.engine !== 'mysql' ||
			!approval.target.password ||
			approval.purpose !==
				(persistent ? 'pluton-persistent-database-restore-v1' : 'pluton-phase6-recovery-only') ||
			approval.target.host !== 'persistent-db-' + id ||
			approval.target.port !== 3306 ||
			approval.target.username !== 'restore_user' ||
			approval.storage.kind !== 'fixed-ext4' ||
			approval.storage.quotaBytes !== 2147483648 ||
			approval.binding?.restoreId !== id ||
			approval.binding.snapshotId !== snapshotId ||
			approval.binding.sha256 !== binding.artifacts[0].sha256 ||
			!approval.containerId ||
			binding.artifacts.reduce((n, a) => n + a.bytes, 0) >
				Math.min(approval.maxSqlBytes, config.internal.maxArtifactBytes) ||
			new Set(binding.artifacts.map(a => a.database)).size !== binding.artifacts.length
		)
			throw new Error();
		const ca = await read(id + '-ca.pem', 16384);
		if (crypto.createHash('sha256').update(ca).digest('hex') !== approval.caSha256)
			throw new Error();
		if ('context' in input) {
			if (
				binding.artifacts.length !== 1 ||
				!same(input.approval, approval) ||
				input.context.id !== id ||
				input.context.targetId !== id ||
				lifecycleHash(binding, input.context.ownerToken) !== proof.bindingHash ||
				input.context.databaseId !== binding.artifacts[0].databaseId ||
				input.context.mode !== 'internal' ||
				input.context.snapshotId !== snapshotId ||
				input.context.expiresAt !== binding.expiresAt ||
				!binding.artifacts.some(
					a =>
						a.database === input.context.artifact.database &&
						a.bytes === input.context.artifact.bytes &&
						a.sha256 === input.context.artifact.sha256
				)
			)
				throw new Error();
		} else {
			const testId = 'lease' in input ? input.lease.testId : input.testId;
			const targetId = 'lease' in input ? input.lease.targetId : input.targetId;
			if (
				testId !== id ||
				!/^irt_[a-f0-9]{24}$/.test(targetId) ||
				!same(input.target, approval.target)
			)
				throw new Error();
			if (
				input.operation === 'import' &&
				(!same(
					input.allowedDatabases,
					binding.artifacts.map(a => a.database)
				) ||
					!binding.artifacts.some(
						a =>
							a.databaseId === input.entry.databaseId &&
							a.database === input.entry.database &&
							a.bytes === input.entry.bytes &&
							a.sha256 === input.entry.sha256
					))
			)
				throw new Error();
			if (
				input.operation === 'cleanup' &&
				!binding.artifacts.some(a => a.database === input.lease.database)
			)
				throw new Error();
		}
		return {
			approval,
			ca: path.join(ROOT, id + '-ca.pem'),
			config: {
				...config,
				host: approval.target.host,
				port: 3306,
				username: approval.target.username,
				databases: binding.artifacts.map(a => a.database),
				maxArtifactBytes: config.internal.maxArtifactBytes,
				persistent: persistent
					? {
							targetId: id,
							activationId: approval.activationId,
							storageId: approval.storage.id,
							host: approval.target.host,
							port: 3306,
							username: approval.target.username,
							database: approval.database,
							maxArtifactBytes: config.internal.maxArtifactBytes,
						}
					: undefined,
			},
		};
	} catch {
		throw new DatabaseRestoreError('target-binding-mismatch');
	}
}

/** SQL guard verifies the root activation/storage, not only its static purpose. */
export class InternalMysqlRecoveryImporter extends RecoveryDatabaseImporter {
	constructor(
		store: ConstructorParameters<typeof RecoveryDatabaseImporter>[0],
		run: ConstructorParameters<typeof RecoveryDatabaseImporter>[1],
		client: ConstructorParameters<typeof RecoveryDatabaseImporter>[2],
		trust: ConstructorParameters<typeof RecoveryDatabaseImporter>[3],
		private readonly proof: { activationId: string; storage: { id: string } }
	) {
		super(store, run, client, trust);
	}
	protected override async connection(
		target: RecoveryTarget,
		directory: string,
		signal: AbortSignal
	) {
		const connection = await super.connection(target, directory, signal);
		try {
			const guard = await connection.query(
				'pluton_recovery_guard',
				'SELECT purpose,activation_id,storage_id FROM pluton_recovery_guard;',
				'database-target-preflight'
			);
			if (
				guard.trim() !==
				['pluton-phase6-recovery-only', this.proof.activationId, this.proof.storage.id].join('\t')
			)
				throw new RecoveryTestError('database-target-preflight', 'recovery-target-unsafe');
			return connection;
		} catch (error) {
			await connection.close();
			throw error;
		}
	}
}
