import { eq, inArray } from 'drizzle-orm';
import { sql } from 'drizzle-orm/sql';
import { DatabaseType } from '../db';
import { Storage, NewStorage, storages, StorageFull } from '../db/schema/storages';
import { providers } from '../utils/providers';
import { PlanChildItem, PlanBackupSettings, ReplicationPlanItem } from '../types/plans';
import { AppError } from '../utils/AppError';
import { canonicalS3RepositoryIdentity } from '../utils/storageSecurity';
import { assertStorageUpdateReplicaIsolation } from '../utils/managedReplicationPolicy';

/**
 * StorageStore is a class for managing storage records in the database.
 */
export class StorageStore {
	constructor(private db: DatabaseType) {}

	/** Check before publishing a remote configuration; database triggers also guard races. */
	assertManagedReplicationStorageEditable(storageId: string, next?: Storage): void {
		const sqlite = this.db.$client;
		if (
			!sqlite
				.prepare(
					"SELECT 1 FROM sqlite_master WHERE type='table' AND name='managed_replication_jobs'"
				)
				.get()
		)
			return;
		if (
			sqlite
				.prepare(
					"SELECT 1 FROM managed_replication_jobs WHERE (source_storage_id=? OR destination_storage_id=?) AND status IN ('pending','running','uncertain') LIMIT 1"
				)
				.get(storageId, storageId)
		) {
			throw new AppError(
				409,
				'Storage is reserved by pending, running or uncertain managed replication. Finish reconciliation before editing it.'
			);
		}
		if (
			!next &&
			sqlite
				.prepare(
					'SELECT 1 FROM managed_replication_destinations WHERE destination_storage_id=? LIMIT 1'
				)
				.get(storageId)
		)
			throw new AppError(
				409,
				'Storage still identifies an owned or retained managed repository. Retain its storage configuration.'
			);
		if (next) {
			assertStorageUpdateReplicaIsolation(sqlite, storageId, next);
			const destinations = sqlite
				.prepare(
					'SELECT destination_storage_path,destination_authority,destination_prefix FROM managed_replication_destinations WHERE destination_storage_id=?'
				)
				.all(storageId) as Array<any>;
			for (const destination of destinations) {
				const identity = canonicalS3RepositoryIdentity(next, destination.destination_storage_path);
				if (
					identity.authority !== destination.destination_authority ||
					identity.prefix !== destination.destination_prefix
				)
					throw new AppError(
						409,
						'Storage endpoint/bucket is bound to an owned managed repository. Detach and retain it before using a different storage.'
					);
			}
		}
	}

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
	 * Returns the devices that own a plan replicating to the given storage.
	 * These devices hold an rclone config entry for it and need it re-pushed on edit.
	 */
	async getReplicationPlanSources(storageId: string): Promise<string[]> {
		// Managed Agent replication runs on the server. Never distribute its
		// destination credentials to an Agent merely because it owns a plan.
		const map = await this.getReplicationPlansForStorages([storageId], true);
		const plans = map.get(storageId) || [];
		return [...new Set(plans.map(plan => plan.sourceId).filter(Boolean))];
	}

	/**
	 * Returns plans that use a given storage for replication (inside settings.replication.storages).
	 * Used to accurately count all plans associated with a storage.
	 */
	private async getReplicationPlansForStorages(
		storageIds: string[],
		excludeManagedAgents = false
	): Promise<Map<string, ReplicationPlanItem[]>> {
		const result = new Map<string, ReplicationPlanItem[]>();
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
				sourceId: true,
				sourceType: true,
			},
		});

		for (const plan of allPlans) {
			if (excludeManagedAgents && plan.sourceType === 'device' && plan.sourceId !== 'main')
				continue;
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
								sourceId: plan.sourceId,
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
		return this.db.transaction(tx => {
			const next = assertStorageUpdateReplicaIsolation(this.db.$client, id, updates);
			if (next) this.assertManagedReplicationStorageEditable(id, next);
			const result = tx.update(storages).set({ ...updates, updatedAt: sql`(unixepoch())` })
				.where(eq(storages.id, id)).returning().all();
			return result[0] || null;
		}, { behavior: 'immediate' });
	}

	async delete(id: string): Promise<boolean> {
		const result = await this.db.delete(storages).where(eq(storages.id, id));

		return result.changes > 0;
	}
}
