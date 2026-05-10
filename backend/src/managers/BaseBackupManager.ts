import { EventEmitter } from 'events';
import { runResticCommand } from '../utils/restic/restic';
import { generateResticRepoPath } from '../utils/restic/helpers';
import { runRcloneCommand } from '../utils/rclone/rclone';
import { CronManager } from './CronManager';
import { BackupPlanArgs, BackupVerifiedResult, PlanPrune } from '../types/plans';
import { BackupHandler } from './handlers/BackupHandler';
import { PruneHandler } from './handlers/PruneHandler';
import { jobQueue } from '../jobs/JobQueue';
import { jobProcessor } from '../jobs/JobProcessor';
import { generateUID } from '../utils/helpers';
import { configService } from '../services/ConfigService';
import { BackupRunConfig } from '../types/backups';

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
			const repoResult = await runResticCommand(repoCommand, {
				RESTIC_PASSWORD: repoPassword,
				RCLONE_CONFIG_PASS: repoPassword,
			});
		} catch (error: any) {
			console.warn('[createBackup] repo Creation Error :', error);
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
			replicationStorages?: { storageName: string; storagePath: string }[];
		}
	): Promise<{ success: boolean; result: string }> {
		try {
			// Stop all cron jobs for this backup and remove the cron schedule
			await this.cronManager.removeSchedule(planId);
			let removeResult = 'Successfully Removed';

			// Remove the primary storage data when necessary
			if (options.storagePath && options.removeRemoteData) {
				const output = await runRcloneCommand([
					'purge',
					`${options.storageName}:${options.storagePath}`,
				]);
				removeResult += output;
			}

			// Also remove data from replication storages
			if (options.removeRemoteData && options.replicationStorages?.length) {
				for (const replica of options.replicationStorages) {
					try {
						const output = await runRcloneCommand([
							'purge',
							`${replica.storageName}:${replica.storagePath}`,
						]);
						removeResult += ` | Replication ${replica.storageName}: ${output}`;
					} catch (error: any) {
						// Log but don't fail the entire removal if a replication storage purge fails
						console.warn(
							`[removeBackup] Failed to purge replication storage ${replica.storageName}:${replica.storagePath}: ${error.message}`
						);
						removeResult += ` | Replication ${replica.storageName} purge failed: ${error.message}`;
					}
				}
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
	async performBackup(
		planId: string,
		runConfig?: BackupRunConfig
	): Promise<{ success: boolean; result: string }> {
		const backupId = generateUID();
		const schedules = await this.cronManager.getSchedule(planId);
		const backupSchedule = schedules?.find(s => s.type === 'backup');
		const options = backupSchedule?.options as BackupPlanArgs;
		const { retries = 5, retryDelay = 60 } = options?.settings || {};
		if (!backupSchedule || !backupSchedule.options) {
			return { success: false, result: 'No backup schedule found for this plan.' };
		}
		jobQueue.addPriorityJob('Backup', { planId, backupId, runConfig }, retries, retryDelay * 1000);
		const activeBackupJobs = jobProcessor.getActiveBackupJobs();
		const maxConcurrentBackups = configService.config.MAX_CONCURRENT_BACKUPS;
		const reachedLimit = activeBackupJobs >= maxConcurrentBackups;
		const resultMessage = reachedLimit
			? `Backup Queue has reached the concurrency limit of ${maxConcurrentBackups}. Your backup will start shortly.`
			: 'Backup job has been added to the queue and will start shortly.';

		return { success: true, result: resultMessage };
	}

	/**
	 * Called only by the BackupTask. This performs the actual backup logic.
	 */
	async performBackupExecution(
		planId: string,
		backupId: string,
		retryInfo: { attempts: number; maxAttempts: number },
		runConfig?: BackupRunConfig
	): Promise<string> {
		// Retrieve the schedule and its options from the CronManager
		const schedules = await this.cronManager.getSchedule(planId);
		const backupSchedule = schedules?.find(s => s.type === 'backup');

		if (!backupSchedule || !backupSchedule.options) {
			throw new Error(`No backup schedule options found for plan ${planId}.`);
		}

		const options = backupSchedule.options as BackupPlanArgs;
		return await this.backupHandler.execute(planId, backupId, options, retryInfo, runConfig);
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

	/**
	 * Retries failed replication operations for a specific backup.
	 * Directly calls BackupHandler to run replications synchronously (awaited).
	 */
	async retryFailedReplications(
		planId: string,
		backupId: string,
		failedReplicationIds: string[]
	): Promise<{ success: boolean; result: string }> {
		try {
			const schedules = await this.cronManager.getSchedule(planId);
			const backupSchedule = schedules?.find(s => s.type === 'backup');

			if (!backupSchedule || !backupSchedule.options) {
				return { success: false, result: `No backup schedule options found for plan ${planId}.` };
			}

			const options = backupSchedule.options as BackupPlanArgs;
			const replication = options.settings?.replication;

			if (!replication?.enabled || !replication.storages?.length) {
				return { success: false, result: 'Replication is not enabled for this plan.' };
			}

			// Filter to only the failed storages
			const replicationStorages = replication.storages.filter(s =>
				failedReplicationIds.includes(s.replicationId)
			);

			if (replicationStorages.length === 0) {
				return { success: false, result: 'No matching replication storages found.' };
			}

			// Directly call BackupHandler to run replications synchronously
			const results = await this.backupHandler.retryFailedReplications(
				planId,
				backupId,
				options,
				failedReplicationIds
			);

			const allSucceeded = results.every(m => m.status === 'completed');
			return {
				success: allSucceeded,
				result: allSucceeded
					? 'All replications succeeded.'
					: `${results.filter(m => m.status === 'failed').length} replication(s) still failed.`,
			};
		} catch (error: any) {
			return { success: false, result: error.message || 'Failed to retry replications.' };
		}
	}

	/**
	 * Removes a single replication storage's data from the remote storage via rclone purge.
	 */
	async removeReplicationStorage(
		planId: string,
		options: {
			storageName: string;
			storagePath: string;
			removeData: boolean;
		}
	): Promise<{ success: boolean; result: string }> {
		try {
			let result = 'Replication storage removed from plan.';

			if (options.removeData && options.storagePath) {
				const output = await runRcloneCommand([
					'purge',
					`${options.storageName}:${options.storagePath}`,
				]);
				result += ` Data purged: ${output}`;
			}

			return { success: true, result };
		} catch (error: any) {
			return {
				success: false,
				result: error.message || 'Failed to remove replication storage data.',
			};
		}
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

	async pruneBackups(
		planId: string,
		replicationStorages?: { storageName: string; storagePath: string }[]
	): Promise<{
		success: boolean;
		result: string;
	}> {
		const schedules = await this.cronManager.getSchedule(planId);
		const backupSchedule = schedules?.find(s => s.type === 'backup');

		if (backupSchedule) {
			const pruneHandler = new PruneHandler(this);
			const pruneResult = await pruneHandler.prune(planId, backupSchedule.options, true);

			// Also prune replication storages
			if (replicationStorages?.length) {
				const options = backupSchedule.options as BackupPlanArgs;
				for (const replica of replicationStorages) {
					try {
						const replicaOptions = {
							...backupSchedule.options,
							storage: { ...options.storage, name: replica.storageName },
							storagePath: replica.storagePath,
						};
						await pruneHandler.prune(planId, replicaOptions, false);
					} catch (error: any) {
						console.warn(
							`[pruneBackups] Failed to prune replication storage ${replica.storageName}: ${error.message}`
						);
					}
				}
			}

			return pruneResult;
		}
		return { success: false, result: 'Backup Task Not Found' };
	}

	/**
	 * Immediately unlocks a restic repository for a given plan.
	 * @param planId - The ID of the plan for which to unlock the repository.
	 * @returns A promise that resolves to an object indicating success and the result message.
	 */
	async unlockRepo(
		planId: string,
		replicationStorages?: { storageName: string; storagePath: string }[]
	): Promise<{ success: boolean; result: string }> {
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
			const repoPath = generateResticRepoPath(options.storage.name, options.storagePath || '');
			const repoPassword = options.settings.encryption ? encKey : '';
			// Run the restic unlock command on the primary repo
			const resticArgs = ['unlock', '-r', repoPath, '--json'];
			const output = await runResticCommand(resticArgs, { RESTIC_PASSWORD: repoPassword });

			let resultMessage =
				output.trim() || 'Successfully removed all stale locks from the repository.';

			// Also unlock replication storages
			if (replicationStorages?.length) {
				for (const replica of replicationStorages) {
					try {
						const replicaRepoPath = generateResticRepoPath(
							replica.storageName,
							replica.storagePath || ''
						);
						await runResticCommand(['unlock', '-r', replicaRepoPath, '--json'], {
							RESTIC_PASSWORD: repoPassword,
						});
						resultMessage += ` | ${replica.storageName}: unlocked`;
					} catch (error: any) {
						console.warn(
							`[unlockRepo] Failed to unlock replication storage ${replica.storageName}: ${error.message}`
						);
						resultMessage += ` | ${replica.storageName}: unlock failed - ${error.message}`;
					}
				}
			}

			return { success: true, result: resultMessage };
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
		try {
			// Get all schedules and iterate through each plan
			const schedules = await this.cronManager.getSchedules();
			if (schedules) {
				for (const [planId, scheduleEntries] of Object.entries(schedules)) {
					const backupSchedule = scheduleEntries.find((s: any) => s.type === 'backup');
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

	async checkIntegrity(
		planId: string
	): Promise<{ success: boolean; result: Record<string, string | null> }> {
		const schedules = await this.cronManager.getSchedule(planId);
		const backupSchedule = schedules?.find(s => s.type === 'backup');
		if (backupSchedule) {
			this.emit('integrity_start', { planId: planId });
			const { storage, storagePath, settings } = backupSchedule?.options as Record<string, any>;
			const repSettings = settings?.replication;
			const hasMirrors =
				repSettings?.enabled && repSettings.storages && repSettings.storages.length > 0;
			const replicationStorages = hasMirrors ? repSettings.storages : [];
			const allStorages =
				replicationStorages.length > 0
					? [
							{ storageName: storage.name, storagePath, storageId: storage.id },
							...replicationStorages,
						]
					: [{ storageName: storage.name, storagePath, storageId: storage.id }];

			const errorMsg: Record<string, string | null> = { primary: null } as Record<
				string,
				string | null
			>;
			const resultObj: Record<string, string | null> = { primary: null } as Record<
				string,
				string | null
			>;
			for (const theStorage of allStorages) {
				const index =
					theStorage.storageId === storage.id ? 'primary' : 'mirror_' + theStorage.storageId;
				errorMsg[index] = null;
				resultObj[index] = null;

				const resticArgs = ['check'];
				const repoPassword = settings.encryption
					? (configService.config.ENCRYPTION_KEY as string)
					: '';

				if (theStorage.storageName) {
					const repoPath = generateResticRepoPath(
						theStorage.storageName,
						theStorage.storagePath || ''
					);
					resticArgs.push('-r', repoPath);
				} else {
					return { success: false, result: { [index]: 'No storage name found' } };
				}

				// Read Method
				const method = settings.integrity?.method || '5%';
				if (['5%', '10%', '25%', '50%'].includes(method)) {
					resticArgs.push('--read-data-subset', method);
				}
				if (method === 'full') {
					resticArgs.push('--read-data');
				}

				// resticArgs.push('--json');
				try {
					const checkRes = await runResticCommand(resticArgs, { RESTIC_PASSWORD: repoPassword });
					resultObj[index] = checkRes;
				} catch (error: any) {
					const errMsg = (error instanceof Error && error.message) || 'Unknown Error';
					errorMsg[index] = errMsg;
					resultObj[index] = errMsg;
				}
			}

			this.emit('integrity_end', { planId: planId, result: resultObj });
			return {
				success: true,
				result: resultObj,
			};
		}

		this.emit('integrity_failed', {
			planId: planId,
			result: { primary: 'No backup schedule found' },
		});
		return { success: false, result: { primary: 'No Backup schedule found' } };
	}

	async repairRepo(
		planId: string,
		repairType: 'snapshots' | 'index' | 'packs',
		checkRes: BackupVerifiedResult,
		options: { storageName: string; storagePath: string }
	): Promise<{ success: boolean; result: string }> {
		try {
			// Check if encryption is enabled for this plan and if ENCRYPTION_KEY is set when necessary before attempting repair
			const encKey = configService.config.ENCRYPTION_KEY;
			const schedules = await this.cronManager.getSchedule(planId);
			const backupSchedule = schedules?.find(s => s.type === 'backup');
			const backupOptions = backupSchedule?.options as BackupPlanArgs;
			const encryption = backupOptions?.settings.encryption;
			if (encryption && (!encKey || encKey.trim() === '')) {
				return {
					success: false,
					result: 'Encryption is enabled but ENCRYPTION_KEY is not set in environment variables.',
				};
			}

			// Run restic repair command to either repair snapshots or index based on the repairType parameter
			const repoPassword = encryption ? encKey : '';
			try {
				const repoPath = generateResticRepoPath(options.storageName, options.storagePath || '');
				const repairCommand = ['-r', repoPath, 'repair', repairType];
				if (repairType === 'snapshots') {
					repairCommand.push('--forget');
				}

				if (repairType === 'packs') {
					const resticPackCommandMsg = checkRes.logs.find(log =>
						log.includes('restic repair packs')
					);
					if (resticPackCommandMsg) {
						const packIdsMatch = resticPackCommandMsg.match(/restic repair packs (.+)/);
						if (packIdsMatch && packIdsMatch[1]) {
							const packIds = packIdsMatch[1].split(' ');
							repairCommand.push(...packIds);
						} else {
							return { success: false, result: 'Could not extract pack IDs for repair.' };
						}
					}
				}

				if (!encryption) {
					repairCommand.push('--insecure-no-password');
				}
				const repairResult = await runResticCommand(repairCommand, {
					RESTIC_PASSWORD: repoPassword,
					RCLONE_CONFIG_PASS: repoPassword,
				});
				return { success: true, result: repairResult };
			} catch (error: any) {
				console.warn('[repairRepo] repo Repair Error :', error);
				return {
					success: false,
					result: 'Could Not Repair Restic Repo. Details: ' + error.message,
				};
			}
		} catch (error: any) {
			console.log('[repairRepo] error :', error);
			return { success: false, result: 'No Backup schedule found' };
		}
	}
}
