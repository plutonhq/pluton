import type Database from 'better-sqlite3';
import { AppError } from '../utils/AppError';
import { assertReplicaNotPlanOwned } from '../utils/managedReplicationPolicy';

export type ManagedReplicationStatus =
	| 'pending'
	| 'running'
	| 'completed'
	| 'failed'
	| 'uncertain'
	| 'cancelled';
export type ManagedReplicationJob = {
	id: string;
	backupId: string;
	planId: string;
	repositoryId: string;
	agentId: string;
	sourceStorageId: string;
	sourceStoragePath: string;
	sourceSnapshotId: string;
	sourceRepositoryConfigId: string;
	sourceTreeId: string;
	sourceBindingHash: string;
	replicationId: string;
	destinationStorageId: string;
	destinationStoragePath: string;
	destinationFingerprint: string;
	destinationSnapshotId: string | null;
	status: ManagedReplicationStatus;
	ownerToken: string | null;
	attempts: number;
	lastErrorCode: string | null;
	createdAt: number;
	updatedAt: number;
	verifiedAt: number | null;
};
export type ManagedReplicationEnqueue = Omit<
	ManagedReplicationJob,
	| 'destinationSnapshotId'
	| 'status'
	| 'ownerToken'
	| 'attempts'
	| 'lastErrorCode'
	| 'updatedAt'
	| 'verifiedAt'
>;
export type ManagedReplicationDestination = {
	fingerprint: string;
	planId: string;
	replicationId: string;
	sourceRepositoryId: string;
	destinationStorageId: string;
	destinationStoragePath: string;
	destinationAuthority: string;
	destinationPrefix: string;
	initState: 'uninitialized' | 'initializing' | 'ready' | 'uncertain' | 'detached';
	actualRepositoryId: string | null;
	createdAt: number;
};
export type DestinationBinding = Omit<
	ManagedReplicationDestination,
	'fingerprint' | 'initState' | 'actualRepositoryId' | 'createdAt'
> & { destinationFingerprint: string };
const decode = <T>(raw: unknown): T | null =>
	raw
		? (Object.fromEntries(
				Object.entries(raw as object).map(([key, value]) => [
					key.replace(/_([a-z])/g, (_all, letter: string) => letter.toUpperCase()),
					value,
				])
			) as T)
		: null;
const busy = () =>
	new AppError(
		409,
		'Managed replication is pending, active or uncertain. Resolve it before changing or removing its resources.'
	);
const fullId = (value: string) => /^[a-f0-9]{64}$/.test(value);

