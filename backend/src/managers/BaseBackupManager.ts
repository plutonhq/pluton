import { EventEmitter } from 'events';
import { runResticCommand } from '../utils/restic/restic';
import { generateResticRepoPath } from '../utils/restic/helpers';
import { runRcloneCommand } from '../utils/rclone/rclone';
import { CronManager } from './CronManager';
import { BackupPlanArgs, PlanPrune } from '../types/plans';
import { BackupHandler } from './handlers/BackupHandler';
import { PruneHandler } from './handlers/PruneHandler';
import { jobQueue } from '../jobs/JobQueue';
import { generateUID } from '../utils/helpers';
import { configService } from '../services/ConfigService';

type ScheduleOptions = (BackupPlanArgs | PlanPrune) & {
	isActive: boolean;
	taskCallback: (id: string, opts: Record<string, any>) => void;
};

type IntegrityScheduleOptions = {
	isActive: boolean;
	taskCallback: (id: string) => void;
};

/**
 * BaseBackupManager is responsible for managing backup plans, scheduling, and execution.
 * It handles the creation, updating, and removal of backup plans and their schedules.
 * It also provides methods for performing backups and pruning old backups.
 * @class BaseBackupManager
 * @extends EventEmitter
 */
export class BaseBackupManager extends EventEmitter {
	_scheduleFilePath?: string;
	_cronManager: CronManager<ScheduleOptions | IntegrityScheduleOptions>;
	protected _backupHandler?: BackupHandler;

	constructor(configPath?: string) {
		super();
		this._scheduleFilePath = configPath;
		this._cronManager = CronManager.getInstance(
			{
				backup: this.queueBackup.bind(this),
			},
			this._scheduleFilePath
		);
	}

	get cronManager(): CronManager<ScheduleOptions | IntegrityScheduleOptions> {
		return this._cronManager;
	}

	get backupHandler(): BackupHandler {
		if (!this._backupHandler) {
			this._backupHandler = new BackupHandler(this);
		}
		return this._backupHandler;
	}

	async createBackup(
		planId: string,
		options: BackupPlanArgs
	): Promise<{ success: boolean; result: string }> {
		const { storagePath, storage } = options;
		const { encryption } = options.settings;
		const encKey = configService.config.ENCRYPTION_KEY;
		if (encryption && (!encKey || encKey.trim() === '')) {
			return {
				success: false,
				result: 'Encryption is enabled but ENCRYPTION_KEY is not set in environment variables.',
			};
		}
		// Then Create a restic repo based on the provided rclone storage and the backup path
		const repoPassword = encryption ? encKey : '';
		try {
			const repoPath = generateResticRepoPath(storage.name, storagePath || '');
			const repoCommand = ['-r', repoPath, 'init', '--verbose'];
			if (!encryption) {
				repoCommand.push('--insecure-no-password');
			}
			const repoResult = await runResticCommand(
				repoCommand,
				{
					RESTIC_PASSWORD: repoPassword,
					RCLONE_CONFIG_PASS: repoPassword,
				},
				(data: Buffer) => {
					console.log('[restic] Progress Data :', data.toString());
				}
			);
			console.log('[BaseBackupManager] 🤍 repo Creation Result :', repoResult);
		} catch (error: any) {
			// logger.error('[BaseBackup] repo Creation Error :', error);
			return { success: false, result: 'Could Not Create Restic Repo. Details: ' + error.message };
		}

		try {
			// Schedule Backup Crons
			await this.createOrUpdateSchedules(planId, options, 'create');

			// Run the initial Backup immediately.
			const initScheduleRes = await this.performBackup(planId);
			const initBackupStatus = initScheduleRes.success
				? 'Backup Schedule Created. Initial Backup Started.'
				: 'Could not Start the Initial Backup. Please run the Backup Manually.';
			return { success: true, result: initBackupStatus };
		} catch (error: any) {
			return { success: false, result: error.message };
		}
	}

	async updateBackup(
		planId: string,
		options: BackupPlanArgs
	): Promise<{ success: boolean; result: any }> {
		// Update schedule if exists
		try {
			// Schedule Backup Crons
			await this.createOrUpdateSchedules(planId, options, 'update');

			return { success: true, result: 'Backup Schedule Updated. ' + 'initBackupStatus' };
		} catch (error: any) {
			return { success: false, result: error.message };
		}
	}

