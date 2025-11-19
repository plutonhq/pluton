import { readFile } from 'fs/promises';
import { RestoreStrategy, RestoreStrategyTypes } from './RestoreStrategy';
import { appPaths } from '../../utils/AppPaths';
import { BaseRestoreManager } from '../../managers/BaseRestoreManager';
import { RestoreConfig, RestoreOptions } from '../../types/restores';

export class LocalStrategy implements RestoreStrategy {
	constructor(protected localAgent: BaseRestoreManager) {}

	async cancelSnapshotRestore(planId: string, restoreId: string) {
		return await this.localAgent.cancelSnapshotRestore(planId, restoreId);
	}

	async getRestoreProgress(planId: string, restoreId: string) {
		try {
			const filename = `restore-${restoreId}.json`;
			const progressFile = `${appPaths.getProgressDir()}/${filename}`;
			const progressData = await readFile(progressFile, 'utf8');
			const progress = JSON.parse(progressData);
			return { success: true, result: progress };
		} catch (error: any) {
			return { success: false, result: error?.message };
		}
	}

	async getRestoreStats(planId: string, restoreId: string) {
		try {
			const filename = `restore-${restoreId}.json`;
			const statsFile = `${appPaths.getStatsDir()}/${filename}`;
			const statsData = await readFile(statsFile, 'utf8');
			const stats = JSON.parse(statsData);
			return { success: true, result: stats };
		} catch (error: any) {
			return { success: false, result: error?.message };
		}
	}

	async restoreSnapshot(planId: string, backupId: string, options: RestoreOptions) {
		return await this.localAgent.restoreSnapshot(backupId, options);
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
		return await this.localAgent.getRestoreSnapshotStats(planId, backupId, options);
	}
}
