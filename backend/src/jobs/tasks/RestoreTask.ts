import { Task } from './AbstractTask';
import { logger, planLogger } from '../../utils/logger';
import { Job } from '../JobQueue';
import { BaseRestoreManager } from '../../managers/BaseRestoreManager';

export class RestoreTask extends Task {
	name = 'Restore';

	constructor(private backupManager: BaseRestoreManager) {
		super();
	}

	async run(job: Job): Promise<void> {
		if (!job.payload || !job.payload?.backupId) {
			logger.error('RestoreTask failed: backupId is missing from the payload.');
			throw new Error('Missing backupId in job payload');
		}

		const { restoreId, backupId, options } = job.payload;
		logger.info(`Starting restore job for plan: ${options.planId}`);

		try {
			await this.backupManager.performRestoreExecution(backupId, restoreId, options, {
				attempts: job.attempts,
				maxAttempts: job.maxAttempts,
			});

			planLogger('restore', options.planId, backupId).info(
				`Restore job for backup ${backupId} completed successfully.`
			);
		} catch (error: any) {
			planLogger('restore', options.planId, backupId).error(
				`Restore job for backup ${backupId} failed. Error: ${error.message}`
			);
			// Re-throw the error so the JobProcessor knows the job failed and can retry it.
			throw error;
		}
	}
}
