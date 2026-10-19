import crypto from 'crypto';
import Cryptr from 'cryptr';
import type { Plan, NewPlan } from '../db/schema/plans';
import type { Storage } from '../db/schema/storages';
import { BackupStore } from '../stores/BackupStore';
import { PlanStore } from '../stores/PlanStore';
import { AgentStore } from '../stores/AgentStore';
import { StorageStore } from '../stores/StorageStore';
import { RemoteManagedRepositoryStore } from '../stores/RemoteManagedRepositoryStore';
import {
	ManagedReplicationStore,
	type ManagedReplicationJob,
} from '../stores/ManagedReplicationStore';
import { configService } from './ConfigService';
import { AppError } from '../utils/AppError';
import {
	canonicalS3RepositoryIdentity,
	storageRcloneOptions,
	trustEnvironment,
	isHcpMode,
} from '../utils/storageSecurity';
import {
	ManagedReplicationExecutor,
	ManagedReplicationError,
	type ManagedReplicationExecutorContract,
	type ReplicationSource,
} from '../utils/restic/ManagedReplicationExecutor';
import { fullSnapshotId } from '../utils/restic/ManagedSftpRepositorySession';
import { lifecycleDatabases, parseRemoteLifecycle } from '../utils/remoteLifecycle';
import type { BackupMirror } from '../types/backups';

export interface ManagedReplicationCompletionHook {
	validatePlan(plan: Plan | NewPlan): Promise<void>;
	enqueueBackup(backupId: string): Promise<void>;
}

/** Server-side only: no replica credentials or commands are sent to an Agent. */
export class ManagedReplicationService implements ManagedReplicationCompletionHook {
	private readonly active = new Map<string, AbortController>();
	private ticking?: Promise<void>;
	private stopping = false;
	private readonly admissions = new Map<
		string,
		{ controller: AbortController; done: Promise<void> }
	>();
	constructor(
		private readonly jobs: ManagedReplicationStore,
		private readonly backups: BackupStore,
		private readonly plans: PlanStore,
		private readonly repositories: RemoteManagedRepositoryStore,
		private readonly agents: AgentStore,
		private readonly storages: StorageStore,
		private readonly remoteBackups: {
			getSftpRecoveryOptions(storageId: string): Promise<Record<string, string>>;
		},
		private readonly executor: ManagedReplicationExecutorContract = new ManagedReplicationExecutor(),
		private readonly secret = configService.config.SECRET
	) {}

	async validatePlan(plan: Plan | NewPlan): Promise<void> {
		const replication = plan.settings.replication;
		if (!replication) return;
		if (!Array.isArray(replication.storages) || replication.storages.length > 2)
			throw new AppError(400, 'Managed Agent plans support at most two replica destinations.');
		if (!replication.enabled) return;
		if (replication.storages.length < 1)
			throw new AppError(400, 'Select one or two replica destinations.');
		if (replication.concurrent === true)
			throw new AppError(
				400,
				'Managed Agent replicas run sequentially within the shared resource limit.'
			);
		const identities: ReturnType<typeof canonicalS3RepositoryIdentity>[] = [];
		const ids = new Set<string>();
		for (const replica of replication.storages) {
			if (
				!/^[A-Za-z0-9_-]+$/.test(replica.replicationId) ||
				ids.has(replica.replicationId) ||
				replica.storageId === plan.storageId
			)
				throw new AppError(400, 'Replica identities and primary storage must be distinct.');
			ids.add(replica.replicationId);
			const storage = await this.storages.getById(replica.storageId);
			if (!storage || !['s3', 's3compatible'].includes(storage.type || ''))
				throw new AppError(
					400,
					'Managed Agent replication requires an HTTPS S3-compatible destination.'
				);
			this.destinationOptions(storage); // decrypt/allowlist validation stays server side
			const identity = canonicalS3RepositoryIdentity(storage, replica.storagePath);
			if (identities.some(other => this.overlaps(identity, other)))
				throw new AppError(409, 'Replica repository prefixes overlap.');
			identities.push(identity);
		}
		// Compare actual endpoint/bucket identities, not merely storage record IDs.
		for (const other of (await this.plans.getAll(false)) || []) {
			if (other.id === plan.id) continue;
			const references = [
				{ storageId: other.storageId, storagePath: other.storagePath },
				...(other.settings.replication?.storages || []),
			];
			for (const reference of references) {
				if (!reference.storageId || !reference.storagePath) continue;
				const storage = await this.storages.getById(reference.storageId);
				if (!storage || !['s3', 's3compatible'].includes(storage.type || '')) continue;
				const existing = canonicalS3RepositoryIdentity(storage, reference.storagePath);
				if (identities.some(identity => this.overlaps(identity, existing)))
					throw new AppError(409, 'Replica repository overlaps another plan.');
			}
		}
	}

