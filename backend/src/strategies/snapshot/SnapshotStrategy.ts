import { SnapShotFile } from '../../types/restic';
import { StrategyMethodTypes } from '../../types/strategy';

export interface SnapshotStrategy {
	removeSnapshot(
		planId: string,
		backupId: string,
		options: {
			storagePath: string;
			storageName: string;
			encryption: boolean;
			mirrors?: { replicationId: string; storageName: string; storagePath: string }[];
		}
	): Promise<{
		success: boolean;
		result: any;
		stats?: {
			primary: null | { total_size: number; snapshots: string[] };
			mirrors?: { [key: string]: { total_size: number; snapshots: string[] } };
		};
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
	): Promise<{ success: boolean; result: string | { fileName: string; filePath: string } }>;
	cancelSnapshotDownload(
		planId: string,
		backupId: string
	): Promise<{ success: boolean; result: string }>;
	getSnapshotFiles(
		planId: string,
		backupId: string,
		options: {
			storagePath: string;
			storageName: string;
			encryption: boolean;
			isSrc?: boolean;
			skipCache?: boolean;
		}
	): Promise<{ success: boolean; result: SnapShotFile[] | string }>;
	listSnapshotFiles(
		planId: string,
		backupId: string,
		options: {
			storagePath: string;
			storageName: string;
			encryption: boolean;
			buildId: string;
			skipCache?: boolean;
		}
	): Promise<{ success: boolean; result: any }>;
	retryFailedReplication(
		planId: string,
		backupId: string,
		replicationIds: string[]
	): Promise<{ success: boolean; result: string }>;
}

export type SnapshotStrategyTypes = StrategyMethodTypes<SnapshotStrategy>;
