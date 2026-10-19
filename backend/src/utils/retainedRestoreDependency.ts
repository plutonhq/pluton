import { sql } from 'drizzle-orm';
import type { DatabaseType } from '../db';
import { AppError } from './AppError';

export class RetainedRestoreDependencyError extends AppError {
	readonly code = 'RETAINED_DATABASE_RESTORE_DEPENDENCY';
	constructor() {
		super(
			409,
			'Finish Database Restore Management cleanup before removing this source. Open /database-restores.'
		);
		Object.setPrototypeOf(this, RetainedRestoreDependencyError.prototype);
	}
}
export type RemovalSource = {
	planId?: string;
	backupId?: string;
	repositoryId?: string;
	snapshotId?: string;
};
// Same-process exclusion only. No authorization, lifecycle intent, or Resume sequence is created here.
const removals = new Set<RemovalSource>();
export function beginSourceRemoval(sources: RemovalSource[]) {
	for (const source of sources) removals.add(source);
	return () => {
		for (const source of sources) removals.delete(source);
	};
}
export function assertRestoreSourceNotRemoving(row: Required<RemovalSource>) {
	for (const source of removals)
		if (
			(source.planId && source.planId === row.planId) ||
			(source.backupId && source.backupId === row.backupId) ||
			(source.repositoryId &&
				source.repositoryId === row.repositoryId &&
				source.snapshotId === row.snapshotId)
		)
			throw new RetainedRestoreDependencyError();
}

/** Full snapshot AND repository binding also catches another backup record for the same snapshot. */
export function assertNoRetainedRestoreDependency(
	db: Pick<DatabaseType, 'get'>,
	source: RemovalSource
) {
	const selected = source.planId
		? sql`selected.plan_id = ${source.planId}`
		: sql`selected.id = ${source.backupId!}`;
	const direct = source.planId
		? sql`r.plan_id = ${source.planId}`
		: sql`r.backup_id = ${source.backupId!}`;
	const blocker = db.get(sql`SELECT 1 FROM persistent_database_restores r WHERE
		(${direct} OR EXISTS (SELECT 1 FROM backups selected WHERE ${selected} AND (
			selected.id = r.backup_id OR (
				length(r.snapshot_id)=64 AND json_valid(selected.completion_stats)
				AND json_extract(selected.completion_stats,'$.snapshot_id')=r.snapshot_id
				AND (EXISTS (SELECT 1 FROM remote_managed_repositories repo WHERE repo.id=r.repository_id AND repo.plan_id=selected.plan_id)
					OR EXISTS (SELECT 1 FROM backups original WHERE original.id=r.backup_id
						AND original.storage_id=selected.storage_id AND original.storage_path=selected.storage_path))
			))))
		AND (r.status!='deleted' OR r.cleanup!='verified'
			OR EXISTS (SELECT 1 FROM persistent_restore_import_leases lease WHERE lease.restore_id=r.id)
			OR EXISTS (SELECT 1 FROM automatic_recovery_lifecycle lifecycle WHERE lifecycle.id=r.id AND lifecycle.state!='removed')) LIMIT 1`);
	if (blocker) throw new RetainedRestoreDependencyError();
}
