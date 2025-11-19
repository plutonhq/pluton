import { relations } from 'drizzle-orm';
import { sql } from 'drizzle-orm/sql';
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-zod';
import { plans } from './plans';
import { ProviderConfig } from '../../utils/providers';
import { PlanChildItem } from '../../types/plans';

export const storages = sqliteTable('storages', {
	id: text('id').notNull().primaryKey(),
	name: text('name').notNull(),
	type: text('type'), // dropbox, amazons3, backblaze, pcloud, ftp etc.
	defaultPath: text('default_path').default('/'),
	settings: text('settings', { mode: 'json' }).$type<Record<string, string | number | boolean>>(),
	credentials: text('credentials', { mode: 'json' }).$type<
		Record<string, string | number | boolean>
	>(),
	authType: text('authType'),
	tags: text('tags', { mode: 'json' }),
	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.default(sql`(unixepoch())`),
	updatedAt: integer('updated_at', { mode: 'timestamp' }),
});

export type Storage = typeof storages.$inferSelect;
export type NewStorage = typeof storages.$inferInsert;
export const storageInsertSchema = createInsertSchema(storages);
export const storageUpdateSchema = createUpdateSchema(storages);
export const storageSelectSchema = createSelectSchema(storages);
export const storageRelations = relations(storages, ({ many }) => ({
	plans: many(plans),
}));
export type StorageFull = Storage & {
	storageTypeName: string;
	storageFields: ProviderConfig['settings'];
	usedSize: number;
	plans: PlanChildItem[];
};
