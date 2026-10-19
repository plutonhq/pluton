import { relations, sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { agentIdentities } from './agents';
import { plans } from './plans';
import { storages } from './storages';

/**
 * Metadata for repositories created by the remote filesystem-backup path.
 *
 * This is deliberately distinct from legacy repository registration. The
 * password is generated for this one managed repository and encrypted at rest
 * with the control-plane secret; it is never stored in an agent command.
 */
export const remoteManagedRepositories = sqliteTable(
	'remote_managed_repositories',
	{
		id: text('id').notNull().primaryKey(),
		planId: text('plan_id')
			.notNull()
			.references(() => plans.id),
		agentId: text('agent_id')
			.notNull()
			.references(() => agentIdentities.agentId),
		storageId: text('storage_id')
			.notNull()
			.references(() => storages.id),
		storagePath: text('storage_path').notNull(),
		encryptedPassword: text('encrypted_password').notNull(),
		initializedAt: integer('initialized_at', { mode: 'timestamp' }),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		updatedAt: integer('updated_at', { mode: 'timestamp' }),
	},
	table => [
		uniqueIndex('remote_managed_repositories_plan_id_idx').on(table.planId),
		index('remote_managed_repositories_agent_id_idx').on(table.agentId),
	]
);

export const remoteManagedRepositoryRelations = relations(remoteManagedRepositories, ({ one }) => ({
	plan: one(plans, {
		fields: [remoteManagedRepositories.planId],
		references: [plans.id],
	}),
	agent: one(agentIdentities, {
		fields: [remoteManagedRepositories.agentId],
		references: [agentIdentities.agentId],
	}),
	storage: one(storages, {
		fields: [remoteManagedRepositories.storageId],
		references: [storages.id],
	}),
}));

export type RemoteManagedRepository = typeof remoteManagedRepositories.$inferSelect;
export type NewRemoteManagedRepository = typeof remoteManagedRepositories.$inferInsert;
