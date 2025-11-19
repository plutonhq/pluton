import { eq, inArray } from 'drizzle-orm';
import { sql } from 'drizzle-orm/sql';
import { DatabaseType } from '../db';
import { Storage, NewStorage, storages, StorageFull } from '../db/schema/storages';
import { providers } from '../utils/providers';

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
			const allStorages = storages.map(storage => {
				const fullStorage: StorageFull = {
					...storage,
					storageTypeName: providers[storage.type as string].name,
					storageFields: providers[storage.type as string].settings,
					usedSize: storage.plans.reduce((acc, plan) => acc + (plan.stats?.size || 0), 0),
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
			const fullStorage: StorageFull = {
				...storage,
				storageTypeName: providers[storage.type as string].name,
				storageFields: providers[storage.type as string].settings,
				usedSize: storage.plans.reduce((acc, plan) => acc + (plan.stats?.size || 0), 0),
			};
			return fullStorage;
		}
		if (storage && hideCreds && storage.credentials) {
			storage.credentials = null;
		}

		return storage || null;
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
