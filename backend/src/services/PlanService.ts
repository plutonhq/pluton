import { createReadStream } from 'fs';
import { access, constants, readFile } from 'fs/promises';
import { BaseBackupManager } from '../managers/BaseBackupManager';
import { PlanStore } from '../stores/PlanStore';
import { BackupStore } from '../stores/BackupStore';
import { StorageStore } from '../stores/StorageStore';
import { RestoreStore } from '../stores/RestoreStore';
import { Plan, NewPlan, planInsertSchema, planUpdateSchema } from '../db/schema/plans';
import {
	BackupPlanArgs,
	NewPlanReq,
	PlanLogItem,
	PlanNotification,
	PlanNotificationType,
} from '../types/plans';
import { planLogger } from '../utils/logger';
import { generateUID } from '../utils/helpers';
import { intervalToCron } from '../utils/intervalToCron';
import { LocalStrategy as LocalBackupStrategy } from '../strategies/backup/LocalStrategy';
import { RemoteStrategy as RemoteBackupStrategy } from '../strategies/backup/RemoteStrategy';
import { DeviceStore } from '../stores/DeviceStore';
import { BackupStrategy } from '../strategies/backup';
import { appPaths } from '../utils/AppPaths';
import { AppError, NotFoundError } from '../utils/AppError';
import { SourceTypes } from '../types/source';
import { sanitizeStoragePath } from '../utils/sanitizeStoragePath';
import { BackupNotification } from '../notifications/BackupNotification';
import { ScheduleReconciler } from './ScheduleReconciler';

/**
 * PlanService is the central orchestrator for all business logic related to backup plans.
 * It manages database state, orchestrates local execution via BaseBackupManager,
 * and delegates remote execution to strategies.
 */
export class PlanService {
	protected scheduleReconciler: ScheduleReconciler;

	constructor(
		protected localAgent: BaseBackupManager,
		protected planStore: PlanStore,
		protected backupStore: BackupStore,
		protected storageStore: StorageStore,
		protected deviceStore: DeviceStore,
		protected restoreStore: RestoreStore
	) {
		this.scheduleReconciler = new ScheduleReconciler(
			this.localAgent,
			this.planStore,
			this.storageStore
		);
	}

	getStrategy(plan: NewPlan | Plan): BackupStrategy | any {
		const isRemote = plan.sourceId !== 'main';
		return isRemote
			? new RemoteBackupStrategy(plan.sourceId)
			: new LocalBackupStrategy(this.localAgent);
	}

	public async getPlan(planId: string, history: boolean = true): Promise<Plan | null> {
		const result = await this.planStore.getById(planId, history);
		if (!result) {
			throw new NotFoundError('Plan not found');
		}
		return result;
	}

	public async getAllPlans(history: boolean = true): Promise<Plan[] | null> {
		const result = await this.planStore.getAll(history);
		return result;
	}

	public async checkActiveBackupsOrRestore(
		planId: string,
		type: 'backup' | 'restore'
	): Promise<boolean> {
		if (type === 'restore') {
			return await this.planStore.hasActiveRestore(planId);
		}
		return await this.planStore.hasActiveBackups(planId);
	}

