export interface BackupCompletionStats {
   lifecycle?: {
      warnings: { stage: 'post-backup' | 'cleanup'; code: string }[];
      database?: { path: string; bytes: number; sha256: string };
      databases?: { databaseId: string; engine: 'mysql' | 'mariadb' | 'postgresql'; database: string; path: string; bytes: number; sha256: string }[];
   };
   files_new: number;
   files_changed: number;
   files_unmodified: number;
   dirs_new: number;
   dirs_changed: number;
   dirs_unmodified: number;
   data_blobs: number;
   tree_blobs: number;
   data_added: number;
   data_added_packed: number;
   total_files_processed: number;
   total_bytes_processed: number;
   total_duration: number;
   snapshot_id: string;
}

export interface BackupTaskStats {
   message_type: string;
   files_new: number;
   files_changed: number;
   files_unmodified: number;
   dirs_new: number;
   dirs_changed: number;
   dirs_unmodified: number;
   data_blobs: number;
   tree_blobs: number;
   data_added: number;
   data_added_packed: number;
   total_files_processed: number;
   total_bytes_processed: number;
   total_duration: number;
   snapshot_id: string;
   dry_run: boolean;
}

export interface BackupMirror {
   replicationId: string;
   storageId: string;
   storageName: string;
   storagePath: string;
   storageType: string;
   status: 'pending' | 'started' | 'completed' | 'failed';
   started?: number;
   ended?: number;
   error?: string;
   size?: number;
   sourceSnapshotId?: string;
   snapshotId?: string;
   attempts?: number;
   lastErrorCode?: string;
   verifiedAt?: number;
}

export type Backup = {
   completionStats?: BackupCompletionStats | null;
   id: string;
   title?: string;
   description?: string;
   snapshotId: string;
   createdAt?: string | number;
   started: number;
   ended: number;
   duration: number;
   status: 'completed' | 'cancelled' | 'failed' | 'started' | 'retrying' | 'initializing';
   inProgress: boolean;
   success?: boolean;
   totalFiles: number;
   totalSize: number;
   changes: { new: number; modified: number; removed: number; newDirs?: number; modifiedDirs?: number };
   active?: boolean;
   errorMsg?: string;
   hasRevisions?: boolean;
   revisionsSkipped?: boolean;
   hasChangesFile?: boolean;
   download?: {
      status: string;
      storageId?: string;
      storageName?: string;
      storageType?: string;
      started?: number;
      ended?: number;
      error?: string;
   };
   mirrors?: BackupMirror[];
};

export type BackupChartPoint = Pick<Backup, 'status' | 'started'> & {
   completionStats?: { total_files_processed: number | null; total_bytes_processed: number | null } | null;
   totalFiles?: number;
   totalSize?: number;
};

export interface BackupProgressEvent {
   timestamp: string;
   phase: string;
   action: string;
   completed: boolean;
   resticData?: any;
   error?: string;
}

export interface ReplicationProgressData {
   replicationId: string;
   storageId: string;
   storageName: string;
   storageType: string;
   status: 'pending' | 'running' | 'completed' | 'failed' | 'retrying';
   error?: string;
   events: BackupProgressEvent[];
}

export interface BackupProgressData {
   remote?: boolean;
   backupStage?: string;
   attempt?: number;
   planId: string;
   backupId: string;
   status: string;
   startTime: string;
   lastUpdate: string;
   events: BackupProgressEvent[];
   duration?: number;
   mirrors?: Record<string, ReplicationProgressData>;
}
