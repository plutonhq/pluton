import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { createInsertSchema, createSelectSchema } from 'drizzle-zod';
import { sql } from 'drizzle-orm';

export type LegacyRepositoryBackend = 'local';
export type LegacyRepositoryValidationStatus = 'unknown' | 'available' | 'unavailable';

/**
 * A registration for a repository that was created outside Pluton.
 *
 * This is intentionally independent from `plans`, `backups`, and `storages`.
 * The encrypted password is private implementation data and must never be sent
 * to the frontend or used by a managed backup lifecycle.
 */
export const legacyRepositories = sqliteTable('legacy_repositories', {
	id: text('id').notNull().primaryKey(),
	displayName: text('display_name').notNull(),
	repositoryPath: text('repository_path').notNull(),
	backend: text('backend').$type<LegacyRepositoryBackend>().notNull().default('local'),
	encryptedPassword: text('encrypted_password').notNull(),
	isReadOnly: integer('is_read_only', { mode: 'boolean' }).notNull().default(true),
	validationStatus: text('validation_status')
		.$type<LegacyRepositoryValidationStatus>()
		.notNull()
		.default('unknown'),
	lastValidatedAt: integer('last_validated_at', { mode: 'timestamp' }),
	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.default(sql`(unixepoch())`),
	updatedAt: integer('updated_at', { mode: 'timestamp' }),
});

export type LegacyRepository = typeof legacyRepositories.$inferSelect;
export type NewLegacyRepository = typeof legacyRepositories.$inferInsert;
export const legacyRepositoryInsertSchema = createInsertSchema(legacyRepositories);
export const legacyRepositorySelectSchema = createSelectSchema(legacyRepositories);
