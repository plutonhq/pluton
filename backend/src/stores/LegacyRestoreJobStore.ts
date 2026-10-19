import { and, eq, inArray } from 'drizzle-orm';
import { sql } from 'drizzle-orm/sql';
import { DatabaseType } from '../db';
import {
	LegacyRestoreJob,
	LegacyRestoreJobStatus,
	legacyRestoreJobs,
	NewLegacyRestoreJob,
} from '../db/schema/legacyRestoreJobs';

/**
 * Persists only staged recovery work for imported repositories. These records
 * do not participate in managed backup, retention, or restore workflows.
 */
export class LegacyRestoreJobStore {
	constructor(private db: DatabaseType) {}

	async getById(id: string): Promise<LegacyRestoreJob | null> {
		return (
			(await this.db.query.legacyRestoreJobs.findFirst({
				where: eq(legacyRestoreJobs.id, id),
			})) || null
		);
	}

	async getByIdAndRepository(id: string, repositoryId: string): Promise<LegacyRestoreJob | null> {
		return (
			(await this.db.query.legacyRestoreJobs.findFirst({
				where: and(eq(legacyRestoreJobs.id, id), eq(legacyRestoreJobs.repositoryId, repositoryId)),
			})) || null
		);
	}

	async create(data: NewLegacyRestoreJob): Promise<LegacyRestoreJob | null> {
		const result = await this.db.insert(legacyRestoreJobs).values(data).returning();
		return result[0] || null;
	}

	async markRunningIfQueued(id: string): Promise<LegacyRestoreJob | null> {
		const result = await this.db
			.update(legacyRestoreJobs)
			.set({
				status: 'running',
				startedAt: sql`(unixepoch())`,
				errorMsg: null,
				updatedAt: sql`(unixepoch())`,
			})
			.where(and(eq(legacyRestoreJobs.id, id), eq(legacyRestoreJobs.status, 'queued')))
			.returning();
		return result[0] || null;
	}

	async cancelIfActive(id: string): Promise<LegacyRestoreJob | null> {
		const result = await this.db
			.update(legacyRestoreJobs)
			.set({
				status: 'cancelled',
				completedAt: sql`(unixepoch())`,
				errorMsg: null,
				updatedAt: sql`(unixepoch())`,
			})
			.where(and(eq(legacyRestoreJobs.id, id), inArray(legacyRestoreJobs.status, ['queued', 'running'])))
			.returning();
		return result[0] || null;
	}

	async completeIfRunning(
		id: string,
		result: Pick<NewLegacyRestoreJob, 'restoredFileCount' | 'restoredBytes'>
	): Promise<LegacyRestoreJob | null> {
		const updated = await this.db
			.update(legacyRestoreJobs)
			.set({
				status: 'completed',
				completedAt: sql`(unixepoch())`,
				restoredFileCount: result.restoredFileCount,
				restoredBytes: result.restoredBytes,
				updatedAt: sql`(unixepoch())`,
			})
			.where(and(eq(legacyRestoreJobs.id, id), eq(legacyRestoreJobs.status, 'running')))
			.returning();
		return updated[0] || null;
	}

	async failIfActive(id: string, errorMsg: string): Promise<LegacyRestoreJob | null> {
		const result = await this.db
			.update(legacyRestoreJobs)
			.set({
				status: 'failed',
				completedAt: sql`(unixepoch())`,
				errorMsg,
				updatedAt: sql`(unixepoch())`,
			})
			.where(and(eq(legacyRestoreJobs.id, id), inArray(legacyRestoreJobs.status, ['queued', 'running'])))
			.returning();
		return result[0] || null;
	}

	async cancelIfRunning(id: string): Promise<LegacyRestoreJob | null> {
		const result = await this.db
			.update(legacyRestoreJobs)
			.set({
				status: 'cancelled',
				completedAt: sql`(unixepoch())`,
				errorMsg: null,
				updatedAt: sql`(unixepoch())`,
			})
			.where(and(eq(legacyRestoreJobs.id, id), eq(legacyRestoreJobs.status, 'running')))
			.returning();
		return result[0] || null;
	}

	async markInterruptedAsFailed(): Promise<void> {
		await this.db
			.update(legacyRestoreJobs)
			.set({
				status: 'failed' as LegacyRestoreJobStatus,
				errorMsg: 'Restore interrupted by an application restart.',
				completedAt: sql`(unixepoch())`,
				updatedAt: sql`(unixepoch())`,
			})
			.where(inArray(legacyRestoreJobs.status, ['queued', 'running']));
	}
}
