import os from 'os';
import fs from 'fs';
import { EventEmitter } from 'events';
import { getBackupPlanStats, runResticCommand } from '../../utils/restic/restic';
import { generateResticRepoPath } from '../../utils/restic/helpers';
import { processManager } from '../ProcessManager';
import { PruneHandler } from './PruneHandler';
import { ProgressManager } from '../ProgressManager';
import { appPaths } from '../../utils/AppPaths';
import { BackupPlanArgs } from '../../types/plans';
import { runScriptsForEvent } from '../../utils/executeUserScript';
import { configService } from '../../services/ConfigService';

type ResticArgsAndEnv = {
	resticArgs: string[];
	resticEnv: Record<string, string>;
};

export class BackupHandler {
	private runningBackups = new Set<string>();
	private cancelledBackups = new Set<string>();
	// private backupAttempts = new Map<string, number>();
	private progressManager: ProgressManager;

	constructor(protected emitter: EventEmitter) {
		this.progressManager = new ProgressManager(appPaths.getProgressDir());
		this.initializeProgressManager();
	}

	private async initializeProgressManager(): Promise<void> {
		try {
			await this.progressManager.initialize();
		} catch (error) {
			console.warn(`Failed to initialize progress manager: ${error}`);
		}
	}

	/**
	 * Executes the backup process of a plan.
	 * @param planId - The ID of the backup plan.
	 * @param backupId - The Pre-generated ID of the backup.
	 * @param options - The options for the backup.
	 * @returns The output of the backup process.
	 */
	async execute(
		planId: string,
		backupId: string,
		options: Record<string, any>,
		retryInfo: { attempts: number; maxAttempts: number }
	): Promise<string> {
		// Prevent the same plan from running concurrently.
		if (this.runningBackups.has(planId)) {
			throw new Error(`Backup is already in progress for plan: ${planId}`);
		}
		this.runningBackups.add(planId);

		// Initialize progress file
		try {
			await this.progressManager.initializeProgress(planId, backupId, retryInfo);
		} catch (error) {
			console.warn(`Failed to initialize progress file: ${error}`);
		}

		// If this is a retry, log the attempt number to the progress file.
		if (retryInfo.attempts > 0) {
			await this.updateProgress(
				planId,
				backupId,
				'pre-backup',
				`RETRY_ATTEMPT_${retryInfo.attempts}_OF_${retryInfo.maxAttempts}_START`,
				false
			);
		}

		try {
			// --- 1. PRE-BACKUP PHASE ---
			const resticArgsAndEnv = this.createResticBackupArgs(planId, options as BackupPlanArgs);
			await this.preBackupPhase(planId, backupId, options, resticArgsAndEnv);
			if (this.cancelledBackups.has(planId)) {
				throw new Error('BACKUP_CANCELLED: Backup was cancelled');
			}

			// --- 2. BACKUP PHASE ---
			const result = await this.executeBackupPhase(planId, backupId, options, resticArgsAndEnv);
			if (this.cancelledBackups.has(planId)) {
				throw new Error('BACKUP_CANCELLED: Backup was cancelled');
			}

			// --- 3. POST-BACKUP PHASE ---
			await this.postBackupPhase(planId, backupId, options);

			// Mark as completed
			await this.progressManager.markCompleted(planId, backupId, true);

			// Run After Backup scripts
			await this.afterBackup(planId, backupId, options);

			return result;
		} catch (error: any) {
			// --- 4. CENTRALIZED ERROR HANDLING ---
			const errorMessage = error instanceof Error ? error.message : 'Unknown execution error';

			// If Cancelled by the user, do not retry or mark as failed.
			const isCancelled = errorMessage.startsWith('BACKUP_CANCELLED:');
			if (isCancelled) {
				return '';
			}

			// If this is not the final attempt, log that a retry will be scheduled.
			// const isFinalAttempt = retryInfo.attempts + 1 === retryInfo.maxAttempts;

			const permanentlyFailed = retryInfo.attempts + 1 > retryInfo.maxAttempts;

			// Mark as failed
			await this.progressManager.markCompleted(
				planId,
				backupId,
				false,
				errorMessage,
				permanentlyFailed
			);

			if (!permanentlyFailed) {
				await this.updateProgress(
					planId,
					backupId,
					'retry',
					`BACKUP_RETRY_${retryInfo.attempts + 1}_OF_${retryInfo.maxAttempts}_SCHEDULED`,
					false
				);
			}

			// Emit the 'error' event for the listener to log the attempt failure.
			this.emitter.emit('backup_error', {
				planId,
				backupId,
				error: errorMessage,
			});

			// Run post-failure scripts.
			if (permanentlyFailed) {
				console.log('### Final Attempt!!! Running Scripts...');
				await this.afterBackupFailure(planId, backupId, options);
				await this.afterBackup(planId, backupId, options);
			} else {
				await this.afterBackupError(planId, backupId, options);
			}

			// Re-throw the error so the JobProcessor's catch block is triggered and decides whether to retry.
			throw new Error(errorMessage);
		} finally {
			// This block runs regardless of success or failure, ensuring we always clean up.
			this.runningBackups.delete(planId);
			this.cancelledBackups.delete(planId);
		}
	}

