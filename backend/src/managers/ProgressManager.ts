import { writeFile, readFile, mkdir, readdir, stat, unlink } from 'fs/promises';
import { join, extname } from 'path';
import { existsSync } from 'fs';

// Types matching the Go implementation
export interface ResticProgress {
	message_type?: string;
	seconds_elapsed?: number;
	seconds_remaining?: number;
	percent_done?: number;
	total_files?: number;
	files_done?: number;
	total_bytes?: number;
	bytes_done?: number;
	current_files?: string[];
}

export interface ProgressEvent {
	timestamp: string;
	phase: string; // "pre-backup", "backup", "post-backup", "finished"
	action: string; // Specific action being performed
	resticData?: ResticProgress;
	error?: string;
	completed: boolean; // Whether this action is completed
}

export interface BackupProgressFile {
	planId: string;
	backupId: string;
	status: string; // "running", "completed", "failed"
	startTime: string;
	lastUpdate: string;
	duration?: number;
	events: ProgressEvent[]; // Array of all progress events
}

export class ProgressManager {
	private progressDir: string;
	private type: 'backup' | 'restore';
	private writeLocks = new Map<string, Promise<any>>();

	constructor(progressDir: string, type: 'backup' | 'restore' = 'backup') {
		this.progressDir = progressDir;
		this.type = type;
	}

	/**
	 * Initialize the progress manager and create directory if needed
	 */
	async initialize(): Promise<void> {
		try {
			if (!existsSync(this.progressDir)) {
				await mkdir(this.progressDir, { recursive: true });
			}
		} catch (error) {
			// CHANGED: Log a warning instead of throwing, as this is not a fatal startup error.
			console.warn(`[ProgressManager] Could not create progress directory: ${error}`);
		}
	}

	/**
	 * A synchronized method to perform read-modify-write operations safely.
	 */
	private async synchronizedUpdate(
		backupId: string,
		updateFunction: (progress: BackupProgressFile) => BackupProgressFile
	): Promise<void> {
		const lockKey = `${this.type}-${backupId}`;
		// Wait for the previous write operation on this specific file to complete.
		const previousLock = this.writeLocks.get(lockKey) || Promise.resolve();

		const newLock = previousLock
			.then(async () => {
				// CRITICAL SECTION: Only one operation at a time per file.
				const planId = (await this.readProgressFile(backupId))?.planId || '';
				const progress = await this.readProgressFile(backupId, planId);

				if (progress) {
					const updatedProgress = updateFunction(progress);
					const filename = `${this.type}-${backupId}.json`;
					const filePath = join(this.progressDir, filename);
					const data = JSON.stringify(updatedProgress, null, 2);
					await writeFile(filePath, data, 'utf-8');
				}
			})
			.catch(err => {
				// Catch errors from the update process so the lock chain isn't broken
				console.error(`[ProgressManager] Error during synchronized update for ${backupId}:`, err);
			});

		// Immediately set the new promise as the current lock for the next caller.
		this.writeLocks.set(lockKey, newLock);

		// When this operation is fully complete, remove the lock if it's still ours.
		await newLock;
		if (this.writeLocks.get(lockKey) === newLock) {
			this.writeLocks.delete(lockKey);
		}
	}

	/**
	 * Creates initial progress file for a backup
	 */
	async initializeProgress(
		planId: string,
		backupId: string,
		retryInfo: { attempts: number; maxAttempts: number }
	): Promise<void> {
		// Only create a new file on the first attempt
		if (retryInfo.attempts === 0) {
			const progress: BackupProgressFile = {
				planId,
				backupId,
				status: 'running',
				startTime: new Date().toISOString(),
				lastUpdate: new Date().toISOString(),
				events: [
					{
						timestamp: new Date().toISOString(),
						phase: 'initializing',
						action: 'INITIALIZE',
						completed: true,
					},
				],
			};

			await this.writeProgressFile(planId, backupId, progress);
		}
	}

	/**
	 * Adds a new action to the progress events
	 */
	async updateAction(
		planId: string,
		backupId: string,
		phase: string,
		action: string,
		completed: boolean,
		error?: string
	): Promise<void> {
		await this.synchronizedUpdate(backupId, progress => {
			const event: ProgressEvent = {
				timestamp: new Date().toISOString(),
				phase,
				action,
				completed,
				error,
			};
			progress.events.push(event);
			progress.lastUpdate = new Date().toISOString();
			return progress;
		});
	}

