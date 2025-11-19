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
	private isRunning = false;
	private intervalId: NodeJS.Timeout | null = null;
	private tasks: Map<string, Task> = new Map();

	// Counter for active backup jobs to enforce concurrency limits
	private activeBackupJobs = 0;

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
		}

		if (dependencies.restoreManager) {
			tasksToRegister.push(new RestoreTask(dependencies.restoreManager));
		}

		for (const task of tasksToRegister) {
			console.log('🎀 task :', task.name);
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
	 * Processes the job queue.
	 * This method is typically called internally by the JobProcessor.
	 */
	private async processQueue(): Promise<void> {
		if (this.isRunning) return;

		const job = jobQueue.getNext();
		if (!job) return;

		// --- Concurrency Check for Backup Jobs ---
		if (job.name === 'Backup') {
			if (this.activeBackupJobs >= configService.config.MAX_CONCURRENT_BACKUPS) {
				// Limit reached, put the job back at the front of the queue and try again later.
				jobQueue.requeueAtFront(job);
				return;
			}
		}

		// --- Retry Delay Check ---
		const now = Date.now();
		if (job.lastAttempt && now - job.lastAttempt < job.retryDelay) {
			const timeLeft = Math.round((job.retryDelay - (now - job.lastAttempt)) / 1000);
			logger.info(
				{ module: 'JobProcessor' },
				`Delaying retry for job '${job.name}'. Next attempt in ~${timeLeft}s.`
			);

			jobQueue.reQueue(job); // Put it back at the end of the queue to wait.
			return;
		}

		this.isRunning = true;
		if (job.name === 'Backup') {
			this.activeBackupJobs++;
		}
		logger.info(
			{ module: 'JobProcessor' },
			`Processing job: ${job.name}. Active backups: ${this.activeBackupJobs}`
		);

		const task = this.tasks.get(job.name);
		if (!task) {
			logger.error({ module: 'JobProcessor' }, `No task registered for job name: ${job.name}`);
			// This is a permanent failure, as there's no task to run.
			jobQueue.failJob(job);
			this.isRunning = false;
			if (job.name === 'Backup') {
				this.activeBackupJobs--;
			}
			return;
		}

		try {
			await task.run(job);
			jobQueue.completeJob();
		} catch (error: any) {
			// Check if this is a cancellation error
			const errorMessage = error instanceof Error ? error.message : String(error);
			if (
				errorMessage.startsWith('BACKUP_CANCELLED:') ||
				errorMessage.startsWith('RESTORE_CANCELLED:')
			) {
				logger.info({ module: 'JobProcessor', job: job.name }, `Job was cancelled by user`);
				// Mark job as completed (cancelled) without retrying
				jobQueue.completeJob();
				return;
			}

			logger.error(
				{ module: 'JobProcessor', job: job.name, error: error.message },
				`Job failed during execution. Attempt ${job.attempts + 1} of ${job.maxAttempts}.`
			);

			// failJob() will re-queue the job if there are attempts left,
			// and return 'true' only if it has permanently failed.
			const isPermanentlyFailed = jobQueue.failJob(job);

			if (isPermanentlyFailed) {
				logger.error(
					{ module: 'JobProcessor', job: job.name },
					`Job has permanently failed after ${job.maxAttempts} attempts.`
				);
				// Emit a specific event for permanent failures that listeners can act on.
				// e.g., backup_failed, integrity_failed, 'prune_failed
				console.log(
					'######### JobProcessor-> Emit Fail Event :',
					`${job.name.toLowerCase()}_failed`
				);
				this.emit(`${job.name.toLowerCase()}_failed`, {
					...job.payload,
					error: error.message || 'Unknown error after multiple retries.',
				});
			}
		} finally {
			this.isRunning = false;
			if (job.name === 'Backup') {
				this.activeBackupJobs--;
			}
		}
	}
}

export const jobProcessor = JobProcessor.getInstance();
