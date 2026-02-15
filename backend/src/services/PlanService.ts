import { createReadStream } from 'fs';
import { access, constants, readFile } from 'fs/promises';
import { BaseBackupManager } from '../managers/BaseBackupManager';
import { PlanStore } from '../stores/PlanStore';
import { BackupStore } from '../stores/BackupStore';
import { StorageStore } from '../stores/StorageStore';
import { RestoreStore } from '../stores/RestoreStore';
import { Plan, NewPlan, planInsertSchema, planUpdateSchema } from '../db/schema/plans';
import { BackupPlanArgs, NewPlanReq, PlanLogItem } from '../types/plans';
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

/**
 * PlanService is the central orchestrator for all business logic related to backup plans.
 * It manages database state, orchestrates local execution via BaseBackupManager,
 * and delegates remote execution to strategies.
 */
export class PlanService {
	constructor(
		protected localAgent: BaseBackupManager,
		protected planStore: PlanStore,
		protected backupStore: BackupStore,
		protected storageStore: StorageStore,
		protected deviceStore: DeviceStore,
		protected restoreStore: RestoreStore
	) {}

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

		const theStoragePath = sanitizeStoragePath(storagePath, planStorage.type);
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

		// Check if Device exists
		const device = await this.deviceStore.getById(sourceId);
		if (!device) {
			throw new NotFoundError('Source device not found');
		}

		// Create Backup Schedule
		const cronExpression = intervalToCron(planData.settings.interval);
		const backupScheduleOptions: BackupPlanArgs = {
			...newPlanData,
			isActive: true,
			storage: planStorage,
			cronExpression,
		};
		// console.log('backupScheduleOptions :', backupScheduleOptions);
		try {
			const strategy = this.getStrategy(newPlanData) as BackupStrategy;
			const creationRes = await strategy.createBackup(planId, backupScheduleOptions);
			console.log('creationRes :', creationRes);
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
		// console.log('[PlanService] planData :', planData);
		try {
			const parsedData = planUpdateSchema.parse(planData);
			parsedPlanData = {
				...parsedData,
				sourceType: (parsedData.sourceType || currentPlan.sourceType) as SourceTypes,
			};
			// console.log('[PlanService] parsedPlanData :', parsedPlanData);
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
		const options = {
			storageName:
				storageName === 'Local' || storageName === 'Local Storage' ? 'local' : storageName,
			storagePath: plan.storagePath || '',
			encryption: plan.settings.encryption || true,
			removeRemoteData,
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
	public async performBackup(planId: string): Promise<void> {
		const plan = await this.planStore.getById(planId);
		if (!plan) throw new NotFoundError(`Plan with ID ${planId} not found.`);

		if (await this.planStore.hasActiveBackups(planId)) {
			throw new AppError(500, 'A backup is already in progress for this plan.');
		}

		const strategy = this.getStrategy(plan) as BackupStrategy;
		const performResult = await strategy.performBackup(planId);

		if (!performResult.success) {
			throw new AppError(500, performResult.result);
		}
	}

	/**
	 * Triggers a manual prune for a plan.
	 */
	public async pruneBackups(planId: string): Promise<string> {
		const plan = await this.planStore.getById(planId);
		if (!plan) throw new NotFoundError(`Plan with ID ${planId} not found.`);

		const strategy = this.getStrategy(plan) as BackupStrategy;
		const pruneResult = await strategy.pruneBackups(planId);

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
	 * Unlocks a plan's repository by removing all stale locks.
	 */
	public async unlockRepo(planId: string): Promise<{ success: boolean; result: string }> {
		const plan = await this.planStore.getById(planId);
		if (!plan) {
			throw new NotFoundError(`Plan with ID ${planId} not found.`);
		}

		// This action is immediate and not queued, so we don't check for active backups.
		// It's a maintenance task that can be run even if a backup failed due to a lock.

		const strategy = this.getStrategy(plan) as BackupStrategy;

		// The strategy must have the new method.
		if (!strategy.unlockRepo) {
			throw new AppError(501, 'The "unlockRepo" feature is not implemented for this strategy.');
		}

		const unlockResult = await strategy.unlockRepo(planId);

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
}
