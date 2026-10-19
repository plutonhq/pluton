import http from 'node:http';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import express, { type Express } from 'express';
import request from 'supertest';
import { AgentClient } from '../../agent/src/client';
import { saveIdentity } from '../../agent/src/identity';
import { verifyCommand } from '../../agent/src/protocol';
import { runOnce } from '../../agent/src/runtime';
import type { AgentConfig, AgentInventory, StoredAgentIdentity } from '../../agent/src/types';
import { AgentController } from '../src/controllers/AgentController';
import { agentCommands, agentEnrollmentTokens, agentIdentities, agentRequestNonces } from '../src/db/schema/agents';
import { devices } from '../src/db/schema/devices';
import { createAgentRouter } from '../src/routes/agents';
import { AgentService } from '../src/services/AgentService';
import { AgentStore } from '../src/stores/AgentStore';
import type { AgentRequest } from '../src/types/agents';

jest.mock('../src/services/ConfigService', () => ({
	configService: {
		config: {
			SECRET: 'agent-control-plane-test-encryption-secret',
			ALLOW_INSECURE_AGENT_HTTP: true,
			AGENT_OFFLINE_TIMEOUT_SECONDS: 90,
		},
	},
}));

const inventory: AgentInventory = {
	hostname: 'app-01',
	os: 'Example Linux',
	architecture: 'x64',
	agentVersion: '0.1.0',
	capabilities: {
		filesystemRootsConfigured: true,
		commandTypes: ['PING', 'INVENTORY_REFRESH'],
	},
};

function createSchema(sqlite: Database.Database): void {
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
}

async function startServer(app: Express): Promise<{ server: http.Server; serverUrl: URL }> {
	const server = http.createServer(app);
	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => {
			server.off('error', reject);
			resolve();
		});
	});
	const address = server.address();
	if (!address || typeof address === 'string') throw new Error('Test server did not expose a TCP port.');
	return { server, serverUrl: new URL(`http://127.0.0.1:${address.port}`) };
}

async function stopServer(server: http.Server | undefined): Promise<void> {
	if (!server) return;
	await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
}

describe('agent control-plane end-to-end lifecycle', () => {
	let sqlite: Database.Database;
	let app: Express;
	let server: http.Server | undefined;
	let store: AgentStore;
	let config: AgentConfig;
	let testRoot: string;

	beforeEach(async () => {
		sqlite = new Database(':memory:');
		createSchema(sqlite);
		const db = drizzle(sqlite, { schema: { devices, agentEnrollmentTokens, agentIdentities, agentRequestNonces, agentCommands } });
		store = new AgentStore(db as any);
		const service = new AgentService(store, 'agent-control-plane-test-encryption-secret');
		app = express();
		app.use(
			express.json({
				verify: (req, _res, buffer) => {
					(req as AgentRequest).rawBody = buffer.toString('utf8');
				},
			})
		);
		app.use('/api/agent', createAgentRouter(new AgentController(service), service));
		const started = await startServer(app);
		server = started.server;
		testRoot = await mkdtemp(path.join(tmpdir(), 'pluton-agent-control-plane-'));
		const allowedRoot = path.join(testRoot, 'allowed');
		await mkdir(allowedRoot);
		config = {
			serverUrl: started.serverUrl,
			dataDir: path.join(testRoot, 'agent-data'),
			allowedRoots: [allowedRoot],
			allowInsecureHttp: true,
		};
	});

	afterEach(async () => {
		await stopServer(server);
		sqlite.close();
		await rm(testRoot, { recursive: true, force: true });
	});

	it('enrolls, authenticates, verifies a leased command, and completes it without duplicate leasing', async () => {
		const service = new AgentService(store, 'agent-control-plane-test-encryption-secret');
		const enrollment = await service.createEnrollment({ name: 'app-01' });
		const enrollmentClient = new AgentClient(config);
		const enrolled = await enrollmentClient.enroll(enrollment.token, inventory);
		const identity: StoredAgentIdentity = { ...enrolled, completedCommands: [] };
		await saveIdentity(config.dataDir, identity);

		await runOnce(config);
		expect(
			sqlite.prepare('SELECT state FROM agent_commands WHERE agent_id = ? ORDER BY created_at').all(identity.agentId)
		).toEqual([{ state: 'completed' }]);

		await store.enqueueCommand({
			id: 'command-duplicate-poll',
			agentId: identity.agentId,
			type: 'PING',
			payload: {},
			idempotencyKey: 'idempotency-duplicate-poll',
		});
		const client = new AgentClient(config, identity);
		const leased = await client.poll();
		expect(leased).not.toBeNull();
		if (!leased) throw new Error('Expected a command lease.');

		// This is the production agent verifier applied to the production server signature after JSON transport.
		expect(verifyCommand(identity.secret, leased)).toBe(true);
		expect(await client.poll()).toBeNull();
		sqlite
			.prepare('UPDATE agent_commands SET lease_expires_at = ? WHERE id = ?')
			.run(Math.floor((Date.now() - 1_000) / 1_000), leased.id);
		const retried = await client.poll();
		expect(retried).toMatchObject({ id: leased.id });
		if (!retried) throw new Error('Expected an expired command to be leased again.');
		expect(retried.leaseToken).not.toBe(leased.leaseToken);
		expect(verifyCommand(identity.secret, retried)).toBe(true);

		for (const endpoint of [
			{ path: `/api/agent/commands/${retried.id}/ack`, body: { leaseToken: retried.leaseToken } },
			{ path: `/api/agent/commands/${retried.id}/events`, body: { leaseToken: retried.leaseToken, sequence: 1 } },
			{ path: `/api/agent/commands/${retried.id}/complete`, body: { leaseToken: retried.leaseToken, sequence: 2, success: true } },
		]) {
			const unauthenticated = await request(app).post(endpoint.path).send(endpoint.body);
			expect(unauthenticated.status).toBe(401);
		}

		await client.acknowledge(retried.id, retried.leaseToken);
		await client.event(retried.id, retried.leaseToken, 1);
		const persistedCompletion: StoredAgentIdentity['completedCommands'][number] = {
			commandId: retried.id,
			sequence: 2,
			success: true,
		};
		await client.complete(retried.id, retried.leaseToken, persistedCompletion);
		expect(await store.getCommandForAgent(identity.agentId, retried.id)).toMatchObject({
			state: 'completed',
			attemptCount: 2,
			lastEventSequence: 2,
		});

		await store.enqueueCommand({
			id: 'command-persisted-completion',
			agentId: identity.agentId,
			type: 'PING',
			payload: {},
			idempotencyKey: 'idempotency-persisted-completion',
		});
		const pending = await client.poll();
		expect(pending).toMatchObject({ id: 'command-persisted-completion' });
		if (!pending) throw new Error('Expected a command lease for persisted completion recovery.');
		await client.acknowledge(pending.id, pending.leaseToken);
		await client.event(pending.id, pending.leaseToken, 1);
		await saveIdentity(config.dataDir, {
			...identity,
			completedCommands: [{ commandId: pending.id, sequence: 2, success: true }],
		});
		sqlite
			.prepare('UPDATE agent_commands SET lease_expires_at = ? WHERE id = ?')
			.run(Math.floor((Date.now() - 1_000) / 1_000), pending.id);

		await runOnce(config);
		expect(await store.getCommandForAgent(identity.agentId, pending.id)).toMatchObject({
			state: 'completed',
			attemptCount: 2,
			lastEventSequence: 2,
		});
	});
});