	/**
	 * Creates a new plan, its schedule, and optionally triggers the first backup.
	 */
	public async createPlan(planData: NewPlanReq): Promise<Plan> {
		const planId = generateUID();
		const {
			title,
			description,
			storage,
			storagePath,
			sourceConfig,
			sourceId,
			sourceType,
			method,
			settings,
			tags = [],
		} = planData;

		// Get Storage Details
		const planStorage: BackupPlanArgs['storage'] = await this.getStorageDetails(
			planData.storage.id
		);
		if (!planStorage.name || !planStorage.type) {
			throw new NotFoundError('Storage not found.');
		}

		// Fetch the device early so we can use its OS for cross-platform path sanitization.
		// Without this, a Windows server would mangle Linux paths (e.g., /var/home → F:/var/home).
		const device = await this.deviceStore.getById(sourceId);
		if (!device) {
			throw new NotFoundError('Source device not found');
		}

		let theStoragePath;
		if (storagePath) {
			try {
				const isRemote = sourceId !== 'main';
				const targetOS = isRemote
					? device.platform
						? device.platform.toLowerCase()
						: undefined
					: undefined;

				theStoragePath = sanitizeStoragePath(storagePath, planStorage.type, targetOS);
			} catch (error) {
				if (error instanceof AppError) {
					throw error;
				}
				throw new AppError(400, 'Invalid storage path');
			}
		}

		let newPlanData: NewPlan = {
			id: planId,
			title: title.trim(),
			description: description?.trim() || '',
			storageId: storage.id,
			storagePath: theStoragePath,
			method,
			sourceConfig,
			sourceId,
			sourceType,
			settings,
			tags,
		};

		// Validate the plan data using the schema
		try {
			const parsedPlanData = planInsertSchema.parse(newPlanData);
			newPlanData = {
				...parsedPlanData,
				sourceType: parsedPlanData.sourceType as SourceTypes,
			};
		} catch (error) {
			console.error('Error parsing plan data:', error);
			throw error;
		}

		// Create Backup Schedule
		const cronExpression = intervalToCron(planData.settings.interval);
		const backupScheduleOptions: BackupPlanArgs = {
			...newPlanData,
			isActive: true,
			storage: planStorage,
			cronExpression,
		};

		try {
			const strategy = this.getStrategy(newPlanData) as BackupStrategy;
			const creationRes = await strategy.createBackup(planId, backupScheduleOptions);
			if (!creationRes.success) {
				throw new AppError(500, creationRes.result);
			}
		} catch (error: any) {
			if (error instanceof AppError) {
				throw error;
			}
			throw new AppError(500, error?.message || 'Error creating backup schedule');
		}
		// Save the plan to the database
		const createdPlan = await this.planStore.create(newPlanData);
		if (!createdPlan) {
			throw new AppError(500, 'Failed to save the new plan to the database.');
		}

		planLogger('create', planId).info('Backup Plan created.');

		return createdPlan;
	}

	/**
	 * Updates a plan's configuration and its underlying schedule.
	 */
	public async updatePlan(planId: string, planData: Partial<Plan>): Promise<Plan> {
		const currentPlan = await this.planStore.getById(planId);
		if (!currentPlan) {
			throw new NotFoundError('Plan not found.');
		}
		let parsedPlanData;
		try {
			const parsedData = planUpdateSchema.parse(planData);
			parsedPlanData = {
				...parsedData,
				sourceType: (parsedData.sourceType || currentPlan.sourceType) as SourceTypes,
			};
		} catch (error) {
			console.error('Error parsing plan data:', error);
			throw error;
		}

		const updatedPlan = await this.planStore.update(planId, parsedPlanData as Partial<Plan>);
		if (!updatedPlan) {
			throw new AppError(500, 'Failed to update plan in the database.');
		}

		const planStorage: BackupPlanArgs['storage'] = await this.getStorageDetails(
			currentPlan.storageId as string
		);

		if (!planStorage.name || !planStorage.type) {
			throw new NotFoundError('Storage not found.');
		}
		const planSettings = parsedPlanData.settings || currentPlan.settings;
		const cronExpression = intervalToCron(planSettings.interval);
		const backupScheduleOptions: BackupPlanArgs = {
			...updatedPlan,
			storage: planStorage,
			cronExpression,
		};

		try {
			const strategy = this.getStrategy(updatedPlan) as BackupStrategy;
			const updateRes = await strategy.updateBackup(planId, backupScheduleOptions);
			if (!updateRes.success) {
				if (updatedPlan.sourceId !== 'main') {
					// Revert the update in the database if remote update fails to avoid inconsistencies
					await this.planStore.update(planId, currentPlan);
				}
				throw new AppError(500, updateRes.result);
			}
			planLogger('update', planId).info('Backup Plan updated by User.');
			return updatedPlan;
		} catch (error: any) {
			if (error instanceof AppError) {
				throw error; // Re-throw as is
			}
			throw new AppError(500, error?.message || 'Failed to update plan');
		}
	}

