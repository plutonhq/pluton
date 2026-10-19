import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { plans } from './plans';
import { backups } from './backups';
import { remoteManagedRepositories } from './remoteManagedRepositories';
import type {
	RecoveryPolicy,
	RecoveryResult,
	RecoveryStatus,
	RecoveryWarning,
	RecoveryStage,
	RecoveryCode,
	RecoveryTargetConfig,
	RecoveryEngine,
} from '../../types/recoveryTests';

export const recoveryTestPolicies = sqliteTable('recovery_test_policies', {
	planId: text('plan_id')
		.primaryKey()
		.references(() => plans.id, { onDelete: 'cascade' }),
	policy: text('policy', { mode: 'json' }).$type<RecoveryPolicy>().notNull(),
});
export const recoveryTargets = sqliteTable(
	'recovery_targets',
	{
		id: text('id').primaryKey(),
		planId: text('plan_id')
			.notNull()
			.references(() => plans.id, { onDelete: 'cascade' }),
		engine: text('engine').$type<RecoveryEngine>().notNull(),
		config: text('config', { mode: 'json' }).$type<RecoveryTargetConfig>().notNull(),
		encryptedPassword: text('encrypted_password').notNull(),
	},
	table => [uniqueIndex('recovery_targets_plan_engine').on(table.planId, table.engine)]
);
export const recoveryTests = sqliteTable(
	'recovery_tests',
	{
		id: text('id').primaryKey(),
		planId: text('plan_id')
			.notNull()
			.references(() => plans.id, { onDelete: 'cascade' }),
		backupId: text('backup_id')
			.notNull()
			.references(() => backups.id, { onDelete: 'cascade' }),
		repositoryId: text('repository_id')
			.notNull()
			.references(() => remoteManagedRepositories.id),
		snapshotId: text('snapshot_id').notNull(),
		status: text('status').$type<RecoveryStatus>().notNull(),
		trigger: text('trigger').$type<'manual' | 'after_backup'>().notNull(),
		/** Durable replay key; manual attempts remain independently repeatable. */
		automationKey: text('automation_key'),
		policy: text('policy', { mode: 'json' }).$type<RecoveryPolicy>().notNull(),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		startedAt: integer('started_at', { mode: 'timestamp' }),
		completedAt: integer('completed_at', { mode: 'timestamp' }),
		result: text('result', { mode: 'json' }).$type<RecoveryResult>(),
		failureStage: text('failure_stage').$type<RecoveryStage>(),
		stage: text('stage').$type<RecoveryStage>(),
		failureCode: text('failure_code').$type<RecoveryCode>(),
		warnings: text('warnings', { mode: 'json' }).$type<RecoveryWarning[]>().notNull().default([]),
		/** Cancellation is durable even while a process is still shutting down. */
		cancelRequested: integer('cancel_requested', { mode: 'boolean' }).notNull().default(false),
	},
	table => [
		index('recovery_tests_backup_created').on(table.backupId, table.createdAt),
		index('recovery_tests_status').on(table.status),
		uniqueIndex('recovery_tests_automation_key').on(table.automationKey),
		uniqueIndex('recovery_tests_active_plan')
			.on(table.planId)
			.where(sql`${table.status} in ('queued','running')`),
	]
);
export type RecoveryTest = typeof recoveryTests.$inferSelect;
export type NewRecoveryTest = typeof recoveryTests.$inferInsert;

/** A crash-recoverable cleanup lease, not a validation result or a credential API. */
export const recoveryImportLeases = sqliteTable('recovery_import_leases', {
	id: text('id').primaryKey(),
	testId: text('test_id')
		.notNull()
		.references(() => recoveryTests.id, { onDelete: 'cascade' }),
	targetId: text('target_id')
		.notNull()
		.references(() => recoveryTargets.id),
	database: text('database_name').notNull(),
	ownerToken: text('owner_token').notNull(),
});
export type RecoveryImportLease = typeof recoveryImportLeases.$inferSelect;
