import { BackupVerifiedResult, PlanAddRunSettings } from '../../types/plans';
import { BackupRunConfig } from '../../types/backups';
import { BackupStrategy } from './BackupStrategy';

export class RemoteStrategy implements BackupStrategy {
	protected deviceId: string;

	constructor(deviceId: string) {
		this.deviceId = deviceId;
	}

	async createBackup(
		planId: string,
		options: Record<string, any>,
		runSettings?: PlanAddRunSettings
	) {
		return this.publishCommand('CREATE_BACKUP', { planId, options, runSettings });
	}

	async updateBackup(planId: string, options: any) {
		return this.publishCommand('UPDATE_BACKUP', { planId, options });
	}

	async removeBackup(
		planId: string,
		options: {
			storageName: string;
			storagePath: string;
			encryption: boolean;
		}
	) {
		return await this.publishCommand('REMOVE_SNAPSHOT', { planId, options });
	}

	async removeReplicationStorage(
		planId: string,
		options: {
			storageName: string;
			storagePath: string;
			removeData: boolean;
		}
	) {
		return await this.publishCommand('REMOVE_REPLICATION_STORAGE', { planId, options });
	}

	async performBackup(planId: string, runConfig?: BackupRunConfig) {
		return await this.publishCommand('PERFORM_BACKUP', { planId, runConfig });
	}

	async pauseBackup(planId: string) {
		return await this.publishCommand('PAUSE_BACKUP', { planId });
	}

	async resumeBackup(planId: string) {
		return await this.publishCommand('RESUME_BACKUP', { planId });
	}
	async pruneBackups(planId: string) {
		return await this.publishCommand('PRUNE_BACKUPS', { planId });
	}

	async getBackupProgress(planId: string, backupId: string) {
		return await this.publishCommand('GET_BACKUP_PROGRESS', { planId, backupId });
	}

	async cancelBackup(planId: string, backupId: string) {
		return await this.publishCommand('CANCEL_BACKUP', { planId });
	}

	async unlockRepo(planId: string) {
		return await this.publishCommand('UNLOCK_REPO', { planId });
	}

	async updatePlanStorageName(storageId: string, newStorageName: string) {
		return await this.publishCommand('UPDATE_PLAN_STORAGE_NAME', { storageId, newStorageName });
	}

	async checkIntegrity(planId: string): Promise<{ success: boolean; result: any }> {
		return await this.publishCommand('CHECK_INTEGRITY', { planId });
	}

	async repairRepo(
		planId: string,
		repairType: 'snapshots' | 'index' | 'packs',
		checkRes: BackupVerifiedResult,
		options: { storageName: string; storagePath: string }
	): Promise<{ success: boolean; result: any }> {
		return await this.publishCommand('REPAIR_REPO', { planId, repairType, checkRes, options });
	}

	publishCommand(action: string, payload: any): Promise<{ success: boolean; result: any }> {
		void action;
		void payload;
		return Promise.resolve({ success: false, result: 'REMOTE_CAPABILITY_NOT_IMPLEMENTED' });
	}
}