	/**
	 * Pre-backup phase - dry run, validation, and preparation
	 */
	private async preBackupPhase(
		planId: string,
		backupId: string,
		options: Record<string, any>,
		resticArgsAndEnv: ResticArgsAndEnv
	): Promise<void> {
		// Update progress: Pre-backup start
		await this.updateProgress(planId, backupId, 'pre-backup', 'PRE_BACKUP_START', false);

		// Perform dry run
		await this.updateProgress(planId, backupId, 'pre-backup', 'PRE_BACKUP_DRY_RUN_START', false);

		let dryRunSummary;
		try {
			dryRunSummary = await this.dryRunBackup(planId, options, resticArgsAndEnv);
			await this.updateProgress(
				planId,
				backupId,
				'pre-backup',
				'PRE_BACKUP_DRY_RUN_COMPLETE',
				true
			);
		} catch (error: any) {
			const errMsg = error?.message || 'Unknown Error';
			await this.updateProgress(
				planId,
				backupId,
				'pre-backup',
				'PRE_BACKUP_DRY_RUN_ERROR',
				false,
				errMsg
			);
			throw error;
		}

		// Emit the 'start' event to signal the listener to create the DB record.
		this.emitter.emit('backup_start', {
			planId: options.id,
			backupId: backupId,
			summary: dryRunSummary,
		});

		// Wait for the 'backup_created' event before proceeding.
		await this.waitForBackupCreation(planId, backupId);

		// Run pre-flight checks
		await this.updateProgress(planId, backupId, 'pre-backup', 'PRE_BACKUP_CHECKS_START', false);
		await this.canRun(options, resticArgsAndEnv);
		await this.updateProgress(planId, backupId, 'pre-backup', 'PRE_BACKUP_CHECKS_COMPLETE', true);

		// Run pre-backup scripts
		await this.updateProgress(planId, backupId, 'pre-backup', 'PRE_BACKUP_SCRIPTS_START', false);
		await this.beforeBackup(planId, backupId, options);
		await this.updateProgress(planId, backupId, 'pre-backup', 'PRE_BACKUP_SCRIPTS_COMPLETE', true);

		// Unlock stale locks
		await this.updateProgress(
			planId,
			backupId,
			'pre-backup',
			'PRE_BACKUP_UNLOCK_STALE_LOCKS',
			false
		);
		await this.unlockStaleLocks(planId, options, resticArgsAndEnv);
		await this.updateProgress(planId, backupId, 'pre-backup', 'PRE_BACKUP_COMPLETE', true);
	}

