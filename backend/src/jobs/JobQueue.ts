import { generateUID } from '../utils/helpers';
import { cronLogger } from '../utils/logger';

export interface Job {
	id: string;
	name: string;
	payload?: any;
	attempts: number;
	maxAttempts: number;
	retryDelay: number; // in milliseconds
	lastAttempt: number;
}

class JobQueue {
	private static instance: JobQueue;
	private queue: Job[] = [];
	private runningJob: Job | null = null;

	private constructor() {}

	public static getInstance(): JobQueue {
		if (!JobQueue.instance) {
			JobQueue.instance = new JobQueue();
		}
		return JobQueue.instance;
	}

	/**
	 * Adds a job to the queue if it's not already present or running.
	 */
	public add(jobName: string, payload?: any, maxAttempts = 3, retryDelay = 60000): void {
		this.addJob(jobName, payload, maxAttempts, retryDelay, false);
	}

	/**
	 * Adds a high-priority job to the front of the queue.
	 */
	public addPriorityJob(jobName: string, payload?: any, maxAttempts = 3, retryDelay = 60000): void {
		this.addJob(jobName, payload, maxAttempts, retryDelay, true);
	}

	/**
	 * Re-queues a failed job for a later retry.
	 */
	public reQueue(job: Job): void {
		// cronLogger.warn(`Re-queuing job '${job.name}' for attempt ${job.attempts + 2}.`);
		// Simply push to the end. The JobProcessor will handle the delay.
		this.queue.push(job);
		this.runningJob = null;
	}

	/**
	 * Adds a job back to the front of the queue.
	 * Used when a job cannot be started due to a temporary constraint like concurrency.
	 */
	public requeueAtFront(job: Job): void {
		this.queue.unshift(job);
		this.runningJob = null;
	}

	/**
	 * Retrieves the next available job and marks it as running.
	 * Returns null if no job is ready to run.
	 */
	public getNext(): Job | null {
		if (this.runningJob || this.queue.length === 0) {
			return null;
		}

		// Set the next job in the queue as the running one and remove it from the queue
		this.runningJob = this.queue.shift()!;
		return this.runningJob;
	}

	/**
	 * Marks the currently running job as complete.
	 */
	public completeJob(): void {
		if (this.runningJob) {
			this.runningJob = null;
		}
	}

	/**
	 * Handles a failed job, deciding whether to re-queue or mark as failed.
	 * @returns {boolean} - True if the job has permanently failed, false if it was re-queued.
	 */
	public failJob(job: Job): boolean {
		job.attempts++;
		job.lastAttempt = Date.now();

		if (job.attempts <= job.maxAttempts) {
			this.reQueue(job);
			return false; // It was re-queued, not permanently failed.
		} else {
			cronLogger.error(
				`Job '${job.name}' for plan '${job.payload?.planId}' failed after ${job.maxAttempts} retries.`
			);
			// Clear the running job
			this.runningJob = null;
			return true; // It has permanently failed.
		}
	}

	/**
	 * Private helper to handle job creation and queuing.
	 */
	private addJob(
		jobName: string,
		payload: any,
		maxAttempts: number,
		retryDelay: number,
		isPriority: boolean
	): void {
		const isPresent =
			this.queue.some(
				j => j.name === jobName && JSON.stringify(j.payload) === JSON.stringify(payload)
			) ||
			(this.runningJob?.name === jobName &&
				JSON.stringify(this.runningJob?.payload) === JSON.stringify(payload));

		// === DEBUG LOGGING START ===
		console.log(
			`[DEBUG_QUEUE] Adding job '${jobName}'. Payload: ${JSON.stringify(payload)}. Is duplicate? ${isPresent}`
		);
		// === DEBUG LOGGING END ===

		if (isPresent) {
			return;
		}

		const job: Job = {
			id: generateUID(),
			name: jobName,
			payload: payload || {},
			attempts: 0,
			maxAttempts,
			retryDelay,
			lastAttempt: 0,
		};

		if (isPriority) {
			this.queue.unshift(job); // <-- Adds to the front
		} else {
			this.queue.push(job); // <-- Adds to the end
		}
	}

	/**
	 * Removes a job from the queue based on its name and a planId in its payload.
	 * This is used to cancel pending retries.
	 * @param jobName The name of the job to remove (e.g., 'Backup').
	 * @param planId The planId to match in the job's payload.
	 * @returns {boolean} True if a job was removed, false otherwise.
	 */
	public remove(jobName: string, planId: string): boolean {
		const initialQueueLength = this.queue.length;

		// Filter out the job from the pending queue
		this.queue = this.queue.filter(j => !(j.name === jobName && j.payload?.planId === planId));

		const wasRemovedFromQueue = this.queue.length < initialQueueLength;

		// Also check if the currently "running" job is the one to be removed.
		// This handles the case where the job is just about to be processed again.
		let wasRemovedFromRunning = false;
		if (this.runningJob?.name === jobName && this.runningJob?.payload?.planId === planId) {
			this.runningJob = null;
			wasRemovedFromRunning = true;
		}

		const jobWasRemoved = wasRemovedFromQueue || wasRemovedFromRunning;

		return jobWasRemoved;
	}
}

export const jobQueue = JobQueue.getInstance();
