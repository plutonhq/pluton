import type { Backup } from '../db/schema/backups';
import type { BackupProgressStats } from '../types/backups';

export const remoteBackupStages = [
	'preparing-backup',
	'validating-source',
	'preparing-storage',
	'checking-existing-snapshot',
	'preparing-database',
	'pre-backup',
	'dumping-database',
	'preparing-repository',
	'backing-up',
	'verifying-snapshot',
	'post-backup',
	'cleanup',
] as const;
export type RemoteProgressEvent = {
	phase?: string;
	backupStage?: string;
	lifecycleStage?: string;
	databaseId?: string;
	engine?: 'mysql' | 'mariadb' | 'postgresql';
	ordinal?: number;
	count?: number;
	progress?: {
		bytesProcessed?: number;
		filesProcessed?: number;
		totalBytesProcessed?: number;
		totalFilesProcessed?: number;
	};
};
const legacyStages: Record<string, string> = {
	'pre-backup-started': 'pre-backup',
	'database-dump-started': 'dumping-database',
	'database-dump-completed': 'dumping-database',
	'backup-started': 'backing-up',
	'backup-completed': 'verifying-snapshot',
	'post-backup-started': 'post-backup',
	'cleanup-completed': 'cleanup',
	'cleanup-warning': 'cleanup',
};
const terminal = new Set(['completed', 'failed', 'cancelled']);
const number = (value?: number) =>
	typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;

/** Called in a database transaction, with the latest row, never a pre-await copy. */
export function mergeRemoteProgress(
	backup: Backup,
	commandId: string,
	attempt: number,
	sequence: number,
	event: RemoteProgressEvent
): Partial<Backup> | null {
	if (!backup.inProgress || terminal.has(backup.status || '')) return null;
	const previous = backup.progressStats;
	if (previous?.remoteCommandId && previous.remoteCommandId !== commandId) return null;
	if ((previous?.remoteAttempt || 0) > attempt) return null;
	const retry = attempt > (previous?.remoteAttempt || 0);
	if (!retry && (previous?.remoteEventSequence || 0) >= sequence) return null;
	const current = retry ? undefined : previous;
	const stage =
		event.backupStage || (event.lifecycleStage ? legacyStages[event.lifecycleStage] : undefined);
	const rank = (value?: string) =>
		remoteBackupStages.indexOf(value as (typeof remoteBackupStages)[number]);
	const progressStats: BackupProgressStats = {
		...current,
		remoteCommandId: commandId,
		remoteAttempt: attempt,
		remoteEventSequence: sequence,
		bytesProcessed: Math.max(
			number(current?.bytesProcessed),
			number(event.progress?.bytesProcessed)
		),
		filesProcessed: Math.max(
			number(current?.filesProcessed),
			number(event.progress?.filesProcessed)
		),
		total_bytes_processed: Math.max(
			number(current?.total_bytes_processed),
			number(event.progress?.totalBytesProcessed)
		),
		total_files_processed: Math.max(
			number(current?.total_files_processed),
			number(event.progress?.totalFilesProcessed)
		),
		...(rank(stage) >= 0 && rank(stage) >= rank(current?.backupStage)
			? { backupStage: stage }
			: {}),
		...(event.lifecycleStage ? { lifecycleStage: event.lifecycleStage } : {}),
		...(event.databaseId
			? {
					databaseId: event.databaseId,
					databaseEngine: event.engine,
					databaseOrdinal: event.ordinal,
					databaseCount: event.count,
				}
			: {}),
	};
	return {
		status:
			event.phase === 'accepted' && (retry || backup.status === 'queued') ? 'queued' : 'started',
		progressStats,
	};
}

/** Durable latest-state projection into the existing UI envelope; not a fabricated event history. */
export function projectRemoteProgress(backup: Backup) {
	const stats = backup.progressStats;
	const finished = terminal.has(backup.status || '');
	const successful = backup.status === 'completed';
	return {
		...stats,
		remote: true,
		planId: backup.planId,
		backupId: backup.id,
		status: backup.status,
		startTime: (backup.started || backup.createdAt).toISOString(),
		lastUpdate: (backup.updatedAt || backup.started || backup.createdAt).toISOString(),
		backupStage: finished
			? backup.status
			: stats?.backupStage ||
				(stats?.lifecycleStage ? legacyStages[stats.lifecycleStage] : undefined) ||
				(backup.status === 'queued' ? 'queued' : 'backing-up'),
		attempt: stats?.remoteAttempt || 1,
		events: [
			{
				timestamp: (backup.updatedAt || backup.started || backup.createdAt).toISOString(),
				phase: finished ? 'finished' : 'backup',
				action: finished
					? successful
						? 'TASK_COMPLETED'
						: backup.status === 'cancelled'
							? 'TASK_CANCELLED'
							: 'TASK_FAILED'
					: 'BACKUP_OPERATION_START',
				completed: finished,
				resticData: successful
					? backup.completionStats
					: {
							message_type: 'status',
							files_done: stats?.filesProcessed || 0,
							bytes_done: stats?.bytesProcessed || 0,
							total_files: stats?.total_files_processed || 0,
							total_bytes: stats?.total_bytes_processed || 0,
						},
				...(backup.status === 'failed'
					? { error: 'Remote backup failed. Review the sanitized backup failure stage/code.' }
					: {}),
			},
		],
	};
}
