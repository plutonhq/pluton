import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-zod';
import { AppSettings } from '../../types/settings';

export const settings = sqliteTable('settings', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	settings: text('settings', { mode: 'json' }).$type<AppSettings>(),
	updatedAt: integer('updated_at', { mode: 'timestamp' }),
	updatedBy: text('updated_by'),
	version: integer('version').default(1),
});

export type Settings = typeof settings.$inferSelect;
export type NewSettings = typeof settings.$inferInsert;
export const settingsInsertSchema = createInsertSchema(settings);
export const settingsUpdateSchema = createUpdateSchema(settings);
export const settingsSelectSchema = createSelectSchema(settings);
