import path from 'path';
import os from 'os';
import { existsSync, constants } from 'fs';
import { rm, access } from 'fs/promises';
import { EventEmitter } from 'events';
import { getSnapshotByTag, runHelperRestore, runResticCommand } from '../../utils/restic/restic';
import { generateResticRepoPath, resticPathToWindows } from '../../utils/restic/helpers';
import {
	buildHelperRestoreArgs,
	buildResticRestoreCommand,
	createNormalizedRestoreRequest,
} from '../../utils/restic/restoreArgs';
import { processManager } from '../ProcessManager';
import copyFilesNatively from '../../utils/copyFiles';
import { ResticRestoredFile, ResticSnapshot } from '../../types/restic';
import { ProgressManager } from '../ProgressManager';
import { appPaths } from '../../utils/AppPaths';
import { RestoreOptions } from '../../types/restores';
import { RestoreStatsManager } from '../RestoreStatsManager';
import { configService } from '../../services/ConfigService';
import {
	canWriteTargetOrParent,
	isHelperDeniedTarget,
	isLinuxInstalledRuntime,
	isPermissionDeniedError,
	runHelper,
} from '../../utils/linuxHelper';

export class RestoreHandler {
	private runningRestores = new Set<string>();
	private cancelledRestores = new Set<string>();
	private progressManager: ProgressManager;
	private restoreStatsManager: RestoreStatsManager;

	constructor(private emitter: EventEmitter) {
		this.progressManager = new ProgressManager(appPaths.getProgressDir(), 'restore');
		this.restoreStatsManager = new RestoreStatsManager();
		this.initializeProgressManager();
	}

	private async initializeProgressManager(): Promise<void> {
		try {
			await this.progressManager.initialize();
		} catch (error) {
			console.warn(`Failed to initialize progress manager for restores: ${error}`);
		}
	}

	/**
	 * Executes the entire restore process, including pre-flight checks,
	 * the restore itself, and post-restore actions. This is the main entry point
	 * for the RestoreTask.
	 */
	async execute(
		backupId: string,
		restoreId: string,
		options: RestoreOptions,
		retryInfo: { attempts: number; maxAttempts: number }
	): Promise<string> {
		const { planId } = options;

		// Prevent the same plan from running concurrently.
		if (this.runningRestores.has(planId)) {
			throw new Error(`Restore is already in progress for plan: ${planId}`);
		}
		this.runningRestores.add(planId);

		// Initialize progress file
		try {
			await this.progressManager.initializeProgress(planId, restoreId, retryInfo);
		} catch (error) {
			console.warn(`Failed to initialize restore progress file: ${error}`);
		}

		// Initialize stats file
		try {
			await this.restoreStatsManager.initialize(
				planId,
				backupId,
				restoreId,
				options.sources || [],
				options
			);
		} catch (error) {
			console.warn(`[RestoreHandler] Failed to initialize restore stats file: ${error}`);
		}

		if (retryInfo.attempts > 0) {
			await this.updateProgress(
				planId,
				restoreId,
				'pre-restore',
				`RETRY_ATTEMPT_${retryInfo.attempts}_OF_${retryInfo.maxAttempts}_START`,
				false
			);
		}

		try {
			// --- 1. PRE-RESTORE PHASE ---
			const snapshot = await this.preRestorePhase(planId, backupId, restoreId, options);
			if (this.cancelledRestores.has(planId)) {
				throw new Error('RESTORE_CANCELLED: Restore was cancelled');
			}

			// --- 2. RESTORE PHASE ---
			const result = await this.executeRestorePhase(planId, backupId, restoreId, snapshot, options);
			if (this.cancelledRestores.has(planId)) {
				throw new Error('RESTORE_CANCELLED: Restore was cancelled');
			}

			// --- 3. POST-RESTORE PHASE ---
			await this.postRestorePhase(planId, backupId, restoreId, snapshot, options);

			// Mark as completed
			await this.progressManager.markCompleted(planId, restoreId, true);
			await this.afterRestore(planId, restoreId, options);

			return result;
		} catch (error: any) {
			const errorMessage = error instanceof Error ? error.message : 'Unknown execution error';

			// If Cancelled by the user, do not retry or mark as failed.
			const isCancelled = errorMessage.startsWith('RESTORE_CANCELLED:');
			if (isCancelled) {
				return '';
			}

			// --- 4. CENTRALIZED ERROR HANDLING ---
			const permanentlyFailed = retryInfo.attempts + 1 > retryInfo.maxAttempts;

			await this.progressManager.markCompleted(
				planId,
				restoreId,
				false,
				errorMessage,
				permanentlyFailed
			);

			if (!permanentlyFailed) {
				await this.updateProgress(
					planId,
					restoreId,
					'retry',
					`RESTORE_RETRY_${retryInfo.attempts + 1}_OF_${retryInfo.maxAttempts}_SCHEDULED`,
					false
				);
			}

			// Emit the 'error' event for the listener to log the attempt failure.
			this.emitter.emit('restore_error', {
				planId,
				backupId,
				restoreId,
				error: errorMessage,
			});

			// Run post-failure scripts.
			if (permanentlyFailed) {
				await this.afterRestoreFailure(planId, restoreId, options);
			} else {
				await this.afterRestoreError(planId, restoreId, options);
			}
			await this.afterRestore(planId, restoreId, options);

			// Re-throw the error for the JobProcessor to handle retries.
			throw new Error(errorMessage);
		} finally {
			this.runningRestores.delete(planId);
			this.cancelledRestores.delete(planId);
		}
	}

