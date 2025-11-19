import { Task } from './AbstractTask';
import { logger, planLogger } from '../../utils/logger';
import { BaseBackupManager } from '../../managers/BaseBackupManager';
import { Job } from '../JobQueue';

export class BackupTask extends Task {
	name = 'Backup';

	constructor(private backupManager: BaseBackupManager) {
		super();
	}

	async run(job: Job): Promise<void> {
		if (!job.payload || !job.payload?.planId) {
			logger.error('BackupTask failed: planId is missing from the payload.');
			throw new Error('Missing planId in job payload');
		}

		const { planId, backupId } = job.payload;
		logger.info(`Starting backup job for plan: ${planId}`);

		try {
			await this.backupManager.performBackupExecution(planId, backupId, {
				attempts: job.attempts,
				maxAttempts: job.maxAttempts,
			});

			planLogger('backup', planId, backupId).info(
				`Backup job for plan ${planId} completed successfully.`
			);
		} catch (error: any) {
			planLogger('backup', planId, backupId).error(
				`Backup job for plan ${planId} failed. Error: ${error.message}`
			);
			// Re-throw the error so the JobProcessor knows the job failed and can retry it.
			throw error;
		}
	}
}
