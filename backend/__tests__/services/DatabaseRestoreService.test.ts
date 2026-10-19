import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { DatabaseRestoreService } from '../../src/services/DatabaseRestoreService';
import { recoveryMetadataToken } from '../../src/utils/recoveryPreparation';
import { RecoveryTestError } from '../../src/utils/recoveryValidation';
import { DatabaseRestoreError } from '../../src/utils/persistentRestorePolicy';
import { MysqlWorkerConnection } from '../../src/utils/mysqlRecoveryWorkerClient';
import { fixture, approval, row, sql } from '../integration/persistentRestore.fixture';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { PlanStore } from '../../src/stores/PlanStore';

describe('Persistent MySQL service lifecycle and immutable binding', () => {
	let db: ReturnType<typeof fixture>,
		target: any,
		item: any,
		service: DatabaseRestoreService,
		root: string,
		targets: any,
		recovery: any,
		native: any,
		oldEnv: string | undefined;
	beforeEach(async () => {
		oldEnv = process.env.PLUTON_MYSQL_WORKER;
		process.env.PLUTON_MYSQL_WORKER = 'enabled';
		db = fixture();
		target = approval();
		target.engine = target.target.engine = 'mysql';
		item = row(target);
		item.artifact.engine = 'mysql';
		root = await fs.mkdtemp(path.join(os.tmpdir(), 'persistent-service-'));
		const metadata = () => ({
			planId: item.planId,
			backupId: item.backupId,
			snapshotId: item.snapshotId,
			repositoryId: item.repositoryId,
			databases: [item.artifact],
		});
		item.metadataToken = recoveryMetadataToken(metadata());
		targets = {
			policy: async () => ({ maxSqlBytes: 128 * 1024 ** 2, maxRetentionSeconds: 86400 }),
			list: async () => [],
			resourceView: async () => ({ status: 'measured', sample: {}, observedAt: 1 }),
			admission: jest.fn(async () => {}),
			assertBinding: jest.fn(async current => {
				if (current.artifact.engine !== target.engine)
					throw new DatabaseRestoreError('target-binding-mismatch');
				return target;
			}),
			ca: async () => '/synthetic-ca',
			state: async () => ({ state: 'external' }),
		};
		recovery = {
			testMetadata: jest.fn(async () => metadata()),
			databaseRestoreArtifact: jest.fn(async (_binding, directory) => {
				await fs.mkdir(path.join(directory, 'pluton/database'), { recursive: true });
				await fs.writeFile(path.join(directory, 'pluton/database/db_example.sql'), sql, {
					mode: 0o600,
				});
			}),
		};
		native = {
			restore: jest.fn(async current => {
				db.store.addLease({
					restoreId: current.id,
					targetId: target.id,
					database: 'example_db',
					ownerToken: current.ownerToken,
					state: 'validated',
				});
				return {
					engine: current.artifact.engine,
					version: '8.4.11',
					database: 'example_db',
					tables: 1,
					views: 0,
					bytes: 1024,
					catalog: [],
					catalogTruncated: false,
					observedAt: Date.now(),
				};
			}),
			inspect: jest.fn(async () => ({})),
			removeOwned: jest.fn(async current => {
				db.store.removeLease(current.id);
				return true;
			}),
		};
		service = new DatabaseRestoreService(
			db.store,
			{
				getById: async () =>
					({ sourceType: 'device', sourceId: 'app-01', method: 'backup' }) as any,
			},
			recovery,
			targets,
			path.join(root, 'workspace'),
			() => native
		);
	});
	afterEach(async () => {
		jest.restoreAllMocks();
		await service.shutdown();
		db.sqlite.close();
		await fs.rm(root, { recursive: true, force: true });
		if (oldEnv === undefined) delete process.env.PLUTON_MYSQL_WORKER;
		else process.env.PLUTON_MYSQL_WORKER = oldEnv;
	});
	const request = () => ({
		planId: item.planId,
		backupId: item.backupId,
		snapshotId: item.snapshotId,
		databaseId: item.databaseId,
		metadataToken: item.metadataToken,
		mode: 'custom',
		targetId: target.id,
		ttlSeconds: 3600,
		resourcesAcknowledged: true,
		securityAcknowledged: true,
	});
	const run = async () => {
		const result = await service.create(request(), 'administrator');
		await service.tick();
		await service.idle();
		return result.id;
	};
	it('automatic deletion waits for the complete Removed receipt, not the earlier native/public Removed state', async () => {
		target.engine = target.target.engine = item.artifact.engine = 'mariadb';
		target.mode = item.mode = 'internal';
		item.status = 'cleanup_required';
		item.cleanup = 'infrastructure_pending';
		item.cancelRequested = true;
		db.store.create(item);
		db.store.bind(item.id, target);
		db.store.update(item.id, { cancelRequested: true, cleanup: 'infrastructure_pending' });
		let removed = false;
		targets.automatic = {
			record: () => ({ state: removed ? 'removed' : 'cleaning-up', action: 'delete', code: null }),
			persistent: jest.fn(async () => {}),
			receipt: jest.fn(async () => ({ state: removed ? 'removed' : 'cleaning-up', code: null })),
		};
		targets.state = async () => ({ state: 'removed' });
		await service.tick();
		await service.idle();
		expect(db.store.get(item.id)?.status).toBe('cleanup_required');
		expect(native.restore).not.toHaveBeenCalled();
		expect(native.removeOwned).not.toHaveBeenCalled();
		removed = true;
		await service.tick();
		expect(db.store.get(item.id)?.status).toBe('deleted');
	});
	it.each(['mariadb', 'postgresql', 'mysql'] as const)(
		'%s automatic Internal waits for host readiness, then retains a validated restore',
		async engine => {
			jest.spyOn(MysqlWorkerConnection.prototype, 'internalReady').mockResolvedValue(true);
			target.engine = target.target.engine = item.artifact.engine = engine;
			target.mode = 'internal';
			item.metadataToken = recoveryMetadataToken(await recovery.testMetadata());
			targets.resourceView = async () => ({
				status: 'measured',
				observedAt: Date.now(),
				sample: {
					total: 8192 * 1024 ** 2,
					available: 4096 * 1024 ** 2,
					swapUsed: 0,
					pressure: 0,
					limit: 1536 * 1024 ** 2,
					used: 128 * 1024 ** 2,
					cgroupSwap: 0,
					diskAvailable: 10 * 1024 ** 3,
					cpuAvailable: 2,
					operatorObservedAt: Date.now(),
					operatorAvailable: 4096 * 1024 ** 2,
					operatorTotal: 8192 * 1024 ** 2,
					operatorCpuAvailable: 4,
					operatorDiskAvailable: 10 * 1024 ** 3,
				},
			});
			let ready = false,
				unsafe = false;
			// Internal targets expose an owned Active/Stopped host state, never Custom's external state.
			targets.state = async () => ({ state: ready ? 'active' : 'stopped', observedAt: Date.now() });
			const host = {
				assertAvailable: jest.fn(),
				capability: async () => ({
					available: true,
					engines: ['mariadb', 'postgresql', ...(engine === 'mysql' ? ['mysql'] : [])],
				}),
				record: () => ({
					state: unsafe ? 'cleanup-required' : ready ? 'ready' : 'provisioning-container',
					action: 'provision',
					code: null,
				}),
				persistent: jest.fn(async () => {}),
				receipt: async () => ({
					state: unsafe ? 'cleanup-required' : ready ? 'ready' : 'provisioning-container',
					code: null,
					observedAt: Date.now(),
				}),
			};
			targets.automatic = host;
			targets.request = jest.fn(async current => {
				target.id = current.id;
				target.binding = {
					restoreId: current.id,
					snapshotId: current.snapshotId,
					sha256: current.artifact.sha256,
				};
			});
			const original = targets.assertBinding;
			targets.assertBinding = jest.fn(async current => {
				if (!ready) throw new DatabaseRestoreError('operator-target-unavailable');
				return original(current);
			});
			const created = await service.create(
				{ ...request(), mode: 'internal', targetId: undefined },
				'administrator'
			);
			expect(targets.request).toHaveBeenCalledWith(
				expect.objectContaining({ id: created.id }),
				'provision'
			);
			await service.tick();
			await service.idle();
			expect(native.restore).not.toHaveBeenCalled();
			expect(service.get(created.id, 'administrator').stage).toBe('provisioning-container');
			ready = true;
			await service.tick();
			await service.idle();
			const retained = service.get(created.id, 'administrator');
			expect(retained.status).toBe('active');
			expect(db.store.lease(created.id)?.state).toBe('validated');
			await service.tick();
			await service.idle();
			expect(native.removeOwned).not.toHaveBeenCalled();
			expect(retained.lifecycle).toMatchObject({
				mode: 'automatic',
				state: 'ready',
				quotaBytes: 2147483648,
			});
			expect(JSON.stringify(retained)).not.toContain(target.target.password);
			expect(JSON.stringify(retained)).not.toContain(db.store.get(created.id)!.ownerToken);
			unsafe = true;
			await service.tick();
			await service.idle();
			expect(service.get(created.id, 'administrator').status).toBe('cleanup_required');
			await expect(service.inspect(created.id, 'administrator')).rejects.toThrow(
				'restore-access-not-active'
			);
			expect(native.removeOwned).not.toHaveBeenCalled();
			unsafe = false;
			await service.tick();
			await service.idle();
			expect(service.get(created.id, 'administrator').status).toBe('active');
			expect(native.restore).toHaveBeenCalledTimes(1);
		}
	);
	it('keeps a verified restore active with durable completion, exact source identity and safe view', async () => {
		const id = await run(),
			result = service.get(id, 'administrator');
		expect(result).toMatchObject({
			status: 'active',
			engine: 'mysql',
			snapshotId: item.snapshotId,
			databaseId: item.databaseId,
			backupId: item.backupId,
		});
		expect(result.completedAt).toBeGreaterThan(0);
		expect(db.store.lease(id)?.state).toBe('validated');
		expect(native.removeOwned).not.toHaveBeenCalled();
		expect(JSON.stringify(result)).not.toContain(target.target.password);
		await service.tick();
		await service.idle();
		expect(service.get(id, 'administrator').status).toBe('active');
	});
	it('fresh Internal refusal commits no restore or provisioning request even after acknowledgement', async () => {
		jest.spyOn(MysqlWorkerConnection.prototype, 'internalReady').mockResolvedValue(true);
		targets.automatic = {
			capability: async () => ({ available: true, engines: ['mariadb', 'postgresql', 'mysql'] }),
			assertAvailable: jest.fn(),
		};
		targets.request = jest.fn();
		targets.resourceView = async () => ({
			status: 'measured',
			sample: {
				operatorObservedAt: Date.now(),
				cpuAvailable: 1,
				total: 8192 * 1024 ** 2,
				available: 2800 * 1024 ** 2,
				swapUsed: 0,
				pressure: 0,
				limit: 1024 * 1024 ** 2,
				used: 128 * 1024 ** 2,
				cgroupSwap: 0,
				diskAvailable: 10 * 1024 ** 3,
			},
			observedAt: Date.now(),
		});
		await expect(
			service.create({ ...request(), mode: 'internal', targetId: undefined }, 'administrator')
		).rejects.toThrow('resource-host-memory-headroom');
		expect(db.store.list()).toHaveLength(0);
		expect(targets.request).not.toHaveBeenCalled();
		expect(native.restore).not.toHaveBeenCalled();
	});
	it('resource-refused Resume preserves a validated stopped database, lease and owner without cleanup', async () => {
		target.mode = item.mode = 'internal';
		item.status = 'importing';
		db.store.create(item);
		db.store.bind(item.id, target);
		db.store.addLease({
			restoreId: item.id,
			targetId: target.id,
			database: 'example_db',
			ownerToken: item.ownerToken,
			state: 'validated',
		});
		db.store.update(item.id, { status: 'stopped' });
		targets.request = jest.fn();
		targets.resourceView = async () => ({
			status: 'unknown',
			sample: null,
			observedAt: Date.now(),
		});
		await expect(service.operator(item.id, 'administrator', 'resume')).rejects.toThrow(
			'resource-capacity-unknown'
		);
		expect(db.store.get(item.id)).toMatchObject({
			status: 'stopped',
			ownerToken: item.ownerToken,
			cancelRequested: false,
		});
		expect(db.store.lease(item.id)?.state).toBe('validated');
		expect(targets.request).not.toHaveBeenCalled();
		expect(native.removeOwned).not.toHaveBeenCalled();
	});
	it.each(['mariadb', 'postgresql', 'mysql'] as const)(
		'%s verified Stopped after a consumed-before-Start failure permits only a fresh explicit Resume',
		async engine => {
			target.engine = target.target.engine = item.artifact.engine = engine;
			target.mode = item.mode = 'internal';
			target.id = item.targetId = item.id;
			item.status = 'importing';
			db.store.create(item);
			db.store.bind(item.id, target);
			db.store.addLease({
				restoreId: item.id,
				targetId: item.id,
				database: 'example_db',
				ownerToken: item.ownerToken,
				state: 'validated',
			});
			db.store.update(item.id, { status: 'stopped', completedAt: Date.now() });
			let state = 'cleanup-required';
			targets.automatic = {
				record: () => ({ state, action: 'resume' }),
				persistent: jest.fn(),
				receipt: async () => ({
					state,
					code: state === 'cleanup-required' ? 'resource-admission-refused' : null,
					observedAt: Date.now(),
				}),
			};
			targets.state = async () => ({ state: 'stopped', observedAt: Date.now() });
			targets.request = jest.fn();
			targets.resourceView = async () => ({
				status: 'measured',
				sample: {
					total: 8192 * 1024 ** 2,
					available: 4096 * 1024 ** 2,
					swapUsed: 0,
					pressure: 0,
					limit: 1536 * 1024 ** 2,
					used: 128 * 1024 ** 2,
					cgroupSwap: 0,
					diskAvailable: 10 * 1024 ** 3,
					cpuAvailable: 2,
					operatorObservedAt: Date.now(),
					operatorAvailable: 4096 * 1024 ** 2,
					operatorTotal: 8192 * 1024 ** 2,
					operatorCpuAvailable: 4,
					operatorDiskAvailable: 10 * 1024 ** 3,
				},
			});
			await service.tick();
			expect(db.store.get(item.id)?.status).toBe('cleanup_required');
			state = 'stopped';
			await service.tick();
			await service.idle();
			expect(db.store.get(item.id)).toMatchObject({
				status: 'stopped',
				cleanup: 'none',
				cancelRequested: false,
			});
			expect(targets.request).not.toHaveBeenCalled();
			expect(native.restore).not.toHaveBeenCalled();
			expect(native.removeOwned).not.toHaveBeenCalled();
			await service.operator(item.id, 'administrator', 'resume');
			expect(targets.request).toHaveBeenCalledWith(
				expect.objectContaining({ id: item.id }),
				'resume'
			);
			expect(db.store.lease(item.id)?.state).toBe('validated');
		}
	);
	it.each([
		'missing-lease',
		'unvalidated-lease',
		'wrong-owner',
		'stale-receipt',
		'wrong-state',
		'bad-binding',
	])('host recovery remains fail-closed for %s', async fault => {
		target.mode = item.mode = 'internal';
		target.id = item.targetId = item.id;
		item.status = 'importing';
		db.store.create(item);
		db.store.bind(item.id, target);
		db.store.addLease({
			restoreId: item.id,
			targetId: item.id,
			database: 'example_db',
			ownerToken: item.ownerToken,
			state: 'validated',
		});
		db.store.update(item.id, {
			status: 'cleanup_required',
			stage: 'host-ownership-unverified',
			cleanup: 'uncertain',
			completedAt: Date.now(),
		});
		if (fault === 'missing-lease') db.store.removeLease(item.id);
		if (fault === 'unvalidated-lease') db.store.leaseState(item.id, 'created');
		if (fault === 'wrong-owner')
			db.sqlite
				.prepare(
					"UPDATE persistent_restore_import_leases SET owner_token='different-synthetic-owner'"
				)
				.run();
		targets.automatic = {
			record: () => ({ state: 'stopped', action: 'resume' }),
			persistent: jest.fn(),
			receipt: async () => ({
				state: 'stopped',
				observedAt: Date.now() - (fault === 'stale-receipt' ? 31000 : 0),
			}),
		};
		targets.state = async () => ({ state: fault === 'wrong-state' ? 'active' : 'stopped' });
		if (fault === 'bad-binding')
			targets.assertBinding = async () => {
				throw new DatabaseRestoreError('target-binding-mismatch');
			};
		await service.tick();
		await service.idle();
		expect(db.store.get(item.id)?.status).toBe('cleanup_required');
		await expect(service.operator(item.id, 'administrator', 'resume')).rejects.toThrow(
			'operator-action-not-allowed'
		);
		expect(native.restore).not.toHaveBeenCalled();
		expect(native.removeOwned).not.toHaveBeenCalled();
	});
	it('Delete requested while binding recovery awaits host state cannot be overwritten with Stopped', async () => {
		target.mode = item.mode = 'internal';
		target.id = item.targetId = item.id;
		item.status = 'importing';
		db.store.create(item);
		db.store.bind(item.id, target);
		db.store.addLease({
			restoreId: item.id,
			targetId: item.id,
			database: 'example_db',
			ownerToken: item.ownerToken,
			state: 'validated',
		});
		db.store.update(item.id, {
			status: 'cleanup_required',
			stage: 'host-ownership-unverified',
			cleanup: 'uncertain',
			completedAt: Date.now(),
		});
		targets.automatic = {
			record: () => ({ state: 'stopped', action: 'resume' }),
			persistent: jest.fn(),
			receipt: async () => ({ state: 'stopped', observedAt: Date.now() }),
		};
		targets.state = async () => {
			db.store.requestDelete(item.id);
			return { state: 'stopped' };
		};
		await service.tick();
		expect(db.store.get(item.id)).toMatchObject({
			status: 'cleanup_required',
			cancelRequested: true,
			cleanup: 'requested',
		});
		expect(native.restore).not.toHaveBeenCalled();
		expect(native.removeOwned).not.toHaveBeenCalled();
	});
	it('0014 preserves pre-existing encrypted approvals, source bindings, leases and 0013 index', async () => {
		db.store.create(item);
		db.store.bind(item.id, target);
		const before = db.store.get(item.id)!;
		// Reconstruct the pre-0014 schema ONLY in this disposable in-memory fixture.
		db.sqlite.exec(
			'ALTER TABLE persistent_database_restores DROP COLUMN completed_at; ALTER TABLE persistent_database_restores DROP COLUMN failure_stage; ALTER TABLE persistent_database_restores DROP COLUMN failure_code;'
		);
		db.sqlite.exec(
			await fs.readFile(
				path.join(process.cwd(), 'drizzle/0014_persistent_restore_outcomes.sql'),
				'utf8'
			)
		);
		const after = db.store.get(item.id)!;
		expect(after).toEqual({ ...before, completedAt: null, failureStage: null, failureCode: null });
		expect(after.encryptedApproval).toBe(before.encryptedApproval);
		expect(
			db.sqlite
				.prepare("SELECT name FROM sqlite_master WHERE name='backups_plan_history_date_idx'")
				.get()
		).toBeTruthy();
		expect(() =>
			db.sqlite
				.prepare('UPDATE persistent_database_restores SET snapshot_id=? WHERE id=?')
				.run('f'.repeat(64), item.id)
		).toThrow();
	});
	it('only advertises custom MySQL when enabled; Internal and unconfigured requests fail before reservation', async () => {
		expect(
			(
				await service.preview({
					planId: item.planId,
					backupId: item.backupId,
					snapshotId: item.snapshotId,
				})
			).engines.mysql
		).toEqual(['custom']);
		await expect(
			service.create({ ...request(), mode: 'internal' }, 'administrator')
		).rejects.toMatchObject({ code: 'mysql-internal-unavailable' });
		delete process.env.PLUTON_MYSQL_WORKER;
		await expect(service.create(request(), 'administrator')).rejects.toMatchObject({
			code: 'mysql-worker-not-configured',
		});
		expect(db.store.list()).toHaveLength(0);
	});
	it('rejects cross-engine and changed metadata without staging or modifying target', async () => {
		await expect(
			service.create({ ...request(), metadataToken: '0'.repeat(64) }, 'administrator')
		).rejects.toMatchObject({ code: 'snapshot-metadata-changed' });
		target.engine = target.target.engine = 'mariadb';
		await expect(service.create(request(), 'administrator')).rejects.toMatchObject({
			code: 'target-binding-mismatch',
		});
		expect(recovery.databaseRestoreArtifact).not.toHaveBeenCalled();
	});
	it('SQLite target reservation refuses concurrent reuse and retains encrypted credentials only', async () => {
		const first = await service.create(request(), 'administrator');
		await expect(service.create(request(), 'administrator')).rejects.toMatchObject({
			code: 'target-already-reserved',
		});
		expect(
			JSON.stringify(db.sqlite.prepare('SELECT * FROM persistent_database_restores').get())
		).not.toContain(target.target.password);
		expect(service.list('other-owner')).toEqual([]);
		expect(() => service.get(first.id, 'other-owner')).toThrow();
	});
	it('failed import never becomes active and original error survives failed cleanup', async () => {
		native.restore.mockRejectedValue(
			new RecoveryTestError('database-import', 'database-import-failed')
		);
		native.removeOwned.mockRejectedValue(new DatabaseRestoreError('restore-ownership-uncertain'));
		const id = await run();
		expect(service.get(id, 'administrator')).toMatchObject({
			status: 'cleanup_required',
			completedAt: null,
			failureStage: 'database-import',
			failureCode: 'database-import-failed',
			errorCode: 'restore-ownership-uncertain',
		});
	});
	it('SQL mismatch is rejected before worker import, with artifact stage preserved', async () => {
		recovery.databaseRestoreArtifact.mockImplementation(async (_binding, directory) => {
			await fs.mkdir(path.join(directory, 'pluton/database'), { recursive: true });
			await fs.writeFile(
				path.join(directory, 'pluton/database/db_example.sql'),
				sql.replace('fixture_entries', 'fixture_invalid')
			);
		});
		const id = await run();
		expect(service.get(id, 'administrator').failureStage).toBe('database-artifact-validation');
		expect(native.restore).not.toHaveBeenCalled();
	});
	it.each(['mysql', 'mariadb', 'postgresql'])(
		'%s expiry preserves blocked source ownership, then exact-ID deletion cleans only owned data',
		async engine => {
			target.engine = target.target.engine = item.artifact.engine = engine;
			item.metadataToken = recoveryMetadataToken({
				planId: item.planId,
				backupId: item.backupId,
				snapshotId: item.snapshotId,
				repositoryId: item.repositoryId,
				databases: [item.artifact],
			});
			const id = await run();
			const sourcePlans = new PlanStore(drizzle(db.sqlite) as any);
			const lease = db.store.lease(id),
				before = db.store.get(id);
			await expect(sourcePlans.delete(item.planId, true)).rejects.toHaveProperty('statusCode', 409);
			expect(db.store.get(id)).toEqual(before);
			expect(db.store.lease(id)).toEqual(lease);
			db.store.update(id, { expiresAt: Date.now() - 1 });
			await expect(service.inspect(id, 'administrator')).rejects.toMatchObject({
				code: 'restore-access-not-active',
			});
			await service.tick();
			await service.idle();
			expect(service.get(id, 'administrator').status).toBe('deleted');
			expect(db.store.lease(id)).toBeNull();
			await service.delete(id, 'administrator', { confirmation: id });
			expect(native.removeOwned).toHaveBeenCalledTimes(1);
			expect(db.store.list()).toHaveLength(1);
		}
	);
	it('interrupted imports recover to ownership-checked cleanup, never resumed as success', async () => {
		const saved = await service.create(request(), 'administrator');
		db.store.claim(saved.id);
		await service.recoverInterrupted();
		await service.idle();
		expect(service.get(saved.id, 'administrator')).toMatchObject({
			status: 'deleted',
			errorCode: 'interrupted',
			completedAt: null,
		});
		expect(native.restore).not.toHaveBeenCalled();
	});
	it('shutdown of metadata-only inspection preserves a completed retained database', async () => {
		const id = await run();
		let entered!: () => void;
		const started = new Promise<void>(resolve => {
			entered = resolve;
		});
		native.inspect.mockImplementation(
			async (_row: unknown, _directory: unknown, signal: AbortSignal) => {
				entered();
				await new Promise<void>(resolve =>
					signal.addEventListener('abort', () => resolve(), { once: true })
				);
				throw new RecoveryTestError('database-import-validation', 'cancelled');
			}
		);
		const inspection = service.inspect(id, 'administrator');
		const refusal = expect(inspection).rejects.toMatchObject({ code: 'cancelled' });
		await started;
		await service.shutdown();
		await refusal;
		expect(service.get(id, 'administrator').status).toBe('active');
		expect(service.get(id, 'administrator').cancelRequested).toBe(false);
		expect(db.store.lease(id)?.state).toBe('validated');
		expect(native.removeOwned).not.toHaveBeenCalled();
	});
});
