import { Task } from './AbstractTask';
import { cronLogger } from '../../utils/logger';
import { Job } from '../JobQueue';
import { SELF_BACKUP_JOB_NAME } from '../systemJobs';
import { SelfBackupService } from '../../services/SelfBackupService';

/**
 * Ticks hourly and gates on `intervalHours` from settings. Retries skip the gate,
 * because the failed attempt already moved `lastRunAt`.
 */
export class SelfBackupTask extends Task {
	name = SELF_BACKUP_JOB_NAME;

	constructor(private selfBackupService: SelfBackupService) {
		super();
	}

	async run(job?: Job): Promise<void> {
		const force = job?.payload?.force === true;

		const isRetry = (job?.attempts ?? 0) > 0;
		if (!force && !isRetry && !(await this.selfBackupService.isDue())) {
			return;
		}

		const isLastAttempt = !job || job.attempts + 1 >= job.maxAttempts;
		const result = await this.selfBackupService.run({ force, isLastAttempt });
		cronLogger.info(`[SelfBackup] Run finished with status: ${result.status}`);
	}
}
