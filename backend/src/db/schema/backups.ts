import { sql } from 'drizzle-orm/sql';
import { sqliteTable, text, integer, AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-zod';
import { storages } from './storages';
import { plans } from './plans';
import {
	BackupCompletionStats,
	BackupDownload,
	BackupProgressStats,
	BackupTaskStats,
} from '../../types/backups';
import { PlanSource } from '../../types/plans';
import { SourceTypes } from '../../types/source';
import { relations } from 'drizzle-orm';

export const backups = sqliteTable('backups', {
	id: text('id').notNull().primaryKey(),
	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.default(sql`(unixepoch())`),
	updatedAt: integer('updated_at', { mode: 'timestamp' }),
	started: integer('started_at', { mode: 'timestamp' }),
	ended: integer('ended_at', { mode: 'timestamp' }),
	inProgress: integer('in_progress', { mode: 'boolean' }),
	success: integer('success', { mode: 'boolean' }),
	active: integer('active', { mode: 'boolean' }).default(true),
	status: text('status'),
	errorMsg: text('error_msg'),
	planId: text('plan_id').references((): AnySQLiteColumn => plans.id),
	storageId: text('storage_id').references((): AnySQLiteColumn => storages.id),
	storagePath: text('storage_path'),
	sourceId: text('source_id').notNull(),
	method: text('method').notNull(),
	sourceType: text('source_type').$type<SourceTypes>().notNull().default('device'),
	sourceConfig: text('source_config', { mode: 'json' }).$type<PlanSource>(),
	encryption: integer('encryption', { mode: 'boolean' }).default(true),
	compression: integer('compression', { mode: 'boolean' }).default(false),
	download: text('download', { mode: 'json' }).$type<BackupDownload>(),
	taskStats: text('task_stats', { mode: 'json' }).$type<BackupTaskStats>(),
	progressStats: text('progress_stats', { mode: 'json' }).$type<BackupProgressStats>(),
	completionStats: text('completion_stats', { mode: 'json' }).$type<BackupCompletionStats>(),
});

export type Backup = typeof backups.$inferSelect;
export type NewBackup = typeof backups.$inferInsert;
export const backupInsertSchema = createInsertSchema(backups);
export const backupUpdateSchema = createUpdateSchema(backups);
export const backupSelectSchema = createSelectSchema(backups);
export const backupRelations = relations(backups, ({ one }) => ({
	plan: one(plans, {
		fields: [backups.planId],
		references: [plans.id],
	}),
}));