/** SQLite CAS, immutable bindings and an execution slot shared by every process. No timed lease takeover. */
export class ManagedReplicationStore {
	constructor(private readonly sqlite: Database.Database) {}
	getById(id: string) {
		return decode<ManagedReplicationJob>(
			this.sqlite.prepare('SELECT * FROM managed_replication_jobs WHERE id=?').get(id)
		);
	}
	listByBackup(backupId: string) {
		return this.sqlite
			.prepare('SELECT * FROM managed_replication_jobs WHERE backup_id=? ORDER BY created_at,id')
			.all(backupId)
			.map(row => decode<ManagedReplicationJob>(row)!);
	}
	listRunnable() {
		return this.sqlite
			.prepare(
				"SELECT * FROM managed_replication_jobs WHERE status='pending' ORDER BY created_at,id LIMIT 100"
			)
			.all()
			.map(row => decode<ManagedReplicationJob>(row)!);
	}
	getDestination(fingerprint: string) {
		return decode<ManagedReplicationDestination>(
			this.sqlite
				.prepare('SELECT * FROM managed_replication_destinations WHERE fingerprint=?')
				.get(fingerprint)
		);
	}
	listDestinations() {
		return this.sqlite
			.prepare('SELECT * FROM managed_replication_destinations')
			.all()
			.map(row => decode<ManagedReplicationDestination>(row)!);
	}
	hasBlockingPlan(planId: string) {
		return !!this.sqlite
			.prepare(
				"SELECT 1 FROM managed_replication_jobs WHERE plan_id=? AND status IN ('pending','running','uncertain') LIMIT 1"
			)
			.get(planId);
	}
	hasBlockingBackup(backupId: string) {
		return !!this.sqlite
			.prepare(
				"SELECT 1 FROM managed_replication_jobs WHERE backup_id=? AND status IN ('pending','running','uncertain') LIMIT 1"
			)
			.get(backupId);
	}
	assertPlanIdle(planId: string) {
		if (this.hasBlockingPlan(planId)) throw busy();
	}
	assertBackupIdle(backupId: string) {
		if (this.hasBlockingBackup(backupId)) throw busy();
	}
	reserveDestination(binding: DestinationBinding): ManagedReplicationDestination {
		return this.sqlite
			.transaction(() => {
				assertReplicaNotPlanOwned(this.sqlite, { planId: binding.planId, authority: binding.destinationAuthority, prefix: binding.destinationPrefix });
				const old = this.getDestination(binding.destinationFingerprint);
				if (old) {
					if (
						old.planId !== binding.planId ||
						old.replicationId !== binding.replicationId ||
						old.sourceRepositoryId !== binding.sourceRepositoryId ||
						old.destinationStorageId !== binding.destinationStorageId ||
						old.destinationStoragePath !== binding.destinationStoragePath ||
						old.initState === 'detached'
					)
						throw new AppError(409, 'Replica repository ownership changed.');
					return old;
				}
				if (
					!fullId(binding.destinationFingerprint) ||
					!binding.destinationAuthority ||
					!binding.destinationPrefix ||
					binding.destinationPrefix.split('/').some(part => part === '..' || part === '')
				)
					throw new AppError(400, 'Invalid replica repository identity.');
				for (const other of this.listDestinations())
					if (
						other.destinationAuthority === binding.destinationAuthority &&
						(other.destinationPrefix === binding.destinationPrefix ||
							other.destinationPrefix.startsWith(binding.destinationPrefix + '/') ||
							binding.destinationPrefix.startsWith(other.destinationPrefix + '/'))
					)
						throw new AppError(
							409,
							'Replica repository prefix overlaps an existing or retained destination.'
						);
				this.sqlite
					.prepare(
						`INSERT INTO managed_replication_destinations(fingerprint,plan_id,replication_id,source_repository_id,destination_storage_id,destination_storage_path,destination_authority,destination_prefix,created_at) VALUES(?,?,?,?,?,?,?,?,?)`
					)
					.run(
						binding.destinationFingerprint,
						binding.planId,
						binding.replicationId,
						binding.sourceRepositoryId,
						binding.destinationStorageId,
						binding.destinationStoragePath,
						binding.destinationAuthority,
						binding.destinationPrefix,
						Date.now()
					);
				return this.getDestination(binding.destinationFingerprint)!;
			})
			.immediate();
	}
	enqueue(input: ManagedReplicationEnqueue): ManagedReplicationJob {
		return this.sqlite
			.transaction(() => {
				if (
					![
						input.sourceSnapshotId,
						input.sourceRepositoryConfigId,
						input.sourceTreeId,
						input.sourceBindingHash,
						input.destinationFingerprint,
					].every(fullId)
				)
					throw new AppError(
						409,
						'Replication requires verified full source and destination identity.'
					);
				const valid = this.sqlite
					.prepare(
						`SELECT 1 FROM backups b JOIN plans p ON p.id=b.plan_id JOIN remote_managed_repositories r ON r.plan_id=p.id JOIN agent_identities a ON a.agent_id=r.agent_id WHERE b.id=? AND p.id=? AND r.id=? AND r.agent_id=? AND a.device_id=p.source_id AND a.revoked_at IS NULL AND r.initialized_at IS NOT NULL AND p.storage_id=r.storage_id AND p.storage_path=r.storage_path AND p.method='backup' AND b.method='backup' AND p.source_type='device' AND b.source_type=p.source_type AND b.encryption=1 AND b.source_id=p.source_id AND b.storage_id=r.storage_id AND b.storage_path=r.storage_path AND r.storage_id=? AND r.storage_path=? AND b.status='completed' AND b.success=1 AND coalesce(b.in_progress,0)=0 AND json_valid(b.completion_stats) AND json_extract(b.completion_stats,'$.snapshot_id')=?`
					)
					.get(
						input.backupId,
						input.planId,
						input.repositoryId,
						input.agentId,
						input.sourceStorageId,
						input.sourceStoragePath,
						input.sourceSnapshotId
					);
				if (!valid) throw new AppError(409, 'Completed backup source binding is no longer valid.');
				const destination = this.getDestination(input.destinationFingerprint);
				if (
					!destination ||
					destination.planId !== input.planId ||
					destination.replicationId !== input.replicationId ||
					destination.initState === 'detached'
				)
					throw new AppError(409, 'Replica destination is not reserved for this plan.');
				const old = decode<ManagedReplicationJob>(
					this.sqlite
						.prepare(
							'SELECT * FROM managed_replication_jobs WHERE backup_id=? AND replication_id=?'
						)
						.get(input.backupId, input.replicationId)
				);
				if (old) {
					for (const key of Object.keys(input) as (keyof ManagedReplicationEnqueue)[])
						if (!['id', 'createdAt'].includes(key) && old[key] !== input[key])
							throw new AppError(409, 'Replication immutable binding changed.');
					return old;
				}
				const keys: (keyof ManagedReplicationEnqueue)[] = [
					'id',
					'backupId',
					'planId',
					'repositoryId',
					'agentId',
					'sourceStorageId',
					'sourceStoragePath',
					'sourceSnapshotId',
					'sourceRepositoryConfigId',
					'sourceTreeId',
					'sourceBindingHash',
					'replicationId',
					'destinationStorageId',
					'destinationStoragePath',
					'destinationFingerprint',
					'createdAt',
				];
				const columns = keys.map(key =>
					key.replace(/[A-Z]/g, letter => '_' + letter.toLowerCase())
				);
				this.sqlite
					.prepare(
						`INSERT INTO managed_replication_jobs(${columns.join(',')},updated_at) VALUES(${keys.map(() => '?').join(',')},?)`
					)
					.run(...keys.map(key => input[key as keyof ManagedReplicationEnqueue]), Date.now());
				return this.getById(input.id)!;
			})
			.immediate();
	}
	claim(id: string, ownerToken: string): ManagedReplicationJob | null {
		return this.sqlite
			.transaction(() => {
				if (!/^[a-f0-9]{48,64}$/.test(ownerToken))
					throw new AppError(400, 'Invalid executor token.');
				if (
					this.sqlite
						.prepare(
							"SELECT 1 FROM managed_replication_jobs WHERE status IN ('running','uncertain') LIMIT 1"
						)
						.get()
				)
					return null;
				const result = this.sqlite
					.prepare(
						"UPDATE managed_replication_jobs SET status='running',owner_token=?,attempts=attempts+1,updated_at=? WHERE id=? AND status='pending'"
					)
					.run(ownerToken, Date.now(), id);
				return result.changes ? this.getById(id) : null;
			})
			.immediate();
	}
	private owns(fingerprint: string, ownerToken: string) {
		return !!this.sqlite
			.prepare(
				"SELECT 1 FROM managed_replication_jobs WHERE destination_fingerprint=? AND owner_token=? AND status='running'"
			)
			.get(fingerprint, ownerToken);
	}
	beginInitialization(fingerprint: string, ownerToken: string): boolean {
		return this.sqlite
			.transaction(
				() =>
					this.owns(fingerprint, ownerToken) &&
					!!this.sqlite
						.prepare(
							"UPDATE managed_replication_destinations SET init_state='initializing' WHERE fingerprint=? AND init_state='uninitialized'"
						)
						.run(fingerprint).changes
			)
			.immediate();
	}
	finalizeInitialization(fingerprint: string, ownerToken: string, repositoryId: string): boolean {
		if (!fullId(repositoryId)) return false;
		return this.sqlite
			.transaction(
				() =>
					this.owns(fingerprint, ownerToken) &&
					!!this.sqlite
						.prepare(
							"UPDATE managed_replication_destinations SET init_state='ready',actual_repository_id=? WHERE fingerprint=? AND init_state='initializing'"
						)
						.run(repositoryId, fingerprint).changes
			)
			.immediate();
	}
	finish(
		id: string,
		ownerToken: string,
		result: {
			status: 'completed' | 'failed' | 'uncertain' | 'cancelled';
			destinationSnapshotId?: string;
			failureCode?: string;
			lastErrorCode?: string;
		}
	): boolean {
		if (result.status === 'completed' && !fullId(result.destinationSnapshotId || ''))
			throw new AppError(409, 'Replica completion requires an exact verified snapshot.');
		const code = result.failureCode || result.lastErrorCode || null;
		if (code && !/^[a-z][a-z0-9-]{0,79}$/.test(code))
			throw new AppError(400, 'Invalid replication failure category.');
		return !!this.sqlite
			.prepare(
				`UPDATE managed_replication_jobs SET status=?,destination_snapshot_id=?,last_error_code=?,verified_at=?,updated_at=?,owner_token=CASE WHEN ?='uncertain' THEN owner_token ELSE NULL END WHERE id=? AND owner_token=? AND status='running'`
			)
			.run(
				result.status,
				result.destinationSnapshotId || null,
				code,
				result.status === 'completed' ? Date.now() : null,
				Date.now(),
				result.status,
				id,
				ownerToken
			).changes;
	}
	retry(id: string): boolean {
		const job = this.getById(id);
		if (
			job?.status === 'uncertain' ||
			['initializing', 'uncertain', 'detached'].includes(
				this.getDestination(job?.destinationFingerprint || '')?.initState || ''
			)
		)
			throw new AppError(
				409,
				'Uncertain execution requires operator verification; automatic replay is refused.'
			);
		return !!this.sqlite
			.prepare(
				"UPDATE managed_replication_jobs SET status='pending',last_error_code=NULL,updated_at=? WHERE id=? AND status IN ('failed','cancelled')"
			)
			.run(Date.now(), id).changes;
	}
	cancelPending(id: string): boolean {
		return !!this.sqlite
			.prepare(
				"UPDATE managed_replication_jobs SET status='cancelled',last_error_code='cancelled',updated_at=? WHERE id=? AND status='pending'"
			)
			.run(Date.now(), id).changes;
	}
	/** No age/PID guess can prove a disconnected executor stopped. Retain the global slot. */
	markInterrupted(): number {
		return this.sqlite
			.prepare(
				"UPDATE managed_replication_jobs SET status='uncertain',last_error_code='execution-interrupted',updated_at=? WHERE status='running'"
			)
			.run(Date.now()).changes;
	}
	/** Small metadata-only batches; no hydration of historical SQL manifests. */
	completedBackupCandidates(limit = 10, afterId = ''): string[] {
		return this.sqlite
			.prepare(
				`SELECT b.id FROM backups b JOIN plans p ON p.id=b.plan_id WHERE b.id>? AND b.source_type='device' AND b.source_id!='main' AND b.status='completed' AND b.success=1 AND coalesce(b.in_progress,0)=0 AND json_valid(p.settings) AND json_extract(p.settings,'$.replication.enabled')=1 AND (SELECT count(*) FROM managed_replication_jobs j WHERE j.backup_id=b.id)<json_array_length(p.settings,'$.replication.storages')
		AND NOT EXISTS(SELECT 1 FROM json_each(CASE WHEN json_valid(b.mirrors) THEN b.mirrors ELSE '[]' END) m WHERE json_extract(m.value,'$.status')='failed' AND NOT EXISTS(SELECT 1 FROM managed_replication_jobs j WHERE j.backup_id=b.id AND j.replication_id=json_extract(m.value,'$.replicationId')))
		ORDER BY b.id LIMIT ?`
			)
			.all(afterId, Math.max(1, Math.min(25, limit)))
			.map(row => (row as { id: string }).id);
	}
	detach(planId: string, replicationId?: string): void {
		this.sqlite
			.transaction(() => {
				this.assertPlanIdle(planId);
				const condition = replicationId ? 'plan_id=? AND replication_id=?' : 'plan_id=?';
				this.sqlite
					.prepare(
						`UPDATE managed_replication_destinations SET init_state='detached' WHERE ${condition}`
					)
					.run(...(replicationId ? [planId, replicationId] : [planId]));
			})
			.immediate();
	}
}