	async queueBackup(planId: string, options: Record<string, any>): Promise<any> {
		// console.log('BaseBackupManager->queueBackup :', options);
		if (options && !options.isActive) {
			return; // Return to satisfy the Promise<any> signature
		}
		const backupId = generateUID();
		const { retries = 5, retryDelay = 300 } = options?.settings || {};
		jobQueue.add('Backup', { planId, backupId }, retries, retryDelay * 1000);
	}

	async removeBackup(
		planId: string,
		options: {
			storageName: string;
			storagePath: string;
			removeRemoteData: boolean;
			encryption: boolean;
		}
	): Promise<{ success: boolean; result: string }> {
		try {
			// Stop all cron jobs for this backup and remove the cron schedule
			await this.cronManager.removeSchedule(planId);
			let removeResult = 'Successfully Removed';

			// remove the remote storage data when necessary
			if (options.storagePath && options.removeRemoteData) {
				const output = await runRcloneCommand([
					'purge',
					`${options.storageName}:${options.storagePath}`,
				]);
				console.log('rclone removeResult :', output);
				removeResult += output;
			}
			return { success: true, result: removeResult };
		} catch (error: any) {
			return { success: false, result: error.message };
		}
	}

	/**
	 * This method is used to perform a backup immediately, without waiting for the scheduled time.
	 * Retries 5 times with a delay of 1 minute between each retry.
	 */
	async performBackup(planId: string): Promise<{ success: boolean; result: string }> {
		const backupId = generateUID();
		const schedules = await this.cronManager.getSchedule(planId);
		const backupSchedule = schedules?.find(s => s.type === 'backup');
		const options = backupSchedule?.options as BackupPlanArgs;
		const { retries = 5, retryDelay = 60 } = options?.settings || {};
		if (!backupSchedule || !backupSchedule.options) {
			return { success: false, result: 'No backup schedule found for this plan.' };
		}
		jobQueue.addPriorityJob('Backup', { planId, backupId }, retries, retryDelay * 1000);
		return { success: true, result: 'Backup job has been added to the queue.' };
	}

	/**
	 * Called only by the BackupTask. This performs the actual backup logic.
	 */
	async performBackupExecution(
		planId: string,
		backupId: string,
		retryInfo: { attempts: number; maxAttempts: number }
	): Promise<string> {
		console.log('[BaseBackupManager] ❎ Performing backup execution:');
		// Retrieve the schedule and its options from the CronManager
		const schedules = await this.cronManager.getSchedule(planId);
		const backupSchedule = schedules?.find(s => s.type === 'backup');

		if (!backupSchedule || !backupSchedule.options) {
			throw new Error(`No backup schedule options found for plan ${planId}.`);
		}

		const options = backupSchedule.options as BackupPlanArgs;
		return await this.backupHandler.execute(planId, backupId, options, retryInfo);
	}

	async cancelBackup(
		planId: string,
		backupId: string
	): Promise<{ success: boolean; result: string }> {
		const cancelled = await this.backupHandler.cancel(planId, backupId);

		return {
			success: cancelled,
			result: cancelled ? 'Cancelled Backup' : 'Failed to cancel Backup',
		};
	}

	async pauseBackup(planId: string): Promise<{ success: boolean; result: string }> {
		const paused = await this.cronManager.pauseSchedule(planId);

		return {
			success: paused,
			result: paused ? 'Paused Backup' : 'Failed to Pause Backup',
		};
	}

	async resumeBackup(planId: string): Promise<{ success: boolean; result: string }> {
		const resumed = await this.cronManager.resumeSchedule(planId);
		return {
			success: resumed,
			result: resumed ? 'Resumed Backup' : 'Failed to Resume Backup',
		};
	}

	async pruneBackups(planId: string): Promise<{
		success: boolean;
		result: string;
	}> {
		const schedules = await this.cronManager.getSchedule(planId);
		const backupSchedule = schedules?.find(s => s.type === 'backup');

		if (backupSchedule) {
			const pruneHandler = new PruneHandler(this);
			const pruneResult = await pruneHandler.prune(planId, backupSchedule.options, true);
			return pruneResult;
		}
		return { success: false, result: 'Backup Task Not Found' };
	}

