import Cryptr from 'cryptr';
import {
	RemoteBackupService,
	RemoteCommandPreparationError,
} from '../../src/services/RemoteBackupService';
import type { AgentCommand } from '../../src/db/schema/agents';

jest.mock('../../src/services/events/BackupEventService', () => ({
	BackupEventService: jest.fn().mockImplementation(() => ({
		onBackupCancelled: jest.fn(),
		onBackupFailure: jest.fn(),
		onBackupComplete: jest.fn(),
	})),
}));

jest.mock('../../src/services/ConfigService', () => ({
	configService: {
		config: {
			SECRET: 'remote-backup-default-secret-for-tests',
			AGENT_OFFLINE_TIMEOUT_SECONDS: 90,
		},
	},
}));

const encryptionSecret = 'remote-backup-service-test-secret-that-is-long-enough';
const repositoryPassword = 'test-only-managed-repository-password';
const storagePassword = 'test-only-sftp-password';

const plan = {
	id: 'plan-remote-filesystem',
	title: 'Example remote filesystem plan',
	description: '',
	isActive: true,
	storageId: 'storage-sftp',
	storagePath: 'managed-repositories/example-plan',
	sourceId: 'remote-device-01',
	sourceType: 'device',
	sourceConfig: { includes: ['/srv/example-app'], excludes: ['*.tmp'] },
	method: 'backup',
	settings: {
		encryption: true,
		compression: false,
		interval: { type: 'daily', time: '01:00AM' },
		replication: { enabled: false, concurrent: false, storages: [] },
		scripts: {},
	},
	stats: null,
} as any;

const capableAgent = {
	agentId: 'agent-example-01',
	deviceId: 'remote-device-01',
	revokedAt: null,
	lastSeen: new Date(),
	agentVersion: '0.2.0',
	resticVersion: 'restic 0.19.1',
	rcloneVersion: 'rclone v1.75.1',
	capabilities: {
		filesystemRootsConfigured: true,
		commandTypes: ['PING', 'INVENTORY_REFRESH', 'BACKUP_FILESYSTEM'],
	},
} as any;

