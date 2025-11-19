import { Cron } from 'croner';
import { jobQueue } from './JobQueue';
import { cronLogger } from '../utils/logger';
import { SystemJobConfig } from '../types/global';
import { SYSTEM_JOBS } from './systemJobs';

/**
 * A singleton class that initializes and manages system-wide, recurring tasks.
 *
 * @description
 * The SystemTaskManager reads a predefined list of static system jobs (e.g.,
 * cleanup tasks, database pruning) and schedules them using `croner`. When a
 * scheduled time is met, it adds the corresponding job to the central `JobQueue`
 * for the `JobProcessor` to execute. It acts as the primary scheduler for
 * non-dynamic, application-level maintenance tasks.
 */
export class SystemTaskManager {
	private static instance: SystemTaskManager;
	private cronJobs: Cron[] = [];
	private systemJobs: SystemJobConfig[];

	private constructor(systemJobs: SystemJobConfig[]) {
		this.systemJobs = systemJobs;
	}

	public static getInstance(systemJobs?: SystemJobConfig[]): SystemTaskManager {
		if (!SystemTaskManager.instance) {
			if (!systemJobs) {
				throw new Error('SystemTaskManager must be initialized with systemJobs on first call');
			}
			SystemTaskManager.instance = new SystemTaskManager(systemJobs);
		}
		return SystemTaskManager.instance;
	}

	/**
	 * Initializes system-level cron jobs.
	 * This method should be called during application startup.
	 */
	public initialize(): void {
		this.systemJobs.forEach(jobConfig => {
			try {
				const cron = new Cron(jobConfig.schedule, () => {
					jobQueue.add(
						jobConfig.name,
						jobConfig.payload,
						jobConfig.maxAttempts,
						jobConfig.retryDelay
					);
				});
				this.cronJobs.push(cron);
			} catch (error: any) {
				cronLogger.error(`Failed to schedule job: ${jobConfig.name}`);
			}
		});
	}

	public stopAll(): void {
		this.cronJobs.forEach(cron => cron.stop());
	}
}

export const systemTaskManager = SystemTaskManager.getInstance(SYSTEM_JOBS);
