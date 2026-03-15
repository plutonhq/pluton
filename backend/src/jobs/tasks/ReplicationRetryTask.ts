import { Task } from './AbstractTask';
import { logger, planLogger } from '../../utils/logger';
import { BaseBackupManager } from '../../managers/BaseBackupManager';
import { Job } from '../JobQueue';

export class ReplicationRetryTask extends Task {
	name = 'ReplicationRetry';

	constructor(private backupManager: BaseBackupManager) {
		super();
	}

	async run(job: Job): Promise<void> {
		if (!job.payload || !job.payload?.planId || !job.payload?.backupId) {
			logger.error('ReplicationRetryTask failed: planId or backupId is missing from the payload.');
			throw new Error('Missing planId or backupId in job payload');
		}

		const { planId, backupId, failedReplicationIds } = job.payload;
		logger.info(`Starting replication retry job for plan: ${planId}, backup: ${backupId}`);

		try {
			await this.backupManager.retryFailedReplications(planId, backupId, failedReplicationIds);

			planLogger('replication', planId, backupId).info(
				`Replication retry job for plan ${planId} completed successfully.`
			);
		} catch (error: any) {
			planLogger('replication', planId, backupId).error(
				`Replication retry job for plan ${planId} failed. Error: ${error.message}`
			);
			throw error;
		}
	}
}
