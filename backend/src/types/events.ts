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