	/**
	 * Deletes a plan and instructs the execution engine to remove its schedule and data.
	 */
	public async deletePlan(planId: string, removeRemoteData: boolean): Promise<boolean> {
		const plan = await this.planStore.getById(planId);
		if (!plan) throw new NotFoundError('Plan not found.');
		const storageName = plan.storage?.name || '';

		// Resolve replication storage names so removeBackup can purge them too
		const replicationStorages = removeRemoteData ? await this.resolveReplicationStorages(plan) : [];

		const options = {
			storageName:
				storageName === 'Local' || storageName === 'Local Storage' ? 'local' : storageName,
			storagePath: plan.storagePath || '',
			encryption: plan.settings.encryption || true,
			removeRemoteData,
			replicationStorages,
		};

		const strategy = this.getStrategy(plan) as BackupStrategy;
		const deleteResult = await strategy.removeBackup(planId, options);

		if (!deleteResult.success) {
			throw new AppError(500, deleteResult.result);
		}

		// Finally, remove from our database
		await this.restoreStore.deleteByPlanId(planId);
		await this.backupStore.deleteByPlanId(planId);
		const deleteRes = await this.planStore.delete(planId);
		if (!deleteRes) {
			throw new AppError(500, 'Failed to delete plan from the database.');
		}

		planLogger('delete', planId).info('Plan and associated data successfully deleted.');

		return deleteRes;
	}

	/**
	 * Triggers a one-off manual backup for a plan.
	 */
	public async performBackup(planId: string): Promise<string> {
		const plan = await this.planStore.getById(planId);
		if (!plan) throw new NotFoundError(`Plan with ID ${planId} not found.`);

		if (await this.planStore.hasActiveBackups(planId)) {
			throw new AppError(500, 'A backup is already in progress for this plan.');
		}

		const strategy = this.getStrategy(plan) as BackupStrategy;
		const performResult = await strategy.performBackup(planId);

		if (!performResult.success) {
			throw new AppError(500, performResult.result);
		} else {
			return performResult.result;
		}
	}

	/**
	 * Triggers a manual prune for a plan.
	 */
	public async pruneBackups(planId: string): Promise<string> {
		const plan = await this.planStore.getById(planId);
		if (!plan) throw new NotFoundError(`Plan with ID ${planId} not found.`);

		const replicationStorages = await this.resolveReplicationStorages(plan);
		const strategy = this.getStrategy(plan) as BackupStrategy;
		const pruneResult = await strategy.pruneBackups(planId, replicationStorages);

		if (!pruneResult.success) {
			throw new AppError(
				500,
				typeof pruneResult.result === 'string' ? pruneResult.result : 'Error Pruning Backup'
			);
		}

		planLogger('prune', planId).info('Backup Plan prune successfully performed.');

		return pruneResult.result;
	}

	/**
	 * Pauses the backup plan.
	 */
	public async pauseBackup(planId: string): Promise<void> {
		const plan = await this.planStore.getById(planId);
		if (!plan) throw new NotFoundError(`Plan with ID ${planId} not found.`);

		const strategy = this.getStrategy(plan) as BackupStrategy;
		const pauseResult = await strategy.pauseBackup(planId);
		if (!pauseResult.success) {
			throw new AppError(500, pauseResult.result);
		}

		await this.planStore.setActive(planId, false);
		planLogger('update', planId).info('Plan paused.');
	}

