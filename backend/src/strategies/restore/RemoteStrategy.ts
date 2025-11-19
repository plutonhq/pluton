import { RestoreConfig, RestoreOptions } from '../../types/restores';
import { RestoreStrategy } from './RestoreStrategy';

export class RemoteStrategy implements RestoreStrategy {
	protected broker: any;
	protected deviceId: string;

	constructor(broker: any, deviceId: string) {
		this.broker = broker;
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
			this.broker.publish(
				{
					cmd: 'publish',
					topic: `command/restore/${this.deviceId}/${action}`,
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
