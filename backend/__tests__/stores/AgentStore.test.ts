import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import {
	agentCommands,
	agentEnrollmentTokens,
	agentIdentities,
	agentRequestNonces,
} from '../../src/db/schema/agents';
import { devices } from '../../src/db/schema/devices';
import { AgentStore } from '../../src/stores/AgentStore';

const inventory = {
	hostname: 'app-01',
	os: 'Example Linux',
	architecture: 'x64',
	agentVersion: '0.1.0',
	capabilities: { filesystemRootsConfigured: true, commandTypes: ['PING'] as const },
};

function enrollmentData(suffix: string, tokenHash: string, now: Date) {
	const agentId = `agent-${suffix}`;
	return {
		tokenHash,
		now,
		device: { id: `remote-${suffix}`, agentId, inventory },
		identity: {
			agentId,
			deviceId: `remote-${suffix}`,
			encryptedSecret: `encrypted-${suffix}`,
			inventory,
		},
		command: {
			id: `command-${suffix}`,
			agentId,
			type: 'PING' as 'PING' | 'INVENTORY_REFRESH',
			payload: {},
			idempotencyKey: `idem-${suffix}`,
		},
	};
}

describe('AgentStore durable command queue', () => {
	let sqlite: Database.Database;
	let store: AgentStore;

	beforeEach(async () => {
		sqlite = new Database(':memory:');
		sqlite.exec(`
			PRAGMA foreign_keys = ON;
			CREATE TABLE devices (
				id text PRIMARY KEY NOT NULL, name text NOT NULL, type text NOT NULL DEFAULT 'device', ip text, host text, port integer, key text,
				created_at integer NOT NULL DEFAULT (unixepoch()), updated_at integer, agent_id text UNIQUE, versions text, hostname text, os text,
				platform text, metrics text, status text, tags text, last_seen integer, settings text
			);
			CREATE TABLE agent_enrollment_tokens (id text PRIMARY KEY NOT NULL, token_hash text NOT NULL UNIQUE, device_name text NOT NULL, expires_at integer NOT NULL, created_at integer NOT NULL DEFAULT (unixepoch()), used_at integer, revoked_at integer);
			CREATE TABLE agent_identities (agent_id text PRIMARY KEY NOT NULL, device_id text NOT NULL UNIQUE, encrypted_secret text NOT NULL, hostname text NOT NULL, os text NOT NULL, architecture text NOT NULL, agent_version text NOT NULL, restic_version text, rclone_version text, capabilities text NOT NULL, created_at integer NOT NULL DEFAULT (unixepoch()), last_seen integer, revoked_at integer, FOREIGN KEY(device_id) REFERENCES devices(id));
			CREATE TABLE agent_request_nonces (id text PRIMARY KEY NOT NULL, agent_id text NOT NULL, nonce_hash text NOT NULL, expires_at integer NOT NULL, created_at integer NOT NULL DEFAULT (unixepoch()), UNIQUE(agent_id, nonce_hash), FOREIGN KEY(agent_id) REFERENCES agent_identities(agent_id));
			CREATE TABLE agent_commands (id text PRIMARY KEY NOT NULL, agent_id text NOT NULL, type text NOT NULL, payload text NOT NULL, state text NOT NULL DEFAULT 'queued', idempotency_key text NOT NULL UNIQUE, created_at integer NOT NULL DEFAULT (unixepoch()), leased_at integer, lease_owner text, lease_expires_at integer, acknowledged_at integer, completed_at integer, attempt_count integer NOT NULL DEFAULT 0, last_event_sequence integer NOT NULL DEFAULT 0, last_error text, FOREIGN KEY(agent_id) REFERENCES agent_identities(agent_id));
		`);
		const db = drizzle(sqlite, {
			schema: {
				devices,
				agentEnrollmentTokens,
				agentIdentities,
				agentRequestNonces,
				agentCommands,
			},
		});
		store = new AgentStore(db as any);
		sqlite
			.prepare(
				`INSERT INTO devices (id, name, type, agent_id, versions, hostname, os, platform, status, tags, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
			)
			.run(
				'remote-1',
				'app-01',
				'remote-agent',
				'agent-1',
				JSON.stringify({ agent: inventory.agentVersion, restic: '', rclone: '' }),
				inventory.hostname,
				inventory.os,
				inventory.architecture,
				'active',
				JSON.stringify([]),
				Math.floor(Date.now() / 1000)
			);
		sqlite
			.prepare(
				`INSERT INTO agent_identities (agent_id, device_id, encrypted_secret, hostname, os, architecture, agent_version, capabilities, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
			)
			.run(
				'agent-1',
				'remote-1',
				'encrypted',
				inventory.hostname,
				inventory.os,
				inventory.architecture,
				inventory.agentVersion,
				JSON.stringify(inventory.capabilities),
				Math.floor(Date.now() / 1000)
			);
	});

	afterEach(() => sqlite.close());

	it('accepts a valid enrollment token once and rejects reused, expired, and revoked tokens', async () => {
		const now = new Date('2026-01-01T00:00:00.000Z');
		await store.createEnrollment({
			id: 'enroll-valid',
			tokenHash: 'hash-valid',
			deviceName: 'app-01',
			expiresAt: new Date('2026-01-01T00:15:00.000Z'),
		});
		expect(await store.enrollAgent(enrollmentData('valid', 'hash-valid', now))).toMatchObject({
			id: 'enroll-valid',
		});
		expect(await store.enrollAgent(enrollmentData('valid-reuse', 'hash-valid', now))).toBeNull();

		await store.createEnrollment({
			id: 'enroll-expired',
			tokenHash: 'hash-expired',
			deviceName: 'app-01',
			expiresAt: now,
		});
		expect(await store.enrollAgent(enrollmentData('expired', 'hash-expired', now))).toBeNull();

		await store.createEnrollment({
			id: 'enroll-revoked',
			tokenHash: 'hash-revoked',
			deviceName: 'app-01',
			expiresAt: new Date('2026-01-01T00:15:00.000Z'),
		});
		expect(await store.revokeEnrollment('enroll-revoked')).toMatchObject({ id: 'enroll-revoked' });
		expect(await store.revokeEnrollment('enroll-revoked')).toBeNull();
		expect(await store.enrollAgent(enrollmentData('revoked', 'hash-revoked', now))).toBeNull();
	});

	it('creates the device, identity, and initial command in the same enrollment transaction', async () => {
		const now = new Date('2026-01-01T00:00:00.000Z');
		await store.createEnrollment({
			id: 'enroll-atomic',
			tokenHash: 'hash-atomic',
			deviceName: 'app-02',
			expiresAt: new Date('2026-01-01T00:15:00.000Z'),
		});
		const data = enrollmentData('atomic', 'hash-atomic', now);
		data.command.type = 'INVENTORY_REFRESH';
		const enrolled = await store.enrollAgent(data);
		expect(enrolled).toMatchObject({ id: 'enroll-atomic' });
		expect(await store.getAgentById('agent-atomic')).toMatchObject({ deviceId: 'remote-atomic' });
		expect(await store.getCommandForAgent('agent-atomic', 'command-atomic')).toMatchObject({
			state: 'queued',
		});
		expect(await store.enrollAgent(enrollmentData('atomic-reuse', 'hash-atomic', now))).toBeNull();
	});

	it('rolls back a token claim if creating the enrolled device fails', async () => {
		const now = new Date('2026-01-01T00:00:00.000Z');
		await store.createEnrollment({
			id: 'enroll-rollback',
			tokenHash: 'hash-rollback',
			deviceName: 'app-01',
			expiresAt: new Date('2026-01-01T00:15:00.000Z'),
		});
		// Make this test's failure injection independent of the shared agent
		// fixture and of test execution order.
		const conflictingDeviceId = 'remote-enrollment-conflict';
		sqlite
			.prepare(
				`INSERT INTO devices (id, name, type, agent_id, versions, hostname, os, platform, status, tags, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
			)
			.run(
				conflictingDeviceId,
				'app-01',
				'remote-agent',
				'agent-existing-conflict',
				JSON.stringify({ agent: inventory.agentVersion, restic: '', rclone: '' }),
				inventory.hostname,
				inventory.os,
				inventory.architecture,
				'active',
				JSON.stringify([]),
				Math.floor(Date.now() / 1000)
			);
		await expect(
			store.enrollAgent({
				...enrollmentData('rollback', 'hash-rollback', now),
				device: { id: conflictingDeviceId, agentId: 'agent-rollback', inventory },
				identity: {
					agentId: 'agent-rollback',
					deviceId: conflictingDeviceId,
					encryptedSecret: 'encrypted-rollback',
					inventory,
				},
			})
		).rejects.toThrow();
		expect(
			await store.enrollAgent(enrollmentData('rollback-retry', 'hash-rollback', now))
		).toMatchObject({ id: 'enroll-rollback' });
		expect(await store.getAgentById('agent-rollback')).toBeNull();
	});

	it('rejects inconsistent device, identity, and command bindings before consuming a token', async () => {
		const now = new Date('2026-01-01T00:00:00.000Z');
		await store.createEnrollment({
			id: 'enroll-binding',
			tokenHash: 'hash-binding',
			deviceName: 'app-03',
			expiresAt: new Date('2026-01-01T00:15:00.000Z'),
		});
		const invalid = enrollmentData('binding', 'hash-binding', now);
		invalid.command.agentId = 'agent-other';
		await expect(store.enrollAgent(invalid)).rejects.toThrow('inconsistent');
		expect(await store.enrollAgent(enrollmentData('binding', 'hash-binding', now))).toMatchObject({
			id: 'enroll-binding',
		});
	});

	it('leases, acknowledges, completes, and preserves a command across a new store instance', async () => {
		await store.enqueueCommand({
			id: 'command-1',
			agentId: 'agent-1',
			type: 'PING',
			payload: {},
			idempotencyKey: 'idem-1',
		});
		const now = new Date('2026-01-01T00:00:00.000Z');
		const leased = await store.leaseNext('agent-1', 'agent-1', 60_000, now);
		expect(leased?.state).toBe('leased');
		expect(leased?.attemptCount).toBe(1);
		expect(await store.leaseNext('agent-1', 'agent-1', 60_000, now)).toBeNull();
		expect(await store.acknowledgeCommand('agent-1', 'command-1', 'wrong-lease', now)).toBeNull();
		expect((await store.acknowledgeCommand('agent-1', 'command-1', 'agent-1', now))?.state).toBe(
			'acknowledged'
		);
		expect((await store.recordCommandEvent('agent-1', 'command-1', 'agent-1', 1, now))?.state).toBe(
			'running'
		);
		expect(
			(await store.completeCommand('agent-1', 'command-1', 'agent-1', 2, true, undefined, now))
				?.state
		).toBe('completed');
		expect(
			(await store.completeCommand('agent-1', 'command-1', 'agent-1', 2, true, undefined, now))
				?.state
		).toBe('completed');
	});

	it('requeues an expired lease after a restart without duplicating an active lease', async () => {
		await store.enqueueCommand({
			id: 'command-2',
			agentId: 'agent-1',
			type: 'PING',
			payload: {},
			idempotencyKey: 'idem-2',
		});
		const firstLease = await store.leaseNext(
			'agent-1',
			'agent-1',
			60_000,
			new Date('2026-01-01T00:00:00.000Z')
		);
		expect(firstLease?.attemptCount).toBe(1);
		// Build the reopened store against the same durable SQLite database instead of in-memory command state.
		const db = drizzle(sqlite, {
			schema: {
				devices,
				agentEnrollmentTokens,
				agentIdentities,
				agentRequestNonces,
				agentCommands,
			},
		});
		const restartedStore = new AgentStore(db as any);
		expect(
			await restartedStore.leaseNext(
				'agent-1',
				'agent-1',
				60_000,
				new Date('2026-01-01T00:00:30.000Z')
			)
		).toBeNull();
		const retried = await restartedStore.leaseNext(
			'agent-1',
			'agent-1',
			60_000,
			new Date('2026-01-01T00:01:01.000Z')
		);
		expect(retried?.id).toBe('command-2');
		expect(retried?.attemptCount).toBe(2);
	});

	it('serializes multiple queued commands for the same agent until the active lease finishes', async () => {
		await store.enqueueCommand({
			id: 'command-serial-1',
			agentId: 'agent-1',
			type: 'BACKUP_FILESYSTEM',
			payload: { backupId: 'backup-1', planId: 'plan-1', repositoryId: 'repo-1' },
			idempotencyKey: 'idem-serial-1',
		});
		await store.enqueueCommand({
			id: 'command-serial-2',
			agentId: 'agent-1',
			type: 'PING',
			payload: {},
			idempotencyKey: 'idem-serial-2',
		});
		const now = new Date('2026-01-01T00:00:00.000Z');
		const first = await store.leaseNext('agent-1', 'serial-lease', 60_000, now);
		expect(first?.id).toBe('command-serial-1');
		expect(await store.leaseNext('agent-1', 'second-lease', 60_000, now)).toBeNull();
		expect(
			(
				await store.completeCommand(
					'agent-1',
					'command-serial-1',
					'serial-lease',
					1,
					true,
					undefined,
					now
				)
			)?.state
		).toBe('completed');
		expect((await store.leaseNext('agent-1', 'second-lease', 60_000, now))?.id).toBe(
			'command-serial-2'
		);
	});

	it('rejects lifecycle updates from an expired lease after the command is leased again', async () => {
		await store.enqueueCommand({
			id: 'command-3',
			agentId: 'agent-1',
			type: 'PING',
			payload: {},
			idempotencyKey: 'idem-3',
		});
		const initial = new Date('2026-01-01T00:00:00.000Z');
		await store.leaseNext('agent-1', 'first-lease', 1_000, initial);
		const retryAt = new Date('2026-01-01T00:00:01.000Z');
		await store.leaseNext('agent-1', 'second-lease', 1_000, retryAt);
		expect(
			await store.acknowledgeCommand('agent-1', 'command-3', 'first-lease', retryAt)
		).toBeNull();
		expect(
			(await store.acknowledgeCommand('agent-1', 'command-3', 'second-lease', retryAt))?.state
		).toBe('acknowledged');
	});

	it('persists nonce hashes and rejects a repeated nonce', async () => {
		const future = new Date(Date.now() + 5 * 60 * 1000);
		expect(await store.reserveNonce('agent-1', 'nonce-hash', future)).toBe(true);
		expect(await store.reserveNonce('agent-1', 'nonce-hash', future)).toBe(false);
	});

	it('refuses an unsupported command type at the durable queue boundary', async () => {
		await expect(
			store.enqueueCommand({
				id: 'command-shell',
				agentId: 'agent-1',
				type: 'SHELL' as any,
				payload: {},
				idempotencyKey: 'idem-shell',
			})
		).rejects.toThrow('REMOTE_CAPABILITY_NOT_IMPLEMENTED');
	});
});
