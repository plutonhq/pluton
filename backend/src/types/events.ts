import { RestoreConfig, RestoreStats } from '../types/restores';
import { BackupCompletionStats, BackupTaskStats } from './backups';

// Event emitted when the pre-check (dry-run) is done and the real backup is starting.
export interface BackupStartEvent {
	planId: string;
	backupId: string;
	summary: BackupTaskStats;
}

// Event emitted periodically during a backup.
export interface BackupProgressEvent {
	backupId: string;
	planId: string;
	// This should match the structure of restic's --json status output
	data: {
		message_type: 'status';
		percent_done: number;
		total_files: number;
		files_done: number;
		total_bytes: number;
		bytes_done: number;
		// ... and other fields from restic's status message
	};
}

// Event emitted on successful completion of a backup.
export interface BackupCompleteEvent {
	backupId: string;
	planId: string;
	success: boolean;
	summary?: BackupCompletionStats;
}

// Event emitted when any error occurs.
export interface BackupErrorEvent {
	planId: string;
	backupId: string; // May not exist if the error was before the backup started
	error: string;
}

// Event emitted when a prune operation finishes.
export interface PruneEndEvent {
	planId: string;
	success: boolean;
	stats?: false | { total_size: number; snapshots: string[] };
	error?: string;
}

export interface BackupStatUpdateEvent {
	planId: string;
	backupId: string;
	error?: string;
	total_size?: number;
	snapshots?: string[];
	mirrors?: {
		replicationId: string;
		storageId: string;
		storagePath: string;
		size: number;
		snapshots: string[];
	}[];
}

export interface BackupReplicationStatUpdateEvent {
	planId: string;
	backupId: string;
	mirrors: {
		replicationId: string;
		storageId: string;
		storagePath: string;
		size: number;
		snapshots: string[];
	}[];
}

export interface BackupReplicationMirrorSizeUpdateEvent {
	backupId: string;
	mirrorSizes: {
		replicationId: string;
		storageId: string;
		storagePath: string;
		size: number;
	}[];
}

export interface RestoreStartEvent {
	planId: string;
	summary: BackupTaskStats;
	backupId: string;
	restoreId: string;
	config: RestoreConfig;
	stats?: RestoreStats;
}

export interface RestoreErrorEvent {
	backupId: string;
	planId: string;
	error: string;
	restoreId?: string;
}

export interface RestoreCompleteEvent {
	backupId: string;
	restoreId: string;
	planId: string;
	success: boolean;
}

export interface DownloadStartEvent {
	backupId: string;
	planId: string;
}

export interface DownloadProgressEvent {
	backupId: string;
	planId: string;
	data: any;
}

export interface DownloadCompleteEvent {
	backupId: string;
	planId: string;
	success: boolean;
}

export interface DownloadErrorEvent {
	backupId: string;
	planId: string;
	error: string;
}

export interface ReplicationStartEvent {
	planId: string;
	backupId: string;
	replicationId: string;
	storageId: string;
	storageName: string;
	storagePath: string;
	storageType: string;
}

export interface ReplicationCompleteEvent {
	planId: string;
	backupId: string;
	replicationId: string;
	storageId: string;
	storageName: string;
	storagePath: string;
	storageType: string;
	success: boolean;
	error?: string;
}

export interface ReplicationProgressEvent {
	planId: string;
	backupId: string;
	replicationId: string;
	storageId: string;
	storagePath: string;
	data: Record<string, any>;
}

/**
 * Emitted by BackupHandler to request replication initialization.
 * ReplicationEventService resolves storage names, creates initial mirror entries,
 * and emits `replication_init_complete` back.
 */
export interface ReplicationInitEvent {
	planId: string;
	backupId: string;
	replicationStorages: {
		replicationId: string;
		storageId: string;
		storagePath: string;
		storageType: string;
	}[];
	/** When true, only resets the specified mirrors to 'pending' instead of replacing all mirrors. */
	isRetry?: boolean;
}

/**
 * Emitted by ReplicationEventService after resolving storage names and
 * creating initial mirror entries on the backup record.
 */
export interface ReplicationInitCompleteEvent {
	planId: string;
	backupId: string;
	resolvedStorages: ResolvedReplicationStorage[];
}

/**
 * A replication storage with its name resolved from the StorageStore.
 */
export interface ResolvedReplicationStorage {
	replicationId: string;
	storageId: string;
	storagePath: string;
	storageName: string;
	storageType: string;
}

/**
 * Emitted by BaseBackupManager to retry failed replications.
 * Handled by ReplicationEventListener to trigger the retry flow.
 */
export interface ReplicationRetryEvent {
	planId: string;
	backupId: string;
	failedReplicationIds: string[];
	sourceRepoPath: string;
	encryption: boolean;
	replicationStorages: {
		replicationId: string;
		storageId: string;
		storagePath: string;
		storageType: string;
	}[];
	pruneSettings: Record<string, any>;
	concurrent: boolean;
}
