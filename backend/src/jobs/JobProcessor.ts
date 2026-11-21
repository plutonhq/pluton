import { EventEmitter } from 'events';
import { jobQueue, Job } from './JobQueue';
import { logger } from '../utils/logger';
import { Task } from './tasks/AbstractTask';
import { CleanDownloadsTask } from './tasks/CleanDownloadsTask';
import { BackupTask } from './tasks/BackupTask';
import { BaseBackupManager } from '../managers/BaseBackupManager';
import { configService } from '../services/ConfigService';
import { BaseRestoreManager } from '../managers/BaseRestoreManager';
import { RestoreTask } from './tasks/RestoreTask';
import { ReplicationRetryTask } from './tasks/ReplicationRetryTask';
import { SystemTaskManager } from './SystemTaskManager';

interface TaskDependencies {
	backupManager?: BaseBackupManager;
	restoreManager?: BaseRestoreManager;
}

/**
 * A singleton class that processes jobs from a queue in a controlled,
 * non-blocking, and fault-tolerant manner.
 *
 * @description
 * The JobProcessor is the core engine for executing all background tasks,
 * such as backups and integrity checks. It operates on a polling interval,
 * pulling one job at a time from the `JobQueue`.
 *
 * Key Responsibilities:
 * - **Sequential Processing:** Ensures jobs are processed one by one (or up to a defined concurrency limit).
 * - **Concurrency Limiting:** Manages how many jobs of a specific type (e.g., 'Backup') can run simultaneously.
 * - **Automatic Retries:** If a job fails, the processor collaborates with the `JobQueue` to re-queue it for a later attempt, respecting retry counts and delays.
 * - **Permanent Failure Notification:** After all retry attempts for a job are exhausted, it emits specific events (e.g., 'backup_failed') to notify the rest of the application.
 * - **Non-Blocking Operation:** The entire process is asynchronous. It does not block the main Node.js event loop, allowing the server to remain responsive to API requests while jobs run in the background.
 *
 * @extends EventEmitter
 */
class JobProcessor extends EventEmitter {
	private static instance: JobProcessor;
	private intervalId: NodeJS.Timeout | null = null;
	private tasks: Map<string, Task> = new Map();

	private constructor() {
		super();
	}

	public static getInstance(): JobProcessor {
		if (!JobProcessor.instance) {
			JobProcessor.instance = new JobProcessor();
		}
		return JobProcessor.instance;
	}

	/**
	 * Registers tasks with the JobProcessor.
	 * This method is typically called during application initialization.
	 * @param dependencies - Optional dependencies that tasks might require.
	 */
	public registerTasks(dependencies: TaskDependencies) {
		const tasksToRegister: Task[] = [new CleanDownloadsTask()];

		if (dependencies.backupManager) {
			tasksToRegister.push(new BackupTask(dependencies.backupManager));
			tasksToRegister.push(new ReplicationRetryTask(dependencies.backupManager));
		}

		if (dependencies.restoreManager) {
			tasksToRegister.push(new RestoreTask(dependencies.restoreManager));
		}

		for (const task of tasksToRegister) {
			this.tasks.set(task.name, task);
		}
	}

	/**
	 * Adds a new task to the JobProcessor.
	 * If a task with the same name already exists, it will be overwritten.
	 * @param task - The task instance to add.
	 */
	public addTask(task: Task): void {
		if (this.tasks.has(task.name)) {
			logger.warn(
				{ module: 'JobProcessor', task: task.name },
				'A task with this name is already registered. It will be overwritten.'
			);
		}
		this.tasks.set(task.name, task);
	}

	/**
	 * Returns the number of currently running backup jobs.
	 */
	public getActiveBackupJobs(): number {
		return jobQueue.getRunning().filter(job => this.isBackupJob(job)).length;
	}

	/**
	 * Starts the JobProcessor and checks for jobs every `interval` milliseconds.
	 * @param interval - Optional interval in milliseconds. Default is 5000ms.
	 */
	public start(interval = 5000): void {
		if (this.intervalId) {
			logger.warn({ module: 'JobProcessor' }, 'Job processor is already running.');
			return;
		}
		if (this.tasks.size === 0) {
			logger.warn({ module: 'JobProcessor' }, 'No tasks registered. Job processor will not start.');
			return;
		}
		logger.info({ module: 'JobProcessor' }, 'Starting job processor.');
		this.intervalId = setInterval(() => this.processQueue(), interval);
	}

