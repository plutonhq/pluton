import crypto from 'crypto';
import Cryptr from 'cryptr';
import { AgentService } from '../../src/services/AgentService';
import { AgentStore } from '../../src/stores/AgentStore';
import { signAgentRequest } from '../../src/utils/agentProtocol';
import { configService } from '../../src/services/ConfigService';
import { serverLogger } from '../../src/utils/logger';
import { RemoteCommandPreparationError } from '../../src/services/remoteCommandPreparation';

jest.mock('../../src/services/ConfigService', () => ({
	configService: {
		config: {
			SECRET: 'agent-service-test-secret-that-is-long-enough',
			APP_URL: 'https://pluton.example.internal',
			ALLOW_INSECURE_AGENT_HTTP: false,
			AGENT_OFFLINE_TIMEOUT_SECONDS: 90,
		},
	},
}));

const secret = 'agent-per-device-test-secret';
const agent = {
	agentId: 'agent-test',
	deviceId: 'remote-test',
	encryptedSecret: new Cryptr('agent-service-test-secret-that-is-long-enough').encrypt(secret),
	hostname: 'app-01',
	os: 'Example Linux',
	architecture: 'x64',
	agentVersion: '0.1.0',
	resticVersion: null,
	rcloneVersion: null,
	capabilities: { filesystemRootsConfigured: true, commandTypes: ['PING'] },
	createdAt: new Date('2026-01-01T00:00:00.000Z'),
	lastSeen: new Date('2026-01-01T00:00:00.000Z'),
	revokedAt: null,
};

const inventory = {
	hostname: 'app-01',
	os: 'Example Linux',
	architecture: 'x64',
	agentVersion: '0.1.0',
	capabilities: { filesystemRootsConfigured: true, commandTypes: ['PING'] as const },
};