	/**
	 * Resumes the backup plan.
	 */
	public async resumeBackup(planId: string): Promise<void> {
		const plan = await this.planStore.getById(planId);
		if (!plan) throw new NotFoundError(`Plan with ID ${planId} not found.`);

		const strategy = this.getStrategy(plan) as BackupStrategy;
		const resumeResult = await strategy.resumeBackup(planId);
		if (!resumeResult.success) {
			throw new AppError(500, resumeResult.result);
		}

		await this.planStore.setActive(planId, true);
		planLogger('update', planId).info('Plan resumed.');
	}

	/**
	 * Checks the integrity of a backup plan's repository.
	 * This can be a long-running operation, so it's designed to be called asynchronously and returns progress updates via events.
	 */

	async checkIntegrity(planId: string): Promise<{ success: boolean; result: Record<string, any> }> {
		try {
			const plan = await this.planStore.getById(planId);
			if (!plan) {
				throw new NotFoundError('Plan not found');
			}
			try {
				const planID = plan.id;
				const strategy = this.getStrategy(plan);
				const result = await strategy.checkIntegrity(planID);
				return result;
			} catch (error: any) {
				console.log('[checkIntegrity] error :', error);
				throw new AppError(500, error?.message || 'Internal Server Error');
			}
		} catch (error: any) {
			console.log('[checkIntegrity] error :', error);
			throw new AppError(500, error?.message || 'Internal Server Error');
		}
	}

	/**
	 * Removes a replication storage from a plan's replication settings.
	 * Optionally purges the replicated data from the remote storage.
	 */
	public async deleteReplicationStorage(
		planId: string,
		storageID: string,
		storagePath: string,
		removeData: boolean,
		replicationId?: string
	): Promise<{ success: boolean; message: string }> {
		const plan = await this.planStore.getById(planId);
		if (!plan) throw new NotFoundError('Plan not found.');

		const replication = plan.settings?.replication;
		if (!replication?.storages?.length) {
			throw new AppError(400, 'Plan has no replication storages configured.');
		}

		const storageIndex = replicationId
			? replication.storages.findIndex(s => s.replicationId === replicationId)
			: replication.storages.findIndex(
					s => s.storageId === storageID && s.storagePath === storagePath
				);
		if (storageIndex === -1) {
			// If the storage to remove isn't found, we can consider it already "removed" for idempotency
			return { success: true, message: `Replication storage removed successfully.` };
		}

		// Resolve storage name for logging and rclone purge
		let storageName = 'Unknown';
		const storageRecords = await this.storageStore.getByIds([storageID]);
		if (storageRecords?.length) {
			const name = storageRecords[0].name;
			storageName = name === 'Local' || name === 'Local Storage' ? 'local' : name;
		}

		// If removeData is true, purge the replicated data from the remote storage
		if (removeData) {
			const strategy = this.getStrategy(plan) as BackupStrategy;
			const purgeResult = await strategy.removeReplicationStorage(planId, {
				storageName,
				storagePath,
				removeData,
			});
			if (!purgeResult.success) {
				throw new AppError(500, `Failed to purge replication data: ${purgeResult.result}`);
			}
		}

		// Update the plan's replication settings to remove the storage
		const updatedStorages = replication.storages.filter((_, i) => i !== storageIndex);
		const updatedReplication = {
			...replication,
			storages: updatedStorages,
			// Disable replication if no storages remain
			...(updatedStorages.length === 0 && { enabled: false }),
		};
		const updatedSettings = { ...plan.settings, replication: updatedReplication };
		await this.planStore.update(planId, { settings: updatedSettings } as any);

		// Sync the CronManager schedule so future backup runs use the updated replication settings
		try {
			const planStorage: BackupPlanArgs['storage'] = await this.getStorageDetails(
				plan.storageId as string
			);
			const cronExpression = intervalToCron(updatedSettings.interval);
			const updatedPlan = await this.planStore.getById(planId);
			if (updatedPlan && planStorage.name) {
				const backupScheduleOptions: BackupPlanArgs = {
					...updatedPlan,
					storage: planStorage,
					cronExpression,
				};
				const strategy = this.getStrategy(updatedPlan) as BackupStrategy;
				await strategy.updateBackup(planId, backupScheduleOptions);
			}
		} catch (error: any) {
			planLogger('replication', planId).warn(
				`Failed to sync CronManager schedule after removing replication storage: ${error?.message || 'Unknown error'}`
			);
		}

		planLogger('replication', planId).info(
			`Replication storage "${storageName}" (${storagePath}) removed from plan.${removeData ? ' Replicated data was purged.' : ''}`
		);

		return { success: true, message: `Replication storage "${storageName}" removed successfully.` };
	}