	/**
	 * Immediately unlocks a restic repository for a given plan.
	 * @param planId - The ID of the plan for which to unlock the repository.
	 * @returns A promise that resolves to an object indicating success and the result message.
	 */
	async unlockRepo(planId: string): Promise<{ success: boolean; result: string }> {
		const schedules = await this.cronManager.getSchedule(planId);
		const backupSchedule = schedules?.find(s => s.type === 'backup');
		const encKey = configService.config.ENCRYPTION_KEY;

		if (!backupSchedule || !backupSchedule.options) {
			return {
				success: false,
				result: `No backup schedule configuration found for plan ${planId}.`,
			};
		}

		const options = backupSchedule.options as BackupPlanArgs;

		if (!options.storage || !options.storage.name) {
			return { success: false, result: 'Storage configuration is missing for this plan.' };
		}

		try {
			console.log(`[BaseBackupManager]: Force-unlocking repository for plan: ${planId}`);

			const repoPath = generateResticRepoPath(options.storage.name, options.storagePath || '');
			const repoPassword = options.settings.encryption ? encKey : '';
			// Run the restic unlock command
			const resticArgs = ['unlock', '-r', repoPath, '--json'];
			const output = await runResticCommand(resticArgs, { RESTIC_PASSWORD: repoPassword });

			const successMessage =
				output.trim() || 'Successfully removed all stale locks from the repository.';

			return { success: true, result: successMessage };
		} catch (error: any) {
			return {
				success: false,
				result: error.message || 'An unknown error occurred during the unlock process.',
			};
		}
	}

	async createOrUpdateSchedules(
		planId: string,
		options: BackupPlanArgs,
		action: 'create' | 'update' = 'create'
	) {
		const {
			cronExpression,
			settings,
			storageId,
			storage,
			storagePath,
			isActive,
			id,
			title,
			sourceConfig,
			sourceId,
		} = options;
		const backupExecOpts = {
			id,
			title,
			isActive,
			cronExpression,
			sourceConfig,
			sourceId,
			storageId,
			storage,
			storagePath,
			settings,
		};
		const backupOptions = {
			...backupExecOpts,
			isActive: backupExecOpts.isActive || false,
			taskCallback: (id: string, opts: Record<string, any>) => {
				this.queueBackup(id, opts);
			},
		};
		console.log('[CORE] action :', action);
		if (action === 'create') {
			await this.cronManager.scheduleTask(planId, cronExpression, backupOptions, 'backup');
		} else {
			const schedules = await this.cronManager.getSchedule(planId);
			const backupSchedule = schedules?.find(s => s.type === 'backup');
			if (backupSchedule) {
				await this.cronManager.updateSchedule(planId, cronExpression, backupOptions, 'backup');
			} else {
				// If for some reason the schedule does not exist, create it.
				await this.cronManager.scheduleTask(planId, cronExpression, backupOptions, 'backup');
			}
		}
	}

	async updatePlanStorageName(storageId: string, newStorageName: string) {
		console.log('updatePlanStorageName :', storageId, newStorageName);
		try {
			// Load schedules.json content
			// await this.cronManager.loadSchedules();

			// Get all schedules and iterate through each plan
			const schedules = await this.cronManager.getSchedules();
			console.log('schedules :', schedules);
			if (schedules) {
				for (const [planId, scheduleEntries] of Object.entries(schedules)) {
					const backupSchedule = scheduleEntries.find((s: any) => s.type === 'backup');

					console.log('Found Schedule :', backupSchedule);

					// Check if this backup schedule uses the storage we want to update
					if (backupSchedule?.options.storageId === storageId) {
						const updatedOptions = {
							...backupSchedule.options,
							storageName: newStorageName,
						};

						await this.cronManager.updateSchedule(
							planId,
							updatedOptions.cronExpression,
							{
								...updatedOptions,
							},
							'backup'
						);
					}
				}
			}
			return { success: true, result: 'Relevant schedules were updated with new storage name.' };
		} catch (error: any) {
			console.log('[error] updatePlanStorageName:', error);
			return {
				success: false,
				result: 'Failed to updated Schedules with new storage name. ' + error?.message || '',
			};
		}
	}

	testFunc() {
		console.log('BaseBackupManager testFunc called');
	}
}
