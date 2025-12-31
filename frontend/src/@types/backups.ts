export interface BackupCompletionStats {
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

export type Backup = {
   id: string;
   title?: string;
   description?: string;
   snapshotId: string;
   started: number;
   ended: number;
   duration: number;
   status: 'completed' | 'cancelled' | 'failed' | 'started';
   inProgress: boolean;
   totalFiles: number;
   totalSize: number;
   changes: { new: number; modified: number; removed: number };
   active?: boolean;
   errorMsg?: string;
   download?: {
      status: string;
      started?: number;
      ended?: number;
      error?: string;
   };
};

export interface BackupProgressEvent {
   timestamp: string;
   phase: string;
   action: string;
   completed: boolean;
   resticData?: any;
   error?: string;
}

export interface BackupProgressData {
   planId: string;
   backupId: string;
   status: string;
   startTime: string;
   lastUpdate: string;
   events: BackupProgressEvent[];
   duration?: number;
}
