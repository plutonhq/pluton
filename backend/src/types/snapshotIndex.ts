import { SnapShotFile } from './restic';

export type SnapshotIndexOrigin = 'local' | 'remote';

export type SnapshotListFormat = 'restic' | 'rclone';

/** Maps the restic form of a listed path to the path on the source device. */
export interface SnapshotIndexSource {
	root: string;
	srcPath: string;
}

export interface SnapshotIndexEntry {
	path: string;
	type: string;
	size: number;
	mtime: number | null;
	perm: string | null;
}

export type SnapshotIndexStage = 'queued' | 'listing' | 'transferring' | 'indexing';

export type SnapshotIndexFailureCode =
	| 'agent_update_required'
	| 'agent_offline'
	| 'snapshot_not_found'
	| 'integrity'
	| 'disk_full'
	| 'stalled'
	| 'unknown';

export interface SnapshotIndexStats {
	entries: number;
	files: number;
	dirs: number;
	bytes: number;
}

export type SnapshotIndexStatus =
	| { state: 'none' }
	| { state: 'unsupported' }
	| { state: 'building'; stage: SnapshotIndexStage; entries: number; total?: number }
	| { state: 'ready'; snapshotId: string; builtAt: number; stats: SnapshotIndexStats }
	| { state: 'failed'; code: SnapshotIndexFailureCode; error: string };

export interface SnapshotIndexMeta {
	backupId: string;
	replicationId: string;
	snapshotId: string;
	origin: SnapshotIndexOrigin;
	builtAt: number;
	stats: SnapshotIndexStats;
}

export type SnapshotIndexRow = SnapShotFile & { dirBytes?: number; hasSubdirs?: boolean };

export interface SnapshotIndexEntriesQuery {
	dir?: string;
	sort?: 'name' | 'modifiedAt' | 'size';
	order?: 'asc' | 'desc';
	offset?: number;
	limit?: number;
	q?: string;
}

export interface SnapshotIndexDirsQuery {
	parent?: string;
	depth?: number;
	offset?: number;
	limit?: number;
}

export interface SnapshotIndexDir {
	path: string;
	subDirs: number;
	items: number;
	bytes: number;
}

export interface SnapshotIndexSelection {
	selected: { items: number; bytes: number };
	total: { items: number; bytes: number };
	normalized: { includes: string[]; excludes: string[] };
}
