import {
	integer,
	sqliteTable,
	text,
	index,
	uniqueIndex,
	primaryKey,
} from 'drizzle-orm/sqlite-core';
import { plans } from './plans';
import type { NotificationPayload } from '../../types/notificationDelivery';
export const notificationChannels = sqliteTable('notification_channels', {
	id: text('id').primaryKey().notNull(),
	name: text('name').notNull(),
	kind: text('kind').notNull(),
	enabled: integer('enabled').notNull().default(0),
	deleted: integer('deleted').notNull().default(0),
	events: text('events').notNull(),
	config: text('config').notNull(),
	encryptedSecret: text('encrypted_secret'),
	revision: integer('revision').notNull().default(1),
	sourceFloor: integer('source_floor').notNull(),
	createdAt: integer('created_at').notNull(),
	updatedAt: integer('updated_at').notNull(),
});
export const notificationSubscriptions = sqliteTable('notification_subscriptions', {
	planId: text('plan_id')
		.primaryKey()
		.notNull()
		.references(() => plans.id, { onDelete: 'cascade' }),
	enabled: integer('enabled').notNull().default(0),
	channelIds: text('channel_ids').notNull(),
	events: text('events').notNull(),
	sourceFloor: integer('source_floor').notNull(),
});
export const notificationSources = sqliteTable(
	'notification_sources',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		kind: text('kind').notNull(),
		jobId: text('job_id').notNull(),
		ready: integer('ready').notNull().default(0),
	},
	table => [
		uniqueIndex('notification_source_job').on(table.kind, table.jobId),
		index('notification_source_ready').on(table.ready, table.id),
	]
);
export const notificationObserved = sqliteTable(
	'notification_observed',
	{
		sourceId: integer('source_id')
			.notNull()
			.references(() => notificationSources.id, { onDelete: 'cascade' }),
		terminalStatus: text('terminal_status').notNull(),
	},
	table => [primaryKey({ columns: [table.sourceId, table.terminalStatus] })]
);
export const notificationEventRecords = sqliteTable(
	'notification_events',
	{
		id: text('id').primaryKey().notNull(),
		logicalKey: text('logical_key').notNull().unique(),
		eventType: text('event_type').notNull(),
		planId: text('plan_id'),
		planName: text('plan_name'),
		payload: text('payload', { mode: 'json' }).$type<NotificationPayload>().notNull(),
		createdAt: integer('created_at').notNull(),
	},
	table => [index('notification_event_created').on(table.createdAt)]
);
export const notificationDeliveries = sqliteTable(
	'notification_deliveries',
	{
		id: text('id').primaryKey().notNull(),
		eventId: text('event_id')
			.notNull()
			.references(() => notificationEventRecords.id, { onDelete: 'cascade' }),
		channelId: text('channel_id')
			.notNull()
			.references(() => notificationChannels.id),
		channelName: text('channel_name').notNull(),
		kind: text('kind').notNull(),
		revision: integer('revision').notNull(),
		status: text('status').notNull().default('pending'),
		attemptCount: integer('attempt_count').notNull().default(0),
		cycleAttempts: integer('cycle_attempts').notNull().default(0),
		manualRetries: integer('manual_retries').notNull().default(0),
		createdAt: integer('created_at').notNull(),
		lastAttemptAt: integer('last_attempt_at'),
		nextAttemptAt: integer('next_attempt_at'),
		completedAt: integer('completed_at'),
		leaseUntil: integer('lease_until'),
		leaseOwner: text('lease_owner'),
		errorCode: text('error_code'),
		httpStatus: integer('http_status'),
	},
	table => [
		uniqueIndex('notification_delivery_event_channel').on(table.eventId, table.channelId),
		index('notification_delivery_due').on(table.status, table.nextAttemptAt, table.leaseUntil),
	]
);
