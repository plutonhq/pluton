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
	private running = new Map<string, Job>();

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
		this.running.delete(job.id);
		this.queue.push(job);
	}

	/**
	 * Takes the first queued job that `canStart` accepts and marks it as running.
	 * Returns null if no job can start now.
	 */
	public getNext(canStart: (job: Job, running: Job[]) => boolean): Job | null {
		const running = this.getRunning();
		const index = this.queue.findIndex(job => canStart(job, running));
		if (index === -1) {
			return null;
		}
		const [job] = this.queue.splice(index, 1);
		this.running.set(job.id, job);
		return job;
	}

	public getRunning(): Job[] {
		return [...this.running.values()];
	}

	/**
	 * Whether a job of this name is queued or currently running.
	 */
	public hasPending(jobName: string): boolean {
		return (
			this.getRunning().some(job => job.name === jobName) ||
			this.queue.some(job => job.name === jobName)
		);
	}

	/**
	 * Marks a running job as complete.
	 */
	public completeJob(job: Job): void {
		this.running.delete(job.id);
	}

	/**
	 * Handles a failed job, deciding whether to re-queue or mark as failed.
	 * @returns {boolean} - True if the job has permanently failed, false if it was re-queued.
	 */
	public failJob(job: Job): boolean {
		job.attempts++;
		job.lastAttempt = Date.now();

		if (job.attempts < job.maxAttempts) {
			this.reQueue(job);
			return false; // It was re-queued, not permanently failed.
		} else {
			cronLogger.error(
				`Job '${job.name}' for plan '${job.payload?.planId}' failed after ${job.attempts} attempts.`
			);
			this.running.delete(job.id);
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
		const isSame = (j: Job) =>
			j.name === jobName && JSON.stringify(j.payload) === JSON.stringify(payload);
		const isPresent = this.queue.some(isSame) || this.getRunning().some(isSame);

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
	 * Removes queued jobs based on their name and a planId in their payload.
	 * This is used to cancel pending retries. A running job is not touched.
	 * @param jobName The name of the job to remove (e.g., 'Backup').
	 * @param planId The planId to match in the job's payload.
	 * @returns {boolean} True if a job was removed, false otherwise.
	 */
	public remove(jobName: string, planId: string): boolean {
		const initialQueueLength = this.queue.length;
		this.queue = this.queue.filter(j => !(j.name === jobName && j.payload?.planId === planId));
		return this.queue.length < initialQueueLength;
	}
}

export const jobQueue = JobQueue.getInstance();
