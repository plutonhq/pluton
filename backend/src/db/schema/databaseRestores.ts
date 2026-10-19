import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import type { DatabaseRestore, DatabaseRestoreInspection } from '../../types/databaseRestores';
import type { RecoveryDatabaseResult } from '../../types/recoveryTests';
/** History is deliberately NOT cascade-bound to plans/backups: retained ownership must survive their deletion. */
export const persistentDatabaseRestores = sqliteTable(
	'persistent_database_restores',
	{
		id: text('id').primaryKey(),
		owner: text('owner').notNull(),
		purpose: text('purpose').notNull(),
		planId: text('plan_id').notNull(),
		repositoryId: text('repository_id').notNull(),
		backupId: text('backup_id').notNull(),
		snapshotId: text('snapshot_id').notNull(),
		databaseId: text('database_id').notNull(),
		artifact: text('artifact', { mode: 'json' }).$type<RecoveryDatabaseResult>().notNull(),
		metadataToken: text('metadata_token').notNull(),
		mode: text('mode').$type<DatabaseRestore['mode']>().notNull(),
		targetId: text('target_id').notNull(),
		targetFingerprint: text('target_fingerprint'),
		encryptedApproval: text('encrypted_approval'),
		ownerToken: text('owner_token').notNull(),
		database: text('database_name'),
		status: text('status').$type<DatabaseRestore['status']>().notNull(),
		stage: text('stage').notNull(),
		cleanup: text('cleanup').$type<DatabaseRestore['cleanup']>().notNull(),
		createdAt: integer('created_at').notNull(),
		startedAt: integer('started_at'),
		completedAt: integer('completed_at'),
		failureStage: text('failure_stage'),
		failureCode: text('failure_code'),
		expiresAt: integer('expires_at').notNull(),
		ttlSeconds: integer('ttl_seconds').notNull(),
		lastValidatedAt: integer('last_validated_at'),
		inspection: text('inspection', { mode: 'json' }).$type<DatabaseRestoreInspection>(),
		errorCode: text('error_code'),
		cancelRequested: integer('cancel_requested', { mode: 'boolean' }).notNull().default(false),
	},
	table => [
		uniqueIndex('persistent_restore_target_reserved')
			.on(table.targetId)
			.where(sql`${table.status} != 'deleted'`),
		index('persistent_restore_status_expiry').on(table.status, table.expiresAt),
		uniqueIndex('persistent_restore_single_executor')
			.on(sql`(1)`)
			.where(sql`${table.status} in ('importing','deleting')`),
	]
);
export const persistentRestoreImportLeases = sqliteTable('persistent_restore_import_leases', {
	restoreId: text('restore_id')
		.primaryKey()
		.references(() => persistentDatabaseRestores.id),
	targetId: text('target_id').notNull(),
	database: text('database_name').notNull(),
	ownerToken: text('owner_token').notNull(),
	state: text('state').notNull(),
});
