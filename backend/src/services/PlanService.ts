import { createReadStream } from 'fs';
import { access, constants, readFile } from 'fs/promises';
import { BaseBackupManager } from '../managers/BaseBackupManager';
import { PlanStore } from '../stores/PlanStore';
import { BackupStore } from '../stores/BackupStore';
import { StorageStore } from '../stores/StorageStore';
import { RestoreStore } from '../stores/RestoreStore';
import { sql } from 'drizzle-orm/sql';
import { Plan, NewPlan, planInsertSchema, planUpdateSchema } from '../db/schema/plans';
import { Backup } from '../db/schema/backups';
import { Restore } from '../db/schema/restores';
import {
	BackupPlanArgs,
	BackupVerifiedResult,
	NewPlanReq,
	PlanAddRunSettings,
	PlanLogItem,
	PlanNotification,
	PlanNotificationType,
	PlanStoragePath,
	PlanStorageDisposition,
} from '../types/plans';
import { planLogger } from '../utils/logger';
import { generateUID, normalizeStorageName } from '../utils/helpers';
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
import { BackupRunConfig } from '../types/backups';
import { RemoteBackupService } from './RemoteBackupService';
import { prepareRemoteLifecycleCollection } from '../utils/remoteLifecycle';
import type { DatabaseCredential } from '../types/remoteLifecycle';
import { configService } from './ConfigService';
import type { RecoveryTestStore } from '../stores/RecoveryTestStore';
import { parseBackupHistoryQuery } from '../utils/backupHistoryQuery';
import { assertStorageRemovalScope } from '../utils/storageRemovalScope';
import { validateReplicationSettings } from '../utils/managedReplicationPolicy';
import type { ManagedReplicationStore } from '../stores/ManagedReplicationStore';
import { canonicalS3RepositoryIdentity, isS3Storage } from '../utils/storageSecurity';

/**
 * PlanService is the central orchestrator for all business logic related to backup plans.
 * It manages database state, orchestrates local execution via BaseBackupManager,
 * and delegates remote execution to strategies.
 */
export class PlanService {
	protected scheduleReconciler: ScheduleReconciler;
	private readonly removingPlans = new Set<string>();