	/**
	 * Pre-restore phase: validation, dry run, and preparation.
	 */
	private async preRestorePhase(
		planId: string,
		backupId: string,
		restoreId: string,
		options: RestoreOptions
	): Promise<ResticSnapshot> {
		await this.updateProgress(planId, restoreId, 'pre-restore', 'PRE_RESTORE_START', false);

		// Get snapshot details
		await this.updateProgress(planId, restoreId, 'pre-restore', 'PRE_RESTORE_GET_SNAPSHOT', false);
		const snapshotTagRes = await getSnapshotByTag('backup-' + backupId, options);
		if (!snapshotTagRes.success || typeof snapshotTagRes.result !== 'object') {
			throw new Error((snapshotTagRes.result as string) || 'Could not retrieve snapshot details.');
		}
		const snapshot = snapshotTagRes.result;
		await this.updateProgress(
			planId,
			restoreId,
			'pre-restore',
			'PRE_RESTORE_GET_SNAPSHOT_COMPLETE',
			true
		);

		// Perform dry run
		await this.updateProgress(planId, restoreId, 'pre-restore', 'PRE_RESTORE_DRY_RUN_START', false);
		const restoreStats = await this.dryRestore(backupId, snapshot.id, options);
		if (!restoreStats.success) {
			throw new Error((restoreStats.result as string) || 'Restore dry run failed.');
		}
		if (typeof restoreStats.result == 'object' && restoreStats.result?.files) {
			await this.restoreStatsManager.update(
				restoreId,
				restoreStats.result?.files || [],
				restoreStats.result.stats
			);
		}
		await this.updateProgress(
			planId,
			restoreId,
			'pre-restore',
			'PRE_RESTORE_DRY_RUN_COMPLETE',
			true
		);

		// Emit 'restore_start' to create the DB record.
		this.emitter.emit('restore_start', {
			restoreId,
			backupId,
			planId,
			stats: typeof restoreStats.result == 'object' ? restoreStats.result.stats : undefined,
			config: {
				target: options.target,
				overwrite: options.overwrite,
				includes: options.includes,
				excludes: options.excludes,
			},
		});

		// Wait for DB record creation
		await this.waitForRestoreCreation(backupId);

		// Run pre-flight checks
		await this.updateProgress(planId, restoreId, 'pre-restore', 'PRE_RESTORE_CHECKS_START', false);
		await this.canRun(options);
		await this.updateProgress(
			planId,
			restoreId,
			'pre-restore',
			'PRE_RESTORE_CHECKS_COMPLETE',
			true
		);

		// Unlock stale locks
		await this.updateProgress(
			planId,
			restoreId,
			'pre-restore',
			'PRE_RESTORE_UNLOCK_STALE_LOCKS',
			false
		);
		await this.unlockStaleLocks(planId, {
			storageName: options.storageName,
			storagePath: options.storagePath,
			encryption: options.encryption,
		});

		// Run BeforeRestore Hook
		await this.beforeRestore(planId, restoreId, options);

		await this.updateProgress(planId, restoreId, 'pre-restore', 'PRE_RESTORE_COMPLETE', true);

		return snapshot;
	}

