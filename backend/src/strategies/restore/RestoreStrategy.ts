import { RestoreConfig, RestoreOptions } from '../../types/restores';
import { StrategyMethodTypes } from '../../types/strategy';

export interface RestoreStrategy {
	cancelSnapshotRestore(
		planId: string,
		restoreId: string
	): Promise<{ success: boolean; result: string }>;
	restoreSnapshot(
		planId: string,
		backupId: string,
		options: RestoreOptions
	): Promise<{ success: boolean; result: string }>;
	getRestoreSnapshotStats(
		planId: string,
		backupId: string,
		options: RestoreConfig & {
			planId: string;
			storagePath: string;
			storageName: string;
			encryption: boolean;
		}
	): Promise<{ success: boolean; result: any }>;
	getRestoreProgress(
		planId: string,
		restoreId: string
	): Promise<{ success: boolean; result: string | Record<string, string | number> }>;
	getRestoreStats(
		planId: string,
		restoreId: string
	): Promise<{ success: boolean; result: string | Record<string, string | number> }>;
}

export type RestoreStrategyTypes = StrategyMethodTypes<RestoreStrategy>;
