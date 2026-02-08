import { RestoreConfig, RestoreOptions } from '../../types/restores';
import { RestoreStrategy } from './RestoreStrategy';

export class RemoteStrategy implements RestoreStrategy {
	protected deviceId: string;

	constructor(deviceId: string) {
		this.deviceId = deviceId;
	}

	async cancelSnapshotRestore(planId: string, restoreId: string) {
		return await this.publishCommand('CANCEL_RESTORE', { planId, restoreId });
	}

	async getRestoreProgress(planId: string, restoreId: string) {
		return await this.publishCommand('GET_RESTORE_PROGRESS', { planId, restoreId });
	}

	async getRestoreStats(planId: string, restoreId: string) {
		return await this.publishCommand('GET_RESTORE_STATS', { planId, restoreId });
	}

	async restoreSnapshot(planId: string, backupId: string, options: RestoreOptions) {
		return await this.publishCommand('PERFORM_RESTORE', { planId, backupId, options });
	}

	async getRestoreSnapshotStats(
		planId: string,
		backupId: string,
		options: RestoreConfig & {
			planId: string;
			storagePath: string;
			storageName: string;
			encryption: boolean;
		}
	) {
		return await this.publishCommand('DRY_RESTORE', { planId, backupId, options });
	}

	publishCommand(action: string, payload: any): Promise<{ success: boolean; result: any }> {
		return new Promise((resolve, reject) => {
			resolve({ success: true, result: null });
		});
	}
}
