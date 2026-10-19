import type Database from 'better-sqlite3';
import Cryptr from 'cryptr';
import crypto from 'crypto';
import type {
	DatabaseRestore,
	PersistentRestoreLease,
	PersistentTargetApproval,
} from '../types/databaseRestores';
import { DatabaseRestoreError } from '../utils/persistentRestorePolicy';
import {
	assertRestoreSourceNotRemoving,
	RetainedRestoreDependencyError,
} from '../utils/retainedRestoreDependency';

const columns = {
	status: 'status',
	stage: 'stage',
	cleanup: 'cleanup',
	startedAt: 'started_at',
	completedAt: 'completed_at',
	failureStage: 'failure_stage',
	failureCode: 'failure_code',
	expiresAt: 'expires_at',
	lastValidatedAt: 'last_validated_at',
	inspection: 'inspection',
	errorCode: 'error_code',
	cancelRequested: 'cancel_requested',
	database: 'database_name',
} as const;
type Changes = Partial<Pick<DatabaseRestore, keyof typeof columns>>;
type Stored = Record<string, unknown>;
export function approvalFingerprint(approval: PersistentTargetApproval) {
	const canonical = (value: unknown): unknown =>
		Array.isArray(value)
			? value.map(canonical)
			: value && typeof value === 'object'
				? Object.fromEntries(
						Object.entries(value)
							.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
							.map(([key, item]) => [key, canonical(item)])
					)
				: value;
	return crypto
		.createHash('sha256')
		.update(JSON.stringify(canonical(approval)))
		.digest('hex');
}
/** Separate history/ownership: no Phase 6 FK, lease table or cleanup method. */
export class DatabaseRestoreStore {
	private readonly cipher: Cryptr;
	constructor(
		private readonly sqlite: Database.Database,
		secret: string
	) {
		this.cipher = new Cryptr(secret);
	}
	private decode(raw?: Stored): DatabaseRestore | null {
		if (!raw) return null;
		const row: Record<string, unknown> = {};
		const mapping = {
			id: 'id',
			owner: 'owner',
			purpose: 'purpose',
			planId: 'plan_id',
			repositoryId: 'repository_id',
			backupId: 'backup_id',
			snapshotId: 'snapshot_id',
			databaseId: 'database_id',
			artifact: 'artifact',
			metadataToken: 'metadata_token',
			mode: 'mode',
			targetId: 'target_id',
			targetFingerprint: 'target_fingerprint',
			encryptedApproval: 'encrypted_approval',
			ownerToken: 'owner_token',
			createdAt: 'created_at',
			ttlSeconds: 'ttl_seconds',
			...columns,
		};
		for (const [key, column] of Object.entries(mapping)) row[key] = raw[column];
		row.artifact = JSON.parse(String(row.artifact));
		row.inspection = row.inspection ? JSON.parse(String(row.inspection)) : null;
		row.cancelRequested = !!row.cancelRequested;
		return row as unknown as DatabaseRestore;
	}
	get(id: string) {
		return this.decode(
			this.sqlite.prepare('SELECT * FROM persistent_database_restores WHERE id=?').get(id) as Stored
		);
	}
	list() {
		return (
			this.sqlite
				.prepare(
					"SELECT * FROM persistent_database_restores ORDER BY (status='deleted'),created_at DESC,id DESC LIMIT 200"
				)
				.all() as Stored[]
		).map(row => this.decode(row)!);
	}
	pending() {
		return (
			this.sqlite
				.prepare(
					`SELECT * FROM persistent_database_restores
					 WHERE status != 'deleted' OR EXISTS (
					   SELECT 1 FROM automatic_recovery_lifecycle AS lifecycle
					   WHERE lifecycle.id=persistent_database_restores.id AND lifecycle.mode='persistent'
					     AND lifecycle.state!='removed'
					 ) ORDER BY created_at LIMIT 200`
				)
				.all() as Stored[]
		).map(row => this.decode(row)!);
	}
	create(row: DatabaseRestore) {
		try {
			return this.sqlite
				.transaction(() => {
					assertRestoreSourceNotRemoving(row);
					if (
						!this.sqlite
							.prepare(
								`SELECT 1 FROM plans p JOIN backups b ON b.plan_id=p.id
						JOIN remote_managed_repositories repo ON repo.plan_id=p.id
						WHERE p.id=? AND b.id=? AND repo.id=? AND json_valid(b.completion_stats)
						AND json_extract(b.completion_stats,'$.snapshot_id')=?`
							)
							.get(row.planId, row.backupId, row.repositoryId, row.snapshotId)
					)
						throw new RetainedRestoreDependencyError();
					if (
						Number(
							(
								this.sqlite
									.prepare(
										"SELECT count(*) AS total FROM persistent_database_restores WHERE status!='deleted'"
									)
									.get() as { total: number }
							).total
						) >= 8
					)
						throw new DatabaseRestoreError('retained-restore-limit');
					this.sqlite
						.prepare(
							`INSERT INTO persistent_database_restores
				(id,owner,purpose,plan_id,repository_id,backup_id,snapshot_id,database_id,artifact,metadata_token,
				mode,target_id,owner_token,status,stage,cleanup,created_at,expires_at,ttl_seconds)
				VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
						)
						.run(
							row.id,
							row.owner,
							row.purpose,
							row.planId,
							row.repositoryId,
							row.backupId,
							row.snapshotId,
							row.databaseId,
							JSON.stringify(row.artifact),
							row.metadataToken,
							row.mode,
							row.targetId,
							row.ownerToken,
							row.status,
							row.stage,
							row.cleanup,
							row.createdAt,
							row.expiresAt,
							row.ttlSeconds
						);
					return this.get(row.id)!;
				})
				.immediate();
		} catch (error) {
			if (error instanceof DatabaseRestoreError || error instanceof RetainedRestoreDependencyError)
				throw error;
			throw new DatabaseRestoreError('target-already-reserved');
		}
	}
	update(id: string, changes: Changes) {
		const entries = Object.entries(changes).filter(
			([key, value]) => key in columns && value !== undefined
		);
		if (!entries.length) return this.get(id)!;
		this.sqlite
			.prepare(
				`UPDATE persistent_database_restores SET ${entries.map(([key]) => `${columns[key as keyof typeof columns]}=?`).join(',')} WHERE id=?`
			)
			.run(
				...entries.map(([key, value]) =>
					key === 'inspection' && value
						? JSON.stringify(value)
						: key === 'cancelRequested'
							? Number(value)
							: value
				),
				id
			);
		return this.get(id)!;
	}
	bind(id: string, approval: PersistentTargetApproval) {
		return this.sqlite
			.transaction(() => {
				const row = this.get(id);
				if (!row || row.targetId !== approval.id || row.mode !== approval.mode)
					throw new DatabaseRestoreError('target-binding-mismatch');
				const fingerprint = approvalFingerprint(approval);
				if (row.targetFingerprint && row.targetFingerprint !== fingerprint)
					throw new DatabaseRestoreError('target-activation-changed');
				if (!row.encryptedApproval)
					this.sqlite
						.prepare(
							`UPDATE persistent_database_restores SET target_fingerprint=?,encrypted_approval=? WHERE id=? AND encrypted_approval IS NULL`
						)
						.run(fingerprint, this.cipher.encrypt(JSON.stringify(approval)), id);
				return this.get(id)!;
			})
			.immediate();
	}
	approval(id: string): PersistentTargetApproval {
		try {
			const row = this.get(id);
			if (!row?.encryptedApproval) throw new Error();
			return JSON.parse(this.cipher.decrypt(row.encryptedApproval)) as PersistentTargetApproval;
		} catch {
			throw new DatabaseRestoreError('target-credentials-unavailable');
		}
	}
	/** Mutual exclusion is checked within the same SQLite write transaction as claim. */
	busy(exceptId = '') {
		return (
			!!this.sqlite.prepare("SELECT 1 FROM recovery_tests WHERE status='running' LIMIT 1").get() ||
			!!this.sqlite
				.prepare(
					"SELECT 1 FROM persistent_database_restores WHERE status IN ('importing','deleting') AND id!=? LIMIT 1"
				)
				.get(exceptId) ||
			!!this.sqlite.prepare('SELECT 1 FROM backups WHERE in_progress=1 LIMIT 1').get() ||
			!!this.sqlite.prepare('SELECT 1 FROM restores WHERE in_progress=1 LIMIT 1').get()
		);
	}
	assertNotSource(approval: PersistentTargetApproval) {
		const normalize = (value: string) =>
			value
				.toLowerCase()
				.replace(/\.$/, '')
				.replace(/^\[|\]$/g, '')
				.replace(/^(localhost|::1)$/, '127.0.0.1');
		for (const raw of this.sqlite.prepare('SELECT settings FROM plans').all() as {
			settings: string | null;
		}[]) {
			const lifecycle = JSON.parse(raw.settings || '{}').remoteLifecycle;
			const entries = lifecycle?.databases || (lifecycle?.database ? [lifecycle.database] : []);
			for (const entry of entries)
				if (
					typeof entry.host === 'string' &&
					normalize(entry.host) === normalize(approval.target.host) &&
					Number(entry.port || (entry.engine === 'postgresql' ? 5432 : 3306)) ===
						approval.target.port
				)
					throw new DatabaseRestoreError('source-database-target-refused');
		}
	}
	claim(id: string, cleanup = false) {
		return this.sqlite
			.transaction(() => {
				if (this.busy()) return null;
				const row = this.get(id);
				if (!row) return null;
				if (cleanup) {
					if (
						!['cleanup_required', 'expired', 'cancelled', 'failed', 'active', 'stopped'].includes(
							row.status
						) ||
						!row.cancelRequested
					)
						return null;
				} else if (row.status !== 'queued' || row.cancelRequested || row.expiresAt <= Date.now())
					return null;
				return this.update(id, {
					status: cleanup ? 'deleting' : 'importing',
					stage: cleanup ? 'database-cleanup' : 'snapshot-validation',
					startedAt: row.startedAt || Date.now(),
				});
			})
			.immediate();
	}
	lease(id: string): PersistentRestoreLease | null {
		const raw = this.sqlite
			.prepare('SELECT * FROM persistent_restore_import_leases WHERE restore_id=?')
			.get(id) as Stored | undefined;
		return raw
			? {
					restoreId: String(raw.restore_id),
					targetId: String(raw.target_id),
					database: String(raw.database_name),
					ownerToken: String(raw.owner_token),
					state: raw.state as PersistentRestoreLease['state'],
				}
			: null;
	}
	addLease(lease: PersistentRestoreLease) {
		const row = this.get(lease.restoreId);
		if (
			!row ||
			row.ownerToken !== lease.ownerToken ||
			row.targetId !== lease.targetId ||
			row.status !== 'importing' ||
			this.lease(row.id)
		)
			throw new DatabaseRestoreError('ownership-lease-unsafe');
		this.sqlite
			.prepare('INSERT INTO persistent_restore_import_leases VALUES (?,?,?,?,?)')
			.run(lease.restoreId, lease.targetId, lease.database, lease.ownerToken, lease.state);
		this.update(row.id, { database: lease.database });
	}
	leaseState(id: string, state: PersistentRestoreLease['state']) {
		this.sqlite
			.prepare('UPDATE persistent_restore_import_leases SET state=? WHERE restore_id=?')
			.run(state, id);
	}
	removeLease(id: string) {
		this.sqlite.prepare('DELETE FROM persistent_restore_import_leases WHERE restore_id=?').run(id);
	}
	finishDeleted(id: string) {
		if (this.lease(id)) throw new DatabaseRestoreError('ownership-lease-unsafe');
		this.sqlite
			.prepare(
				"UPDATE persistent_database_restores SET status='deleted',cleanup='verified',stage='deleted',last_validated_at=?,encrypted_approval=NULL,inspection=NULL WHERE id=?"
			)
			.run(Date.now(), id);
		return this.get(id)!;
	}
	requestDelete(id: string) {
		const row = this.get(id);
		if (!row || row.status === 'deleted') return row;
		if (row.cleanup === 'infrastructure_pending') return row; // Preserve verified database cleanup across repeated requests.
		return this.update(id, {
			cancelRequested: true,
			cleanup: 'requested',
			...(['importing', 'deleting'].includes(row.status) ? {} : { status: 'cleanup_required' }),
		});
	}
	recoverInterrupted() {
		this.sqlite
			.prepare(
				`UPDATE persistent_database_restores SET status='cleanup_required',cleanup='uncertain',
			cancel_requested=1,error_code='interrupted' WHERE status IN ('importing','deleting')`
			)
			.run();
	}
}
