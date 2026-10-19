import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { recoveryTests } from './recoveryTests';
import type { InternalRecoveryEngine, RecoveryTargetConfig } from '../../types/recoveryTests';

/** Immutable activation binding retained until BOTH SQL/workspace and infrastructure cleanup. */
export const internalRecoverySessions = sqliteTable(
	'internal_recovery_sessions',
	{
		id: text('id').primaryKey(),
		testId: text('test_id')
			.notNull()
			.references(() => recoveryTests.id, { onDelete: 'cascade' }),
		engine: text('engine').$type<InternalRecoveryEngine>().notNull(),
		installationId: text('installation_id').notNull(),
		activationId: text('activation_id').notNull(),
		config: text('config', { mode: 'json' }).$type<RecoveryTargetConfig>().notNull(),
		encryptedPassword: text('encrypted_password').notNull(),
		caSha256: text('ca_sha256').notNull(),
		cleanupReady: integer('cleanup_ready', { mode: 'boolean' }).notNull().default(false),
		releasedAt: integer('released_at', { mode: 'timestamp' }),
	},
	table => [
		uniqueIndex('internal_recovery_session_test').on(table.testId),
		uniqueIndex('internal_recovery_session_active')
			.on(sql`(1)`)
			.where(sql`${table.releasedAt} IS NULL`),
	]
);
export type InternalRecoverySession = typeof internalRecoverySessions.$inferSelect;

/** Separate leases preserve the original Custom-target unique key and foreign key contract. */
export const internalRecoveryImportLeases = sqliteTable('internal_recovery_import_leases', {
	id: text('id').primaryKey(),
	testId: text('test_id')
		.notNull()
		.references(() => recoveryTests.id, { onDelete: 'cascade' }),
	targetId: text('target_id')
		.notNull()
		.references(() => internalRecoverySessions.id, { onDelete: 'cascade' }),
	database: text('database_name').notNull(),
	ownerToken: text('owner_token').notNull(),
});
