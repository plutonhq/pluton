import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { RecoveryTestService } from '../../src/services/RecoveryTestService';
import { RecoveryTestError } from '../../src/utils/recoveryValidation';
import { RecoveryWorkspace } from '../../src/utils/recoveryWorkspace';
import { ManagedRepositoryAccessError } from '../../src/utils/restic/ManagedSftpRepositorySession';
import { planLogger } from '../../src/utils/logger';
import { recoveryArtifacts } from '../../src/utils/recoveryValidation';

jest.mock('../../src/utils/logger', () => ({ planLogger: jest.fn(() => ({ warn: jest.fn() })) }));
const snapshot = 'a'.repeat(64);
const hash = (text: string) => crypto.createHash('sha256').update(text).digest('hex');
const artifact = (engine = 'mariadb', databaseId = 'db_app') => ({
	engine,
	databaseId,
	database: 'example_db',
	path: `/pluton/database/${databaseId}.sql`,
	bytes: 10,
	sha256: hash('SELECT 1;\n'),
});
describe('Phase 6 durable recovery orchestration', () => {
	let scratch: string,
		root: string,
		service: RecoveryTestService,
		store: any,
		backup: any,
		recovery: any,
		importer: any,
		rows: Map<string, any>,
		plan: any;
	beforeEach(async () => {
		scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'phase6-service-'));
		root = path.join(scratch, 'recovery-tests');
		rows = new Map();
		plan = { id: 'plan-01', sourceId: 'app-01', sourceType: 'device', method: 'backup' };
		backup = {
			id: 'backup-01',
			planId: plan.id,
			status: 'completed',
			completionStats: { snapshot_id: snapshot },
		};
		store = {
			activity: jest.fn(async () => ({ backup: false, restore: false, recovery: false })),
			get: jest.fn(async id => rows.get(id)),
			list: jest.fn(async planId => [...rows.values()].filter(row => row.planId === planId)),
			policy: jest.fn(async () => ({ enabled: false, databaseImport: 'disabled' })),
			targets: jest.fn(async () => []),
			target: jest.fn(async (_, engine) => ({
				id: `target-${engine}`,
				engine,
				password: 'synthetic-import-password',
			})),
			enqueue: jest.fn(async input => {
				const old = [...rows.values()].find(
					row => row.automationKey && row.automationKey === input.automationKey
				);
				if (old) return old;
				const row = { ...input, warnings: [], cancelRequested: false };
				rows.set(row.id, row);
				return row;
			}),
			claim: jest.fn(async () => {
				const row = [...rows.values()].find(row => row.status === 'queued');
				if (row) row.status = 'running';
				return row || null;
			}),
			update: jest.fn(async (id, patch) => {
				Object.assign(rows.get(id), patch);
				return rows.get(id);
			}),
			requestCancellation: jest.fn(async id => {
				const row = rows.get(id);
				row.cancelRequested = true;
				if (row.status === 'queued') row.status = 'cancelled';
				return row;
			}),
			leases: jest.fn(async () => []),
			automaticCandidates: jest.fn(async () => []),
			interrupted: jest.fn(async () => []),
			cleanupCandidates: jest.fn(async () => []),
			pendingInternalSessions: jest.fn(async () => []),
		};
		recovery = {
			testMetadata: jest.fn(async (backupId, planId, snapshotId) => ({
				backupId,
				planId,
				snapshotId,
				repositoryId: 'repo-01',
				databases: recoveryArtifacts(backup.completionStats.lifecycle),
			})),
			testBinding: jest.fn(async (backupId, planId) => ({
				planId,
				backupId,
				snapshotId: snapshot,
				repositoryId: 'repo-01',
			})),
			testRestore: jest.fn(async (_, target, _signal, stage, assertWorkspace) => {
				await assertWorkspace();
				stage('staged-restore');
				for (const entry of backup.completionStats.lifecycle?.databases || []) {
					await fs.mkdir(path.join(target, 'pluton/database'), { recursive: true });
					await fs.writeFile(path.join(target, entry.path.slice(1)), 'SELECT 1;\n');
				}
				return {
					files: 1,
					bytes: 10,
					sourceTrees: 1,
					integrity: 'restic-restore-and-structure',
					databaseArtifactPaths: (backup.completionStats.lifecycle?.databases || []).map(
						entry => entry.path
					),
				};
			}),
		};
		importer = {
			importDatabase: jest.fn(async ({ entry }) => {
				entry.importValidation = 'passed';
				entry.tables = 0;
				entry.views = 0;
			}),
			cleanup: jest.fn(),
			verifyEmptyTarget: jest.fn(),
		};
		service = new RecoveryTestService(
			store,
			{ getById: async () => plan } as any,
			{ getById: async () => backup } as any,
			recovery,
			root,
			importer
		);
	});
	afterEach(async () => {
		jest.restoreAllMocks();
		await service.shutdown();
		await fs.rm(scratch, { recursive: true, force: true });
	});
	async function run() {
		const row = await service.enqueue(plan.id, backup.id);
		await service.tick();
		await service.idle();
		return rows.get(row!.id);
	}
	it('handles advisory stage persistence rejection without an unhandled promise or raw diagnostic and still verifies cleanup', async () => {
		store.update.mockImplementationOnce(async () => {
			throw new Error('synthetic-private-provider-detail');
		});
		const result = await run();
		await new Promise(resolve => setImmediate(resolve));
		expect(result.status).toBe('passed');
		expect(result.result.cleanup).toEqual({ workspace: true, databases: true });
		const events = (planLogger as jest.Mock).mock.results.flatMap(
			entry => entry.value.warn.mock.calls
		);
		expect(events).toEqual(
			expect.arrayContaining([
				expect.arrayContaining([
					expect.objectContaining({
						event: 'recovery_test_stage_persistence_failed',
						recoveryTestId: result.id,
						stage: 'staged-restore',
						code: 'stage-persistence-failed',
					}),
				]),
			])
		);
		expect(JSON.stringify(events)).not.toContain('synthetic-private-provider-detail');
	});
	function internalFixture(engine: 'mariadb' | 'mysql' = 'mariadb') {
		backup.completionStats.lifecycle = { databases: [artifact(engine)] };
		store.policy.mockResolvedValue({
			enabled: false,
			databaseImport: 'required',
			targetModes: { [engine]: 'internal' },
		});
		const session: any = { id: `irt_${'1'.repeat(24)}`, engine, cleanupReady: false };
		const internal: any = {
			resourceView: jest.fn(async () => ({ status: 'unknown', sample: null })),
			admission: jest.fn(async () => ({ status: 'admitted', maxSqlBytes: 128 * 1024 ** 2 })),
			prepare: jest.fn(async () => ({ engine, target: { engine } })),
			preflight: jest.fn(),
			requestCleanup: jest.fn(),
			removed: jest.fn(() => false),
			readiness: jest.fn(async () => []),
		};
		store.beginInternalSession = jest.fn(async ({ testId }) => {
			session.testId = testId;
			return { id: session.id, engine, password: 'synthetic' };
		});
		store.pendingInternalSessions.mockImplementation(async () =>
			session.testId && !session.released ? [session] : []
		);
		store.internalSession = jest.fn(async () => session);
		store.markInternalCleanupReady = jest.fn(async () => {
			session.cleanupReady = true;
		});
		store.completeInternalCleanup = jest.fn(async (_, changes) => {
			Object.assign(rows.get(session.testId), changes);
			session.released = true;
		});
		service = new RecoveryTestService(
			store,
			{ getById: async () => plan } as any,
			{ getById: async () => backup } as any,
			recovery,
			root,
			importer,
			internal
		);
		return { session, internal };
	}
	it('prepares exact engine identities without credentials, import, workspace or policy changes', async () => {
		const { internal } = internalFixture();
		const preview = await service.preparation(plan.id, backup.id, snapshot);
		expect(preview.databases[0].engine).toBe('mariadb');
		expect(preview.artifactHashVerification).toBe('mandatory-before-import');
		expect(preview.versionCompatibility).toBe('not-recorded-in-receipt');
		expect(preview.persistentRestore.status).toBe('unavailable');
		expect(preview.resources.status).toBe('unknown');
		expect(JSON.stringify(preview)).not.toContain('password');
		expect(recovery.testRestore).not.toHaveBeenCalled();
		expect(importer.importDatabase).not.toHaveBeenCalled();
		expect(internal.prepare).not.toHaveBeenCalled();
	});
	it('manual confirmation persists an operation-only policy and fingerprint, then rejects changed receipt before restore', async () => {
		internalFixture();
		store.targets.mockResolvedValue([
			{ engine: 'mariadb', enabled: true, passwordConfigured: true },
		]);
		const preview = await service.preparation(plan.id, backup.id, snapshot);
		const row = await service.enqueueManual(plan.id, {
			backupId: backup.id,
			snapshotId: snapshot,
			metadataToken: preview.metadataToken,
			resourcesAcknowledged: true,
			selection: { databaseImport: 'required', targetModes: { mariadb: 'custom' } },
		});
		expect(row.policy.enabled).toBe(false);
		expect(row.policy.snapshotMetadataToken).toBe(preview.metadataToken);
		expect((await store.policy()).targetModes.mariadb).toBe('internal');
		backup.completionStats.lifecycle.databases[0].engine = 'mysql';
		await service.tick();
		await service.idle();
		expect(rows.get(row.id).failureCode).toBe('snapshot-binding-mismatch');
		expect(recovery.testRestore).not.toHaveBeenCalled();
		expect(importer.importDatabase).not.toHaveBeenCalled();
	});
	it('stale confirmation is refused and cannot queue or bypass missing Internal admission', async () => {
		const { internal } = internalFixture();
		const preview = await service.preparation(plan.id, backup.id, snapshot);
		const input = {
			backupId: backup.id,
			snapshotId: snapshot,
			metadataToken: 'f'.repeat(64),
			resourcesAcknowledged: true as const,
			selection: {
				databaseImport: 'required' as const,
				targetModes: { mariadb: 'internal' as const },
			},
		};
		await expect(service.enqueueManual(plan.id, input)).rejects.toThrow('metadata changed');
		internal.readiness.mockResolvedValue([
			{ engine: 'mariadb', status: 'ready', mode: 'operator-managed' },
		]);
		internal.admission.mockResolvedValue({
			status: 'refused',
			code: 'internal-resources-insufficient',
		});
		await expect(
			service.enqueueManual(plan.id, { ...input, metadataToken: preview.metadataToken })
		).rejects.toThrow('internal-resources-insufficient');
		expect(store.enqueue).not.toHaveBeenCalled();
	});
	it('bounds concurrent preparation and never exposes raw repository errors in the API', async () => {
		internalFixture();
		let release!: () => void;
		const gate = new Promise<void>(resolve => {
			release = resolve;
		});
		const original = recovery.testMetadata.getMockImplementation();
		recovery.testMetadata.mockImplementation(async (...args: any[]) => {
			await gate;
			return original(...args);
		});
		const first = service.preparation(plan.id, backup.id, snapshot);
		await expect(service.preparation(plan.id, backup.id, snapshot)).rejects.toThrow(
			'already in progress'
		);
		release();
		await first;
	});
	it('persistent restore fails explicitly without importing or allocating infrastructure', async () => {
		await expect(service.databaseRestoreUnavailable(plan.id)).rejects.toThrow(
			'Persistent Database Restore is not available'
		);
		expect(recovery.testRestore).not.toHaveBeenCalled();
		expect(importer.importDatabase).not.toHaveBeenCalled();
	});
	it('rechecks backup workload before import and never competes with an already-running backup', async () => {
		backup.completionStats.lifecycle = { databases: [artifact()] };
		store.policy.mockResolvedValue({ enabled: false, databaseImport: 'required' });
		store.activity.mockResolvedValue({ backup: true, restore: false, recovery: false });
		const row = await run();
		expect(row.failureCode).toBe('recovery-workload-busy');
		expect(importer.importDatabase).not.toHaveBeenCalled();
	});
	it.each(['mariadb', 'postgresql', 'mysql'])(
		'refuses %s source endpoint as a Custom native target',
		async engine => {
			backup.completionStats.lifecycle = { databases: [artifact(engine)] };
			store.policy.mockResolvedValue({ enabled: false, databaseImport: 'required' });
			plan.settings = {
				remoteLifecycle: { databases: [{ engine, host: 'source.example.internal', port: 3306 }] },
			};
			store.target.mockResolvedValue({
				id: 'target-01',
				engine,
				host: 'source.example.internal',
				port: 3306,
			});
			const row = await run();
			expect(row.failureCode).toBe('recovery-target-unsafe');
			expect(importer.importDatabase).not.toHaveBeenCalled();
		}
	);
	it.each(['mariadb', 'mysql'] as const)(
		'%s Internal remains Cleanup Required until exact operator removal receipt, then Passed',
		async engine => {
			const { internal, session } = internalFixture(engine);
			const row = await run();
			expect(row.status).toBe('failed');
			expect(row.failureCode).toBe('internal-cleanup-required');
			expect(row.result.databases[0].importValidation).toBe('passed');
			expect(row.result.cleanup).toEqual({
				workspace: true,
				databases: true,
				infrastructure: false,
			});
			expect(session.cleanupReady).toBe(true);
			expect(internal.requestCleanup).toHaveBeenCalledWith(session, snapshot);
			internal.removed.mockReturnValue(true);
			await service.tick();
			await service.idle();
			expect(row.status).toBe('passed');
			expect(row.result.cleanup.infrastructure).toBe(true);
		}
	);
	it('resource refusal never imports and still requests safe cleanup of the manually activated target', async () => {
		const { internal } = internalFixture();
		internal.preflight.mockRejectedValue(
			new RecoveryTestError('database-target-preflight', 'internal-resources-insufficient')
		);
		const row = await run();
		expect(importer.importDatabase).not.toHaveBeenCalled();
		expect(row.failureCode).toBe('internal-resources-insufficient');
		expect(internal.requestCleanup).toHaveBeenCalled();
		internal.removed.mockReturnValue(true);
		await service.tick();
		expect(row.status).toBe('failed');
	});
	it('internal SQL catalog cleanup failure is mandatory, cannot be Passed, and refuses removal approval', async () => {
		const { session } = internalFixture();
		importer.verifyEmptyTarget.mockRejectedValue(new Error('synthetic raw error'));
		const row = await run();
		expect(row.status).toBe('failed');
		expect(session.cleanupReady).toBe(false);
		expect(row.result.cleanup.databases).toBe(false);
		expect(store.markInternalCleanupReady).not.toHaveBeenCalled();
	});
	it('two internal engines in one snapshot are rejected before activation/import', async () => {
		const { internal } = internalFixture();
		store.policy.mockResolvedValue({
			enabled: false,
			databaseImport: 'required',
			targetModes: { mariadb: 'internal', postgresql: 'internal' },
		});
		backup.completionStats.lifecycle = {
			databases: [artifact(), artifact('postgresql', 'db_other')],
		};
		const row = await run();
		expect(row.failureCode).toBe('internal-target-unsafe');
		expect(internal.prepare).not.toHaveBeenCalled();
		expect(importer.importDatabase).not.toHaveBeenCalled();
	});
	it('a stale/wrong removal receipt cannot release a successful test', async () => {
		internalFixture();
		const row = await run();
		await service.tick();
		expect(row.status).toBe('failed');
		expect(store.completeInternalCleanup).not.toHaveBeenCalled();
	});
	it('interrupted internal sessions clean safely but never resume imports or become Passed', async () => {
		const { internal } = internalFixture();
		const row = await run();
		row.failureCode = 'interrupted';
		internal.removed.mockReturnValue(true);
		await service.recoverInterrupted();
		expect(row.status).toBe('failed');
		expect(row.failureCode).toBe('interrupted');
		expect(importer.importDatabase).toHaveBeenCalledTimes(1);
	});
	it('MySQL source endpoint is refused before worker dispatch', async () => {
		backup.completionStats.lifecycle = { databases: [artifact('mysql')] };
		plan.settings = {
			remoteLifecycle: {
				databases: [{ engine: 'mysql', host: 'source.example.internal', port: 3306 }],
			},
		};
		store.policy.mockResolvedValue({ enabled: true, databaseImport: 'required' });
		store.target.mockResolvedValue({
			id: 'b'.repeat(24),
			engine: 'mysql',
			host: 'SOURCE.example.internal',
			port: 3306,
			password: 'synthetic-worker-fixture',
		});
		const row = await run();
		expect(row.status).toBe('failed');
		expect(row.failureCode).toBe('recovery-target-unsafe');
		expect(importer.importDatabase).not.toHaveBeenCalled();
	});
	it('manually restores the exact snapshot, cleans staging, and never writes Backup or contacts an agent', async () => {
		const original = JSON.stringify(backup);
		const row = await run();
		expect(row.status).toBe('passed');
		expect(row.snapshotId).toBe(snapshot);
		expect(row.repositoryId).toBe('repo-01');
		expect(recovery.testRestore.mock.calls[0][0].backupId).toBe(backup.id);
		expect(row.result.cleanup).toEqual({ workspace: true, databases: true });
		expect(await fs.readdir(root)).toEqual([]);
		expect(JSON.stringify(backup)).toBe(original);
	});
	it('automatic opt-in reconciliation is idempotent and disabled policies cannot enqueue automatically', async () => {
		expect(await service.enqueue(plan.id, backup.id, 'after_backup')).toBeNull();
		store.policy.mockResolvedValue({ enabled: true, databaseImport: 'disabled' });
		store.automaticCandidates.mockResolvedValue([backup.id]);
		await service.tick();
		await service.idle();
		await service.tick();
		await service.idle();
		expect(rows.size).toBe(1);
		expect(recovery.testRestore).toHaveBeenCalledTimes(1);
	});
	it.each(['mariadb', 'mysql', 'postgresql'])(
		'%s artifact-only validation is explicit Passed with warning',
		async engine => {
			backup.completionStats.lifecycle = { databases: [artifact(engine)] };
			const row = await run();
			expect(row.status).toBe('passed_with_warning');
			expect(row.result.databases[0].artifactValidation).toBe('passed');
			expect(row.result.databases[0].importValidation).toBe('disabled');
			expect(importer.importDatabase).not.toHaveBeenCalled();
		}
	);
	it('imports every mixed database; a single failure preserves all artifact results and cleans both leases', async () => {
		backup.completionStats.lifecycle = {
			databases: [artifact('mariadb'), artifact('postgresql', 'db_metrics')],
		};
		store.policy.mockResolvedValue({ enabled: true, databaseImport: 'required' });
		store.leases.mockResolvedValue([{ id: 'lease-01' }, { id: 'lease-02' }]);
		importer.importDatabase.mockImplementation(async ({ entry }) => {
			if (entry.engine === 'postgresql') {
				entry.importValidation = 'failed';
				throw new RecoveryTestError('database-import', 'database-import-failed');
			}
			entry.importValidation = 'passed';
		});
		const row = await run();
		expect(row.status).toBe('failed');
		expect(row.failureCode).toBe('database-import-failed');
		expect(row.result.databases.map(entry => entry.artifactValidation)).toEqual([
			'passed',
			'passed',
		]);
		expect(importer.cleanup).toHaveBeenCalledTimes(2);
		expect(row.result.cleanup.databases).toBe(true);
		expect(backup.status).toBe('completed');
	});
	it('missing required targets fail instead of silently passing', async () => {
		backup.completionStats.lifecycle = { databases: [artifact()] };
		store.policy.mockResolvedValue({ enabled: false, databaseImport: 'required' });
		store.target.mockResolvedValue(null);
		const row = await run();
		expect(row.status).toBe('failed');
		expect(row.failureCode).toBe('recovery-target-not-configured');
		expect(row.result.databases[0].importValidation).toBe('not_configured');
	});
	it('missing expected SQL or absent completion metadata cannot be a full pass', async () => {
		backup.completionStats.lifecycle = { databases: [artifact()] };
		recovery.testRestore.mockResolvedValue({
			files: 1,
			bytes: 10,
			sourceTrees: 1,
			integrity: 'restic-restore-and-structure',
			databaseArtifactPaths: [],
		});
		expect((await run()).failureCode).toBe('database-artifact-missing');
		delete backup.completionStats.lifecycle;
		recovery.testRestore.mockResolvedValue({
			files: 1,
			bytes: 10,
			sourceTrees: 1,
			integrity: 'restic-restore-and-structure',
			databaseArtifactPaths: [artifact().path],
		});
		expect((await run()).failureCode).toBe('database-metadata-incomplete');
	});
	it('sanitizes unknown/provider exceptions; neither result nor logs include raw secrets', async () => {
		recovery.testRestore.mockRejectedValue(new Error('synthetic-private-password secret SQL'));
		const row = await run();
		expect(row.status).toBe('failed');
		expect(JSON.stringify(row)).not.toContain('synthetic-private-password');
		const checkpoints = (planLogger as jest.Mock).mock.results.flatMap(
			result => result.value.warn.mock.calls
		);
		expect(JSON.stringify(checkpoints)).not.toContain('synthetic-private-password');
		expect(
			checkpoints.some(
				([fields]) => fields.code === 'unexpected' && fields.stage === 'snapshot-validation'
			)
		).toBe(false);
		expect(checkpoints.some(([fields]) => fields.event === 'recovery_test_failed')).toBe(true);
	});
	it.each([
		['wrong-password', 'repository-auth-failed'],
		['timeout', 'restore-timeout'],
	])('classifies %s without raw provider stderr', async (provider, code) => {
		recovery.testRestore.mockRejectedValue(new ManagedRepositoryAccessError(provider as any));
		expect((await run()).failureCode).toBe(code);
	});
	it('rejects cross-plan job ownership and changed backup snapshots before any restore', async () => {
		const queued = await service.enqueue(plan.id, backup.id);
		await expect(service.get('plan-other', queued!.id)).rejects.toMatchObject({ statusCode: 404 });
		backup.completionStats.snapshot_id = 'b'.repeat(64);
		await service.tick();
		await service.idle();
		expect(rows.get(queued!.id).failureCode).toBe('snapshot-binding-mismatch');
		expect(recovery.testRestore).not.toHaveBeenCalled();
	});
	it('cancels a queued job without any external execution', async () => {
		const row = await service.enqueue(plan.id, backup.id);
		await service.cancel(plan.id, row!.id);
		await service.tick();
		expect(rows.get(row!.id).status).toBe('cancelled');
		expect(recovery.testRestore).not.toHaveBeenCalled();
	});
	it('cancellation stops an active restore, skips import, cleans its files and records Cancelled', async () => {
		let started!: () => void;
		const ready = new Promise<void>(resolve => {
			started = resolve;
		});
		recovery.testRestore.mockImplementation(async (_row, _target, signal) => {
			started();
			await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
			throw new Error('private diagnostics');
		});
		const row = await service.enqueue(plan.id, backup.id);
		await service.tick();
		await ready;
		await service.cancel(plan.id, row!.id);
		expect(rows.get(row!.id).status).toBe('cancelled');
		expect(rows.get(row!.id).failureCode).toBe('cancelled');
		expect(importer.importDatabase).not.toHaveBeenCalled();
		expect(await fs.readdir(root)).toEqual([]);
	});
	it('simultaneous ticks cannot start multiple local workers', async () => {
		await service.enqueue(plan.id, backup.id);
		await Promise.all([service.tick(), service.tick(), service.tick()]);
		await service.idle();
		expect(store.claim).toHaveBeenCalledTimes(1);
		expect(recovery.testRestore).toHaveBeenCalledTimes(1);
	});
	it('cleanup failures preserve validation and leave explicit retryable warnings', async () => {
		const remove = jest
			.spyOn(RecoveryWorkspace.prototype, 'remove')
			.mockRejectedValue(new Error('private location error'));
		store.leases.mockResolvedValue([{ id: 'lease-01' }]);
		importer.cleanup.mockRejectedValue(new Error('private database password'));
		const row = await run();
		expect(row.status).toBe('passed_with_warning');
		expect(row.result.filesystem).toBeDefined();
		expect(row.result.cleanup).toEqual({ workspace: false, databases: false });
		expect(JSON.stringify(row.warnings)).not.toContain('private');
		remove.mockRestore();
	});
	it('startup cleans an interrupted owned workspace without resuming repository operations', async () => {
		const row = await service.enqueue(plan.id, backup.id);
		rows.get(row!.id).status = 'failed';
		store.interrupted.mockResolvedValue([row]);
		await new RecoveryWorkspace(root).create(row!.id);
		await service.recoverInterrupted();
		expect(await fs.readdir(root)).toEqual([]);
		expect(recovery.testRestore).not.toHaveBeenCalled();
	});
	it('shutdown aborts active work, persists cancellation, cleans staging and stops future dispatch', async () => {
		let started!: () => void;
		const ready = new Promise<void>(resolve => {
			started = resolve;
		});
		recovery.testRestore.mockImplementation(async (_row, _target, signal) => {
			started();
			await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
			throw new Error('synthetic-private-shutdown-error');
		});
		const row = await service.enqueue(plan.id, backup.id);
		await service.tick();
		await ready;
		await service.shutdown();
		expect(rows.get(row!.id).status).toBe('cancelled');
		expect(await fs.readdir(root)).toEqual([]);
		const claims = store.claim.mock.calls.length;
		await service.tick();
		expect(store.claim).toHaveBeenCalledTimes(claims);
	});
	it('restart retries file-only cleanup warnings without changing prior validation', async () => {
		const row = await run();
		rows.get(row.id).warnings = [{ stage: 'workspace-cleanup', code: 'workspace-cleanup-failed' }];
		await new RecoveryWorkspace(root).create(row.id);
		store.cleanupCandidates.mockResolvedValue([row]);
		await service.recoverInterrupted();
		expect(await fs.readdir(root)).toEqual([]);
		expect(row.result.cleanup.workspace).toBe(true);
		expect(row.result.filesystem.files).toBe(1);
		expect(recovery.testRestore).toHaveBeenCalledTimes(1);
	});
});
