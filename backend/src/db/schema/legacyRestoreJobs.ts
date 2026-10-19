import { relations, sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { legacyRepositories } from './legacyRepositories';

export type LegacyRestoreJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

/**
 * A staged, repository-read-only restore request for a registered legacy
 * repository. It intentionally has no relationship to managed plans, backups,
 * or managed restore records.
 */
export const legacyRestoreJobs = sqliteTable(
	'legacy_restore_jobs',
	{
		id: text('id').notNull().primaryKey(),
		repositoryId: text('repository_id')
			.notNull()
			.references(() => legacyRepositories.id),
		snapshotId: text('snapshot_id').notNull(),
		selectedPaths: text('selected_paths', { mode: 'json' }).$type<string[]>().notNull(),
		stagingPath: text('staging_path').notNull(),
		status: text('status').$type<LegacyRestoreJobStatus>().notNull().default('queued'),
		errorMsg: text('error_msg'),
		restoredFileCount: integer('restored_file_count'),
		restoredBytes: integer('restored_bytes'),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		startedAt: integer('started_at', { mode: 'timestamp' }),
		completedAt: integer('completed_at', { mode: 'timestamp' }),
		updatedAt: integer('updated_at', { mode: 'timestamp' }),
	},
	table => [index('legacy_restore_jobs_repository_id_idx').on(table.repositoryId)]
);

export const legacyRestoreJobRelations = relations(legacyRestoreJobs, ({ one }) => ({
	repository: one(legacyRepositories, {
		fields: [legacyRestoreJobs.repositoryId],
		references: [legacyRepositories.id],
	}),
}));

export type LegacyRestoreJob = typeof legacyRestoreJobs.$inferSelect;
export type NewLegacyRestoreJob = typeof legacyRestoreJobs.$inferInsert;
export const legacyRestoreJobInsertSchema = createInsertSchema(legacyRestoreJobs);
export const legacyRestoreJobSelectSchema = createSelectSchema(legacyRestoreJobs);
