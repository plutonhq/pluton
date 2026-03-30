import { StrategyMethodTypes } from '../../types/strategy';
import { BackupPlanArgs } from '../../types/plans';

export interface BackupStrategy {
	createBackup(
		planId: string,
		options: BackupPlanArgs
	): Promise<{ success: boolean; result: string }>;
	performBackup(planId: string): Promise<{ success: boolean; result: string }>;
	updateBackup(
		planId: string,
		options: Record<string, any>
	): Promise<{ success: boolean; result: string }>;
	removeBackup(
		planId: string,
		options: {
			storageName: string;
			storagePath: string;
			removeRemoteData: boolean;
			encryption: boolean;
			replicationStorages?: { storageName: string; storagePath: string }[];
		}
	): Promise<{ success: boolean; result: string }>;
	removeReplicationStorage(
		planId: string,
		options: {
			storageName: string;
			storagePath: string;
			removeData: boolean;
		}
	): Promise<{ success: boolean; result: string }>;
	pauseBackup(planId: string): Promise<{ success: boolean; result: string }>;
	resumeBackup(planId: string): Promise<{ success: boolean; result: string }>;
	pruneBackups(
		planId: string,
		replicationStorages?: { storageName: string; storagePath: string }[]
	): Promise<{
		success: boolean;
		result: string;
	}>;
	getBackupProgress?(
		planId: string,
		backupId: string
	): Promise<{ success: boolean; result: string }>;
	cancelBackup?(planId: string, backupId: string): Promise<{ success: boolean; result: string }>;
	unlockRepo?(
		planId: string,
		replicationStorages?: { storageName: string; storagePath: string }[]
	): Promise<{ success: boolean; result: string }>;

	updatePlanStorageName?(
		storageId: string,
		newStorageName: string
	): Promise<{ success: boolean; result: string }>;
	checkIntegrity(planId: string): Promise<{ success: boolean; result: any }>;
}

export type BackupStrategyTypes = StrategyMethodTypes<BackupStrategy>;