	/** A startup rescan closes the completion-to-enqueue crash window. */
	async rescanCompleted(): Promise<void> {
		for (const id of this.jobs.completedBackupCandidates(10)) await this.enqueueBackup(id);
	}

	enqueueBackup(backupId: string): Promise<void> {
		if (this.stopping) return Promise.resolve();
		const existing = this.admissions.get(backupId);
		if (existing) return existing.done;
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort('timeout'), 30 * 60_000);
		timer.unref();
		const done = this.admitBackup(backupId, controller.signal).finally(() => {
			clearTimeout(timer);
			this.admissions.delete(backupId);
		});
		this.admissions.set(backupId, { controller, done });
		return done;
	}

	private async admitBackup(backupId: string, signal: AbortSignal): Promise<void> {
		const backup = await this.backups.getById(backupId);
		if (!backup?.planId) return;
		const plan = await this.plans.getById(backup.planId);
		if (!plan?.settings.replication?.enabled) return;
		try {
			await this.validatePlan(plan);
			const context = await this.source(backupId);
			const existing = await this.jobs.listByBackup(backupId);
			const missing = plan.settings.replication.storages.filter(
				replica => !existing.some(job => job.replicationId === replica.replicationId)
			);
			if (!missing.length) {
				await this.project(backupId);
				return;
			}
			const proof = await this.executor.inspectSource(context.source, signal);
			if (signal.aborted) throw new ManagedReplicationError('cancelled');
			for (const replica of missing) {
				const storage = await this.storages.getById(replica.storageId);
				if (!storage) throw new ManagedReplicationError('destination-unavailable');
				const identity = canonicalS3RepositoryIdentity(storage, replica.storagePath);
				await this.jobs.reserveDestination({
					destinationFingerprint: identity.fingerprint,
					planId: plan.id,
					replicationId: replica.replicationId,
					sourceRepositoryId: context.repository.id,
					destinationStorageId: storage.id,
					destinationStoragePath: replica.storagePath,
					destinationAuthority: identity.authority,
					destinationPrefix: identity.prefix,
				});
				await this.jobs.enqueue({
					id: `managed-replication-${crypto.createHash('sha256').update(`${backupId}\0${replica.replicationId}`).digest('hex')}`,
					backupId,
					planId: plan.id,
					repositoryId: context.repository.id,
					agentId: context.repository.agentId,
					sourceStorageId: context.repository.storageId,
					sourceStoragePath: context.repository.storagePath,
					sourceSnapshotId: context.source.snapshotId,
					sourceRepositoryConfigId: proof.repositoryConfigId,
					sourceTreeId: proof.snapshot.tree,
					sourceBindingHash: context.bindingHash,
					replicationId: replica.replicationId,
					destinationStorageId: storage.id,
					destinationStoragePath: replica.storagePath,
					destinationFingerprint: identity.fingerprint,
					createdAt: Date.now(),
				});
			}
			await this.project(backupId);
		} catch (error) {
			const code = this.code(error);
			const durable = await this.jobs.listByBackup(backupId);
			if (durable.length) await this.project(backupId, code);
			else
				await this.backups.update(backupId, {
					mirrors: plan.settings.replication.storages.map(replica => ({
						...replica,
						status: 'failed' as const,
						error: `Replication admission failed (${code}).`,
						lastErrorCode: code,
					})),
				});
		}
	}

	/** Durable claims serialize processes; running/uncertain claims never expire. */
	tick(): Promise<void> {
		if (this.stopping) return Promise.resolve();
		if (this.ticking) return this.ticking;
		this.ticking = this.runTick().finally(() => {
			this.ticking = undefined;
		});
		return this.ticking;
	}

	private async runTick(): Promise<void> {
		for (const pending of await this.jobs.listRunnable()) {
			if (this.stopping) break;
			const token = crypto.randomBytes(32).toString('hex');
			const job = await this.jobs.claim(pending.id, token);
			if (!job) continue;
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort('timeout'), 30 * 60_000);
			timer.unref();
			this.active.set(job.id, controller);
			await this.project(job.backupId);
			try {
				const context = await this.source(job.backupId);
				if (
					context.bindingHash !== job.sourceBindingHash ||
					context.repository.id !== job.repositoryId ||
					context.repository.agentId !== job.agentId ||
					context.repository.storageId !== job.sourceStorageId ||
					context.repository.storagePath !== job.sourceStoragePath ||
					context.source.snapshotId !== job.sourceSnapshotId
				)
					throw new ManagedReplicationError('source-binding-changed');
				const replica = context.plan.settings.replication?.storages.find(
					item => item.replicationId === job.replicationId
				);
				if (
					!context.plan.settings.replication?.enabled ||
					!replica ||
					replica.storageId !== job.destinationStorageId ||
					replica.storagePath !== job.destinationStoragePath
				)
					throw new ManagedReplicationError('destination-binding-changed');
				const storage = await this.storages.getById(job.destinationStorageId);
				if (
					!storage ||
					canonicalS3RepositoryIdentity(storage, job.destinationStoragePath).fingerprint !==
						job.destinationFingerprint
				)
					throw new ManagedReplicationError('destination-binding-changed');
				const destination = await this.jobs.getDestination(job.destinationFingerprint);
				if (!destination || destination.initState === 'detached')
					throw new ManagedReplicationError('destination-unowned');
				const proof = await this.executor.inspectSource(context.source, controller.signal);
				if (
					proof.repositoryConfigId !== job.sourceRepositoryConfigId ||
					proof.snapshot.tree !== job.sourceTreeId
				)
					throw new ManagedReplicationError('source-binding-changed');
				const copied = await this.executor.copy({
					source: context.source,
					proof,
					signal: controller.signal,
					destination: {
						options: this.destinationOptions(storage),
						repositoryPath: job.destinationStoragePath,
						environment: trustEnvironment(),
					},
					state: {
						repositoryConfigId: destination.actualRepositoryId,
						initialization: destination.initState,
					},
					beginInitialization: async () => {
						if (!(await this.jobs.beginInitialization(job.destinationFingerprint, token)))
							throw new ManagedReplicationError('claim-lost');
					},
					bindRepository: async id => {
						if (!(await this.jobs.finalizeInitialization(job.destinationFingerprint, token, id)))
							throw new ManagedReplicationError('claim-lost');
					},
				});
				await this.jobs.finish(job.id, token, {
					status: 'completed',
					destinationSnapshotId: copied.snapshotId,
				});
			} catch (error) {
				const failure = this.code(error);
				// A timeout cannot prove termination: retain the durable fence when the
				// executor cannot establish that every child has actually stopped.
				const code = ['claim-lost', 'execution-uncertain'].includes(failure)
					? failure
					: controller.signal.reason === 'timeout'
						? 'timeout'
						: failure;
				const destination = await this.jobs.getDestination(job.destinationFingerprint);
				await this.jobs.finish(job.id, token, {
					status:
						destination?.initState === 'initializing' ||
						['claim-lost', 'execution-uncertain'].includes(code)
							? 'uncertain'
							: controller.signal.aborted && code !== 'timeout'
								? 'cancelled'
								: 'failed',
					failureCode: code,
				});
			} finally {
				clearTimeout(timer);
				this.active.delete(job.id);
				await this.project(job.backupId);
			}
		}
	}

	async retryFailed(backupId: string, replicationId?: string): Promise<void> {
		const rows = (await this.jobs.listByBackup(backupId)).filter(
			row => replicationId === undefined || row.replicationId === replicationId
		);
		const backup = await this.backups.getById(backupId);
		const plan = backup?.planId ? await this.plans.getById(backup.planId) : null;
		const missing =
			plan?.settings.replication?.storages.filter(
				replica =>
					(replicationId === undefined || replica.replicationId === replicationId) &&
					!rows.some(row => row.replicationId === replica.replicationId)
			) || [];
		if (rows.some(row => row.status === 'uncertain' || row.status === 'running'))
			throw new AppError(409, 'Uncertain or active replication cannot be replayed.');
		let retried = false;
		if (missing.length || !rows.length) {
			await this.enqueueBackup(backupId);
			retried = (await this.jobs.listByBackup(backupId)).some(
				row =>
					row.status === 'pending' &&
					(replicationId === undefined || row.replicationId === replicationId)
			);
			if (!rows.length && !retried)
				throw new AppError(
					409,
					'Replication admission remains refused. Check the source and destination bindings.'
				);
		}
		for (const row of rows)
			if (['failed', 'cancelled'].includes(row.status))
				retried = (await this.jobs.retry(row.id)) || retried;
		if (!retried) throw new AppError(409, 'Only failed or cancelled replication can be retried.');
		await this.project(backupId);
	}
	async recoverInterrupted(): Promise<void> {
		this.jobs.markInterrupted();
	}
	async shutdown(): Promise<void> {
		this.stopping = true;
		for (const admission of this.admissions.values()) admission.controller.abort();
		for (const controller of this.active.values()) controller.abort();
		await Promise.allSettled([
			...(this.ticking ? [this.ticking] : []),
			...[...this.admissions.values()].map(admission => admission.done),
		]);
	}
	async cancel(id: string): Promise<void> {
		const active = this.active.get(id);
		if (!active) throw new AppError(409, 'This executor does not own the running replication.');
		active.abort();
	}

	private async source(backupId: string) {
		const backup = await this.backups.getById(backupId);
		if (
			!backup?.planId ||
			backup.status !== 'completed' ||
			backup.inProgress ||
			backup.success !== true ||
			backup.method !== 'backup' ||
			backup.sourceId === 'main' ||
			backup.sourceType !== 'device'
		)
			throw new ManagedReplicationError('backup-not-completed');
		const plan = await this.plans.getById(backup.planId);
		const repository = await this.repositories.getByPlanId(backup.planId);
		const agent = repository ? await this.agents.getAgentById(repository.agentId) : null;
		if (
			!plan ||
			!repository?.initializedAt ||
			!agent ||
			agent.revokedAt ||
			agent.deviceId !== backup.sourceId ||
			plan.sourceId !== backup.sourceId ||
			plan.sourceType !== backup.sourceType ||
			plan.method !== 'backup' ||
			repository.planId !== plan.id ||
			plan.storageId !== repository.storageId ||
			backup.storageId !== repository.storageId ||
			plan.storagePath !== repository.storagePath ||
			backup.storagePath !== repository.storagePath ||
			backup.encryption !== true
		)
			throw new ManagedReplicationError('source-binding-mismatch');
		const snapshotId = backup.completionStats?.snapshot_id;
		if (!fullSnapshotId.safeParse(snapshotId).success)
			throw new ManagedReplicationError('snapshot-id-incomplete');
		const lifecycle = backup.completionStats?.lifecycle;
		const configured = plan.settings.remoteLifecycle
			? lifecycleDatabases(parseRemoteLifecycle(plan.settings.remoteLifecycle))
			: [];
		const artifacts = lifecycle?.databases || (lifecycle?.database ? [lifecycle.database] : []);
		if (
			configured.length !== artifacts.length ||
			configured.some(
				item =>
					!artifacts.some(
						artifact =>
							artifact.path === `/pluton/database/${item.dumpFilename}` &&
							artifact.bytes > 0 &&
							artifact.bytes <= item.maxDumpBytes
					)
			)
		)
			throw new ManagedReplicationError('artifact-binding-mismatch');
		if (
			lifecycle?.databases &&
			configured.some(
				item =>
					!lifecycle.databases!.some(
						artifact =>
							artifact.databaseId === item.databaseId &&
							artifact.engine === item.engine &&
							artifact.database === item.database
					)
			)
		)
			throw new ManagedReplicationError('artifact-binding-mismatch');
		let password: string;
		try {
			password = new Cryptr(this.secret).decrypt(repository.encryptedPassword);
		} catch {
			throw new ManagedReplicationError('credentials-unavailable');
		}
		const source: ReplicationSource = {
			access: {
				options: await this.remoteBackups.getSftpRecoveryOptions(repository.storageId),
				repositoryPath: repository.storagePath,
				password,
			},
			planId: plan.id,
			backupId,
			snapshotId: snapshotId!,
			artifacts,
		};
		const bindingHash = crypto
			.createHash('sha256')
			.update(
				JSON.stringify({
					snapshotId,
					sourceId: backup.sourceId,
					sourceType: backup.sourceType,
					sourcePaths: backup.completionStats?.sourcePaths || backup.sourceConfig?.includes || [],
					lifecycle,
				})
			)
			.digest('hex');
		return { source, repository, plan, backup, bindingHash };
	}

	private async project(backupId: string, admissionFailureCode?: string) {
		const rows = await this.jobs.listByBackup(backupId);
		const backup = await this.backups.getById(backupId);
		const plan = backup?.planId ? await this.plans.getById(backup.planId) : null;
		const mirrors: BackupMirror[] = [];
		for (const row of rows) {
			const storage = await this.storages.getById(row.destinationStorageId);
			mirrors.push({
				replicationId: row.replicationId,
				storageId: row.destinationStorageId,
				storageName: storage?.name || 'Unavailable storage',
				storageType: storage?.type || 's3compatible',
				storagePath: row.destinationStoragePath,
				status:
					row.status === 'running'
						? 'started'
						: row.status === 'uncertain' || row.status === 'cancelled'
							? 'failed'
							: row.status,
				...(row.lastErrorCode
					? { error: `Replication needs attention (${row.lastErrorCode}).` }
					: {}),
				...this.details(row),
			});
		}
		for (const replica of plan?.settings.replication?.storages || []) {
			if (rows.some(row => row.replicationId === replica.replicationId)) continue;
			const previous = backup?.mirrors?.find(
				mirror =>
					mirror.replicationId === replica.replicationId &&
					mirror.storageId === replica.storageId &&
					mirror.storagePath === replica.storagePath
			);
			mirrors.push(
				admissionFailureCode
					? {
							...replica,
							status: 'failed',
							error: `Replication admission failed (${admissionFailureCode}).`,
							lastErrorCode: admissionFailureCode,
						}
					: previous || { ...replica, status: 'pending' }
			);
		}
		await this.backups.update(backupId, { mirrors });
	}
	private details(row: ManagedReplicationJob) {
		return {
			sourceSnapshotId: row.sourceSnapshotId,
			snapshotId: row.destinationSnapshotId,
			attempts: row.attempts,
			lastErrorCode: row.lastErrorCode,
			verifiedAt: row.verifiedAt,
		};
	}
	private destinationOptions(storage: Storage): Record<string, string> {
		const options = storageRcloneOptions(storage);
		const hostname = new URL(options.endpoint).hostname;
		const awsEndpoint = /^(?:s3|s3[.-][a-z0-9-]+)\.amazonaws\.com(?:\.cn)?$/.test(hostname);
		if ((storage.type === 's3compatible' || !awsEndpoint) && !isHcpMode(storage.settings))
			throw new AppError(
				400,
				'Enable protected HCP / pre-existing namespace mode before using this managed replica.'
			);
		return options;
	}
	private overlaps(
		a: { authority: string; prefix: string },
		b: { authority: string; prefix: string }
	) {
		return (
			a.authority === b.authority &&
			(a.prefix === b.prefix ||
				a.prefix.startsWith(`${b.prefix}/`) ||
				b.prefix.startsWith(`${a.prefix}/`))
		);
	}
	private code(error: unknown) {
		return error instanceof ManagedReplicationError
			? error.code
			: error instanceof AppError
				? `admission-${error.statusCode}`
				: 'execution-failed';
	}
}
