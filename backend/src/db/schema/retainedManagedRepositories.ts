import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

/** Recovery escrow, not a schedulable plan or a Legacy registration. No cascading FKs. */
export const retainedManagedRepositories = sqliteTable('retained_managed_repositories', {
	id: text('id').notNull().primaryKey(),
	formerPlanId: text('former_plan_id').notNull(),
	agentId: text('agent_id').notNull(),
	storageId: text('storage_id').notNull(),
	storagePath: text('storage_path').notNull(),
	encryptedPassword: text('encrypted_password').notNull(),
	initializedAt: integer('initialized_at', { mode: 'timestamp' }),
	repositoryCreatedAt: integer('repository_created_at', { mode: 'timestamp' }).notNull(),
	retainedAt: integer('retained_at', { mode: 'timestamp' })
		.notNull()
		.default(sql`(unixepoch())`),
});
