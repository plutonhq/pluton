import { eq, sql } from 'drizzle-orm';
import { DatabaseType } from '../db';
import { Device, NewDevice, devices } from '../db/schema/devices';
import { providers } from '../utils/providers';
import { plans } from '../db/schema/plans';

/**
 * DeviceStore is a class for managing device records in the database.
 */
export class DeviceStore {
	constructor(private db: DatabaseType) {}

	async getAll(): Promise<Device[] | null> {
		const devices = await this.db.query.devices.findMany({
			with: {
				plans: {
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
		return devices || null;
	}

	async getById(deviceId: string): Promise<Device | null> {
		const device = await this.db.query.devices.findFirst({
			where: eq(devices.id, deviceId),
		});

		return device || null;
	}

	async getDeviceStorages(
		id: string
	): Promise<{ id: string; name: string; type: string; storageTypeName: string }[] | null> {
		//if main device, get all the storages
		if (id === 'main') {
			const allStorages = await this.db.query.storages.findMany({
				columns: {
					id: true,
					name: true,
					type: true,
				},
			});
			return allStorages.map(s => ({
				...s,
				type: s.type ?? '',
				storageTypeName: providers[s.type as string]?.name ?? '',
			}));
		} else {
			// if remote device, get the storages used by its plans,
			// including replication storages (plan->settings->replication->storages) if replication is enabled
			const planItems = await this.db.query.plans.findMany({
				where: eq(plans.sourceId, id),
				with: {
					storage: {
						columns: {
							id: true,
							name: true,
							type: true,
						},
					},
				},
			});

			// Collect primary storage IDs and replication storage IDs
			const storageMap = new Map<string, { id: string; name: string; type: string }>();

			for (const plan of planItems) {
				// Add the plan's primary storage
				if (plan.storage) {
					storageMap.set(plan.storage.id, {
						id: plan.storage.id,
						name: plan.storage.name,
						type: plan.storage.type ?? '',
					});
				}

				// Add replication storages if replication is enabled
				const replication = plan.settings?.replication;
				if (replication?.enabled && replication.storages?.length) {
					for (const rs of replication.storages) {
						if (!storageMap.has(rs.storageId)) {
							storageMap.set(rs.storageId, {
								id: rs.storageId,
								name: rs.storageName, // placeholder, will be resolved below
								type: rs.storageType,
							});
						}
					}
				}
			}

			return [...storageMap.values()].map(s => ({
				...s,
				storageTypeName: providers[s.type]?.name ?? '',
			}));
		}
	}

	async create(deviceData: NewDevice): Promise<Device | null> {
		const result = await this.db.insert(devices).values(deviceData).returning();
		return result[0] || null;
	}

	async update(id: string, updates: Partial<NewDevice>): Promise<Device | null> {
		const result = await this.db
			.update(devices)
			.set({ ...updates, updatedAt: sql`(unixepoch())` })
			.where(eq(devices.id, id))
			.returning();

		return result[0] || null;
	}

	async delete(id: string): Promise<boolean> {
		const result = await this.db.delete(devices).where(eq(devices.id, id));

		return result.changes > 0;
	}
}
