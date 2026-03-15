import { eq, inArray } from 'drizzle-orm';
import { sql } from 'drizzle-orm/sql';
import { DatabaseType } from '../db';
import { Storage, NewStorage, storages, StorageFull } from '../db/schema/storages';
import { providers } from '../utils/providers';
import { PlanChildItem, PlanBackupSettings } from '../types/plans';

/**
 * StorageStore is a class for managing storage records in the database.
 */
export class StorageStore {
	constructor(private db: DatabaseType) {}

	async getAll(full: boolean = false, hideCreds: boolean = false): Promise<Storage[] | null> {
		const storages = await this.db.query.storages.findMany({
			with: {
				plans: {
					limit: full ? undefined : 0,
					columns: {
						id: true,
						title: true,
						createdAt: true,
						isActive: true,
						stats: true,
						method: true,
					},
				},
			},
		});

		if (storages && storages.length > 0 && full) {
			const storageIds = storages.map(s => s.id);
			const replicationPlansMap = await this.getReplicationPlansForStorages(storageIds);

			const allStorages = storages.map(storage => {
				const replicationPlans = replicationPlansMap.get(storage.id) || [];
				const directPlans = storage.plans || [];
				// Merge direct + replication plans, avoiding duplicates
				const mergedPlans = [...directPlans];
				for (const repPlan of replicationPlans) {
					if (!mergedPlans.some(p => p.id === repPlan.id)) {
						mergedPlans.push(repPlan);
					}
				}

				// Calculate usedSize including mirror sizes from plan stats
				const usedSize = mergedPlans.reduce((acc, plan) => {
					const isReplicationPlan = replicationPlans.some(rp => rp.id === plan.id);
					if (isReplicationPlan && plan.stats?.mirrors) {
						// For replication plans, use the mirror size matching this storage
						const mirrorStat = plan.stats.mirrors.find((m: any) => m.storageId === storage.id);
						return acc + (mirrorStat?.size || 0);
					}
					// For direct plans, use the main stats size
					return acc + (plan.stats?.size || 0);
				}, 0);

				const fullStorage: StorageFull = {
					...storage,
					storageTypeName: providers[storage.type as string].name,
					storageFields: providers[storage.type as string].settings,
					usedSize,
					plans: mergedPlans,
				};
				return fullStorage;
			});
			return allStorages;
		}
		if (storages && hideCreds && storages.length > 0) {
			return storages.map(s => ({ ...s, credentials: null }));
		}
		return storages || null;
	}

	async getById(
		storageId: string,
		full: boolean = false,
		hideCreds: boolean = false
	): Promise<Storage | StorageFull | null> {
		const storage = await this.db.query.storages.findFirst({
			where: eq(storages.id, storageId),
			with: {
				plans: {
					limit: full ? undefined : 0,
					columns: {
						id: true,
						title: true,
						createdAt: true,
						isActive: true,
						stats: true,
						method: true,
					},
				},
			},
		});

		if (storage && full) {
			const replicationPlansMap = await this.getReplicationPlansForStorages([storageId]);
			const replicationPlans = replicationPlansMap.get(storageId) || [];
			const directPlans = storage.plans || [];
			// Merge direct + replication plans, avoiding duplicates
			const mergedPlans = [...directPlans];
			for (const repPlan of replicationPlans) {
				if (!mergedPlans.some(p => p.id === repPlan.id)) {
					mergedPlans.push(repPlan);
				}
			}

			// Calculate usedSize including mirror sizes from plan stats
			const usedSize = mergedPlans.reduce((acc, plan) => {
				const isReplicationPlan = replicationPlans.some(rp => rp.id === plan.id);
				if (isReplicationPlan && plan.stats?.mirrors) {
					// For replication plans, use the mirror size matching this storage
					const mirrorStat = plan.stats.mirrors.find((m: any) => m.storageId === storageId);
					return acc + (mirrorStat?.size || 0);
				}
				// For direct plans, use the main stats size
				return acc + (plan.stats?.size || 0);
			}, 0);

			const fullStorage: StorageFull = {
				...storage,
				storageTypeName: providers[storage.type as string].name,
				storageFields: providers[storage.type as string].settings,
				usedSize,
				plans: mergedPlans,
			};
			return fullStorage;
		}
		if (storage && hideCreds && storage.credentials) {
			storage.credentials = null;
		}

		return storage || null;
	}

	/**
	 * Returns plans that reference the given storage as a replication target.
	 */
	async getReplicationPlans(storageId: string): Promise<PlanChildItem[]> {
		const map = await this.getReplicationPlansForStorages([storageId]);
		return map.get(storageId) || [];
	}

	/**
	 * Returns plans that use a given storage for replication (inside settings.replication.storages).
	 * Used to accurately count all plans associated with a storage.
	 */
	private async getReplicationPlansForStorages(
		storageIds: string[]
	): Promise<Map<string, PlanChildItem[]>> {
		const result = new Map<string, PlanChildItem[]>();
		if (storageIds.length === 0) return result;

		// Query all plans that have replication settings
		const allPlans = await this.db.query.plans.findMany({
			columns: {
				id: true,
				title: true,
				createdAt: true,
				isActive: true,
				stats: true,
				method: true,
				settings: true,
				storageId: true,
			},
		});

		for (const plan of allPlans) {
			const settings = plan.settings as PlanBackupSettings;
			if (settings?.replication?.enabled && settings.replication.storages?.length > 0) {
				for (const repStorage of settings.replication.storages) {
					if (
						storageIds.includes(repStorage.storageId) &&
						repStorage.storageId !== plan.storageId
					) {
						const existing = result.get(repStorage.storageId) || [];
						// Avoid duplicates
						if (!existing.some(p => p.id === plan.id)) {
							existing.push({
								id: plan.id,
								title: plan.title,
								createdAt: plan.createdAt,
								isActive: plan.isActive,
								stats: plan.stats,
								method: plan.method,
							});
							result.set(repStorage.storageId, existing);
						}
					}
				}
			}
		}

		return result;
	}

	async getByIds(storageIds: string[]): Promise<Storage[] | null> {
		const storageItems = await this.db.query.storages.findMany({
			where: inArray(storages.id, storageIds),
		});
		return storageItems || null;
	}

	async create(storageData: NewStorage): Promise<Storage | null> {
		const result = await this.db.insert(storages).values(storageData).returning();
		return result[0] || null;
	}

	async update(id: string, updates: Partial<NewStorage>): Promise<Storage | null> {
		const result = await this.db
			.update(storages)
			.set({ ...updates, updatedAt: sql`(unixepoch())` })
			.where(eq(storages.id, id))
			.returning();

		return result[0] || null;
	}

	async delete(id: string): Promise<boolean> {
		const result = await this.db.delete(storages).where(eq(storages.id, id));

		return result.changes > 0;
	}
}
