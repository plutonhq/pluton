import { sql } from 'drizzle-orm/sql';
import { sqliteTable, integer, AnySQLiteColumn, text } from 'drizzle-orm/sqlite-core';
import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-zod';
import { plans } from './plans';
import { backups } from './backups';
import { BackupCompletionStats, BackupProgressStats } from '../../types/backups';
import { storages } from './storages';
import { RestoreConfig, RestoreTaskStats } from '../../types/restores';
import { SourceTypes } from '../../types/source';
import { relations } from 'drizzle-orm';

export const restores = sqliteTable('restores', {
	id: text('id').notNull().primaryKey(),
	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.default(sql`(unixepoch())`),
	updatedAt: integer('updated_at', { mode: 'timestamp' }),
	started: integer('started_at', { mode: 'timestamp' }),
	ended: integer('ended_at', { mode: 'timestamp' }),
	inProgress: integer('in_progress', { mode: 'boolean' }),
	status: text('status'),
	errorMsg: text('error_msg'),
	backupId: text('backup_id').references((): AnySQLiteColumn => backups.id),
	planId: text('plan_id').references((): AnySQLiteColumn => plans.id),
	storageId: text('storage_id').references((): AnySQLiteColumn => storages.id),
	sourceId: text('source_id').notNull(),
	sourceType: text('source_type').$type<SourceTypes>().notNull().default('device'),
	config: text('config', { mode: 'json' }).$type<RestoreConfig>(),
	method: text('method').notNull().default('backup'), // backup, sync, bisync
	taskStats: text('task_stats', { mode: 'json' }).$type<RestoreTaskStats>(),
	progressStats: text('progress_stats', { mode: 'json' }).$type<BackupProgressStats>(),
	completionStats: text('completion_stats', { mode: 'json' }).$type<BackupCompletionStats>(),
});

export type Restore = typeof restores.$inferSelect;
export type NewRestore = typeof restores.$inferInsert;
export const restoreInsertSchema = createInsertSchema(restores);
export const restoreUpdateSchema = createUpdateSchema(restores);
export const restoreSelectSchema = createSelectSchema(restores);
export const restoreRelations = relations(restores, ({ one }) => ({
	plan: one(plans, {
		fields: [restores.planId],
		references: [plans.id],
	}),
}));
