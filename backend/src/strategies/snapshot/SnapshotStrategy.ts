import { SnapShotFile } from '../../types/restic';
import { StrategyMethodTypes } from '../../types/strategy';
import { ReadStream } from 'fs';

export interface SnapshotStrategy {
	removeSnapshot(
		planId: string,
		backupId: string,
		options: { storagePath: string; storageName: string; encryption: boolean; planId: string }
	): Promise<{
		success: boolean;
		result: any;
		stats?: false | { total_size: number; snapshots: string[] };
	}>;
	downloadSnapshot(
		planId: string,
		backupId: string,
		path: string,
		options: { storagePath: string; storageName: string; encryption: boolean }
	): Promise<{ success: boolean; result: string }>;
	getSnapshotDownload(
		planId: string,
		backupId: string
	): Promise<{ success: boolean; result: string | { fileName: string; fileStream: ReadStream } }>;
	cancelSnapshotDownload(
		planId: string,
		backupId: string
	): Promise<{ success: boolean; result: string }>;
	getSnapshotFiles(
		planId: string,
		backupId: string,
		options: { storagePath: string; storageName: string; encryption: boolean }
	): Promise<{ success: boolean; result: SnapShotFile[] | string }>;
}

export type SnapshotStrategyTypes = StrategyMethodTypes<SnapshotStrategy>;