describe('RemoteBackupService', () => {
	let repositories: any;
	let agentStore: any;
	let planStore: any;
	let backupStore: any;
	let storageStore: any;
	let service: RemoteBackupService;

	beforeEach(() => {
		const crypt = new Cryptr(encryptionSecret);
		repositories = {
			getByPlanId: jest.fn().mockResolvedValue({
				id: 'remote-repo-example-01',
				planId: plan.id,
				agentId: capableAgent.agentId,
				storageId: plan.storageId,
				storagePath: plan.storagePath,
				encryptedPassword: crypt.encrypt(repositoryPassword),
				initializedAt: null,
			}),
			getById: jest.fn().mockResolvedValue({
				id: 'remote-repo-example-01',
				planId: plan.id,
				agentId: capableAgent.agentId,
				storageId: plan.storageId,
				storagePath: plan.storagePath,
				encryptedPassword: crypt.encrypt(repositoryPassword),
				initializedAt: null,
			}),
			createBackupAndCommand: jest.fn().mockResolvedValue({}),
			markInitialized: jest.fn(),
		};
		agentStore = {
			getAgentByDeviceId: jest.fn().mockResolvedValue({ ...capableAgent, lastSeen: new Date() }),
		};
		planStore = {
			getById: jest.fn().mockResolvedValue(plan),
			hasActiveBackups: jest.fn().mockResolvedValue(false),
			getAll: jest.fn().mockResolvedValue([]),
		};
		backupStore = {
			getById: jest.fn().mockResolvedValue({
				id: 'backup-example-01',
				planId: plan.id,
				sourceId: plan.sourceId,
				status: 'queued',
				inProgress: true,
			}),
		};
		storageStore = {
			getById: jest.fn().mockResolvedValue({
				id: plan.storageId,
				type: 'sftp',
				settings: {},
				credentials: {
					host: crypt.encrypt('sftp.example.internal'),
					port: crypt.encrypt('22'),
					user: crypt.encrypt('backup-user'),
					pass: crypt.encrypt(storagePassword),
				},
			}),
		};
		service = new RemoteBackupService(
			repositories,
			agentStore,
			planStore,
			backupStore,
			storageStore,
			encryptionSecret
		);
	});

	it('rejects a remote device without the filesystem-backup capability', async () => {
		agentStore.getAgentByDeviceId.mockResolvedValue({
			...capableAgent,
			capabilities: { filesystemRootsConfigured: true, commandTypes: ['PING'] },
		});
		await expect(service.validatePlanCreation(plan)).rejects.toThrow(
			'Remote agent does not yet support filesystem backup'
		);
	});
	it('does not erase repository credentials before PlanStore archival commits', async () => {
		repositories.deleteByPlanId = jest.fn();
		backupStore.getAll = jest.fn().mockResolvedValue([]);
		(service as any).cronManager.removeSchedulesByType = jest.fn();
		await expect(service.removeManagedPlan(plan)).resolves.toEqual({ storagePath: plan.storagePath });
		expect(repositories.deleteByPlanId).not.toHaveBeenCalled();
	});

	it('rejects an offline agent before creating or queueing a plan', async () => {
		agentStore.getAgentByDeviceId.mockResolvedValue({
			...capableAgent,
			lastSeen: new Date(Date.now() - 91_000),
		});
		await expect(service.validatePlanCreation(plan)).rejects.toThrow(
			'Remote agent is not available'
		);
	});

	it('rejects malformed remote excludes with a client-safe validation error', async () => {
		await expect(
			service.validatePlanCreation({
				...plan,
				sourceConfig: { includes: ['/srv/example-app'], excludes: [123] },
			} as any)
		).rejects.toThrow('Remote backup exclude is invalid');
	});

	it('queues a non-secret durable command reference for a capable agent', async () => {
		await expect(service.queuePlanBackup(plan.id)).resolves.toBe(
			'Remote filesystem backup queued.'
		);
		const queued = repositories.createBackupAndCommand.mock.calls[0][0];
		expect(queued.command).toMatchObject({
			agentId: capableAgent.agentId,
			payload: {
				planId: plan.id,
				repositoryId: 'remote-repo-example-01',
				backupId: expect.any(String),
			},
		});
		const persistedPayload = JSON.stringify(queued.command.payload);
		expect(persistedPayload).not.toContain(storagePassword);
		expect(persistedPayload).not.toContain(repositoryPassword);
		expect(persistedPayload).not.toContain(encryptionSecret);
	});
	it('requires the server replication lifecycle and never sends mirror credentials to the Agent', async () => {
		const replicated = { ...plan, settings: { ...plan.settings, replication: { enabled: true, concurrent: false, storages: [{ replicationId: 'replica-01', storageId: 'mirror-01', storagePath: 'bucket-01/owned', storageType: 's3compatible', storageName: 'Mirror', addedAt: 1 }] } } };
		await expect(service.validatePlanCreation(replicated)).rejects.toMatchObject({ statusCode: 503 });
		const replication = { validatePlan: jest.fn(async () => undefined), enqueueBackup: jest.fn(async () => undefined) };
		service.setReplicationService(replication);
		planStore.getById.mockResolvedValue(replicated);
		await expect(service.validatePlanCreation(replicated)).resolves.toBeUndefined();
		const command = backupCommand();
		const payload = await service.materializeCommand(capableAgent.agentId, command);
		expect(replication.validatePlan).toHaveBeenCalledWith(replicated);
		expect(JSON.stringify(payload)).not.toContain('mirror-01');
		expect(payload).not.toHaveProperty('replication');
		replication.validatePlan.mockRejectedValue(new Error('synthetic mirror credentials unavailable'));
		await expect(service.materializeCommand(capableAgent.agentId, command)).resolves.toHaveProperty('repository');
		await expect(service.queuePlanBackup(replicated.id)).resolves.toContain('queued');
		await expect(service.validatePlanCreation(replicated)).rejects.toThrow('mirror credentials unavailable');
	});

	it('does not cancel a completed remote backup record', async () => {
		backupStore.getById.mockResolvedValue({
			id: 'backup-example-01',
			planId: plan.id,
			inProgress: false,
			status: 'completed',
			sourceId: plan.sourceId,
		});
		await expect(service.cancelBackup(plan.id, 'backup-example-01')).rejects.toThrow(
			'no longer in progress'
		);
	});

	it('materializes the minimum SFTP and repository credentials only at poll time', async () => {
		const command = {
			id: 'remote-backup-backup-example-01',
			type: 'BACKUP_FILESYSTEM',
			agentId: capableAgent.agentId,
			payload: {
				backupId: 'backup-example-01',
				planId: plan.id,
				repositoryId: 'remote-repo-example-01',
			},
		} as AgentCommand;
		const payload = await service.materializeCommand(capableAgent.agentId, command);
		expect(payload).toMatchObject({
			sourcePath: '/srv/example-app',
			repositoryPassword,
			rclone: {
				type: 'sftp',
				options: {
					host: 'sftp.example.internal',
					port: '22',
					user: 'backup-user',
					pass: storagePassword,
				},
			},
		});
		expect(JSON.stringify(command.payload)).not.toContain(storagePassword);
		expect(JSON.stringify(command.payload)).not.toContain(repositoryPassword);
		expect(payload).not.toHaveProperty('encryptionKey');
	});

	it('ignores disabled and empty SFTP UI defaults without widening the agent allowlist', async () => {
		const crypt = new Cryptr(encryptionSecret);
		storageStore.getById.mockResolvedValue({
			id: plan.storageId,
			type: 'sftp',
			// These are the values the normal Storage UI can persist when an
			// optional switch is toggled and left off. Empty text fields are also
			// retained by the edit form when it saves the storage.
			settings: {
				key_use_agent: false,
				use_insecure_cipher: false,
				disable_hashcheck: false,
				ask_password: false,
				known_hosts_file: '',
				path_override: '',
			},
			credentials: {
				host: crypt.encrypt('sftp.example.internal'),
				port: crypt.encrypt('22'),
				user: crypt.encrypt('backup-user'),
				pass: crypt.encrypt(storagePassword),
			},
		});
		const command = {
			id: 'remote-backup-backup-example-01',
			type: 'BACKUP_FILESYSTEM',
			agentId: capableAgent.agentId,
			payload: {
				backupId: 'backup-example-01',
				planId: plan.id,
				repositoryId: 'remote-repo-example-01',
			},
		} as AgentCommand;

		const payload = await service.materializeCommand(capableAgent.agentId, command);
		expect(payload).toMatchObject({
			rclone: {
				type: 'sftp',
				options: {
					host: 'sftp.example.internal',
					port: '22',
					user: 'backup-user',
					pass: storagePassword,
				},
			},
		});
		expect((payload.rclone as any).options).not.toHaveProperty('disable_hashcheck');
		expect((payload.rclone as any).options).not.toHaveProperty('key_use_agent');
		expect((payload.rclone as any).options).not.toHaveProperty('use_insecure_cipher');
	});

	it('classifies an SFTP credential decryption failure without retaining credential material', async () => {
		const foreignSecret = 'foreign-fixture-secret-that-is-long-enough';
		const foreignCrypt = new Cryptr(foreignSecret);
		const fixturePassword = 'fixture-sftp-password-must-not-appear-in-diagnostics';
		storageStore.getById.mockResolvedValue({
			id: plan.storageId,
			type: 'sftp',
			settings: {},
			credentials: {
				host: foreignCrypt.encrypt('sftp.example.internal'),
				user: foreignCrypt.encrypt('backup-user'),
				pass: foreignCrypt.encrypt(fixturePassword),
			},
		});
		const command = {
			id: 'remote-backup-backup-example-01',
			type: 'BACKUP_FILESYSTEM',
			agentId: capableAgent.agentId,
			payload: {
				backupId: 'backup-example-01',
				planId: plan.id,
				repositoryId: 'remote-repo-example-01',
			},
		} as AgentCommand;

		const error = await service
			.materializeCommand(capableAgent.agentId, command)
			.then(() => null)
			.catch(error => error);

		expect(error).toBeInstanceOf(RemoteCommandPreparationError);
		expect(error).toMatchObject({
			stage: 'sftp-credential-decryption',
			backupId: 'backup-example-01',
			planId: plan.id,
			storageId: plan.storageId,
			message: 'Storage credentials could not be prepared for the remote agent.',
			safeMessage: 'Remote SFTP credentials could not be decrypted or validated.',
		});
		expect(JSON.stringify(error)).not.toContain(fixturePassword);
		expect(JSON.stringify(error)).not.toContain(foreignSecret);
	});

	it('does not materialize credentials for a finalized backup command', async () => {
		backupStore.getById.mockResolvedValue({
			id: 'backup-example-01',
			planId: plan.id,
			sourceId: plan.sourceId,
			status: 'completed',
			inProgress: false,
		});
		const command = {
			id: 'remote-backup-backup-example-01',
			type: 'BACKUP_FILESYSTEM',
			agentId: capableAgent.agentId,
			payload: {
				backupId: 'backup-example-01',
				planId: plan.id,
				repositoryId: 'remote-repo-example-01',
			},
		} as AgentCommand;
		await expect(service.materializeCommand(capableAgent.agentId, command)).rejects.toThrow(
			'no longer has a valid managed plan'
		);
	});

	it('refuses storage settings that would enable external SSH or a shell command', async () => {
		const crypt = new Cryptr(encryptionSecret);
		storageStore.getById.mockResolvedValue({
			id: plan.storageId,
			type: 'sftp',
			settings: { ssh: 'ssh -o ProxyCommand=unsafe' },
			credentials: {
				host: crypt.encrypt('sftp.example.internal'),
				user: crypt.encrypt('backup-user'),
				pass: crypt.encrypt(storagePassword),
			},
		});
		const command = {
			id: 'remote-backup-backup-example-01',
			type: 'BACKUP_FILESYSTEM',
			agentId: capableAgent.agentId,
			payload: {
				backupId: 'backup-example-01',
				planId: plan.id,
				repositoryId: 'remote-repo-example-01',
			},
		} as AgentCommand;
		const error = await service
			.materializeCommand(capableAgent.agentId, command)
			.then(() => null)
			.catch(error => error);
		expect(error).toMatchObject({
			stage: 'sftp-setting-allowlist',
			rejectedField: 'ssh',
			ruleCategory: 'unsupported-field',
			message:
				'Remote filesystem backups support only SFTP host, port, username, and encrypted password credentials.',
		});
	});

	it('reports the rejected SFTP field and rule without retaining its value', async () => {
		const crypt = new Cryptr(encryptionSecret);
		const unsafeHost = 'sftp.example.internal\u0001';
		storageStore.getById.mockResolvedValue({
			id: plan.storageId,
			type: 'sftp',
			settings: {},
			credentials: {
				host: crypt.encrypt(unsafeHost),
				user: crypt.encrypt('backup-user'),
				pass: crypt.encrypt(storagePassword),
			},
		});
		const command = {
			id: 'remote-backup-backup-example-01',
			type: 'BACKUP_FILESYSTEM',
			agentId: capableAgent.agentId,
			payload: {
				backupId: 'backup-example-01',
				planId: plan.id,
				repositoryId: 'remote-repo-example-01',
			},
		} as AgentCommand;

		const error = await service
			.materializeCommand(capableAgent.agentId, command)
			.then(() => null)
			.catch(error => error);

		expect(error).toBeInstanceOf(RemoteCommandPreparationError);
		expect(error).toMatchObject({
			stage: 'sftp-option-validation',
			rejectedField: 'host',
			ruleCategory: 'unsafe-control-character',
			safeMessage: 'Remote SFTP configuration contains an unsafe value.',
		});
		expect(JSON.stringify(error)).not.toContain(unsafeHost);
		expect(JSON.stringify(error)).not.toContain(storagePassword);
	});

	const database = {
		engine: 'mariadb',
		host: 'localhost',
		port: 3306,
		tls: 'local',
		database: 'example_db',
		username: 'backup_reader',
		dumpFilename: 'app.sql',
		timeoutSeconds: 60,
		maxDumpBytes: 1024 ** 3,
		includeRoutines: false,
		includeEvents: false,
		passwordConfigured: true,
	};
	const lifecyclePlan = () => ({
		...plan,
		settings: { ...plan.settings, remoteLifecycle: { version: 1, database } },
	});
	const backupCommand = () =>
		({
			id: 'remote-backup-backup-example-01',
			type: 'BACKUP_FILESYSTEM',
			agentId: capableAgent.agentId,
			payload: {
				backupId: 'backup-example-01',
				planId: plan.id,
				repositoryId: 'remote-repo-example-01',
			},
		}) as AgentCommand;
	const advertiseLifecycle = () =>
		agentStore.getAgentByDeviceId.mockResolvedValue({
			...capableAgent,
			lastSeen: new Date(),
			capabilities: {
				...capableAgent.capabilities,
				backupLifecycleVersion: 1,
				databaseEngines: ['mariadb'],
				hooksConfigured: true,
			},
		});
	it('Phase 5 requires declared lifecycle/client capabilities without breaking Phase 4', async () => {
		await expect(service.validatePlanCreation(lifecyclePlan())).rejects.toThrow(
			'does not support the selected'
		);
		await expect(service.validatePlanCreation(plan)).resolves.toBeUndefined();
		advertiseLifecycle();
		await expect(service.validatePlanCreation(lifecyclePlan())).resolves.toBeUndefined();
		await expect(
			service.validatePlanCreation({
				...lifecyclePlan(),
				settings: {
					...lifecyclePlan().settings,
					remoteLifecycle: { version: 1, database: { ...database, engine: 'mysql' } },
				},
			})
		).rejects.toThrow('does not support the selected');
	});
	it('materializes database password only in the signed ephemeral version 2 payload', async () => {
		advertiseLifecycle();
		planStore.getById.mockResolvedValue(lifecyclePlan());
		const dbPassword = 'test-only-db-password';
		planStore.getDatabaseCredential = jest
			.fn()
			.mockResolvedValue(new Cryptr(encryptionSecret).encrypt(dbPassword));
		const command = backupCommand();
		const result = await service.materializeCommand(capableAgent.agentId, command);
		expect(result).toMatchObject({
			version: 2,
			lifecycle: { version: 1, database: { password: dbPassword } },
		});
		expect(JSON.stringify(command.payload)).not.toContain(dbPassword);
		expect(JSON.stringify(lifecyclePlan().settings)).not.toContain(dbPassword);
	});
	it('missing or undecryptable DB secret fails at a closed stage without provider text', async () => {
		advertiseLifecycle();
		planStore.getById.mockResolvedValue(lifecyclePlan());
		planStore.getDatabaseCredential = jest.fn().mockResolvedValue('synthetic-invalid-ciphertext');
		const error = await service
			.materializeCommand(capableAgent.agentId, backupCommand())
			.catch(error => error);
		expect(error).toMatchObject({
			stage: 'database-credential-preparation',
			safeMessage: 'Database backup credentials could not be prepared.',
		});
		expect(JSON.stringify(error)).not.toContain('synthetic-invalid-ciphertext');
	});
	it('materializes a mixed collection with independent password binding only into ephemeral version 3', async () => {
		const databases = [
			{ ...database, databaseId: 'db_maria' },
			{
				...database,
				databaseId: 'db_pg',
				engine: 'postgresql',
				port: 5432,
				database: 'analytics',
				dumpFilename: 'analytics.sql',
			},
		];
		const mixedPlan = {
			...plan,
			settings: { ...plan.settings, remoteLifecycle: { version: 2, databases } },
		};
		planStore.getById.mockResolvedValue(mixedPlan);
		agentStore.getAgentByDeviceId.mockResolvedValue({
			...capableAgent,
			lastSeen: new Date(),
			capabilities: {
				...capableAgent.capabilities,
				backupLifecycleVersion: 2,
				databaseEngines: ['mariadb', 'postgresql'],
			},
		});
		planStore.getDatabaseCredentials = jest.fn().mockResolvedValue([
			{
				databaseId: 'db_pg',
				encryptedPassword: new Cryptr(encryptionSecret).encrypt('synthetic-pg-password'),
				legacySingle: false,
			},
			{
				databaseId: 'db_maria',
				encryptedPassword: new Cryptr(encryptionSecret).encrypt('synthetic-maria-password'),
				legacySingle: false,
			},
		]);
		const command = backupCommand();
		const payload = await service.materializeCommand(capableAgent.agentId, command);
		expect(payload).toMatchObject({
			version: 3,
			lifecycle: {
				version: 2,
				databases: [
					{ databaseId: 'db_maria', password: 'synthetic-maria-password' },
					{ databaseId: 'db_pg', password: 'synthetic-pg-password' },
				],
			},
		});
		expect(JSON.stringify(mixedPlan)).not.toContain('synthetic-pg-password');
		expect(JSON.stringify(command)).not.toContain('synthetic-maria-password');
		advertiseLifecycle();
		await expect(service.validatePlanCreation(mixedPlan)).rejects.toThrow('does not support');
		const single = {
			...mixedPlan,
			settings: {
				...mixedPlan.settings,
				remoteLifecycle: { version: 2, databases: [databases[0]] },
			},
		};
		planStore.getById.mockResolvedValue(single);
		const legacy = await service.materializeCommand(capableAgent.agentId, command);
		expect(legacy).toMatchObject({
			version: 2,
			lifecycle: { version: 1, database: { password: 'synthetic-maria-password' } },
		});
		expect((legacy.lifecycle as any).database).not.toHaveProperty('databaseId');
	});
	it('snapshot success with post/cleanup warnings remains completed and exposes a safe warning separately', async () => {
		backupStore.update = jest.fn();
		planStore.update = jest.fn();
		const id = 'a'.repeat(64);
		const summary = {
			message_type: 'summary',
			snapshot_id: id,
			total_bytes_processed: 1024,
		} as any;
		const warnings = [{ stage: 'post-backup', code: 'hook-failed' }] as any;
		await service.completeCommand(backupCommand(), {
			success: true,
			result: { snapshotId: id, summary, lifecycle: { warnings } },
		});
		expect((service as any).eventService.onBackupComplete).toHaveBeenCalledWith(
			expect.objectContaining({ success: true, summary: { ...summary, lifecycle: { warnings } } })
		);
		expect((service as any).eventService.onBackupFailure).not.toHaveBeenCalled();
		expect(backupStore.update).toHaveBeenCalledWith('backup-example-01', {
			errorMsg: expect.stringContaining('post-backup/hook-failed'),
		});
	});
	it('accepts only complete multi-DB snapshot metadata bound to every configured entry', async () => {
		planStore.update = jest.fn();
		const databases = [
			{ ...database, databaseId: 'db_one' },
			{
				...database,
				databaseId: 'db_two',
				engine: 'postgresql',
				database: 'analytics',
				dumpFilename: 'analytics.sql',
			},
		];
		planStore.getById.mockResolvedValue({
			...plan,
			settings: { ...plan.settings, remoteLifecycle: { version: 2, databases } },
		});
		const id = 'a'.repeat(64);
		const artifacts = databases.map(entry => ({
			databaseId: entry.databaseId,
			engine: entry.engine,
			database: entry.database,
			path: `/pluton/database/${entry.dumpFilename}`,
			bytes: 1024,
			sha256: 'b'.repeat(64),
		})) as any;
		const summary = { message_type: 'summary', snapshot_id: id } as any;
		for (const reported of [
			undefined,
			artifacts.slice(0, 1),
			[{ ...artifacts[0], databaseId: 'db_foreign' }, artifacts[1]],
			[{ ...artifacts[0], bytes: 1024 ** 4 }, artifacts[1]],
		]) {
			await service.completeCommand(backupCommand(), {
				success: true,
				result: { snapshotId: id, summary, lifecycle: { warnings: [], databases: reported } },
			});
			expect((service as any).eventService.onBackupFailure).toHaveBeenLastCalledWith(
				expect.objectContaining({ error: expect.stringContaining('snapshot-confirmation-failed') })
			);
		}
		expect((service as any).eventService.onBackupComplete).not.toHaveBeenCalled();
		await service.completeCommand(backupCommand(), {
			success: true,
			result: { snapshotId: id, summary, lifecycle: { warnings: [], databases: artifacts } },
		});
		expect((service as any).eventService.onBackupComplete).toHaveBeenCalledWith(
			expect.objectContaining({
				summary: { ...summary, lifecycle: { warnings: [], databases: artifacts } },
			})
		);
	});
});