describe('AgentService', () => {
	let store: jest.Mocked<AgentStore>;
	let service: AgentService;
	let now: Date;

	beforeEach(() => {
		now = new Date('2026-01-01T00:00:00.000Z');
		store = {
			createEnrollment: jest.fn().mockImplementation(async value => value),
			enrollAgent: jest.fn().mockResolvedValue({ id: 'enroll-1', deviceName: 'app-01' }),
			getAgentById: jest.fn().mockResolvedValue(agent),
			reserveNonce: jest.fn().mockResolvedValue(true),
			updateHeartbeat: jest.fn().mockResolvedValue(agent),
			leaseNext: jest.fn(),
			acknowledgeCommand: jest.fn(),
			recordCommandEvent: jest.fn(),
			completeCommand: jest.fn(),
			revokeAgentByDeviceId: jest.fn(),
			getAgentByDeviceId: jest.fn().mockResolvedValue(agent),
			revokeEnrollment: jest.fn(),
		} as unknown as jest.Mocked<AgentStore>;
		service = new AgentService(store, 'agent-service-test-secret-that-is-long-enough', () => now);
	});

	it('creates a random enrollment token while persisting only its hash', async () => {
		const result = await service.createEnrollment({ name: 'app-01' });
		expect(result.token).toHaveLength(43);
		expect(result.serverUrl).toBe('https://pluton.example.internal');
		expect(result.insecureHttpAllowed).toBe(false);
		expect(store.createEnrollment).toHaveBeenCalledWith(
			expect.objectContaining({
				deviceName: 'app-01',
				tokenHash: expect.not.stringContaining(result.token),
			})
		);
		expect((store.createEnrollment.mock.calls[0][0] as { tokenHash: string }).tokenHash).toBe(
			crypto.createHash('sha256').update(result.token).digest('base64url')
		);
	});

	it('reports the explicit server-side HTTP exception with an enrollment response', async () => {
		(configService.config as any).ALLOW_INSECURE_AGENT_HTTP = true;
		try {
			const result = await service.createEnrollment({ name: 'app-01' });
			expect(result.insecureHttpAllowed).toBe(true);
		} finally {
			(configService.config as any).ALLOW_INSECURE_AGENT_HTTP = false;
		}
	});

	it('uses the operator private Agent URL only for new enrollment instructions, independently of canonical web origin',async()=>{
		(configService.config as any).AGENT_SERVER_URL='http://192.0.2.10:5173';
		try {
			expect((await service.createEnrollment({name:'app-01'})).serverUrl).toBe('http://192.0.2.10:5173');
			expect(configService.config.APP_URL).toBe('https://pluton.example.internal');
			expect(store.updateHeartbeat).not.toHaveBeenCalled();
			expect(store.enrollAgent).not.toHaveBeenCalled();
		} finally { delete (configService.config as any).AGENT_SERVER_URL; }
	});

	it.each(['expired', 'reused', 'revoked'])('rejects a %s enrollment token', async () => {
		store.enrollAgent.mockResolvedValue(null);
		await expect(service.enroll({ token: 'a'.repeat(43), inventory })).rejects.toThrow(
			'Enrollment token is invalid'
		);
	});

	it('enrolls with a per-agent secret and queues only the safe inventory command', async () => {
		store.enrollAgent.mockResolvedValue({ id: 'enroll-1', deviceName: 'app-01' } as any);
		const result = await service.enroll({ token: 'a'.repeat(43), inventory });
		expect(result.secret).toHaveLength(43);
		expect(store.enrollAgent).toHaveBeenCalledWith(
			expect.objectContaining({
				device: expect.objectContaining({ agentId: expect.any(String) }),
				identity: expect.objectContaining({ encryptedSecret: expect.any(String) }),
				command: expect.objectContaining({ type: 'INVENTORY_REFRESH', payload: {} }),
			})
		);
	});

	it('issues a unique signed lease token with each command delivery', async () => {
		store.leaseNext.mockImplementation(
			async (_agentId, leaseToken) =>
				({
					id: 'command-1',
					type: 'PING',
					payload: {},
					idempotencyKey: 'idem-1',
					leaseOwner: leaseToken,
					leaseExpiresAt: new Date(now.getTime() + 60_000),
				}) as any
		);
		const result = await service.poll({ agentId: agent.agentId, deviceId: agent.deviceId, secret });
		expect(result.command?.leaseToken).toMatch(/^[A-Za-z0-9_-]{32}$/);
		expect(store.leaseNext).toHaveBeenCalledWith(
			agent.agentId,
			result.command?.leaseToken,
			60_000,
			now
		);
	});

	it('materializes BACKUP_FILESYSTEM credentials only for the signed leased response', async () => {
		const remoteBackupService = {
			materializeCommand: jest.fn().mockResolvedValue({
				version: 1,
				backupId: 'backup-01',
				planId: 'plan-01',
				sourcePath: '/srv/example-app',
				excludes: [],
				repository: { remoteName: 'pluton', path: 'managed/plan-01', initialize: true },
				rclone: {
					type: 'sftp',
					options: {
						host: 'sftp.example.internal',
						user: 'backup-user',
						pass: 'test-only-sftp-secret',
					},
				},
				repositoryPassword: 'test-only-repository-secret',
			}),
			completeCommand: jest.fn(),
		};
		service = new AgentService(
			store,
			'agent-service-test-secret-that-is-long-enough',
			() => now,
			remoteBackupService as any
		);
		const persistedPayload = { backupId: 'backup-01', planId: 'plan-01', repositoryId: 'repo-01' };
		store.leaseNext.mockImplementation(
			async (_agentId, leaseToken) =>
				({
					id: 'command-backup-01',
					type: 'BACKUP_FILESYSTEM',
					payload: persistedPayload,
					idempotencyKey: 'idem-backup-01',
					leaseOwner: leaseToken,
					leaseExpiresAt: new Date(now.getTime() + 60_000),
					lastEventSequence: 0,
				}) as any
		);

		const result = await service.poll({ agentId: agent.agentId, deviceId: agent.deviceId, secret });
		expect(remoteBackupService.materializeCommand).toHaveBeenCalledWith(
			agent.agentId,
			expect.objectContaining({ id: 'command-backup-01', payload: persistedPayload })
		);
		expect(result.command?.payload).toMatchObject({
			repositoryPassword: 'test-only-repository-secret',
		});
		expect(JSON.stringify(persistedPayload)).not.toContain('test-only-sftp-secret');
		expect(JSON.stringify(persistedPayload)).not.toContain('test-only-repository-secret');
	});

	it('fails closed rather than sending a durable BACKUP_FILESYSTEM reference without a materializer', async () => {
		store.leaseNext.mockImplementation(
			async (_agentId, leaseToken) =>
				({
					id: 'command-backup-unavailable',
					type: 'BACKUP_FILESYSTEM',
					payload: { backupId: 'backup-01', planId: 'plan-01', repositoryId: 'repo-01' },
					idempotencyKey: 'idem-backup-unavailable',
					leaseOwner: leaseToken,
					leaseExpiresAt: new Date(now.getTime() + 60_000),
					lastEventSequence: 0,
				}) as any
		);
		store.completeCommand.mockResolvedValue(null);
		await expect(
			service.poll({ agentId: agent.agentId, deviceId: agent.deviceId, secret })
		).resolves.toEqual({
			command: null,
		});
		expect(store.completeCommand).toHaveBeenCalledWith(
			agent.agentId,
			'command-backup-unavailable',
			expect.any(String),
			1,
			false,
			'Remote backup command could not be prepared.',
			now
		);
	});

	it('logs a sanitized remote command preparation failure with correlation IDs', async () => {
		const fixtureStoragePassword = 'fixture-sftp-password-must-not-appear-in-logs';
		const fixtureRepositoryPassword = 'fixture-repository-password-must-not-appear-in-logs';
		const remoteBackupService = {
			materializeCommand: jest.fn().mockRejectedValue(
				new RemoteCommandPreparationError({
					stage: 'sftp-credential-decryption',
					planId: 'plan-01',
					backupId: 'backup-01',
					storageId: 'storage-01',
					rejectedField: 'host',
					ruleCategory: 'unsafe-control-character',
				})
			),
			completeCommand: jest.fn(),
		};
		service = new AgentService(
			store,
			'agent-service-test-secret-that-is-long-enough',
			() => now,
			remoteBackupService as any
		);
		store.leaseNext.mockImplementation(
			async (_agentId, leaseToken) =>
				({
					id: 'command-backup-01',
					type: 'BACKUP_FILESYSTEM',
					payload: { backupId: 'backup-01', planId: 'plan-01', repositoryId: 'repo-01' },
					idempotencyKey: 'idem-backup-01',
					leaseOwner: leaseToken,
					leaseExpiresAt: new Date(now.getTime() + 60_000),
					lastEventSequence: 0,
				}) as any
		);
		store.completeCommand.mockResolvedValue(null);
		const warn = jest.spyOn(serverLogger, 'warn').mockImplementation(() => undefined as any);

		try {
			await expect(
				service.poll({ agentId: agent.agentId, deviceId: agent.deviceId, secret })
			).resolves.toEqual({ command: null });
			expect(warn).toHaveBeenCalledWith(
				expect.objectContaining({
					agentEvent: 'remote_backup_command_preparation_failed',
					deviceId: agent.deviceId,
					failureStage: 'sftp-credential-decryption',
					failureMessage: 'Remote SFTP credentials could not be decrypted or validated.',
					planId: 'plan-01',
					backupId: 'backup-01',
					storageId: 'storage-01',
					rejectedField: 'host',
					ruleCategory: 'unsafe-control-character',
				}),
				'Remote backup command preparation failed'
			);
			const logged = JSON.stringify(warn.mock.calls);
			expect(logged).not.toContain(fixtureStoragePassword);
			expect(logged).not.toContain(fixtureRepositoryPassword);
		} finally {
			warn.mockRestore();
		}
	});

	it('does not log an unexpected materializer error verbatim', async () => {
		const fixtureProviderError = 'fixture-provider-error-with-password-material';
		const remoteBackupService = {
			materializeCommand: jest.fn().mockRejectedValue(new Error(fixtureProviderError)),
			completeCommand: jest.fn(),
		};
		service = new AgentService(
			store,
			'agent-service-test-secret-that-is-long-enough',
			() => now,
			remoteBackupService as any
		);
		store.leaseNext.mockImplementation(
			async (_agentId, leaseToken) =>
				({
					id: 'command-backup-unexpected',
					type: 'BACKUP_FILESYSTEM',
					payload: { backupId: 'backup-01', planId: 'plan-01', repositoryId: 'repo-01' },
					idempotencyKey: 'idem-backup-unexpected',
					leaseOwner: leaseToken,
					leaseExpiresAt: new Date(now.getTime() + 60_000),
					lastEventSequence: 0,
				}) as any
		);
		store.completeCommand.mockResolvedValue(null);
		const warn = jest.spyOn(serverLogger, 'warn').mockImplementation(() => undefined as any);

		try {
			await service.poll({ agentId: agent.agentId, deviceId: agent.deviceId, secret });
			expect(warn).toHaveBeenCalledWith(
				expect.objectContaining({
					failureStage: 'unexpected',
					failureMessage: 'An unexpected remote command preparation error occurred.',
				}),
				'Remote backup command preparation failed'
			);
			expect(JSON.stringify(warn.mock.calls)).not.toContain(fixtureProviderError);
		} finally {
			warn.mockRestore();
		}
	});

	it('accepts a valid signed request and reserves its nonce', async () => {
		const timestamp = now.getTime().toString();
		const nonce = crypto.randomBytes(24).toString('base64url');
		const body = JSON.stringify({ hello: 'world' });
		const signature = signAgentRequest(secret, timestamp, nonce, 'POST', '/api/agent/poll', body);
		const result = await service.authenticate({
			agentId: agent.agentId,
			timestamp,
			nonce,
			signature,
			method: 'POST',
			path: '/api/agent/poll',
			body,
		});
		expect(result).toEqual({ agentId: agent.agentId, deviceId: agent.deviceId, secret });
		expect(store.reserveNonce).toHaveBeenCalledWith(
			agent.agentId,
			expect.any(String),
			expect.any(Date)
		);
	});

	it.each(['modified body', 'wrong secret', 'stale timestamp'])(
		'rejects a %s signed request',
		async scenario => {
			const timestamp = now.getTime().toString();
			const nonce = crypto.randomBytes(24).toString('base64url');
			const body = JSON.stringify({ hello: 'world' });
			const signature = signAgentRequest(secret, timestamp, nonce, 'POST', '/api/agent/poll', body);
			const override =
				scenario === 'modified body'
					? { body: JSON.stringify({ hello: 'tampered' }) }
					: scenario === 'wrong secret'
						? { signature: 'not-a-valid-signature' }
						: { timestamp: (now.getTime() - 6 * 60 * 1000).toString() };
			await expect(
				service.authenticate({
					agentId: agent.agentId,
					timestamp,
					nonce,
					signature,
					method: 'POST',
					path: '/api/agent/poll',
					body,
					...override,
				})
			).rejects.toThrow('Agent authentication failed');
		}
	);

	it('rejects a replayed nonce', async () => {
		store.reserveNonce.mockResolvedValue(false);
		const timestamp = now.getTime().toString();
		const nonce = crypto.randomBytes(24).toString('base64url');
		const body = '{}';
		const signature = signAgentRequest(secret, timestamp, nonce, 'POST', '/api/agent/poll', body);
		await expect(
			service.authenticate({
				agentId: agent.agentId,
				timestamp,
				nonce,
				signature,
				method: 'POST',
				path: '/api/agent/poll',
				body,
			})
		).rejects.toThrow('Agent authentication failed');
	});

	it('rejects a revoked agent before accepting a signature', async () => {
		store.getAgentById.mockResolvedValue({ ...agent, revokedAt: now } as any);
		await expect(
			service.authenticate({
				agentId: agent.agentId,
				timestamp: now.getTime().toString(),
				nonce: crypto.randomBytes(24).toString('base64url'),
				signature: 'x',
				method: 'POST',
				path: '/api/agent/poll',
				body: '{}',
			})
		).rejects.toThrow('Agent authentication failed');
	});

	it('derives offline status from last seen instead of a stored flag', async () => {
		now = new Date('2026-01-01T00:02:00.000Z');
		const result = await service.getPublicAgent(agent.deviceId);
		expect(result?.status).toBe('offline');
	});

	it('updates heartbeat inventory and derives the resulting online status', async () => {
		const updated = { ...agent, lastSeen: now, resticVersion: '0.17.3' };
		store.updateHeartbeat.mockResolvedValue(updated as any);
		const result = await service.heartbeat(agent.agentId, {
			...inventory,
			resticVersion: '0.17.3',
		});
		expect(store.updateHeartbeat).toHaveBeenCalledWith(agent.agentId, {
			...inventory,
			resticVersion: '0.17.3',
		});
		expect(result).toMatchObject({ status: 'online', resticVersion: '0.17.3' });
	});

	it('revokes the agent identity instead of only hiding its device', async () => {
		store.revokeAgentByDeviceId.mockResolvedValue({ ...agent, revokedAt: now } as any);
		await service.revokeDevice(agent.deviceId);
		expect(store.revokeAgentByDeviceId).toHaveBeenCalledWith(agent.deviceId);
	});

	it('requires the server-side insecure HTTP exception', () => {
		expect(() => service.assertTransportIsAllowed(false)).toThrow('Agent HTTPS is required');
		(configService.config as any).ALLOW_INSECURE_AGENT_HTTP = true;
		expect(() => service.assertTransportIsAllowed(false)).not.toThrow();
		(configService.config as any).ALLOW_INSECURE_AGENT_HTTP = false;
	});

	it.each([
		'repository-check-failed',
		'repository-target-not-empty',
		'database-insufficient-privileges',
		'source-parent-not-traversable',
		'target-check-access-failed',
		'target-check-auth-failed',
		'target-check-transport-failed',
	])('logs only closed, sanitized BACKUP_FILESYSTEM failure metadata: %s', async failureCode => {
		const failureStage =
			failureCode === 'repository-check-failed' ? 'repository-check' : 'repository-target-check';
		const command = {
			id: 'command-backup-failure',
			agentId: agent.agentId,
			type: 'BACKUP_FILESYSTEM',
			state: 'failed',
			payload: { backupId: 'backup-01', planId: 'plan-01', repositoryId: 'repo-01' },
		} as any;
		store.completeCommand.mockResolvedValue(command);
		const warn = jest.spyOn(serverLogger, 'warn').mockImplementation(() => undefined as any);
		const fixtureSecret = 'fixture-provider-secret-must-not-be-logged';
		try {
			await expect(
				service.complete(agent.agentId, command.id, {
					sequence: 4,
					leaseToken: 'a'.repeat(32),
					success: false,
					error: 'Remote filesystem backup failed.',
					failureStage,
					failureCode,
					providerError: fixtureSecret,
				})
			).rejects.toThrow('Command completion is invalid');
			// Unknown fields must be rejected before anything is logged.
			expect(warn).not.toHaveBeenCalled();
			warn.mockClear();
			await service.complete(agent.agentId, command.id, {
				sequence: 4,
				leaseToken: 'a'.repeat(32),
				success: false,
				error: 'Remote filesystem backup failed.',
				failureStage,
				failureCode,
			});
			expect(warn).toHaveBeenCalledWith(
				expect.objectContaining({
					agentEvent: 'command_failed',
					agentId: agent.agentId,
					commandId: command.id,
					planId: 'plan-01',
					backupId: 'backup-01',
					failureStage,
					failureCode,
				}),
				'BACKUP_FILESYSTEM command failed'
			);
			expect(JSON.stringify(warn.mock.calls)).not.toContain(fixtureSecret);
		} finally {
			warn.mockRestore();
		}
	});

	it('accepts Phase 5 capabilities and forwards only closed lifecycle stage events', async () => {
		const extended = {
			...inventory,
			agentVersion: '0.3.0',
			capabilities: {
				...inventory.capabilities,
				backupLifecycleVersion: 1,
				databaseEngines: ['mysql', 'mariadb'],
				hooksConfigured: true,
			},
		};
		await service.heartbeat(agent.agentId, extended);
		expect(store.updateHeartbeat).toHaveBeenCalledWith(agent.agentId, extended);
		const command = {
			id: 'command-01',
			type: 'BACKUP_FILESYSTEM',
			payload: { backupId: 'backup-01', planId: 'plan-01', repositoryId: 'repo-01' },
			state: 'running',
			lastEventSequence: 2,
		} as any;
		store.recordCommandEvent.mockResolvedValue(command);
		const remote = { recordCommandEvent: jest.fn() } as any;
		const lifecycleService = new AgentService(store, 'synthetic-phase5-secret', () => now, remote);
		await lifecycleService.recordEvent(agent.agentId, command.id, {
			sequence: 2,
			leaseToken: 'a'.repeat(32),
			event: { lifecycleStage: 'database-dump-started' },
		});
		expect(remote.recordCommandEvent).toHaveBeenCalledWith(
			command,
			{
				lifecycleStage: 'database-dump-started',
			},
			2
		);
		await expect(
			lifecycleService.recordEvent(agent.agentId, command.id, {
				sequence: 3,
				leaseToken: 'a'.repeat(32),
				event: { lifecycleStage: 'arbitrary provider secret' },
			})
		).rejects.toThrow('event is invalid');
	});
	it('Phase 5 failures reach server persistence/service without any raw agent/provider error', async () => {
		const command = {
			id: 'command-db-failure',
			type: 'BACKUP_FILESYSTEM',
			state: 'failed',
			payload: { backupId: 'backup-01', planId: 'plan-01', repositoryId: 'repo-01' },
		} as any;
		store.completeCommand.mockResolvedValue(command);
		const remote = { completeCommand: jest.fn() } as any;
		const lifecycleService = new AgentService(store, 'synthetic-phase5-secret', () => now, remote);
		const warn = jest.spyOn(serverLogger, 'warn').mockImplementation(() => undefined as any);
		try {
			await lifecycleService.complete(agent.agentId, command.id, {
				sequence: 4,
				leaseToken: 'a'.repeat(32),
				success: false,
				error: 'test-only-provider-secret',
				failureStage: 'database-dump',
				failureCode: 'database-auth-failed',
			});
			expect(JSON.stringify(store.completeCommand.mock.calls)).not.toContain(
				'test-only-provider-secret'
			);
			expect(JSON.stringify(remote.completeCommand.mock.calls)).not.toContain(
				'test-only-provider-secret'
			);
			expect(JSON.stringify(warn.mock.calls)).not.toContain('test-only-provider-secret');
			expect(remote.completeCommand).toHaveBeenCalledWith(
				command,
				expect.objectContaining({
					failureStage: 'database-dump',
					failureCode: 'database-auth-failed',
				})
			);
		} finally {
			warn.mockRestore();
		}
	});
	it('accepts PostgreSQL/multi-DB inventory and safe entry diagnostics but refuses secret-bearing unknown fields', async () => {
		const extended = {
			...inventory,
			agentVersion: '0.4.0',
			capabilities: {
				...inventory.capabilities,
				backupLifecycleVersion: 2,
				databaseEngines: ['mysql', 'mariadb', 'postgresql'],
				hooksConfigured: true,
			},
		};
		await service.heartbeat(agent.agentId, extended);
		expect(store.updateHeartbeat).toHaveBeenCalledWith(agent.agentId, extended);
		const command = {
			id: 'command-mixed-db',
			type: 'BACKUP_FILESYSTEM',
			state: 'failed',
			payload: { backupId: 'backup-01', planId: 'plan-01', repositoryId: 'repo-01' },
		} as any;
		store.recordCommandEvent.mockResolvedValue({
			...command,
			state: 'running',
			lastEventSequence: 2,
		});
		store.completeCommand.mockResolvedValue(command);
		const remote = { recordCommandEvent: jest.fn(), completeCommand: jest.fn() } as any;
		const lifecycleService = new AgentService(store, 'synthetic-phase5-secret', () => now, remote);
		const event = {
			lifecycleStage: 'database-dump-started',
			databaseId: 'db_two',
			engine: 'postgresql',
			ordinal: 2,
			count: 3,
		};
		await lifecycleService.recordEvent(agent.agentId, command.id, {
			sequence: 2,
			leaseToken: 'a'.repeat(32),
			event,
		});
		expect(remote.recordCommandEvent).toHaveBeenCalledWith(
			{ ...command, state: 'running', lastEventSequence: 2 },
			event,
			2
		);
		await expect(
			lifecycleService.recordEvent(agent.agentId, command.id, {
				sequence: 3,
				leaseToken: 'a'.repeat(32),
				event: { ...event, password: 'synthetic-provider-secret' },
			})
		).rejects.toThrow('event is invalid');
		const warn = jest.spyOn(serverLogger, 'warn').mockImplementation(() => undefined as any);
		try {
			await lifecycleService.complete(agent.agentId, command.id, {
				sequence: 4,
				leaseToken: 'a'.repeat(32),
				success: false,
				error: 'synthetic-provider-secret',
				failureStage: 'database-dump',
				failureCode: 'database-client-incompatible',
				databaseId: 'db_two',
				engine: 'postgresql',
			});
			expect(remote.completeCommand).toHaveBeenCalledWith(
				command,
				expect.objectContaining({
					databaseId: 'db_two',
					engine: 'postgresql',
					error: expect.stringContaining('databaseId=db_two'),
				})
			);
			expect(warn).toHaveBeenCalledWith(
				expect.objectContaining({
					databaseId: 'db_two',
					engine: 'postgresql',
					failureCode: 'database-client-incompatible',
				}),
				'BACKUP_FILESYSTEM command failed'
			);
			for (const output of [
				remote.completeCommand.mock.calls,
				store.completeCommand.mock.calls,
				warn.mock.calls,
			])
				expect(JSON.stringify(output)).not.toContain('synthetic-provider-secret');
		} finally {
			warn.mockRestore();
		}
	});
});
