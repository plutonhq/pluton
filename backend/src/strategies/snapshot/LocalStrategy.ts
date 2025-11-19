import { BaseSnapshotManager } from '../../managers/BaseSnapshotManager';
import { SnapshotStrategy } from './SnapshotStrategy';

export class LocalStrategy implements SnapshotStrategy {
	constructor(protected localAgent: BaseSnapshotManager) {}

	async removeSnapshot(
		planId: string,
		backupId: string,
		options: {
			storageName: string;
			storagePath: string;
			encryption: boolean;
			planId: string;
		}
	) {
		return await this.localAgent.removeSnapshot(planId, backupId, options);
	}

	async downloadSnapshot(
		planId: string,
		backupId: string,
		path: string,
		options: { storagePath: string; storageName: string; encryption: boolean }
	) {
		return await this.localAgent.downloadSnapshot(planId, backupId, path, options);
	}

	async getSnapshotDownload(planId: string, backupId: string) {
		return await this.localAgent.getSnapshotDownload(planId, backupId);
	}

	async cancelSnapshotDownload(planId: string, backupId: string) {
		return await this.localAgent.cancelSnapshotDownload(planId, backupId);
	}

	async getSnapshotFiles(
		planId: string,
		backupId: string,
		options: { storagePath: string; storageName: string; encryption: boolean }
	) {
		return await this.localAgent.getSnapshotFiles(backupId, options);
	}
}
