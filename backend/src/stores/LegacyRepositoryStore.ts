import { eq } from 'drizzle-orm';
import { sql } from 'drizzle-orm/sql';
import { DatabaseType } from '../db';
import {
	LegacyRepository,
	LegacyRepositoryValidationStatus,
	legacyRepositories,
	NewLegacyRepository,
} from '../db/schema/legacyRepositories';

/**
 * Persists only local registration metadata for externally created repositories.
 * It has no relationship to plans, schedules, backups, or retention.
 */
export class LegacyRepositoryStore {
	constructor(private db: DatabaseType) {}

	async getAll(): Promise<LegacyRepository[]> {
		return await this.db.query.legacyRepositories.findMany();
	}

	async getById(id: string): Promise<LegacyRepository | null> {
		return (await this.db.query.legacyRepositories.findFirst({
			where: eq(legacyRepositories.id, id),
		})) || null;
	}

	async create(data: NewLegacyRepository): Promise<LegacyRepository | null> {
		const result = await this.db.insert(legacyRepositories).values(data).returning();
		return result[0] || null;
	}

	async updateValidationStatus(
		id: string,
		validationStatus: LegacyRepositoryValidationStatus
	): Promise<LegacyRepository | null> {
		const result = await this.db
			.update(legacyRepositories)
			.set({
				validationStatus,
				lastValidatedAt: sql`(unixepoch())`,
				updatedAt: sql`(unixepoch())`,
			})
			.where(eq(legacyRepositories.id, id))
			.returning();
		return result[0] || null;
	}

	async delete(id: string): Promise<boolean> {
		const result = await this.db.delete(legacyRepositories).where(eq(legacyRepositories.id, id));
		return result.changes > 0;
	}
}
