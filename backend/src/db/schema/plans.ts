import { sqliteTable, text, integer, AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-zod';
import { sql } from 'drizzle-orm/sql';
import { storages } from './storages';
import { PlanSource, PlanVerification, PlanBackupSettings, PlanStats } from '../../types/plans';
import { SourceTypes } from '../../types/source';
import { relations } from 'drizzle-orm';
import { devices } from './devices';
import { backups } from './backups';
import { restores } from './restores';

export const plans = sqliteTable('plans', {
	id: text('id').notNull().primaryKey(),
	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.default(sql`(unixepoch())`),
	title: text('title').notNull(),
	isActive: integer('active', { mode: 'boolean' }).notNull().default(true),
	inProgress: integer('in_progress', { mode: 'boolean' }),
	updatedAt: integer('updated_at', { mode: 'timestamp' }),
	storageId: text('storage_id').references((): AnySQLiteColumn => storages.id),
	storagePath: text('storage_path'),
	sourceId: text('source_id').notNull(),
	sourceType: text('source_type').$type<SourceTypes>().notNull().default('device'),
	sourceConfig: text('source_config', { mode: 'json' }).notNull().$type<PlanSource>(), // an object that contains includes and excludes key which are array of strings folder locations
	verified: text('verified', { mode: 'json' }).$type<PlanVerification>(),
	lastBackupTime: integer('last_backup_time', { mode: 'timestamp' }),
	method: text('method').notNull().default('backup'), // backup, sync, bisync, rescue
	tags: text('tags', { mode: 'json' }).$type<string[]>(), // array of strings
	settings: text('settings', { mode: 'json' }).$type<PlanBackupSettings>().notNull(),
	stats: text('stats', { mode: 'json' }).$type<PlanStats>(),
});

export type Plan = typeof plans.$inferSelect;
export type NewPlan = typeof plans.$inferInsert;
export const planInsertSchema = createInsertSchema(plans);
export const planUpdateSchema = createUpdateSchema(plans);
export const planSelectSchema = createSelectSchema(plans);

export const plansRelations = relations(plans, ({ one, many }) => ({
	storage: one(storages, {
		fields: [plans.storageId],
		references: [storages.id],
	}),
	device: one(devices, {
		fields: [plans.sourceId],
		references: [devices.id],
	}),
	backups: many(backups),
	restores: many(restores),
}));