	/**
	 * Stops the JobProcessor.
	 */
	public stop(): void {
		if (this.intervalId) {
			clearInterval(this.intervalId);
			this.intervalId = null;
			logger.info({ module: 'JobProcessor' }, 'Stopped job processor.');
		}
	}

	/**
	 * Starts every queued job that can run now.
	 * Backup tasks run up to MAX_CONCURRENT_BACKUPS at a time, other tasks one at a time,
	 * and only one job of a plan runs at a time.
	 */
	private processQueue(): void {
		let job: Job | null;
		while ((job = jobQueue.getNext((next, running) => this.canStart(next, running)))) {
			const started = job;
			this.runJob(started).catch(error =>
				logger.error(
					{ module: 'JobProcessor', job: started.name, error: error?.message },
					'Job handler failed.'
				)
			);
		}
	}

	private isBackupJob(job: Job): boolean {
		return this.tasks.get(job.name)?.isBackup === true;
	}

	private canStart(job: Job, running: Job[]): boolean {
		if (job.lastAttempt && Date.now() - job.lastAttempt < job.retryDelay) {
			return false;
		}
		const planId = job.payload?.planId;
		if (planId && running.some(r => r.payload?.planId === planId)) {
			return false;
		}
		if (this.isBackupJob(job)) {
			const activeBackups = running.filter(r => this.isBackupJob(r)).length;
			return activeBackups < configService.config.MAX_CONCURRENT_BACKUPS;
		}
		return !running.some(r => !this.isBackupJob(r));
	}

	private async runJob(job: Job): Promise<void> {
		// System jobs tick often and most ticks do nothing, so keep their start line out of the info log.
		const level = SystemTaskManager.isSystemJob(job.name) ? 'debug' : 'info';
		logger[level](
			{ module: 'JobProcessor' },
			`Processing job: ${job.name}. Active backups: ${this.getActiveBackupJobs()}`
		);

		const task = this.tasks.get(job.name);
		if (!task) {
			logger.error({ module: 'JobProcessor' }, `No task registered for job name: ${job.name}`);
			jobQueue.failJob(job);
			return;
		}

		try {
			await task.run(job);
			jobQueue.completeJob(job);
		} catch (error: any) {
			// Check if this is a cancellation error
			const errorMessage = error instanceof Error ? error.message : String(error);
			if (
				errorMessage.startsWith('BACKUP_CANCELLED:') ||
				errorMessage.startsWith('RESTORE_CANCELLED:')
			) {
				logger.info({ module: 'JobProcessor', job: job.name }, `Job was cancelled by user`);
				jobQueue.completeJob(job);
				return;
			}

			logger.error(
				{ module: 'JobProcessor', job: job.name, error: error.message },
				`Job failed during execution. Attempt ${job.attempts + 1} of ${job.maxAttempts}.`
			);

			// Some failures are permanent and must not be retried (e.g. a restic
			// backup that failed with a wrong password or a missing repository).
			const isNonRetryable = (error as { retryable?: boolean })?.retryable === false;

			let isPermanentlyFailed: boolean;
			if (isNonRetryable) {
				logger.warn(
					{ module: 'JobProcessor', job: job.name },
					`Job failed with a non-retryable error. Skipping remaining retries.`
				);
				jobQueue.completeJob(job);
				isPermanentlyFailed = true;
			} else {
				isPermanentlyFailed = jobQueue.failJob(job);
			}

			if (isPermanentlyFailed) {
				logger.error(
					{ module: 'JobProcessor', job: job.name },
					`Job has permanently failed after ${job.maxAttempts} attempts.`
				);
				// Emit a specific event for permanent failures that listeners can act on.
				// e.g., backup_failed, integrity_failed, 'prune_failed
				this.emit(`${job.name.toLowerCase()}_failed`, {
					...job.payload,
					error: error.message || 'Unknown error after multiple retries.',
				});
			}
		}
	}
}

export const jobProcessor = JobProcessor.getInstance();
