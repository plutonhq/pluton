import { EventEmitter } from 'events';
import { getSnapshotByTag } from '../utils/restic/restic';
import { RestoreHandler } from './handlers/RestoreHandler';
import { generateUID } from '../utils/helpers';
import { jobQueue } from '../jobs/JobQueue';
import { RestoreOptions } from '../types/restores';

export class BaseRestoreManager extends EventEmitter {
	private restoreHandler: RestoreHandler;
	constructor() {
		super();
		this.restoreHandler = new RestoreHandler(this);
	}

	/**
	 * Called only by the RestoreTask. This performs the actual restore logic.
	 */
	async performRestoreExecution(
		backupId: string,
		restoreId: string,
		options: RestoreOptions,
		retryInfo: { attempts: number; maxAttempts: number }
	) {
		return await this.restoreHandler.execute(backupId, restoreId, options, retryInfo);
	}

	/**
	 * This method is used to perform a backup immediately, without waiting for the scheduled time.
	 * Retries 2 times with a delay of 1 minute between each retry.
	 */
	async restoreSnapshot(
		backupId: string,
		options: RestoreOptions
	): Promise<{ success: boolean; result: string }> {
		const restoreId = generateUID();

		jobQueue.addPriorityJob('Restore', { backupId, restoreId, options }, 2, 60 * 1000);
		return { success: true, result: 'Restore job has been added to the queue.' };
	}

	async getRestoreSnapshotStats(
		planId: string,
		backupId: string,
		options: RestoreOptions
	): Promise<any> {
		try {
			const { success, result } = await getSnapshotByTag('backup-' + backupId, options);
			if (success && typeof result !== 'string') {
				const dryRestoreRes = await this.restoreHandler.dryRestore(backupId, result.id, options);
				// TODO: On Windows, due to a limitation, restic marks all files as "restored". So its very hard to detect
				// which file will be replaced after the restore is complete.
				// So we need to run "rclone lsjson" on the sources-> includes to get the file list and the size,
				// and determine which one is modified, new or will be removed.
				return dryRestoreRes;
			} else {
				return { success, result };
			}
		} catch (error: any) {
			return {
				success: false,
				result: error?.message || '',
			};
		}
	}

	async cancelSnapshotRestore(planId: string, restoreId: string): Promise<any> {
		try {
			const result = await this.restoreHandler.cancel(planId, restoreId);
			return {
				success: result,
				result: 'Restore cancelled',
			};
		} catch (error: any) {
			return {
				success: false,
				result: error?.message || '',
			};
		}
	}
}