	/**
	 * Restore phase: executes the actual restic restore command.
	 */
	private async executeRestorePhase(
		planId: string,
		backupId: string,
		restoreId: string,
		snapshot: ResticSnapshot,
		options: RestoreOptions
	): Promise<string> {
		await this.updateProgress(planId, restoreId, 'restore', 'RESTORE_OPERATION_START', false);
		const handlers = this.createHandlers(planId, backupId, restoreId);
		const resticOpts = this.createResticRestoreArgs(backupId, snapshot.id, options);
		const helperArgs = this.createHelperRestoreArgs(backupId, snapshot.id, options);
		const useHelper = await this.shouldUseHelperRestore(options);

		try {
			const result = useHelper
				? await runHelperRestore(
					helperArgs,
					handlers.onProgress,
					handlers.onError,
					handlers.onComplete,
					process => processManager.trackProcess(`restore-${restoreId}`, process)
				)
				: await runResticCommand(
					resticOpts.args,
					resticOpts.env,
					handlers.onProgress,
					handlers.onError,
					handlers.onComplete,
					process => processManager.trackProcess(`restore-${restoreId}`, process)
				);
			await this.updateProgress(planId, restoreId, 'restore', 'RESTORE_OPERATION_COMPLETE', true);
			return result;
		} catch (error: any) {
			let restoreError = error;
			if (!useHelper && isLinuxInstalledRuntime() && isPermissionDeniedError(error)) {
				await this.validateHelperRestoreTarget(options);
				try {
					const result = await runHelperRestore(
						helperArgs,
						handlers.onProgress,
						handlers.onError,
						handlers.onComplete,
						process => processManager.trackProcess(`restore-${restoreId}`, process)
					);
					await this.updateProgress(
						planId,
						restoreId,
						'restore',
						'RESTORE_OPERATION_COMPLETE',
						true
					);
					return result;
				} catch (helperError) {
					restoreError = helperError;
				}
			}

			const errMsg = restoreError.message || 'Restic restore command failed';

			// On macOS, restic exits with code 1 for non-fatal xattr errors (e.g.,
			// SIP-protected "com.apple.rootless"). The file data is restored successfully;
			// only the extended attribute write fails. Treat these as warnings, not failures.
			const isXattrOnly =
				process.platform === 'darwin' &&
				/xattr\.LSet.*operation not permitted/i.test(errMsg) &&
				!/fatal(?!.*xattr)/i.test(errMsg);

			if (isXattrOnly) {
				console.warn(
					`[RestoreHandler] Restic reported xattr errors but file data was restored. Treating as success.`
				);
				await this.updateProgress(
					planId,
					restoreId,
					'restore',
					'RESTORE_OPERATION_COMPLETE',
					true,
					'Restore completed but some macOS extended attributes could not be set (SIP restriction).'
				);
				return '';
			}

			await this.updateProgress(
				planId,
				restoreId,
				'restore',
				'RESTORE_OPERATION_ERROR',
				true,
				errMsg
			);
			throw restoreError;
		}
	}