	/**
	 * Updates with restic JSON output (only during backup phase)
	 */
	async updateResticProgress(planId: string, backupId: string, resticChunk: string): Promise<void> {
		const lines = resticChunk.split('\n').filter(line => line.trim() !== '');
		if (lines.length === 0) return;

		await this.synchronizedUpdate(backupId, progress => {
			let didUpdate = false;
			let targetEvent: ProgressEvent | undefined;
			for (let i = progress.events.length - 1; i >= 0; i--) {
				const event = progress.events[i];
				if ((event.phase === 'backup' || event.phase === 'restore') && !event.completed) {
					targetEvent = event;
					break;
				}
			}

			if (!targetEvent) return progress; // No active event to update

			for (const line of lines) {
				try {
					const resticData: ResticProgress = JSON.parse(line);
					// As requested, only process 'status' and 'summary' message types.
					if (resticData.message_type === 'status' || resticData.message_type === 'summary') {
						targetEvent.resticData = resticData;
						didUpdate = true;
					}
				} catch (e) {
					// ignore parse errors
				}
			}

			if (didUpdate) {
				targetEvent.timestamp = new Date().toISOString();
				progress.lastUpdate = new Date().toISOString();
			}
			return progress;
		});
	}

	/**
	 * Marks backup as completed
	 */
	async markCompleted(
		planId: string,
		backupId: string,
		success: boolean,
		errorMsg?: string,
		finalFail?: boolean
	): Promise<void> {
		await this.synchronizedUpdate(backupId, progress => {
			progress.lastUpdate = new Date().toISOString();
			const startTime = new Date(progress.startTime);
			const endTime = new Date();
			progress.duration = endTime.getTime() - startTime.getTime();

			let finalEvent: ProgressEvent;
			if (success) {
				progress.status = 'completed';
				finalEvent = {
					timestamp: new Date().toISOString(),
					phase: 'finished',
					action: 'TASK_COMPLETED',
					completed: true,
				};
			} else {
				progress.status = 'failed';
				const finalFailReason = errorMsg?.includes('cancelled')
					? 'TASK_CANCELLED'
					: 'FAILED_PERMANENTLY';
				finalEvent = {
					timestamp: new Date().toISOString(),
					phase: finalFail ? 'finished' : 'error',
					action: finalFail ? finalFailReason : 'TASK_FAILED',
					error: errorMsg,
					completed: true,
				};
			}
			progress.events.push(finalEvent);
			return progress;
		});
	}

	/**
	 * Reads progress data from file. Now public but safe.
	 */
	async readProgress(planId: string, backupId: string): Promise<BackupProgressFile | null> {
		return this.readProgressFile(backupId, planId);
	}

	/**
	 * Gets the latest restic progress from the progress file
	 */
	async getResticProgress(planId: string, backupId: string): Promise<ResticProgress | null> {
		const progress = await this.readProgressFile(backupId, planId);
		if (!progress) return null;

		for (let i = progress.events.length - 1; i >= 0; i--) {
			const event = progress.events[i];
			if (event.resticData) {
				return event.resticData;
			}
		}
		return null;
	}

	/**
	 * Reads progress from file.
	 * CHANGED: This method is now resilient. It no longer throws errors.
	 * It returns a default object if the file doesn't exist or is invalid, allowing the process to continue.
	 */
	private async readProgressFile(
		backupId: string,
		planId?: string
	): Promise<BackupProgressFile | null> {
		const filename = `${this.type}-${backupId}.json`;
		const filePath = join(this.progressDir, filename);

		try {
			const data = await readFile(filePath, 'utf-8');
			if (!data) throw new Error('File is empty');
			return JSON.parse(data);
		} catch (error: any) {
			if (error.code !== 'ENOENT' && error.message !== 'File is empty') {
				console.error(
					`[ProgressManager] Failed to read or parse progress file for ${backupId}: ${error.message}`
				);
			}
			return {
				planId: planId || '',
				backupId,
				status: 'running',
				startTime: new Date().toISOString(),
				lastUpdate: new Date().toISOString(),
				events: [],
			};
		}
	}

	/**
	 * Writes progress to file.
	 * CHANGED: This method is now resilient and will not throw errors.
	 */
	private async writeProgressFile(
		planId: string,
		backupId: string,
		progress: BackupProgressFile
	): Promise<void> {
		await this.synchronizedUpdate(backupId, () => progress);
	}

	/**
	 * Removes progress files older than specified duration
	 */
	async cleanupOldProgress(maxAgeMs: number): Promise<void> {
		try {
			const files = await readdir(this.progressDir);
			const cutoff = Date.now() - maxAgeMs;

			for (const file of files) {
				if (extname(file) !== '.json') {
					continue;
				}

				const filePath = join(this.progressDir, file);
				try {
					const stats = await stat(filePath);
					if (stats.mtime.getTime() < cutoff) {
						await unlink(filePath);
					}
				} catch (error) {
					console.warn(
						`[ProgressManager] Failed to remove old progress file ${filePath}: ${error}`
					);
				}
			}
		} catch (error: any) {
			console.warn(
				`[ProgressManager] Failed to read progress directory for cleanup: ${error.message}`
			);
		}
	}
}
