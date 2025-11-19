import { eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm/sql';
import { DatabaseType } from '../db';
import { Backup, NewBackup, backups } from '../db/schema/backups';

/**
 * BackupStore is a class for managing backup records in the database.
 */
export class BackupStore {
	private db: DatabaseType;
	constructor(db: DatabaseType) {
		this.db = db;
	}

	async getAll(): Promise<Backup[] | null> {
		const backups = await this.db.query.backups.findMany();
		return backups || null;
	}

	async getById(backupId: string): Promise<Backup | null> {
		const backup = await this.db.query.backups.findFirst({
			where: eq(backups.id, backupId),
		});

		return backup || null;
	}

	async create(backupData: NewBackup): Promise<Backup | null> {
		const result = await this.db
			.insert(backups)
			.values({ ...backupData, createdAt: sql`(unixepoch())`, started: sql`(unixepoch())` })
			.returning();
		return result[0] || null;
	}

	async update(id: string, updates: Partial<NewBackup>): Promise<Backup | null> {
		const updatedPayload = { ...updates, updatedAt: sql`(unixepoch())` };
		const result = await this.db
			.update(backups)
			.set(updatedPayload)
			.where(eq(backups.id, id))
			.returning();

		return result[0] || null;
	}

	async delete(id: string): Promise<boolean> {
		const result = await this.db.delete(backups).where(eq(backups.id, id));
		return result.changes > 0;
	}

	async deleteByPlanId(id: string): Promise<boolean> {
		const result = await this.db.delete(backups).where(eq(backups.planId, id));
		return result.changes > 0;
	}
}
