import { ResticRestoredFile, SnapShotFile } from '../types/restic';
import { Restore } from '../db/schema/restores';

export interface RestoreResItem {
	id: Restore['id'];
	status: Restore['status'];
	error: Restore['errorMsg'];
	stats: Restore['taskStats'];
	planId: Restore['planId'];
	sourceId: Restore['sourceId'];
	sourceType: Restore['sourceType'];
	endedAt: Restore['ended'];
	createdAt: Restore['createdAt'];
	planName: string;
	storage: {
		id: Restore['storageId'];
		path: string;
		name: string;
		type: string;
	};
	deviceName: string;
}

export interface RestoreConfig {
	target: string;
	overwrite: 'always' | 'if-changed' | 'if-newer' | 'never';
	includes: string[];
	excludes: string[];
	delete: boolean;
}

export interface RestoreStats {
	total_files: number;
	files_restored: number;
	total_bytes: number;
	bytes_restored: number;
}

export type RestoreTaskStats = RestoreStats;

export interface RestoreOptions extends RestoreConfig {
	planId: string;
	storagePath: string;
	storageName: string;
	encryption: boolean;
	sources?: string[];
	performanceSettings?: Record<string, any>;
}

export interface RestoreStatsFile {
	planId: string;
	backupId: string;
	restoreId: string;
	sources: string[];
	config: Record<string, any>;
	sourcePaths: SnapShotFile[];
	restoredPaths: ResticRestoredFile[];
	stats: RestoreStats;
}