	/**
	 * Execute backup phase - runs the actual restic backup command
	 */
	protected async executeBackupPhase(
		planId: string,
		backupId: string,
		options: Record<string, any>,
		resticArgsAndEnv: ResticArgsAndEnv
	): Promise<string> {
		// Update progress: Backup operation start
		await this.updateProgress(planId, backupId, 'backup', 'BACKUP_OPERATION_START', false);

		const repoPassword = options.settings.encryption ? (process.env.ENCRYPTION_KEY as string) : '';
		const handlers = this.createHandlers(planId, backupId);
		const { resticArgs, resticEnv } = resticArgsAndEnv;
		const resticArgsWithBackupTag: string[] = [...resticArgs, '--tag', `backup-${backupId}`];

		try {
			// Run the Restic Backup command.
			const result = await runResticCommand(
				resticArgsWithBackupTag,
				{ RESTIC_PASSWORD: repoPassword, ...resticEnv },
				handlers.onProgress,
				handlers.onError,
				handlers.onComplete,
				process => processManager.trackProcess('backup-' + backupId, process)
			);
			if (!this.cancelledBackups.has(planId)) {
				await this.updateProgress(planId, backupId, 'backup', 'BACKUP_OPERATION_COMPLETE', true);
			}
			return result;
		} catch (error: any) {
			const errMsg = error?.message || 'Unknown Error';
			await this.updateProgress(planId, backupId, 'backup', 'BACKUP_OPERATION_ERROR', true, errMsg);
			throw error;
		}
	}

	/**
	 * Post-backup phase - cleanup and post-backup operations
	 */
	private async postBackupPhase(
		planId: string,
		backupId: string,
		options: Record<string, any>
	): Promise<void> {
		// Update progress: Post-backup start
		await this.updateProgress(planId, backupId, 'post-backup', 'POST_BACKUP_START', false);

		// Run post-backup scripts
		await this.updateProgress(planId, backupId, 'post-backup', 'POST_BACKUP_SCRIPTS_START', false);
		await this.afterBackupSuccess(planId, backupId, options);
		await this.updateProgress(
			planId,
			backupId,
			'post-backup',
			'POST_BACKUP_SCRIPTS_COMPLETE',
			true
		);

		// Run pruning and stats update
		await this.updateProgress(planId, backupId, 'post-backup', 'POST_BACKUP_PRUNE_START', false);
		try {
			const pruneHandler = new PruneHandler(this.emitter);
			await pruneHandler.prune(planId, options);
			await this.updateProgress(
				planId,
				backupId,
				'post-backup',
				'POST_BACKUP_PRUNE_COMPLETE',
				true
			);
		} catch (error: any) {
			const errorMsg = error?.message || 'Unknown Error';
			console.warn(
				`[BackupHandler]: Failed to prune repository for plan: ${planId}. Error:  ${errorMsg}`
			);
			await this.updateProgress(
				planId,
				backupId,
				'post-backup',
				'POST_BACKUP_PRUNE_FAILED',
				true,
				errorMsg
			);
		}

		// Run post-backup repository stats update
		await this.updateProgress(
			planId,
			backupId,
			'post-backup',
			'POST_BACKUP_REPO_STATS_START',
			false
		);
		try {
			const planStats = await getBackupPlanStats(
				planId,
				options.storage.name,
				options.storagePath,
				options.settings.encryption
			);
			this.emitter.emit('backup_stats_update', {
				planId,
				backupId: backupId,
				...(planStats || {}),
			});
			await this.updateProgress(
				planId,
				backupId,
				'post-backup',
				'POST_BACKUP_REPO_STATS_COMPLETE',
				true
			);
		} catch (error: any) {
			const errMsg = error?.message || 'Unknown Error';
			this.emitter.emit('backup_stats_update', {
				planId,
				backupId: backupId,
				error: errMsg,
			});
			await this.updateProgress(
				planId,
				backupId,
				'post-backup',
				'POST_BACKUP_REPO_STATS_FAILED',
				true,
				errMsg
			);
		}

		await this.updateProgress(planId, backupId, 'post-backup', 'POST_BACKUP_COMPLETE', true);
	}

	/**
	 * Helper to update backup progress with error handling
	 */
	protected async updateProgress(
		planId: string,
		backupId: string,
		phase: string,
		action: string,
		completed: boolean,
		error?: string
	): Promise<void> {
		try {
			await this.progressManager.updateAction(planId, backupId, phase, action, completed, error);
		} catch (error) {
			console.warn(`Warning: Failed to update progress for ${phase}/${action}: ${error}`);
		}
	}

