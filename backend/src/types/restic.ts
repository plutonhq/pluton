export interface ResticSnapshot {
	time: string;
	parent: string;
	tree: string;
	paths: string[];
	hostname: string;
	username: string;
	tags: string[];
	program_version: string;
	summary: ResticSnapshotSummary;
	id: string;
	short_id: string;
}

export interface ResticSnapshotSummary {
	backup_start: string;
	backup_end: string;
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
}

export interface ResticRawStats {
	total_size: number;
	total_uncompressed_size: number;
	compression_ratio: number;
	compression_progress: number;
	compression_space_saving: number;
	total_blob_count: number;
	snapshots_count: number;
}

export interface ResticStats {
	total_size: number;
	total_file_count: number;
	snapshots_count: number;
}

export interface SnapShotFile {
	name: string;
	path: string;
	type: string;
	isDirectory: boolean;
	size: number;
	modifiedAt: string;
	owner: string;
	permissions: string;
	isAvailable: boolean;
	srcPath?: string;
	changeType?: string;
}

export interface ResticRestoredFile {
	path: string;
	size: number;
	action: string;
	isDirectory?: boolean;
}