	/**
	 * Unlocks a plan's repository by removing all stale locks.
	 */
	public async unlockRepo(planId: string): Promise<{ success: boolean; result: string }> {
		const plan = await this.planStore.getById(planId);
		if (!plan) {
			throw new NotFoundError(`Plan with ID ${planId} not found.`);
		}

		// This action is immediate and not queued, so we don't check for active backups.
		// It's a maintenance task that can be run even if a backup failed due to a lock.

		const replicationStorages = await this.resolveReplicationStorages(plan);
		const strategy = this.getStrategy(plan) as BackupStrategy;

		// The strategy must have the new method.
		if (!strategy.unlockRepo) {
			throw new AppError(501, 'The "unlockRepo" feature is not implemented for this strategy.');
		}

		const unlockResult = await strategy.unlockRepo(planId, replicationStorages);

		if (unlockResult.success) {
			planLogger('unlock', planId).info('Repository unlocked successfully by user request.');
		} else {
			planLogger('unlock', planId).error(`Failed to unlock repository: ${unlockResult.result}`);
		}

		return unlockResult;
	}

	/**
	 * Retrieves the logs for a backup plan. Parses the plan log file from the data/logs folder.
	 */
	public async getPlanLogs(planId: string): Promise<PlanLogItem[] | undefined> {
		const plan = await this.planStore.getById(planId);
		if (!plan) throw new NotFoundError(`Plan with ID ${planId} not found.`);

		if (plan) {
			const logPath = appPaths.getLogsDir();
			const logFilePath = `${logPath}/plan-${plan.id}.log`;

			try {
				// Read the raw log file
				const rawLogs = await readFile(logFilePath, 'utf-8');

				if (!rawLogs) {
					throw new NotFoundError(`No logs found for plan with ID ${planId}`);
				}

				// Process the logs - split by line breaks and parse each line as JSON
				const logEntries = rawLogs
					.split(/\r?\n/)
					.filter(line => line.trim() !== '')
					.map(line => {
						try {
							const entry = JSON.parse(line);
							// Format the timestamp to be more readable
							if (entry.time) {
								const date = new Date(entry.time);
								entry.formattedTime = date.toLocaleString();
							}
							return entry;
						} catch (e) {
							// If a line can't be parsed as JSON, return it as-is
							return { raw: line };
						}
					});

				return logEntries;
			} catch (error: any) {
				if (error.code === 'ENOENT') {
					throw new NotFoundError(`No logs found for plan with ID ${planId}`);
				}

				throw error;
			}
		}
	}

	/**
	 * Downloads the logs for a backup plan. Fetches the plan log file from the data/logs folder as is.
	 */
	public async downloadPlanLogs(planId: string): Promise<NodeJS.ReadableStream> {
		const plan = await this.planStore.getById(planId);
		if (!plan) throw new NotFoundError(`Plan with ID ${planId} not found.`);

		const logPath = appPaths.getLogsDir();
		const logFilePath = `${logPath}/plan-${plan.id}.log`;

		try {
			// Check if file exists
			await access(logFilePath, constants.F_OK);

			// Stream the file directly to the response
			const fileStream = createReadStream(logFilePath);

			// Return nothing as we're handling the response with the stream
			return fileStream;
		} catch (error: any) {
			if (error.code === 'ENOENT') {
				throw new NotFoundError('Log file not found');
			}

			throw new AppError(403, error?.message || 'Failed to access the log file');
		}
	}

