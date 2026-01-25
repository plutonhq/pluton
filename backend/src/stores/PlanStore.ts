import { eq } from 'drizzle-orm';
import { and, sql } from 'drizzle-orm/sql';
import { DatabaseType } from '../db';
import { NewPlan, Plan, plans } from '../db/schema/plans';
import { backups } from '../db/schema/backups';
import { PlanBackupSettings, PlanFull } from '../types/plans';
import Cryptr from 'cryptr';
import { configService } from '../services/ConfigService';

/**
 * PlanStore is a class for managing plan records in the database.
 */
export class PlanStore {
	constructor(protected db: DatabaseType) {}

	async getAll(history: boolean = true): Promise<PlanFull[] | null> {
		const result = await this.db.query.plans.findMany({
			with: {
				device: {
					columns: {
						id: true,
						name: true,
						hostname: true,
					},
				},
				storage: {
					columns: {
						id: true,
						name: true,
						type: true,
					},
				},
				backups: {
					limit: history ? 90 : 10,
					orderBy: (backups, { desc }) => [desc(backups.ended)],
					columns: {
						id: true,
						title: true,
						description: true,
						status: true,
						errorMsg: true,
						download: true,
						started: true,
						ended: true,
						completionStats: true,
						taskStats: true,
						inProgress: true,
					},
				},
				restores: {
					limit: history ? 90 : 0,
					orderBy: (restores, { desc }) => [desc(restores.ended)],
					columns: {
						id: true,
						backupId: true,
						started: true,
						ended: true,
						config: true,
						status: true,
						completionStats: true,
						taskStats: true,
						errorMsg: true,
					},
				},
			},
		});

		if (result) {
			const plans = result.map(async plan => {
				if (plan?.settings?.scripts) {
					plan.settings.scripts = await this.decryptScripts(plan.settings.scripts);
				}
				return {
					...plan,
					backups: this.handleBackupStats(plan.method, plan.backups, plan.stats),
				};
			});
			return Promise.all(plans);
		}

		return null;
	}

	async getById(planId: string, history: boolean = false): Promise<PlanFull | null> {
		const thePlan = await this.db.query.plans.findFirst({
			where: eq(plans.id, planId),
			with: {
				device: {
					columns: {
						id: true,
						name: true,
						hostname: true,
					},
				},
				storage: {
					columns: {
						id: true,
						name: true,
						type: true,
					},
				},
				backups: {
					limit: history ? 90 : 10,
					orderBy: (backups, { desc }) => [desc(backups.ended)],
					columns: {
						id: true,
						title: true,
						description: true,
						status: true,
						errorMsg: true,
						download: true,
						started: true,
						ended: true,
						inProgress: true,
						completionStats: true,
						taskStats: true,
					},
				},
				restores: {
					limit: history ? 90 : 0,
					orderBy: (restores, { desc }) => [desc(restores.ended)],
					columns: {
						id: true,
						backupId: true,
						started: true,
						ended: true,
						config: true,
						status: true,
						inProgress: true,
						completionStats: true,
						taskStats: true,
						errorMsg: true,
					},
				},
			},
		});

		if (thePlan && thePlan.backups) {
			thePlan.backups = this.handleBackupStats(thePlan.method, thePlan.backups, thePlan.stats);
		}
		if (thePlan?.settings?.scripts) {
			thePlan.settings.scripts = await this.decryptScripts(thePlan.settings.scripts);
		}

		return thePlan || null;
	}

	async getStoragePlans(storageId: string): Promise<Plan[] | null> {
		const result = await this.db.query.plans.findMany({
			where: eq(plans.storageId, storageId),
		});
		return result;
	}

	async getDevicePlans(deviceId: string): Promise<Plan[] | null> {
		const result = await this.db.query.plans.findMany({
			where: eq(plans.sourceId, deviceId),
		});
		return result;
	}

