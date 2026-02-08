import { and, eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm/sql';
import { DatabaseType } from '../db';
import { Restore, NewRestore, restores } from '../db/schema/restores';

/**
 * RestoreStore is a class for managing restore records in the database.
 */
export class RestoreStore {
	constructor(private db: DatabaseType) {}

	async getAll(): Promise<Restore[] | null> {
		const restores = await this.db.query.restores.findMany();
		return restores || null;
	}

	async getById(restoreId: string): Promise<Restore | null> {
		const restore = await this.db.query.restores.findFirst({
			where: eq(restores.id, restoreId),
		});

		return restore || null;
	}

	async create(restoreData: NewRestore): Promise<Restore | null> {
		const result = await this.db
			.insert(restores)
			.values({ ...restoreData, started: sql`(unixepoch())` })
			.returning();
		return result[0] || null;
	}

	async update(
		id: string,
		updates: Partial<NewRestore>,
		identifier: 'id' | 'backupId' = 'id'
	): Promise<Restore | null> {
		const ended =
			updates.status === 'completed' ||
			updates.status === 'failed' ||
			updates.status === 'cancelled';

		const result = await this.db
			.update(restores)
			.set({
				...updates,
				updatedAt: sql`(unixepoch())`,
				ended: ended ? sql`(unixepoch())` : null,
			})
			.where(eq(identifier === 'backupId' ? restores.backupId : restores.id, id))
			.returning();

		return result[0] || null;
	}

	async isRestoreRunning(backupId: string): Promise<boolean> {
		const restore = await this.db.query.restores.findFirst({
			where: and(eq(restores.backupId, backupId), eq(restores.inProgress, true)),
		});

		return restore?.inProgress === true || false;
	}

	async delete(id: string): Promise<boolean> {
		const result = await this.db.delete(restores).where(eq(restores.id, id));

		return result.changes > 0;
	}

	async deleteByPlanId(planId: string): Promise<boolean> {
		const result = await this.db.delete(restores).where(eq(restores.planId, planId));
		return result.changes > 0;
	}
}
