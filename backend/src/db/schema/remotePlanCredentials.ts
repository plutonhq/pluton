import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { plans } from './plans';

/** Not joined into public plan/device queries. Encrypted using the server SECRET. */
export const remotePlanDatabaseCredentials = sqliteTable('remote_plan_database_credentials', {
	planId: text('plan_id')
		.primaryKey()
		.notNull()
		.references(() => plans.id, { onDelete: 'cascade' }),
	encryptedPassword: text('encrypted_password').notNull(),
});

/** Collection credentials are private and scoped to a plan plus a stable entry ID. */
export const remotePlanDatabaseEntryCredentials = sqliteTable(
	'remote_plan_database_entry_credentials',
	{
		databaseId: text('database_id').primaryKey().notNull(),
		planId: text('plan_id')
			.notNull()
			.references(() => plans.id, { onDelete: 'cascade' }),
		encryptedPassword: text('encrypted_password').notNull(),
		legacySingle: integer('legacy_single', { mode: 'boolean' }).notNull().default(false),
	},
	table => [index('remote_plan_database_entry_plan_idx').on(table.planId)]
);