	handleBackupStats(method: string, backups: PlanFull['backups'], stats: PlanFull['stats']) {
		return backups.map(backup => {
			const { completionStats: backupCompStats, taskStats: backupTaskStats } = backup;
			const backupStarted = backup.started ? new Date(backup.started).getTime() : 0;
			const backupEnded = backup.ended ? new Date(backup.ended).getTime() : 0;
			const taskStats = backupCompStats || backupTaskStats;
			return {
				...backup,
				totalFiles: backupTaskStats?.total_files_processed || 0,
				totalSize: backupTaskStats?.total_bytes_processed || 0,
				duration: Math.floor((backupEnded - backupStarted) / 1000),
				active: stats?.snapshots?.includes(backup.id) || false,
				changes: {
					new: (taskStats?.files_new || 0) + (taskStats?.dirs_new || 0),
					modified: (taskStats?.files_changed || 0) + (taskStats?.dirs_changed || 0),
					removed: 0,
				},
			};
		});
	}

	async create(planData: NewPlan): Promise<Plan | null> {
		const result = await this.db
			.insert(plans)
			.values({
				...planData,
				createdAt: sql`(unixepoch())`,
				isActive: true,
				stats: { size: 0, snapshots: [] },
			})
			.returning();
		return result[0] || null;
	}

	async update(id: string, updates: Partial<PlanFull | Plan>): Promise<Plan | null> {
		// Only allow certain fields to be updated
		const allowedFields = [
			'title',
			'description',
			'isActive',
			'inProgress',
			'storagePath',
			'sourceConfig',
			'verified',
			'lastBackupTime',
			'tags',
			'stats',
			'settings',
		] as const;

		// Only pick allowed fields
		const updatedPlan = Object.fromEntries(
			Object.entries(updates).filter(([key]) => allowedFields.includes(key as any))
		);

		// No valid fields to update
		if (Object.keys(updatedPlan).length === 0) {
			return null;
		}

		// Encrypt scripts if they are present
		if ((updatedPlan.settings as PlanBackupSettings)?.scripts) {
			(updatedPlan.settings as PlanBackupSettings).scripts = await this.encryptScripts(
				(updatedPlan.settings as PlanBackupSettings).scripts
			);
		}

		const result = await this.db
			.update(plans)
			.set({
				...updatedPlan,
				updatedAt: sql`(unixepoch())`,
			})
			.where(eq(plans.id, id))
			.returning();

		return result[0] || null;
	}

	async delete(id: string): Promise<boolean> {
		const result = await this.db.delete(plans).where(eq(plans.id, id));

		return result.changes > 0;
	}

	async hasActiveBackups(planId: string): Promise<boolean> {
		const result = await this.db
			.select()
			.from(backups)
			.where(and(eq(backups.planId, planId), eq(backups.inProgress, true)))
			.limit(1);

		return result.length > 0;
	}

	async setActive(id: string, isActive: boolean): Promise<Plan | null> {
		return this.update(id, { isActive });
	}

	async encryptScripts(scripts: Plan['settings']['scripts']): Promise<Plan['settings']['scripts']> {
		try {
			const planScripts = { ...scripts };
			const cryptr = new Cryptr(configService.config.SECRET as string);

			for (const [scriptType, scriptArray] of Object.entries(planScripts)) {
				if (scriptArray && Array.isArray(scriptArray)) {
					planScripts[scriptType as keyof typeof planScripts] = scriptArray.map(script => {
						const encryptedCommand = cryptr.encrypt(script.command);
						return {
							...script,
							command: encryptedCommand,
						};
					});
				}
			}
			return planScripts;
		} catch (error) {
			console.error('Error encrypting scripts:', error);
			throw new Error('Failed to encrypt Plan scripts');
		}
	}

	async decryptScripts(scripts: Plan['settings']['scripts']): Promise<Plan['settings']['scripts']> {
		try {
			const planScripts = { ...scripts };
			const cryptr = new Cryptr(configService.config.SECRET as string);

			for (const [scriptType, scriptArray] of Object.entries(planScripts)) {
				if (scriptArray && Array.isArray(scriptArray)) {
					planScripts[scriptType as keyof typeof planScripts] = scriptArray.map(script => {
						const decryptedCommand = cryptr.decrypt(script.command);
						return {
							...script,
							command: decryptedCommand,
						};
					});
				}
			}
			return planScripts;
		} catch (error) {
			console.error('Error decrypting scripts:', error);
			throw new Error('Failed to decrypt Plan scripts');
		}
	}
}
