import { relations, sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { devices } from './devices';

/**
 * `BACKUP_FILESYSTEM` is intentionally the only execution command in the
 * community agent. It is a fixed Restic/Rclone workflow, not a shell-command
 * transport. All other remote strategy operations remain unavailable.
 */
export type AgentCommandType = 'PING' | 'INVENTORY_REFRESH' | 'BACKUP_FILESYSTEM';
export type AgentCommandState =
	| 'queued'
	| 'leased'
	| 'acknowledged'
	| 'running'
	| 'completed'
	| 'failed'
	| 'cancelled'
	| 'expired';

/**
 * One-time enrollment credentials are stored only as SHA-256 hashes. The raw
 * token is returned once to the authenticated administrator and is never
 * persisted or logged.
 */
export const agentEnrollmentTokens = sqliteTable(
	'agent_enrollment_tokens',
	{
		id: text('id').notNull().primaryKey(),
		tokenHash: text('token_hash').notNull(),
		deviceName: text('device_name').notNull(),
		expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		usedAt: integer('used_at', { mode: 'timestamp' }),
		revokedAt: integer('revoked_at', { mode: 'timestamp' }),
	},
	table => [uniqueIndex('agent_enrollment_tokens_token_hash_idx').on(table.tokenHash)]
);

/**
 * Agent credentials are per-agent and encrypted at rest. This table is kept
 * separate from devices so normal device responses can never expose secrets.
 */
export const agentIdentities = sqliteTable(
	'agent_identities',
	{
		agentId: text('agent_id').notNull().primaryKey(),
		deviceId: text('device_id')
			.notNull()
			.unique()
			.references(() => devices.id),
		encryptedSecret: text('encrypted_secret').notNull(),
		hostname: text('hostname').notNull(),
		os: text('os').notNull(),
		architecture: text('architecture').notNull(),
		agentVersion: text('agent_version').notNull(),
		resticVersion: text('restic_version'),
		rcloneVersion: text('rclone_version'),
		capabilities: text('capabilities', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		lastSeen: integer('last_seen', { mode: 'timestamp' }),
		revokedAt: integer('revoked_at', { mode: 'timestamp' }),
	},
	table => [index('agent_identities_device_id_idx').on(table.deviceId)]
);

/** A nonce is retained through the timestamp skew window to reject replays. */
export const agentRequestNonces = sqliteTable(
	'agent_request_nonces',
	{
		id: text('id').notNull().primaryKey(),
		agentId: text('agent_id')
			.notNull()
			.references(() => agentIdentities.agentId),
		nonceHash: text('nonce_hash').notNull(),
		expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
	},
	table => [
		uniqueIndex('agent_request_nonces_agent_nonce_idx').on(table.agentId, table.nonceHash),
		index('agent_request_nonces_expires_at_idx').on(table.expiresAt),
	]
);

/**
 * A durable, agent-polled command queue. Only harmless control-plane command
 * types are allowed in Phase 4; no command can carry executable shell input.
 */
export const agentCommands = sqliteTable(
	'agent_commands',
	{
		id: text('id').notNull().primaryKey(),
		agentId: text('agent_id')
			.notNull()
			.references(() => agentIdentities.agentId),
		type: text('type').$type<AgentCommandType>().notNull(),
		payload: text('payload', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
		state: text('state').$type<AgentCommandState>().notNull().default('queued'),
		idempotencyKey: text('idempotency_key').notNull(),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		leasedAt: integer('leased_at', { mode: 'timestamp' }),
		leaseOwner: text('lease_owner'),
		leaseExpiresAt: integer('lease_expires_at', { mode: 'timestamp' }),
		acknowledgedAt: integer('acknowledged_at', { mode: 'timestamp' }),
		completedAt: integer('completed_at', { mode: 'timestamp' }),
		attemptCount: integer('attempt_count').notNull().default(0),
		lastEventSequence: integer('last_event_sequence').notNull().default(0),
		lastError: text('last_error'),
	},
	table => [
		uniqueIndex('agent_commands_idempotency_key_idx').on(table.idempotencyKey),
		index('agent_commands_agent_state_idx').on(table.agentId, table.state, table.createdAt),
		index('agent_commands_lease_expires_at_idx').on(table.leaseExpiresAt),
	]
);

export const agentIdentityRelations = relations(agentIdentities, ({ one, many }) => ({
	device: one(devices, {
		fields: [agentIdentities.deviceId],
		references: [devices.id],
	}),
	commands: many(agentCommands),
}));

export const agentCommandRelations = relations(agentCommands, ({ one }) => ({
	agent: one(agentIdentities, {
		fields: [agentCommands.agentId],
		references: [agentIdentities.agentId],
	}),
}));

export type AgentEnrollmentToken = typeof agentEnrollmentTokens.$inferSelect;
export type AgentIdentity = typeof agentIdentities.$inferSelect;
export type AgentCommand = typeof agentCommands.$inferSelect;
