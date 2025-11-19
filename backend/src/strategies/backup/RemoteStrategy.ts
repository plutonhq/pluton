import { BackupStrategy } from './BackupStrategy';

export class RemoteStrategy implements BackupStrategy {
	protected broker: any;
	protected deviceId: string;

	constructor(broker: any, deviceId: string) {
		this.broker = broker;
		this.deviceId = deviceId;
	}

	async createBackup(planId: string, options: Record<string, any>) {
		return { success: true, result: 'Backup created successfully' };
	}

	async updateBackup(planId: string, options: any) {
		return { success: true, result: 'Backup updated successfully' };
	}

	async removeBackup(
		planId: string,
		options: {
			storageName: string;
			storagePath: string;
			removeRemoteData: boolean;
			encryption: boolean;
		}
	) {
		return { success: true, result: 'Backup removed successfully' };
	}

	async performBackup(planId: string) {
		return await this.publishCommand('PERFORM_BACKUP', { planId });
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

	publishCommand(action: string, payload: any): Promise<{ success: boolean; result: any }> {
		return new Promise((resolve, reject) => {
			this.broker.publish(
				{
					cmd: 'publish',
					topic: `command/backup/${this.deviceId}/${action}`,
					payload: JSON.stringify(payload),
					qos: 0,
					dup: false,
					retain: false,
				},
				(error: any) => {
					if (error) reject({ success: false, result: error?.message || 'Unknown Error' });
					else resolve({ success: true, result: JSON.stringify(payload) });
				}
			);
		});
	}
}