	constructor(
		protected localAgent: BaseBackupManager,
		protected planStore: PlanStore,
		protected backupStore: BackupStore,
		protected storageStore: StorageStore,
		protected deviceStore: DeviceStore,
		protected restoreStore: RestoreStore,
		private readonly remoteBackupService?: RemoteBackupService,
		private readonly recoveryTests?: Pick<RecoveryTestStore, 'assertPlanRemovable'>,
		private readonly managedReplications?: ManagedReplicationStore
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

	public async getPlan(
		planId: string,
		history: boolean = true,
		backupSummary = false
	): Promise<Plan | null> {
		const result = backupSummary
			? await this.planStore.getById(planId, history, true)
			: await this.planStore.getById(planId, history);
		if (!result) {
			throw new NotFoundError('Plan not found');
		}
		return result;
	}

	public async getBackupHistory(planId: string, input: unknown) {
		const query = parseBackupHistoryQuery(input);
		// Reuse the same authenticated administrative plan boundary. This public
		// community schema has no per-user plan ownership/tenant field.
		const plan = await this.planStore.getById(planId, false);
		if (!plan) throw new NotFoundError('Plan not found');
		const result = await this.backupStore.getHistoryPage(plan.id, query);
		const items = this.planStore.handleBackupStats(
			plan.method,
			result.items,
			plan.stats,
			plan.sourceType === 'device' && plan.sourceId !== 'main'
		);
		return {
			...result,
			items: plan.settings?.replication ? this.planStore.handleBackupMirrors(plan, items) : items,
		};
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
	public async createPlan(planData: NewPlanReq, runSettings?: PlanAddRunSettings): Promise<Plan> {
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
		validateReplicationSettings(settings?.replication);
		const planStorage: BackupPlanArgs['storage'] = await this.getStorageDetails(
			planData.storage.id
		);
		if (!planStorage.name || !planStorage.type) {
			throw new NotFoundError('Storage not found.');
		}

		const isStorageSource = sourceType === 'storage';
		let planSourceConfig = sourceConfig;

		if (isStorageSource) {
			if (method !== 'sync') {
				throw new AppError(400, 'A storage source is only supported by the sync method.');
			}
			if (sourceId === storage.id) {
				throw new AppError(
					400,
					'The source storage and the destination storage must be different.'
				);
			}
			if (!sourceConfig?.includes?.[0]?.trim()) {
				throw new AppError(400, 'A source path is required.');
			}
			if (settings?.replication?.storages?.some(s => s.storageId === sourceId)) {
				throw new AppError(400, 'A replication storage must be different from the source storage.');
			}
			planSourceConfig = {
				...sourceConfig,
				includes: [await this.bakeStorageSourcePath(sourceConfig?.includes?.[0], sourceId)],
			};
		}

		// Fetch the device early so we can use its OS for cross-platform path sanitization.
		// Without this, a Windows server would mangle Linux paths (e.g., /var/home → F:/var/home).
		const device = isStorageSource ? null : await this.deviceStore.getById(sourceId);
		if (!isStorageSource && !device) {
			throw new NotFoundError('Source device not found');
		}

		let theStoragePath;
		if (storagePath) {
			try {
				const isRemote = !isStorageSource && sourceId !== 'main';
				const targetOS = isRemote
					? device?.platform
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
			sourceConfig: planSourceConfig,
			sourceId,
			sourceType,
			settings,
			tags,
		};
		let databaseCredential: DatabaseCredential[] | undefined;
		if (settings?.remoteLifecycle !== undefined) {
			if (!RemoteBackupService.isRemoteFilesystemPlan(newPlanData)) {
				throw new AppError(
					400,
					'Database lifecycle is available only for remote managed backup plans.'
				);
			}
			const prepared = prepareRemoteLifecycleCollection(
				settings,
				undefined,
				[],
				configService.config.SECRET
			);
			newPlanData.settings = prepared.settings;
			databaseCredential = prepared.credentials;
		}

		// Validate the plan data using the schema
		try {
			const parsedPlanData = planInsertSchema.parse(newPlanData);
			newPlanData = {
				...parsedPlanData,
				sourceType: parsedPlanData.sourceType as SourceTypes,
			};
		} catch (error) {
			console.error('Plan data validation failed.');
			throw error;
		}

		if (RemoteBackupService.isRemoteFilesystemPlan(newPlanData)) {
			const remote = this.requireRemoteBackupService();
			await remote.validatePlanCreation(newPlanData);
			const createdPlan =
				databaseCredential === undefined
					? await this.planStore.create(newPlanData)
					: await this.planStore.create(newPlanData, databaseCredential);
			if (!createdPlan) throw new AppError(500, 'Failed to save the new remote backup plan.');
			try {
				await remote.createManagedPlan(createdPlan, runSettings);
			} catch (error) {
				// No repository data has been deleted or mutated; only the newly-created
				// plan row is rolled back when scheduling/queueing cannot be prepared.
				await this.planStore.delete(createdPlan.id);
				throw error;
			}
			planLogger('create', planId).info('Remote filesystem backup plan created.');
			return createdPlan;
		}

		// Create Backup Schedule
		const cronExpression = intervalToCron(planData.settings.interval);
		const backupScheduleOptions: BackupPlanArgs = {
			...newPlanData,
			isActive: true,
			storage: planStorage,
			cronExpression,
		};
		// Register the destination scope atomically before a schedule can execute.
		// A concurrent managed reservation sees this row or this insert is refused.
		const createdPlan = await this.planStore.create(newPlanData);
		if (!createdPlan) throw new AppError(500, 'Failed to save the new plan to the database.');

		try {
			const strategy = this.getStrategy(newPlanData) as BackupStrategy;
			const creationRes = await strategy.createBackup(planId, backupScheduleOptions, runSettings);
			if (!creationRes.success) {
				throw new AppError(500, creationRes.result);
			}
		} catch (error: any) {
			// Retain failed scheduling metadata: a partially installed schedule must
			// keep its scope reserved until ordinary authorized removal resolves it.
			await this.planStore.update(createdPlan.id, { isActive: false });
			if (error instanceof AppError) {
				throw error;
			}
			throw new AppError(500, error?.message || 'Error creating backup schedule');
		}

		planLogger('create', planId).info('Backup Plan created.');

		return createdPlan;
	}

	/**
	 * Updates a plan's configuration and its underlying schedule.
	 */
	public async updatePlan(planId: string, planData: Partial<Plan>): Promise<Plan> {
		validateReplicationSettings(planData.settings?.replication);
		this.managedReplications?.assertPlanIdle(planId);
		const currentPlan = await this.planStore.getById(planId);
		if (!currentPlan) {
			throw new NotFoundError('Plan not found.');
		}
		let databaseCredential: DatabaseCredential[] | undefined;
		let previousCredential: DatabaseCredential[] = [];
		const lifecycleSupplied =
			!!planData.settings && Object.hasOwn(planData.settings, 'remoteLifecycle');
		// Partial unrelated settings updates must not implicitly disable database backup.
		// Disabling is an explicit version-2 empty collection (hooks may remain).
		if (planData.settings) {
			planData = { ...planData, settings: { ...currentPlan.settings, ...planData.settings } };
		}
		if (
			lifecycleSupplied &&
			planData.settings &&
			(planData.settings.remoteLifecycle !== undefined ||
				currentPlan.settings.remoteLifecycle !== undefined)
		) {
			if (await this.planStore.hasActiveBackups(planId))
				throw new AppError(
					409,
					'Wait for the active backup to finish before changing lifecycle settings.'
				);
			if (!RemoteBackupService.isRemoteFilesystemPlan(currentPlan)) {
				throw new AppError(
					400,
					'Database lifecycle is available only for remote managed backup plans.'
				);
			}
			previousCredential = await this.planStore.getDatabaseCredentials(planId);
			const prepared =
				planData.settings.remoteLifecycle === undefined
					? { settings: planData.settings, credentials: [] }
					: prepareRemoteLifecycleCollection(
							planData.settings,
							currentPlan.settings.remoteLifecycle,
							previousCredential,
							configService.config.SECRET
						);
			planData = { ...planData, settings: prepared.settings };
			databaseCredential = prepared.credentials;
		}
		let parsedPlanData;
		try {
			const parsedData = planUpdateSchema.parse(planData);
			parsedPlanData = {
				...parsedData,
				sourceType: (parsedData.sourceType || currentPlan.sourceType) as SourceTypes,
			};
		} catch (error) {
			console.error('Plan data validation failed.');
			throw error;
		}

		// The backup destination is immutable after a plan is created — the restic
		// repository and all its snapshots live there. Refuse any change.
		if (parsedPlanData.storageId != null && parsedPlanData.storageId !== currentPlan.storageId) {
			throw new AppError(
				400,
				'The backup destination storage cannot be changed after the plan is created.'
			);
		}
		if (
			parsedPlanData.storagePath != null &&
			parsedPlanData.storagePath !== currentPlan.storagePath
		) {
			throw new AppError(
				400,
				'The backup destination path cannot be changed after the plan is created, because the repository and its snapshots are stored there.'
			);
		}
		// Never let the immutable storageId reach the update.
		delete (parsedPlanData as Record<string, unknown>).storageId;

		if (parsedPlanData.sourceType !== currentPlan.sourceType) {
			throw new AppError(400, 'The source type cannot be changed after the plan is created.');
		}

		if (currentPlan.sourceType === 'storage') {
			if (parsedPlanData.sourceId != null && parsedPlanData.sourceId !== currentPlan.sourceId) {
				throw new AppError(400, 'The source storage cannot be changed after the plan is created.');
			}
			const newSettings = parsedPlanData.settings || currentPlan.settings;
			if (newSettings?.replication?.storages?.some(s => s.storageId === currentPlan.sourceId)) {
				throw new AppError(400, 'A replication storage must be different from the source storage.');
			}
			if (parsedPlanData.sourceConfig) {
				// A partial update without a source path must not re-bake to the remote root
				const givenPath = parsedPlanData.sourceConfig.includes?.[0]?.trim();
				parsedPlanData.sourceConfig = {
					...parsedPlanData.sourceConfig,
					includes: givenPath
						? [await this.bakeStorageSourcePath(givenPath, currentPlan.sourceId)]
						: currentPlan.sourceConfig.includes,
				};
			}
		}

		if (RemoteBackupService.isRemoteFilesystemPlan(currentPlan)) {
			if (parsedPlanData.sourceId != null && parsedPlanData.sourceId !== currentPlan.sourceId) {
				throw new AppError(400, 'The remote source device cannot be changed after creation.');
			}
			const remote = this.requireRemoteBackupService();
			const candidate = { ...currentPlan, ...parsedPlanData } as Plan;
			await remote.validatePlanCreation(candidate as NewPlan);
			const updated =
				databaseCredential === undefined
					? await this.planStore.update(planId, parsedPlanData as Partial<Plan>)
					: await this.planStore.update(
							planId,
							parsedPlanData as Partial<Plan>,
							databaseCredential
						);
			if (!updated) throw new AppError(500, 'Failed to update remote backup plan.');
			try {
				await remote.updateManagedPlan(updated);
				planLogger('update', planId).info('Remote filesystem backup plan updated.');
				return updated;
			} catch (error) {
				if (databaseCredential === undefined) await this.planStore.update(planId, currentPlan);
				else await this.planStore.update(planId, currentPlan, previousCredential);
				throw error;
			}
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
				if (updatedPlan.sourceType === 'device' && updatedPlan.sourceId !== 'main') {
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
	 * Storage data the engine could not remove does not stop the plan being deleted: those
	 * locations come back in `unremovedPaths`, with `unremovedReason` saying why.
	 */
	public async deletePlan(
		planId: string,
		removeRemoteData: boolean
	): Promise<{
		deleted: boolean;
		unremovedPaths: PlanStoragePath[];
		unremovedReason: string;
		storageDisposition: PlanStorageDisposition;
	}> {
		if (this.removingPlans.has(planId))
			throw new AppError(409, 'Plan removal is already in progress.');
		this.removingPlans.add(planId);
		let release = () => {};
		try {
			release = this.planStore.beginSourceRemoval({ planId });
			return await this.removePlan(planId, removeRemoteData);
		} finally {
			release();
			this.removingPlans.delete(planId);
		}
	}

	private async removePlan(planId: string, removeRemoteData: boolean) {
		const plan = await this.planStore.getById(planId);
		if (!plan) throw new NotFoundError('Plan not found.');
		this.planStore.assertNoRetainedDatabaseRestores({ planId });
		this.managedReplications?.assertPlanIdle(planId);
		if (
			(await this.planStore.hasActiveBackups(planId)) ||
			(await this.planStore.hasActiveRestore(planId))
		)
			throw new AppError(
				409,
				'Wait for active backups and restores to finish before removing this plan.'
			);
		const storageName = plan.storage?.name || '';
		if (RemoteBackupService.isRemoteFilesystemPlan(plan)) {
			await this.recoveryTests?.assertPlanRemovable(planId);
			const remote = this.requireRemoteBackupService();
			const replicaBindings = [
				...(plan.settings.replication?.storages || []),
				...(this.managedReplications?.listDestinations() || [])
					.filter(destination => destination.planId === planId)
					.map(destination => ({
						storageId: destination.destinationStorageId,
						storagePath: destination.destinationStoragePath,
					})),
			];
			const replicaStorages = replicaBindings.length
				? await this.storageStore.getByIds([...new Set(replicaBindings.map(item => item.storageId))])
				: [];
			const replicaPaths = [...new Map(replicaBindings.map(replica => [
				`${replica.storageId}:${replica.storagePath}`,
				{
					storageName: replicaStorages?.find(storage => storage.id === replica.storageId)?.name || 'retained replica',
					storagePath: replica.storagePath,
				},
			])).values()];
			const retained = await remote.removeManagedPlan(plan);
			const deleted = await this.planStore.delete(planId, true);
			if (!deleted) throw new AppError(500, 'Failed to delete remote backup plan.');
			this.managedReplications?.detach(planId);
			return {
				deleted,
				unremovedPaths: [
					{ storageName: storageName || 'remote', storagePath: retained.storagePath },
					...replicaPaths,
				],
				unremovedReason:
					'Managed remote repository data was retained; this phase never deletes remote repositories.',
				storageDisposition: {
					status: 'retained_intentionally' as const,
					paths: [
						{ storageName: storageName || 'remote', storagePath: retained.storagePath },
						...replicaPaths,
					],
				},
			};
		}
		// Resolve replication storage names so removeBackup can purge them too
		const replicationStorages = removeRemoteData ? await this.resolveReplicationStorages(plan) : [];
		if (removeRemoteData) {
			await this.assertRemovableStorage(plan.storageId, plan.storagePath || '', planId);
			for (const replica of plan.settings.replication?.storages || [])
				await this.assertRemovableStorage(replica.storageId, replica.storagePath, planId);
		}

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
		const deleteRes = await this.planStore.delete(planId, true);
		if (!deleteRes) {
			throw new AppError(500, 'Failed to delete plan from the database.');
		}

		planLogger('delete', planId).info('Plan and associated data successfully deleted.');

		return {
			deleted: deleteRes,
			unremovedPaths: deleteResult.unremovedPaths || [],
			unremovedReason: deleteResult.unremovedReason || '',
			storageDisposition: {
				status: !removeRemoteData
					? ('retained_by_request' as const)
					: deleteResult.unremovedPaths?.length
						? ('cleanup_failed' as const)
						: ('removed' as const),
				paths: deleteResult.unremovedPaths || [],
			},
		};
	}

	/**
	 * Triggers a one-off manual backup for a plan.
	 */
	public async performBackup(planId: string, runConfig?: BackupRunConfig): Promise<string> {
		if (this.removingPlans.has(planId)) throw new AppError(409, 'Plan removal is in progress.');
		const plan = await this.planStore.getById(planId);
		if (!plan) throw new NotFoundError(`Plan with ID ${planId} not found.`);

		if (await this.planStore.hasActiveBackups(planId)) {
			throw new AppError(500, 'A backup is already in progress for this plan.');
		}
		if (RemoteBackupService.isRemoteFilesystemPlan(plan)) {
			return this.requireRemoteBackupService().queuePlanBackup(planId);
		}

		const strategy = this.getStrategy(plan) as BackupStrategy;
		const performResult = await strategy.performBackup(planId, runConfig);

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
		if (RemoteBackupService.isRemoteFilesystemPlan(plan)) {
			throw new AppError(501, 'REMOTE_CAPABILITY_NOT_IMPLEMENTED');
		}

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
		if (RemoteBackupService.isRemoteFilesystemPlan(plan)) {
			const paused = await this.requireRemoteBackupService().pausePlan(planId);
			if (!paused) throw new AppError(500, 'Failed to pause remote backup plan.');
			await this.planStore.setActive(planId, false);
			return;
		}

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
		if (RemoteBackupService.isRemoteFilesystemPlan(plan)) {
			const resumed = await this.requireRemoteBackupService().resumePlan(planId);
			if (!resumed) throw new AppError(500, 'Failed to resume remote backup plan.');
			await this.planStore.setActive(planId, true);
			return;
		}

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
			if (RemoteBackupService.isRemoteFilesystemPlan(plan)) {
				throw new AppError(501, 'REMOTE_CAPABILITY_NOT_IMPLEMENTED');
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
			if (error instanceof AppError) throw error;
			throw new AppError(500, error?.message || 'Internal Server Error');
		}
	}

	async repairRepo(
		planId: string,
		repairType: string,
		replicationId?: string
	): Promise<{ success: boolean; result: Record<string, any> }> {
		try {
			const plan = await this.planStore.getById(planId);
			if (!plan) {
				throw new NotFoundError('Plan not found');
			}
			if (RemoteBackupService.isRemoteFilesystemPlan(plan)) {
				throw new AppError(501, 'REMOTE_CAPABILITY_NOT_IMPLEMENTED');
			}
			let storageName;
			let storagePath;
			const integrityCheckResAll = plan.verified?.result as Record<string, BackupVerifiedResult>;
			let integrityCheckRes = integrityCheckResAll['primary'];
			if (replicationId) {
				const replicationStorage = plan.settings?.replication?.storages?.find(
					s => s.replicationId === replicationId
				);
				if (!replicationStorage) {
					throw new NotFoundError('Replication storage not found for the given replicationId');
				}
				storageName = replicationStorage.storageName;
				storagePath = replicationStorage.storagePath;
				integrityCheckRes = integrityCheckResAll[`mirror_${replicationStorage.storageId}`];
			} else {
				if (plan.storage) {
					storageName =
						plan.storage.name === 'Local' || plan.storage.name === 'Local Storage'
							? 'local'
							: plan.storage.name;
					storagePath = plan.storagePath || '';
				} else {
					throw new NotFoundError('Storage not found for the given replicationId');
				}
			}
			const strategy = this.getStrategy(plan);

			const result = await strategy.repairRepo(planId, repairType, integrityCheckRes, {
				storageName,
				storagePath,
			});
			return result;
		} catch (error: any) {
			console.log('[repairRepo] error :', error);
			if (error instanceof AppError) throw error;
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
		if (this.removingPlans.has(planId))
			throw new AppError(409, 'Plan removal is already in progress.');
		this.removingPlans.add(planId);
		try {
			return await this.removeReplicationStorage(
				planId,
				storageID,
				storagePath,
				removeData,
				replicationId
			);
		} finally {
			this.removingPlans.delete(planId);
		}
	}

	private async removeReplicationStorage(
		planId: string,
		storageID: string,
		storagePath: string,
		removeData: boolean,
		replicationId?: string
	) {
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
		const selectedStorage = replication.storages[storageIndex];
		if (selectedStorage.storageId !== storageID || selectedStorage.storagePath !== storagePath)
			throw new AppError(409, 'Replication storage selection changed. Refresh before removing it.');
		this.managedReplications?.assertPlanIdle(planId);
		if (
			(await this.planStore.hasActiveBackups(planId)) ||
			(await this.planStore.hasActiveRestore(planId))
		)
			throw new AppError(
				409,
				'Wait for active backups and restores before removing replication storage.'
			);

		// Resolve storage name for logging and rclone purge
		let storageName = 'Unknown';
		const storageRecords = await this.storageStore.getByIds([storageID]);
		if (storageRecords?.length) {
			const name = storageRecords[0].name;
			storageName = name === 'Local' || name === 'Local Storage' ? 'local' : name;
		}

		// Managed repositories are never passed to the legacy whole-prefix purge path.
		if (RemoteBackupService.isRemoteFilesystemPlan(plan) && removeData)
			throw new AppError(
				409,
				'Managed replica cleanup requires verified repository ownership and separate operator approval. Detach and retain the repository instead.'
			);
		if (RemoteBackupService.isRemoteFilesystemPlan(plan))
			this.managedReplications?.detach(planId, selectedStorage.replicationId);
		// If removeData is true, purge the replicated data from the remote storage
		if (removeData) {
			if (!selectedStorage.replicationId)
				throw new AppError(409, 'Replication identity is missing. Retain the storage data.');
			await this.assertRemovableStorage(
				selectedStorage.storageId,
				selectedStorage.storagePath,
				planId,
				selectedStorage.replicationId
			);
			const strategy = this.getStrategy(plan) as BackupStrategy;
			const purgeResult = await strategy.removeReplicationStorage(planId, {
				storageName,
				storagePath: selectedStorage.storagePath,
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

		if (RemoteBackupService.isRemoteFilesystemPlan(plan)) {
			await this.requireRemoteBackupService().updateManagedPlan({
				...plan,
				settings: updatedSettings,
			});
			return {
				success: true,
				message: 'Replica detached. Its repository and recovery access were retained.',
			};
		}
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

	private async assertRemovableStorage(
		storageId: string | null | undefined,
		storagePath: string,
		planId: string,
		replicationId?: string
	) {
		if (!storageId)
			throw new AppError(409, 'Storage identity is missing. Retain the storage data.');
		const storage = await this.storageStore.getById(storageId);
		if (!storage)
			throw new AppError(409, 'Storage identity is unavailable. Retain the storage data.');
		let references = await this.planStore.getStorageRemovalReferences();
		for (const retained of this.managedReplications?.listDestinations() || [])
			references.push({
				planId: null,
				storageId: retained.destinationStorageId,
				storagePath: retained.destinationStoragePath,
				kind: 'replica',
			});
		let checkedPath = storagePath;
		if (isS3Storage(storage.type)) {
			const selected = canonicalS3RepositoryIdentity(storage, storagePath);
			checkedPath = selected.prefix;
			const canonical = [];
			for (const reference of references) {
				if (!reference.storageId) continue;
				const other =
					reference.storageId === storageId
						? storage
						: await this.storageStore.getById(reference.storageId);
				if (!other || !isS3Storage(other.type)) continue;
				const identity = canonicalS3RepositoryIdentity(other, reference.storagePath);
				if (identity.authority === selected.authority)
					canonical.push({ ...reference, storageId, storagePath: identity.prefix });
			}
			references = canonical;
		}
		assertStorageRemovalScope(
			{ storageId, storagePath: checkedPath, local: storage.type === 'local' },
			references,
			{ planId, kind: replicationId === undefined ? 'plan' : 'replica', replicationId }
		);
	}

	/**
	 * Unlocks a plan's repository by removing all stale locks.
	 */
	public async unlockRepo(planId: string): Promise<{ success: boolean; result: string }> {
		const plan = await this.planStore.getById(planId);
		if (!plan) {
			throw new NotFoundError(`Plan with ID ${planId} not found.`);
		}
		if (RemoteBackupService.isRemoteFilesystemPlan(plan)) {
			throw new AppError(501, 'REMOTE_CAPABILITY_NOT_IMPLEMENTED');
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

	/**
	 * Builds the `remoteName:path` source that rclone reads for a storage-to-storage sync plan.
	 */
	private async bakeStorageSourcePath(
		sourcePath: string | undefined,
		sourceStorageId: string
	): Promise<string> {
		const sourceStorage = await this.getStorageDetails(sourceStorageId);
		if (!sourceStorage.name || !sourceStorage.type) {
			throw new NotFoundError('Source storage not found.');
		}
		const prefix = `${sourceStorage.name}:`;
		const givenPath = (sourcePath || '').trim();
		const rawPath = givenPath.startsWith(prefix) ? givenPath.slice(prefix.length) : givenPath;
		const cleanPath = sanitizeStoragePath(rawPath, sourceStorage.type);
		return `${sourceStorage.name}:${cleanPath}`;
	}

	private async getStorageDetails(storageId: string): Promise<BackupPlanArgs['storage']> {
		const storage = await this.storageStore.getById(storageId);
		if (!storage) {
			throw new NotFoundError('Storage not found');
		}
		return {
			name: storage.id === 'local' ? 'local' : normalizeStorageName(storage.name),
			type: storage.type as string,
			authType: storage.authType as string,
			settings: storage.settings as Record<string, string>,
			credentials: storage.credentials as Record<string, string>,
			defaultPath: storage.defaultPath as string,
		};
	}

	public async reconcileSchedules(): Promise<void> {
		await this.scheduleReconciler.reconcileSchedules();
		await this.remoteBackupService?.reconcileSchedules();
	}

	private requireRemoteBackupService(): RemoteBackupService {
		if (!this.remoteBackupService) {
			throw new AppError(501, 'REMOTE_CAPABILITY_NOT_IMPLEMENTED');
		}
		return this.remoteBackupService;
	}

	/**
	 * Marks every orphaned in-progress backup and restore as failed and clears
	 * stale in-progress flags on plans. The job queue is in memory only, so a
	 * row of this host that is in progress at startup is a leftover of a stopped
	 * or crashed service. Rows of a remote device are left alone.
	 * Returns the cleared rows.
	 */
	public async clearOrphanedInProgress(): Promise<{
		backups: Backup[];
		restores: Restore[];
		plans: Plan[];
	}> {
		const backupMsg =
			'Backup was interrupted because the Pluton service stopped or restarted. It was not completed.';
		const restoreMsg =
			'Restore was interrupted because the Pluton service stopped or restarted. It was not completed.';

		// Only rows of this host. A remote device runs its own agent, which keeps
		// running when Pluton restarts, so its in-progress rows are not orphans.
		const isLocal = (row: { sourceId?: string | null }) => (row.sourceId || 'main') === 'main';

		const sweptBackups: Backup[] = [];
		const orphanBackups = ((await this.backupStore.getAll()) || []).filter(
			b => b.inProgress && isLocal(b)
		);
		for (const backup of orphanBackups) {
			const updated = await this.backupStore.update(backup.id, {
				inProgress: false,
				status: 'failed',
				success: false,
				ended: sql`(unixepoch())` as any,
				errorMsg: backupMsg,
			});
			if (updated) sweptBackups.push(updated);
		}

		const sweptRestores: Restore[] = [];
		const orphanRestores = ((await this.restoreStore.getAll()) || []).filter(
			r => r.inProgress && isLocal(r)
		);
		for (const restore of orphanRestores) {
			// RestoreStore.update sets `ended` for a final status on its own.
			const updated = await this.restoreStore.update(restore.id, {
				inProgress: false,
				status: 'failed',
				errorMsg: restoreMsg,
			});
			if (updated) sweptRestores.push(updated);
		}

		const sweptPlans: Plan[] = [];
		const orphanPlans = ((await this.planStore.getAll()) || []).filter(
			p => p.inProgress && isLocal(p)
		);
		for (const plan of orphanPlans) {
			const updated = await this.planStore.update(plan.id, { inProgress: false });
			if (updated) sweptPlans.push(updated);
		}

		return { backups: sweptBackups, restores: sweptRestores, plans: sweptPlans };
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
				return {
					storageName: normalizeStorageName(record?.name),
					storagePath: rs.storagePath,
				};
			})
			.filter(s => s.storageName && s.storagePath);
	}
}
