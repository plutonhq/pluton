import { sql } from 'drizzle-orm/sql';
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { createInsertSchema, createSelectSchema, createUpdateSchema } from 'drizzle-zod';
import { DeviceMetrics, DeviceSettings, DeviceDependencyVersions } from '../../types/devices';
import { relations } from 'drizzle-orm';
import { plans } from './plans';

export const devices = sqliteTable('devices', {
	id: text('id').notNull().primaryKey(),
	name: text('name').notNull(),
	type: text('type').notNull().default('device'),
	ip: text('ip'),
	host: text('host'),
	port: integer('port'),
	key: text('key'),
	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.default(sql`(unixepoch())`),
	updatedAt: integer('updated_at', { mode: 'timestamp' }),
	agentId: text('agent_id').unique(),
	versions: text('versions', { mode: 'json' }).$type<DeviceDependencyVersions>(),
	hostname: text('hostname'),
	os: text('os'),
	platform: text('platform'),
	metrics: text('metrics', { mode: 'json' }).$type<DeviceMetrics>(),
	status: text('status'),
	tags: text('tags', { mode: 'json' }),
	lastSeen: integer('last_seen', { mode: 'timestamp' }),
	settings: text('settings', { mode: 'json' }).$type<DeviceSettings>(),
});

export type Device = typeof devices.$inferSelect;
export type NewDevice = typeof devices.$inferInsert;
export const deviceInsertSchema = createInsertSchema(devices);
export const deviceUpdateSchema = createUpdateSchema(devices);
export const deviceSelectSchema = createSelectSchema(devices);
export const deviceRelations = relations(devices, ({ many }) => ({
	plans: many(plans),
}));