	async sendTestNotification(
		planId: string,
		notificationChannel: 'slack' | 'discord' | 'webhook',
		notificationCase: PlanNotificationType,
		channelSettings:
			| PlanNotification['webhook']
			| PlanNotification['slack']
			| PlanNotification['discord']
	): Promise<void> {
		try {
			const theCase = notificationCase;
			const plan = await this.planStore.getById(planId);
			if (!plan) throw new NotFoundError(`Plan with ID ${planId} not found.`);

			// TODO: for sync backup type this should be different.
			const dummyStats = {
				message_type: 'summary',
				files_new: 2,
				files_changed: 3,
				files_unmodified: 273,
				dirs_new: 0,
				dirs_changed: 0,
				dirs_unmodified: 24,
				data_blobs: 0,
				tree_blobs: 0,
				data_added: 0,
				data_added_packed: 0,
				total_files_processed: 273,
				total_bytes_processed: 2896809876,
				total_duration: 200,
				snapshot_id: '86dajhg985edioguo23782x',
				dry_run: false,
			};

			const payload: Record<string, any> = {
				id: 'edioguo23782y',
				startTime: new Date(),
				stats: dummyStats,
			};
			if (theCase === 'end' || theCase === 'success' || theCase === 'failure') {
				payload.endTime = new Date();
			}
			if (theCase === 'failure') {
				payload.error = 'An Unknown error caused the backup to fail.';
			}

			const planNotifications: PlanNotification | Record<string, any> =
				plan?.settings?.notification || {};
			if (notificationChannel === 'slack') {
				planNotifications.slack = channelSettings as PlanNotification['slack'];
				await new BackupNotification().sendSlack(plan, theCase, payload, theCase);
			} else if (notificationChannel === 'discord') {
				planNotifications.discord = channelSettings as PlanNotification['discord'];
				await new BackupNotification().sendDiscord(plan, theCase, payload, theCase);
			} else {
				throw new AppError(400, 'Invalid notification channel specified.');
			}
		} catch (error) {
			throw new AppError(
				401,
				`Test webhook request failed. Reason: ${error instanceof Error ? error.message : 'Unknown'}`
			);
		}
	}

	private async getStorageDetails(storageId: string): Promise<BackupPlanArgs['storage']> {
		const storage = await this.storageStore.getById(storageId);
		if (!storage) {
			throw new NotFoundError('Storage not found');
		}
		return {
			name: storage.id === 'local' ? 'local' : storage.name,
			type: storage.type as string,
			authType: storage.authType as string,
			settings: storage.settings as Record<string, string>,
			credentials: storage.credentials as Record<string, string>,
			defaultPath: storage.defaultPath as string,
		};
	}

	public async reconcileSchedules(): Promise<void> {
		await this.scheduleReconciler.reconcileSchedules();
	}

	/**
	 * Resolves replication storage names from storageIds for a plan's replication settings.
	 */
	private async resolveReplicationStorages(
		plan: Plan
	): Promise<{ storageName: string; storagePath: string }[]> {
		if (!plan.settings.replication?.enabled || !plan.settings.replication.storages?.length) {
			return [];
		}
		const storageIds = plan.settings.replication.storages.map(s => s.storageId);
		const storageRecords = await this.storageStore.getByIds(storageIds);
		if (!storageRecords) return [];
		return plan.settings.replication.storages
			.map(rs => {
				const record = storageRecords.find(s => s.id === rs.storageId);
				const name = record?.name || '';
				return {
					storageName: name === 'Local' || name === 'Local Storage' ? 'local' : name,
					storagePath: rs.storagePath,
				};
			})
			.filter(s => s.storageName && s.storagePath);
	}
}