	/**
	 * Post-restore phase: handles platform-specific file moving.
	 */
	private async postRestorePhase(
		planId: string,
		backupId: string,
		restoreId: string,
		snapshot: ResticSnapshot,
		options: RestoreOptions
	): Promise<void> {
		await this.updateProgress(planId, restoreId, 'post-restore', 'POST_RESTORE_START', false);
		const { target, overwrite = 'always' } = options;

		// On Windows, Restic may not restore to original paths. We handle this by moving files.
		if (process.platform === 'win32' && (!target || target === '/')) {
			await this.updateProgress(
				planId,
				restoreId,
				'post-restore',
				'POST_RESTORE_WINDOWS_MOVE_START',
				false
			);
			const restoresDir = appPaths.getRestoresDir();
			const winRestorePath = path.join(restoresDir, `backup-${backupId}`);
			const errorMessages: string[] = [];

			for (const sourcePath of snapshot.paths) {
				try {
					const sourceRoot = path.parse(sourcePath).root;
					const driveLetter = sourceRoot.replace(':\\', '');
					const relativePath = sourcePath.substring(sourceRoot.length);
					const sourceItemInTempDir = path.join(winRestorePath, driveLetter, relativePath);
					const destinationPath = sourcePath;

					console.log('Copying files from', sourceItemInTempDir, 'to', destinationPath);
					// Verify the item exists in the temp directory before trying to copy
					await access(sourceItemInTempDir, constants.F_OK);
					await copyFilesNatively(sourceItemInTempDir, destinationPath, overwrite);
				} catch (error: any) {
					console.log('Error occurred while copying files:', error);
					errorMessages.push(`Failed to move files to ${sourcePath}: ${error.message}`);
				}
			}

			if (errorMessages.length > 0) {
				const finalError =
					errorMessages.join('\n') +
					`. Failed to Move files. Manually move the restored files from ${winRestorePath} to desired location.`;
				await this.updateProgress(
					planId,
					restoreId,
					'post-restore',
					'POST_RESTORE_WINDOWS_MOVE_ERROR',
					false,
					finalError
				);
				// We don't throw here, just log the error. The restore itself was successful.
			} else {
				if (existsSync(winRestorePath)) {
					try {
						await rm(winRestorePath, { recursive: true, force: true });
					} catch (error: any) {
						console.log(
							`[postRestorePhase] Warning: Failed to remove temp restore folder: ${winRestorePath}`
						);
					}
				}
				await this.updateProgress(
					planId,
					restoreId,
					'post-restore',
					'POST_RESTORE_WINDOWS_MOVE_COMPLETE',
					true
				);
			}
		}

		await this.afterRestoreSuccess(planId, restoreId, options);
		await this.updateProgress(planId, restoreId, 'post-restore', 'POST_RESTORE_COMPLETE', true);
	}

	/**
	 * Helper to update restore progress with error handling.
	 */
	protected async updateProgress(
		planId: string,
		restoreId: string,
		phase: string,
		action: string,
		completed: boolean,
		error?: string
	): Promise<void> {
		try {
			await this.progressManager.updateAction(planId, restoreId, phase, action, completed, error);
		} catch (progressError) {
			console.warn(
				`[RestoreHandler] Warning: Failed to update progress for ${phase}/${action}: ${progressError}`
			);
		}
	}

