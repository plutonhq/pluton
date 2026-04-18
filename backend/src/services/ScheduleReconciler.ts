import { BaseBackupManager } from '../managers/BaseBackupManager';
import { PlanStore } from '../stores/PlanStore';
import { StorageStore } from '../stores/StorageStore';
import { Plan, NewPlan } from '../db/schema/plans';
import { BackupPlanArgs } from '../types/plans';
import { intervalToCron } from '../utils/intervalToCron';
import { NotFoundError } from '../utils/AppError';

/**
 * Reconciles the CronManager schedules with the plans stored in the database.
 * Removes orphaned schedules (present in CronManager but not in DB) and
 * recreates missing schedules (present in DB but not in CronManager).
 * Should be called once during application startup.
 */

export class ScheduleReconciler {
	constructor(
		protected localAgent: BaseBackupManager,
		protected planStore: PlanStore,
		protected storageStore: StorageStore
	) {}

	public async reconcileSchedules(): Promise<void> {
		const allPlans = await this.getReconciliationPlans();
		const dbPlanIds = new Set(allPlans.map(plan => plan.id));
		const dbPlanMap = new Map(allPlans.map(plan => [plan.id, plan]));

		const schedulesMap = await this.localAgent.cronManager.getSchedules();
		const scheduledIds = new Set(schedulesMap.keys());

		const orphansRemoved = await this.removeOrphanedSchedules(scheduledIds, dbPlanIds);

		let schedulesAdded = 0;
		for (const [planId, plan] of dbPlanMap) {
			if (scheduledIds.has(planId)) continue;

			try {
				if (await this.reconcileMissingSchedule(planId, plan)) {
					schedulesAdded++;
				}
			} catch (error: any) {
				console.error(
					`[Reconciliation] Failed to recreate schedule for plan ${planId}: ${error?.message}`
				);
			}
		}

		if (orphansRemoved === 0 && schedulesAdded === 0) {
			return;
		}

		console.log(
			`[Reconciliation] Complete. Orphans removed: ${orphansRemoved}, Schedules added: ${schedulesAdded}.`
		);
	}

	protected async getReconciliationPlans(): Promise<Plan[]> {
		return (await this.planStore.getDevicePlans('main')) || [];
	}

	protected async removeOrphanedSchedules(
		scheduledIds: Set<string>,
		dbPlanIds: Set<string>
	): Promise<number> {
		let orphansRemoved = 0;

		for (const scheduledId of scheduledIds) {
			if (!dbPlanIds.has(scheduledId)) {
				try {
					await this.localAgent.cronManager.removeSchedule(scheduledId);
					orphansRemoved++;
					console.log(`[Reconciliation] Removed orphaned schedule for plan ID: ${scheduledId}`);
				} catch (error: any) {
					console.error(
						`[Reconciliation] Failed to remove orphaned schedule ${scheduledId}: ${error?.message}`
					);
				}
			}
		}

		return orphansRemoved;
	}

	protected async buildReconciliationScheduleOptions(
		planId: string,
		plan: Plan | NewPlan
	): Promise<BackupPlanArgs | null> {
		if (!plan.settings?.interval) {
			console.warn(`[Reconciliation] Skipping plan ${planId} — no interval settings found.`);
			return null;
		}

		const planStorage = await this.getStorageDetails(plan.storageId as string);
		if (!planStorage.name || !planStorage.type) {
			console.warn(`[Reconciliation] Skipping plan ${planId} — storage not found.`);
			return null;
		}

		const cronExpression = intervalToCron(plan.settings.interval);
		return {
			...plan,
			storage: planStorage,
			cronExpression,
		};
	}

	protected async reconcileMissingSchedule(
		planId: string,
		plan: Plan | NewPlan
	): Promise<boolean> {
		const backupScheduleOptions = await this.buildReconciliationScheduleOptions(planId, plan);
		if (!backupScheduleOptions) {
			return false;
		}

		await this.localAgent.createOrUpdateSchedules(planId, backupScheduleOptions, 'create');
		console.log(
			`[Reconciliation] Recreated missing schedule for plan "${plan.title}" (${planId})`
		);

		return true;
	}

	protected async getStorageDetails(storageId: string): Promise<BackupPlanArgs['storage']> {
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