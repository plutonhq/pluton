import { BackupStrategy } from './BackupStrategy';
import { BackupPlanArgs } from '../../types/plans';
import { BaseBackupManager } from '../../managers/BaseBackupManager';
import { readFile } from 'fs/promises';
import { appPaths } from '../../utils/AppPaths';

export class LocalStrategy implements BackupStrategy {
	constructor(protected localAgent: BaseBackupManager) {}

	async performBackup(backupId: string) {
		return await this.localAgent.performBackup(backupId);
	}

	async createBackup(backupId: string, options: BackupPlanArgs) {
		return await this.localAgent.createBackup(backupId, options);
	}

	async updateBackup(backupId: string, options: BackupPlanArgs) {
		return await this.localAgent.updateBackup(backupId, options);
	}

	async cancelBackup(planId: string, backupId: string) {
		return await this.localAgent.cancelBackup(planId, backupId);
	}

	async removeBackup(
		planId: string,
		options: {
			storageName: string;
			storagePath: string;
			encryption: boolean;
			removeRemoteData: boolean;
			replicationStorages?: { storageName: string; storagePath: string }[];
		}
	) {
		const { storageName, storagePath, removeRemoteData, encryption, replicationStorages } = options;
		return await this.localAgent.removeBackup(planId, {
			storageName,
			storagePath,
			removeRemoteData,
			encryption,
			replicationStorages,
		});
	}

	async removeReplicationStorage(
		planId: string,
		options: {
			storageName: string;
			storagePath: string;
			removeData: boolean;
		}
	) {
		return await this.localAgent.removeReplicationStorage(planId, options);
	}

	async pauseBackup(backupId: string) {
		return await this.localAgent.pauseBackup(backupId);
	}
	async resumeBackup(backupId: string) {
		return await this.localAgent.resumeBackup(backupId);
	}
	async pruneBackups(
		backupId: string,
		replicationStorages?: { storageName: string; storagePath: string }[]
	) {
		return await this.localAgent.pruneBackups(backupId, replicationStorages);
	}

	async unlockRepo(
		planId: string,
		replicationStorages?: { storageName: string; storagePath: string }[]
	) {
		return await this.localAgent.unlockRepo(planId, replicationStorages);
	}

	async updatePlanStorageName(storageId: string, newStorageName: string) {
		return await this.localAgent.updatePlanStorageName(storageId, newStorageName);
	}

	async checkIntegrity(planId: string): Promise<{ success: boolean; result: any }> {
		return await this.localAgent.checkIntegrity(planId);
	}

	async getBackupProgress(planId: string, backupId: string) {
		try {
			const filename = `backup-${backupId}.json`;
			const progressFile = `${appPaths.getProgressDir()}/${filename}`;
			const progressData = await readFile(progressFile, 'utf8');
			const progress = JSON.parse(progressData);
			return { success: true, result: progress };
		} catch (error: any) {
			return { success: false, result: error?.message };
		}
	}
}