	/**
	 * Waits for the `restoreCreated` event to ensure the DB record exists.
	 */
	private waitForRestoreCreation(backupId: string): Promise<void> {
		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.emitter.removeListener('restoreCreated', onRestoreCreated);
				reject(
					new Error(`Timeout: Did not receive restore_created confirmation for backup: ${backupId}`)
				);
			}, 30000);

			const onRestoreCreated = (data: { backupId: string; restoreId: string }) => {
				if (data.backupId === backupId) {
					clearTimeout(timeout);
					this.emitter.removeListener('restoreCreated', onRestoreCreated);
					resolve();
				}
			};

			this.emitter.on('restoreCreated', onRestoreCreated);
		});
	}

	async canRun(options: RestoreOptions) {
		// Check system resource availability
		// Use a fixed minimum (128MB) rather than scaling by CPU count.
		// Restic's memory usage doesn't scale linearly with cores, and on macOS
		// os.freemem() excludes reclaimable cached memory.
		const availableMemory = os.freemem();
		const requiredMemory = 128 * 1024 * 1024; // 128MB minimum
		if (availableMemory < requiredMemory) {
			throw new Error(`Insufficient memory to perform restore.`);
		}

		// Check if encryption key is available when encryption is enabled
		if (options.encryption && !configService.config.ENCRYPTION_KEY) {
			throw new Error(`Snapshot encrypted but ENCRYPTION_KEY not found.`);
		}

		// Check if target path is accessible
		if (isLinuxInstalledRuntime()) {
			await this.validateHelperRestoreTarget(options);
			const target = options.target || '/';
			const targetWritable = await canWriteTargetOrParent(target);
			if (!targetWritable) {
				try {
					await runHelper('version');
				} catch (error: any) {
					throw new Error(
						`Target path requires pluton-helper, but helper is unavailable: ${error.message}`
					);
				}
			}
		} else if (options.target && options.target !== '/') {
			try {
				await access(path.dirname(options.target), constants.W_OK);
			} catch (error) {
				throw new Error(`Target path not writable: ${options.target}`);
			}
		}

		// Check if restic is installed when the direct path may be used.
		if (!isLinuxInstalledRuntime() || (await canWriteTargetOrParent(options.target || '/'))) {
			try {
				await runResticCommand(['version']);
			} catch (error) {
				throw new Error(`Restic is not installed.`);
			}
		}

		return true;
	}

	createResticRestoreArgs(
		backupId: string,
		snapshotId: string,
		options: RestoreOptions,
		dryRun: boolean = false
	) {
		const repoPassword = options.encryption ? configService.config.ENCRYPTION_KEY : '';
		const request = createNormalizedRestoreRequest(
			backupId,
			snapshotId,
			options,
			repoPassword,
			dryRun
		);
		return buildResticRestoreCommand(request);
	}

	createHelperRestoreArgs(
		backupId: string,
		snapshotId: string,
		options: RestoreOptions,
		dryRun: boolean = false
	) {
		const repoPassword = options.encryption ? configService.config.ENCRYPTION_KEY : '';
		const request = createNormalizedRestoreRequest(
			backupId,
			snapshotId,
			options,
			repoPassword,
			dryRun
		);
		return buildHelperRestoreArgs(request);
	}

	async dryRestore(
		backupId: string,
		snapshotId: string,
		options: RestoreOptions
	): Promise<{ success: boolean; result: string | { stats: any; files: ResticRestoredFile[] } }> {
		try {
			const resticOpts = this.createResticRestoreArgs(backupId, snapshotId, options, true);
			const helperArgs = this.createHelperRestoreArgs(backupId, snapshotId, options, true);
			let dryRes: string;

			if (await this.shouldUseHelperRestore(options)) {
				dryRes = await runHelperRestore(helperArgs);
			} else {
				try {
					dryRes = await runResticCommand(resticOpts.args, resticOpts.env);
				} catch (error) {
					if (!isLinuxInstalledRuntime() || !isPermissionDeniedError(error)) {
						throw error;
					}
					await this.validateHelperRestoreTarget(options);
					dryRes = await runHelperRestore(helperArgs);
				}
			}

			const { stats, files } = this.parseDryRestoreResult(dryRes);

			return {
				success: true,
				result: {
					stats: {
						total_files: stats.total_files,
						files_restored: stats.files_restored,
						total_bytes: stats.total_bytes,
						bytes_restored: stats.bytes_restored,
					},
					files,
				},
			};
		} catch (error: any) {
			return {
				success: false,
				result: error?.message || 'Failed to get dry run results',
			};
		}
	}

	private async shouldUseHelperRestore(options: RestoreOptions): Promise<boolean> {
		if (!isLinuxInstalledRuntime()) {
			return false;
		}

		await this.validateHelperRestoreTarget(options);
		return !(await canWriteTargetOrParent(options.target || '/'));
	}

	private async validateHelperRestoreTarget(options: RestoreOptions): Promise<void> {
		const target = options.target || '/';
		const allowRootTarget = target === '/' && ((options.includes?.length || 0) > 0 || (options.sources?.length || 0) > 0);
		if (isHelperDeniedTarget(target, allowRootTarget)) {
			throw new Error(
				`Restore target is not allowed for privileged restore: ${target}. Choose a non-system directory such as /srv/pluton-restore.`
			);
		}
		if (target === '/' && !allowRootTarget) {
			throw new Error(
				"Privileged restore to '/' requires at least one included source path so the helper can scope the restore."
			);
		}
	}

	private parseDryRestoreResult(dryRes: string): { stats: any; files: ResticRestoredFile[] } {
		const jsonLines = dryRes.split('\n').filter(line => line.trim());
		const parsedLines = jsonLines.map(line => JSON.parse(line));
		const stats = parsedLines.find(item => item.message_type === 'summary');

		const files: ResticRestoredFile[] = parsedLines
			.filter(item => item.message_type === 'verbose_status')
			.map(item => ({
				path: process.platform === 'win32' ? resticPathToWindows(item.item) : item.item,
				size: parseInt(item.size, 10),
				action: item.action,
			}));

		return { stats, files };
	}

	async cancel(planId: string, restoreId: string) {
		this.cancelledRestores.add(planId);
		await this.progressManager.markCompleted(
			planId,
			restoreId,
			false,
			'Restoration was cancelled by user',
			true
		);

		try {
			const killed = processManager.killProcess('restore-' + restoreId);
			console.log('[Cancel Restore] killed:', killed);
			return true;
		} catch (error: any) {
			throw new Error('Error Cancelling restore. ' + error?.message || '');
		}
	}

	private createHandlers(planId: string, backupId: string, restoreId: string) {
		return {
			onProgress: (data: Buffer) => {
				const progressLine = data.toString().trim();
				this.progressManager.updateResticProgress(planId, restoreId, progressLine);
			},
			onError: (data: Buffer) => {
				this.emitter.emit('restore_error', {
					backupId,
					restoreId,
					planId,
					error: data.toString(),
				});
			},
			onComplete: (code: number | null) => {
				this.emitter.emit('restore_complete', {
					backupId,
					restoreId,
					planId,
					success: code === 0,
				});
			},
		};
	}

	/**
	 * Helper to unlock stale repository locks.
	 */
	private async unlockStaleLocks(
		planId: string,
		options: { storageName: string; storagePath: string; encryption: boolean }
	): Promise<void> {
		if (options.storageName && options.storagePath) {
			try {
				const repoPath = generateResticRepoPath(options.storageName, options.storagePath || '');
				const repoPassword = options.encryption ? configService.config.ENCRYPTION_KEY : '';

				await runResticCommand(['unlock', '-r', repoPath], {
					RESTIC_PASSWORD: repoPassword,
				});
			} catch (error: any) {
				console.warn(
					`[BackupHandler]: Failed to unlock stale locks for plan: ${planId}. Error:  ${error.message}`
				);
			}
		}
	}

	// Placeholder methods for future script hooks
	protected async beforeRestore(planId: string, restoreId: string, options: RestoreOptions) {}
	protected async afterRestore(planId: string, restoreId: string, options: RestoreOptions) {}
	protected async afterRestoreSuccess(planId: string, restoreId: string, options: RestoreOptions) {}
	protected async afterRestoreError(planId: string, restoreId: string, options: RestoreOptions) {}
	protected async afterRestoreFailure(planId: string, restoreId: string, options: RestoreOptions) {}
}
