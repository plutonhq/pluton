import { eq, sql } from 'drizzle-orm';
import { DatabaseType } from '../db';
import { Device, NewDevice, devices } from '../db/schema/devices';

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
