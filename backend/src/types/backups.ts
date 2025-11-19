export interface BackupCompletionStats {
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

export interface BackupProgressStats {
	bytesProcessed: number;
	filesProcessed: number;
	total_files_processed: number;
	total_bytes_processed: number;
}

export interface BackupDownload {
	status: string;
	started?: number;
	ended?: number;
	error?: string;
	sourceConfig?: Record<string, any>;
}

export interface BackupNotificationJSONPayload {
	eventName: string;
	appTitle: string;
	deviceName: string;
	storageName: string;
	storageType: string;
	storagePath: string;
	startTime: Date;
	planID: string;
	planTitle: string;
	planType: string;
	planSource: {
		included: string;
		excluded: string;
	};
	endTime?: Date;
	error?: string;
	stats?: BackupTaskStats | BackupCompletionStats;
}