	/**
	 * A helper method to wait for the 'backup_created' event with a timeout.
	 * The backup process only continues after the backup entry is created in the database.
	 * Automatically rejects if the backup_created event is not received after 30 seconds.
	 */
	private waitForBackupCreation(planId: string, backupId: string): Promise<void> {
		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				// Clean up the listener to prevent memory leaks.
				this.emitter.removeListener('backup_created', onBackupCreated);
				reject(
					new Error(`Timeout: Did not receive backup_created confirmation for ID: ${backupId}`)
				);
			}, 30000);

			const onBackupCreated = (data: { planId: string; backupId: string }) => {
				if (data.backupId === backupId && data.planId === planId) {
					clearTimeout(timeout);
					this.emitter.removeListener('backup_created', onBackupCreated);
					resolve();
				}
			};

			this.emitter.on('backup_created', onBackupCreated);
		});
	}

	/**
	 * Helper to unlock stale repository locks.
	 */
	private async unlockStaleLocks(
		planId: string,
		options: Record<string, any>,
		resticArgsAndEnv: ResticArgsAndEnv
	): Promise<void> {
		if (options.storage && options.storagePath) {
			console.log(`[BackupHandler]: Unlocking stale locks for plan: ${planId}`);
			try {
				const repoPath = generateResticRepoPath(options.storage.name, options.storagePath || '');
				const repoPassword = options.settings.encryption
					? (process.env.ENCRYPTION_KEY as string)
					: '';

				await runResticCommand(['unlock', '-r', repoPath], {
					...resticArgsAndEnv.resticEnv,
					RESTIC_PASSWORD: repoPassword,
				});
			} catch (error: any) {
				console.warn(
					`[BackupHandler]: Failed to unlock stale locks for plan: ${planId}. Error:  ${error.message}`
				);
			}
		}
	}

	/**
	 * Checks if the backup can run.
	 * @param options - Options for the backup process.
	 * @returns A promise that resolves to a boolean indicating if the backup can run.
	 */
	async canRun(options: Record<string, any>, resticArgsAndEnv: ResticArgsAndEnv): Promise<boolean> {
		// Check system resource availability
		const availableMemory = os.freemem();
		const processorCount = resticArgsAndEnv?.resticEnv?.GOMAXPROCS
			? parseInt(resticArgsAndEnv.resticEnv.GOMAXPROCS, 10)
			: os.cpus().length;
		const requiredMemory = 64 * 1024 * 1024 * processorCount;
		if (availableMemory < requiredMemory) {
			throw new Error(`Insufficient memory to perform backup.`);
		}

		// Check if encryption key is available when encryption is enabled
		if (options.settings.encryption && !process.env.ENCRYPTION_KEY) {
			throw new Error(`Encryption enabled but ENCRYPTION_KEY not found.`);
		}

		// Check if source paths exist and are accessible
		if (options.sourceConfig?.includes) {
			const pathsNotFound = [];
			for (const path of options.sourceConfig.includes) {
				try {
					await fs.promises.access(path, fs.constants.R_OK);
				} catch (error) {
					pathsNotFound.push(path);
				}
			}
			if (pathsNotFound.length > 0) {
				throw new Error(`Source paths not accessible: ${pathsNotFound.join(', ')}.`);
			}
		}

		return true;
	}

	/**
	 * Cancels the backup process.
	 * @param planId - The ID of the backup plan.
	 * @param backupId - The ID of the backup.
	 * @returns A promise that resolves to a boolean indicating if the backup was cancelled.
	 */
	async cancel(planId: string, backupId: string): Promise<boolean> {
		this.cancelledBackups.add(planId);
		await this.progressManager.markCompleted(
			planId,
			backupId,
			false,
			'Backup was cancelled by user',
			true
		);

		try {
			const killed = processManager.killProcess('backup-' + backupId);
			console.log('[Cancel] killed:', killed);
			return true;
		} catch (error: any) {
			console.log('Error Cancelling Backup. ' + error?.message || '');
			return false;
		}
	}

	/**
	 * Creates handlers for the backup process.
	 * @param planId - The ID of the backup plan.
	 * @param backupId - The ID of the backup.
	 * @returns An object containing event handlers for the backup process.
	 */
	protected createHandlers(planId: string, backupId: string) {
		return {
			onProgress: (data: Buffer) => {
				const progressLine = data.toString().trim();

				// Update restic progress in progress file
				this.updateResticProgress(planId, backupId, progressLine);

				// Also emit the existing event for compatibility
				try {
					const progressData = JSON.parse(progressLine);
					this.emitter.emit('backup_progress', {
						planId,
						backupId,
						data: progressData,
					});
				} catch (error) {
					// Ignore non-JSON lines from restic
				}
			},
			onError: (data: Buffer) => {
				this.emitter.emit('backup_error', {
					planId,
					backupId,
					error: data.toString(),
				});
			},
			onComplete: async (code: number) => {
				const progressData = await this.progressManager.getResticProgress(planId, backupId);
				this.emitter.emit('backup_complete', {
					planId,
					backupId,
					success: code === 0,
					summary: progressData,
				});
			},
		};
	}

	/**
	 * Helper to update restic progress with error handling
	 */
	protected async updateResticProgress(
		planId: string,
		backupId: string,
		resticLine: string
	): Promise<void> {
		try {
			await this.progressManager.updateResticProgress(planId, backupId, resticLine);
		} catch (error) {
			console.warn(`Warning: Failed to update restic progress: ${error}`);
		}
	}

	/**
	 * Performs a dry run of the backup process.
	 * @param options - Options for the backup process.
	 * @returns A promise that resolves to an object containing the result of the dry run.
	 */
	protected async dryRunBackup(
		planId: string,
		options: Record<string, any>,
		resticArgsAndEnv: ResticArgsAndEnv
	): Promise<false | Record<string, any>> {
		const { resticArgs, resticEnv } = resticArgsAndEnv;
		const dryRunArgs = [...resticArgs, '--dry-run'];
		const dryRunEnv = {
			...resticEnv,
			RESTIC_PASSWORD: options.settings.encryption ? (process.env.ENCRYPTION_KEY as string) : '',
		};
		if (options.method === 'rescue') {
			dryRunArgs.push('--one-file-system');
		}
		try {
			const dryRunOutput = await runResticCommand(dryRunArgs, dryRunEnv);
			const outputLines = dryRunOutput.split('\n');
			const summaryLine = outputLines[outputLines.length - 1];
			const dryRunSummary = JSON.parse(summaryLine);
			console.log('dryRunBackup :', dryRunSummary);
			return dryRunSummary;
		} catch (error: any) {
			console.error('[dryRunBackup]: Failed', error.message);
			throw new Error(`Dry run failed: ${error.message}`);
		}
	}

	/**
	 * Creates the arguments for the restic backup command.
	 * @param planId - The ID of the backup plan.
	 * @param options - The options for the backup.
	 * @returns The arguments and the environment variables for the restic backup command.
	 */
	createResticBackupArgs = (planId: string, options: BackupPlanArgs) => {
		const { sourceConfig, storagePath, storage } = options;
		const { compression, performance, encryption } = options.settings;
		const resticArgs = ['backup'];
		const resticEnv: Record<string, string> = {};
		if (sourceConfig?.includes) {
			sourceConfig.includes.forEach(inPath => {
				const pathSlice = inPath.slice(0, 3);
				// Handles pattern paths
				if (!inPath.startsWith('-')) {
					const pathName = pathSlice === 'ip#' ? inPath.replace('ip#', '') : inPath;
					resticArgs.push(pathName);
				}
			});
		}
		if (sourceConfig?.excludes) {
			sourceConfig.excludes.forEach(exPath => {
				const pathSlice = exPath.slice(0, 3);
				// Handles pattern paths
				if (!exPath.startsWith('-')) {
					const xpathName = pathSlice === 'ep#' ? exPath.replace('ep#', '') : exPath;
					resticArgs.push('--exclude', xpathName);
				}
			});
		}
		if (storage.name) {
			const repoPath = generateResticRepoPath(storage.name, storagePath || '');
			resticArgs.push('-r', repoPath);
		}

		if (compression) resticArgs.push('--compression', 'auto'); // auto, max, off
		if (performance) {
			if (performance.maxProcessor) resticEnv.GOMAXPROCS = performance.maxProcessor.toString();
			if (performance.packSize) resticArgs.push('--pack-size', performance.packSize); // 16MiB, 256Mib etc.
			if (!performance.scan) resticArgs.push('--no-scan');
			if (performance.readConcurrency)
				resticArgs.push('--read-concurrency', performance.readConcurrency.toString());
			if (performance.transfers) {
				resticEnv['RCLONE_TRANSFERS'] = performance.transfers.toString();
			}
			if (performance.bufferSize) {
				resticEnv['RCLONE_BUFFER_SIZE'] = performance.bufferSize;
			}
			if (performance.multiThreadStream) {
				resticEnv['RCLONE_MULTI_THREAD_STREAMS'] = performance.multiThreadStream.toString();
			}
		}
		if (!encryption) {
			resticArgs.push('--insecure-no-password');
		}
		resticArgs.push('--tag', 'plan-' + planId);
		resticArgs.push('--json');
		return { resticArgs, resticEnv };
	};

	/**
	 * [PRO] Run user commands before a backup starts.
	 * This is an extension point for custom backup handling.
	 */
	protected async beforeBackup(
		planId: string,
		backupId: string,
		options: Record<string, any>
	): Promise<void> {
		await this.runScripts('onBackupStart', planId, backupId, options);
	}

	/**
	 *  Run user commands after a backup ends. Run on both success and error.
	 * This is an extension point for custom backup handling.
	 */
	protected async afterBackup(
		planId: string,
		backupId: string,
		options: Record<string, any>
	): Promise<void> {
		await this.runScripts('onBackupEnd', planId, backupId, options);
	}

	/**
	 *  Run user commands after a backup completes successfully.
	 * This is an extension point for custom backup handling.
	 */
	protected async afterBackupSuccess(
		planId: string,
		backupId: string,
		options: Record<string, any>
	): Promise<void> {
		await this.runScripts('onBackupComplete', planId, backupId, options);
	}

	/**
	 *  Overrides the core 'afterBackupSuccess' hook to run user commands.
	 * This is an extension point for custom backup handling.
	 */
	protected async afterBackupError(
		planId: string,
		backupId: string,
		options: Record<string, any>
	): Promise<void> {
		await this.runScripts('onBackupError', planId, backupId, options);
	}

	/**
	 * Run user commands after a backup fails permanently.
	 * This is an extension point for custom backup handling.
	 */
	protected async afterBackupFailure(
		planId: string,
		backupId: string,
		options: Record<string, any>
	): Promise<void> {
		await this.runScripts('onBackupFailure', planId, backupId, options);
	}

	protected async runScripts(
		eventName: string,
		planId: string,
		backupId: string,
		options: Record<string, any>
	) {
		const phase = this.getPhaseFromScriptEvent(eventName);
		const scripts = options?.settings?.scripts?.[eventName] || [];
		const secret = configService.config.SECRET as string;

		await runScriptsForEvent(
			eventName,
			scripts,
			secret,
			async scriptName => {
				await this.updateProgress(planId, backupId, phase, scriptName + '_START', false);
			},
			async scriptName => {
				await this.updateProgress(planId, backupId, phase, scriptName + '_COMPLETE', true);
			},
			async (scriptName, message) => {
				await this.updateProgress(planId, backupId, phase, scriptName + '_FAIL', true, message);
			}
		);
	}

	protected getPhaseFromScriptEvent(eventName: string): string {
		let phase = 'post-backup';
		if (eventName === 'onBackupStart') {
			phase = 'pre-backup';
		}

		return phase;
	}
}
