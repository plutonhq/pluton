import { SnapshotStrategy } from './SnapshotStrategy';

export class RemoteStrategy implements SnapshotStrategy {
	protected deviceId: string;

	constructor(deviceId: string) {
		this.deviceId = deviceId;
	}
	async removeSnapshot(
		planId: string,
		backupId: string,
		options: { storagePath: string; storageName: string; encryption: boolean; planId: string }
	) {
		return await this.publishCommand('REMOVE_SNAPSHOT', { backupId, options });
	}

	async downloadSnapshot(
		planId: string,
		backupId: string,
		path: string,
		options: { storagePath: string; storageName: string; encryption: boolean }
	) {
		return await this.publishCommand('DOWNLOAD_SNAPSHOT', { backupId, path, options });
	}

	async getSnapshotDownload(planId: string, backupId: string) {
		return await this.publishCommand('GET_SNAPSHOT_DOWNLOAD', { planId, backupId });
	}

	async cancelSnapshotDownload(backupId: string) {
		return await this.publishCommand('CANCEL_SNAPSHOT_DOWNLOAD', { backupId });
	}

	async getSnapshotFiles(
		planId: string,
		backupId: string,
		options: { storagePath: string; storageName: string; encryption: boolean }
	) {
		return await this.publishCommand('GET_SNAPSHOT_FILES', { planId, backupId, options });
	}

	publishCommand(action: string, payload: any): Promise<{ success: boolean; result: any }> {
		return new Promise((resolve, reject) => {
			resolve({ success: true, result: null });
		});
	}
}
