import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import Cryptr from 'cryptr';
import { randomBytes } from 'node:crypto';
import * as planSchema from '../../src/db/schema/plans';
import * as backupSchema from '../../src/db/schema/backups';
import * as restoreSchema from '../../src/db/schema/restores';
import * as storageSchema from '../../src/db/schema/storages';
import * as deviceSchema from '../../src/db/schema/devices';
import { legacyRepositories } from '../../src/db/schema/legacyRepositories';
import { PlanStore } from '../../src/stores/PlanStore';
import { BackupStore } from '../../src/stores/BackupStore';
import { RestoreStore } from '../../src/stores/RestoreStore';
import { StorageStore } from '../../src/stores/StorageStore';
import { DeviceStore } from '../../src/stores/DeviceStore';
import { PlanService } from '../../src/services/PlanService';
import { PlanController } from '../../src/controllers/PlanController';
import { createPlanRouter } from '../../src/routes/plans';
import { configService } from '../../src/services/ConfigService';
import { webAccess } from '../../src/middlewares/webAccess';
import { assertStorageRemovalScope } from '../../src/utils/storageRemovalScope';
import { remoteManagedRepositories } from '../../src/db/schema/remoteManagedRepositories';
import { agentIdentities } from '../../src/db/schema/agents';

describe('selected-resource deletion with real SQLite stores and HTTP route', () => {
	let sqlite: Database.Database;
	let db: ReturnType<typeof drizzle>;
	let service: PlanService;
	let manager: {
		removeBackup: jest.Mock;
		removeReplicationStorage: jest.Mock;
		updateBackup: jest.Mock;
	};
	let app: express.Express;
	const replica = {
		replicationId: 'replica-a',
		storageId: 'storage-a',
		storagePath: '/synthetic/replica-a',
	};
	const plan = (id: string, storagePath: string) => ({
		id,
		title: id,
		sourceId: 'main',
		sourceType: 'device',
		method: 'backup',
		storageId: 'storage-a',
		storagePath,
		sourceConfig: { includes: ['/synthetic/source'], excludes: [] },
		settings: {
			interval: { type: 'daily', time: '10:00AM' },
			encryption: true,
			replication: { enabled: true, concurrent: false, storages: [replica] },
		},
	});
	beforeEach(() => {
		sqlite = new Database(':memory:');
		db = drizzle(sqlite, {
			schema: {
				...planSchema,
				...backupSchema,
				...restoreSchema,
				...storageSchema,
				...deviceSchema,
				legacyRepositories,
			},
		});
		migrate(db, { migrationsFolder: './drizzle' });
		db.insert(storageSchema.storages)
			.values({ id: 'storage-a', name: 'Local', type: 'local' })
			.run();
		db.insert(deviceSchema.devices).values({ id: 'main', name: 'Synthetic host' }).run();
		db.insert(planSchema.plans)
			.values([
				plan('plan-a', '/synthetic/a'),
				{ ...plan('plan-b', '/synthetic/b'), settings: { encryption: true } },
			] as any)
			.run();
		db.insert(backupSchema.backups)
			.values(
				['a', 'b'].map(id => ({
					id: 'backup-' + id,
					planId: 'plan-' + id,
					sourceId: 'main',
					method: 'backup',
					storageId: 'storage-a',
					storagePath: '/synthetic/' + id,
				}))
			)
			.run();
		manager = {
			removeBackup: jest.fn().mockResolvedValue({ success: true, result: 'Removed' }),
			removeReplicationStorage: jest.fn().mockResolvedValue({ success: true, result: 'Removed' }),
			updateBackup: jest.fn().mockResolvedValue({ success: true }),
		};
		service = new PlanService(
			manager as any,
			new PlanStore(db as any),
			new BackupStore(db as any),
			new StorageStore(db as any),
			new DeviceStore(db as any),
			new RestoreStore(db as any)
		);
		app = express();
		app.use(express.json());
		app.use(webAccess({ canonical: 'http://localhost:5173', origins: ['http://localhost:5173'] }));
		app.use('/api/plans', createPlanRouter(new PlanController(service)));
	});
	afterEach(() => sqlite.close());
	const remove = (query = '') =>
		request(app)
			.delete('/api/plans/plan-a' + query)
			.set('Host', 'localhost:5173')
			.set('Origin', 'http://localhost:5173')
			.set('Cookie', 'token=' + jwt.sign({ user: 'synthetic-user' }, configService.config.SECRET!));
	const rows = () => ({
		plans: sqlite.prepare('SELECT id FROM plans ORDER BY id').pluck().all(),
		backups: sqlite.prepare('SELECT id FROM backups ORDER BY id').pluck().all(),
	});
	function seedRepository() {
		const key = randomBytes(32).toString('hex');
		const password = randomBytes(32).toString('hex');
		const ciphertext = new Cryptr(key).encrypt(password);
		db.insert(agentIdentities).values({ agentId: 'agent-a', deviceId: 'main', encryptedSecret: ciphertext,
			hostname: 'app-01', os: 'linux', architecture: 'x64', agentVersion: '0.4.0', capabilities: {} }).run();
		db.insert(remoteManagedRepositories).values({ id: 'repo-a', planId: 'plan-a', agentId: 'agent-a',
			storageId: 'storage-a', storagePath: '/synthetic/a', encryptedPassword: ciphertext }).run();
		return { key, password, ciphertext };
	}
	it('atomically archives original ciphertext/binding and never exposes it in the DELETE response', async () => {
		const { key, password, ciphertext } = seedRepository();
		const response = await remove('?removeData=false');
		expect(response.status).toBe(200);
		const archive = sqlite.prepare('SELECT * FROM retained_managed_repositories').get() as any;
		expect(archive).toMatchObject({ id: 'repo-a', former_plan_id: 'plan-a', agent_id: 'agent-a',
			storage_id: 'storage-a', storage_path: '/synthetic/a', encrypted_password: ciphertext });
		expect(new Cryptr(key).decrypt(archive.encrypted_password) === password).toBe(true);
		expect(response.text.includes(password) || response.text.includes(ciphertext)).toBe(false);
		expect(sqlite.prepare('SELECT count(*) FROM remote_managed_repositories').pluck().get()).toBe(0);
		const references = await new PlanStore(db as any).getStorageRemovalReferences();
		expect(() => assertStorageRemovalScope({ storageId: 'storage-a', storagePath: '/synthetic/a', local: true }, references,
			{ planId: 'plan-b', kind: 'plan' })).toThrow('overlaps');
	});
	it.each(['archive', 'plan'])('failed %s write rolls back all credential/history removal', async stage => {
		const { ciphertext } = seedRepository();
		const trigger = stage === 'archive'
			? "CREATE TRIGGER block_archive BEFORE INSERT ON retained_managed_repositories BEGIN SELECT RAISE(ABORT,'synthetic archive failure'); END"
			: "CREATE TRIGGER block_plan BEFORE DELETE ON plans BEGIN SELECT RAISE(ABORT,'synthetic plan failure'); END";
		sqlite.exec(trigger);
		expect((await remove('?removeData=false')).status).toBe(500);
		expect(rows()).toEqual({ plans: ['plan-a', 'plan-b'], backups: ['backup-a', 'backup-b'] });
		expect(sqlite.prepare('SELECT encrypted_password FROM remote_managed_repositories').pluck().get() === ciphertext).toBe(true);
		expect(sqlite.prepare('SELECT count(*) FROM retained_managed_repositories').pluck().get()).toBe(0);
	});
	it.each([false, true])('managed Agent retention is typed, never calls purge, and escrows credentials (removeData=%s)', async removeData => {
		seedRepository();
		sqlite.prepare("UPDATE plans SET source_id='remote-device' WHERE id='plan-a'").run();
		const remote = { removeManagedPlan: jest.fn().mockResolvedValue({ storagePath: '/synthetic/a' }) };
		const remoteService = new PlanService(manager as any, new PlanStore(db as any), new BackupStore(db as any),
			new StorageStore(db as any), new DeviceStore(db as any), new RestoreStore(db as any), remote as any);
		const result = await remoteService.deletePlan('plan-a', removeData);
		expect(result.storageDisposition.status).toBe('retained_intentionally');
		expect(manager.removeBackup).not.toHaveBeenCalled();
		expect(sqlite.prepare('SELECT count(*) FROM retained_managed_repositories').pluck().get()).toBe(1);
	});
	it('an existing archive cannot be overwritten or used to discard a different live credential', async () => {
		const { ciphertext } = seedRepository();
		sqlite.exec("INSERT INTO retained_managed_repositories (id,former_plan_id,agent_id,storage_id,storage_path,encrypted_password,repository_created_at) SELECT id,plan_id,agent_id,storage_id,storage_path,encrypted_password,created_at FROM remote_managed_repositories");
		const response = await remove('?removeData=false');
		expect(response.status).toBe(500);
		expect(response.body.error).toBe('Retained repository access could not be archived safely. Plan removal was not completed.');
		expect(response.text.includes(ciphertext)).toBe(false);
		expect(rows().plans).toEqual(['plan-a', 'plan-b']);
		expect(sqlite.prepare('SELECT encrypted_password FROM remote_managed_repositories').pluck().get() === ciphertext).toBe(true);
	});
	it('preserves encrypted escrow with foreign keys enabled and completed recovery history', async () => {
		seedRepository();
		const snapshot = 'a'.repeat(64);
		sqlite.prepare("UPDATE backups SET status='completed',in_progress=0,completion_stats=? WHERE id='backup-a'").run(JSON.stringify({ snapshot_id: snapshot }));
		sqlite.prepare("INSERT INTO recovery_tests (id,plan_id,backup_id,repository_id,snapshot_id,status,trigger,policy) VALUES ('test-a','plan-a','backup-a','repo-a',?,'passed','manual','{}')").run(snapshot);
		sqlite.pragma('foreign_keys=ON');
		expect(await new PlanStore(db as any).delete('plan-a', true)).toBe(true);
		expect(sqlite.prepare('SELECT count(*) FROM retained_managed_repositories').pluck().get()).toBe(1);
		expect(sqlite.prepare('SELECT count(*) FROM recovery_tests').pluck().get()).toBe(0);
		expect(sqlite.pragma('foreign_key_check')).toEqual([]);
	});
	it.each(['local', 'sftp', 'amazons3'])('standard %s storage keeps selected scope and typed cleanup outcomes', async type => {
		sqlite.prepare('UPDATE storages SET type=? WHERE id=?').run(type, 'storage-a');
		manager.removeBackup.mockResolvedValue({ success: true, unremovedPaths: [{ storageName: 'Local', storagePath: '/synthetic/a' }] });
		const response = await remove('?removeData=true');
		expect(response.status).toBe(200);
		expect(response.body.storageDisposition.status).toBe('cleanup_failed');
		expect(manager.removeBackup).toHaveBeenCalledWith('plan-a', expect.objectContaining({ storagePath: '/synthetic/a', removeRemoteData: true }));
	});
	it.each([false, true])(
		'removeData=%s only removes the selected plan and history',
		async removeData => {
			const response = await remove('?removeData=' + removeData);
			expect(response.status).toBe(200);
			expect(response.type).toBe('application/json');
			expect(response.body.success).toBe(true);
			expect(manager.removeBackup).toHaveBeenCalledWith(
				'plan-a',
				expect.objectContaining({ removeRemoteData: removeData })
			);
			expect(rows()).toEqual({ plans: ['plan-b'], backups: ['backup-b'] });
			expect((await remove('?removeData=' + removeData)).status).toBe(404);
			expect(manager.removeBackup).toHaveBeenCalledTimes(1);
		}
	);
	it('retains all metadata and never purges on execution failure', async () => {
		manager.removeBackup.mockResolvedValue({ success: false, result: 'Synthetic failure' });
		expect((await remove('?removeData=true')).status).toBe(500);
		expect(rows()).toEqual({ plans: ['plan-a', 'plan-b'], backups: ['backup-a', 'backup-b'] });
	});
	it('rolls back history deletion if the final plan row cannot be removed', async () => {
		sqlite.exec(
			"CREATE TRIGGER deny_plan_removal BEFORE DELETE ON plans WHEN OLD.id='plan-a' BEGIN SELECT RAISE(ABORT, 'synthetic removal failure'); END"
		);
		expect((await remove('?removeData=false')).status).toBe(500);
		expect(rows()).toEqual({ plans: ['plan-a', 'plan-b'], backups: ['backup-a', 'backup-b'] });
	});
	it('surfaces partial storage cleanup without claiming the data was erased', async () => {
		manager.removeBackup.mockResolvedValue({
			success: true,
			result: 'Removed schedule',
			unremovedPaths: [{ storageName: 'local', storagePath: '/synthetic/a' }],
			unremovedReason: 'Storage unavailable',
		});
		const response = await remove('?removeData=true');
		expect(response.status).toBe(200);
		expect(response.body.unremovedPaths).toHaveLength(1);
		expect(response.body.unremovedReason).toBe('Storage unavailable');
		expect(rows()).toEqual({ plans: ['plan-b'], backups: ['backup-b'] });
	});
	it.each(['plan', 'snapshot', 'legacy'])(
		'blocks overlapping retained %s before schedule or metadata changes',
		async kind => {
			if (kind === 'plan')
				sqlite
					.prepare('UPDATE plans SET storage_path=? WHERE id=?')
					.run('/synthetic/a/child', 'plan-b');
			if (kind === 'snapshot')
				sqlite
					.prepare('UPDATE backups SET storage_path=? WHERE id=?')
					.run('/synthetic/a', 'backup-b');
			if (kind === 'legacy')
				db.insert(legacyRepositories)
					.values({
						id: 'legacy-a',
						displayName: 'Synthetic imported',
						repositoryPath: '/synthetic/a/imported',
						encryptedPassword: 'synthetic-unused',
					})
					.run();
			expect((await remove('?removeData=true')).status).toBe(409);
			expect(manager.removeBackup).not.toHaveBeenCalled();
			expect(rows()).toEqual({ plans: ['plan-a', 'plan-b'], backups: ['backup-a', 'backup-b'] });
			// Metadata-only removal remains possible and explicitly retains all repository bytes.
			expect((await remove('?removeData=false')).status).toBe(200);
		}
	);
	it.each(['backup', 'restore'])('refuses deletion during active %s', async kind => {
		if (kind === 'backup')
			sqlite.prepare('UPDATE backups SET in_progress=1 WHERE id=?').run('backup-a');
		else
			db.insert(restoreSchema.restores)
				.values({
					id: 'restore-a',
					planId: 'plan-a',
					backupId: 'backup-a',
					sourceId: 'main',
					method: 'backup',
					inProgress: true,
					config: {},
				} as any)
				.run();
		expect((await remove('?removeData=true')).status).toBe(409);
		expect(manager.removeBackup).not.toHaveBeenCalled();
	});
	it('rejects mismatched replica identity before any purge or settings mutation', async () => {
		await expect(
			service.deleteReplicationStorage(
				'plan-a',
				'storage-a',
				'/synthetic/b',
				true,
				replica.replicationId
			)
		).rejects.toHaveProperty('statusCode', 409);
		expect(manager.removeReplicationStorage).not.toHaveBeenCalled();
		expect(
			JSON.parse(
				sqlite.prepare('SELECT settings FROM plans WHERE id=?').pluck().get('plan-a') as string
			).replication.storages
		).toEqual([replica]);
	});
	it('purges only the matched stored replica and preserves primary and other-plan rows', async () => {
		await service.deleteReplicationStorage(
			'plan-a',
			replica.storageId,
			replica.storagePath,
			true,
			replica.replicationId
		);
		expect(manager.removeReplicationStorage).toHaveBeenCalledWith('plan-a', {
			storageName: 'local',
			storagePath: replica.storagePath,
			removeData: true,
		});
		expect(rows()).toEqual({ plans: ['plan-a', 'plan-b'], backups: ['backup-a', 'backup-b'] });
	});
	it('never purges for replica metadata-only removal', async () => {
		await service.deleteReplicationStorage(
			'plan-a',
			replica.storageId,
			replica.storagePath,
			false,
			replica.replicationId
		);
		expect(manager.removeReplicationStorage).not.toHaveBeenCalled();
	});
	it('refuses a legacy replica with missing identity even if its path matches', async () => {
		const settings = {
			encryption: true,
			replication: {
				enabled: true,
				storages: [{ storageId: replica.storageId, storagePath: '/synthetic/a' }],
			},
		};
		sqlite
			.prepare('UPDATE plans SET settings=? WHERE id=?')
			.run(JSON.stringify(settings), 'plan-a');
		await expect(
			service.deleteReplicationStorage('plan-a', replica.storageId, '/synthetic/a', true)
		).rejects.toHaveProperty('statusCode', 409);
		expect(manager.removeReplicationStorage).not.toHaveBeenCalled();
	});
	it('refuses replica data deletion overlapping its own retained primary', async () => {
		const settings = {
			encryption: true,
			replication: { enabled: true, storages: [{ ...replica, storagePath: '/synthetic/a' }] },
		};
		sqlite
			.prepare('UPDATE plans SET settings=? WHERE id=?')
			.run(JSON.stringify(settings), 'plan-a');
		await expect(
			service.deleteReplicationStorage(
				'plan-a',
				replica.storageId,
				'/synthetic/a',
				true,
				replica.replicationId
			)
		).rejects.toHaveProperty('statusCode', 409);
		expect(manager.removeReplicationStorage).not.toHaveBeenCalled();
	});
	it('rejects duplicate deletion and manual backup while removal is in flight', async () => {
		let finish!: (value: unknown) => void;
		manager.removeBackup.mockImplementation(
			() =>
				new Promise(resolve => {
					finish = resolve;
				})
		);
		const pending = service.deletePlan('plan-a', false);
		while (!finish) await new Promise(resolve => setImmediate(resolve));
		await expect(service.deletePlan('plan-a', true)).rejects.toHaveProperty('statusCode', 409);
		await expect(service.performBackup('plan-a')).rejects.toHaveProperty('statusCode', 409);
		finish({ success: true, result: 'Removed' });
		await pending;
		expect(manager.removeBackup).toHaveBeenCalledTimes(1);
	});
	it('preserves auth and same-origin rejection as JSON without mutation', async () => {
		const noAuth = await request(app)
			.delete('/api/plans/plan-a')
			.set('Host', 'localhost:5173')
			.set('Origin', 'http://localhost:5173');
		expect(noAuth.status).toBe(401);
		expect(noAuth.type).toBe('application/json');
		const crossOrigin = await remove().set('Origin', 'https://example.invalid');
		expect(crossOrigin.status).toBe(403);
		expect(crossOrigin.type).toBe('application/json');
		expect(manager.removeBackup).not.toHaveBeenCalled();
	});
	it('serves DELETE as JSON at the approved HTTPS origin over a private HTTP application hop', async () => {
		const proxied = express();
		proxied.use(express.json());
		proxied.use(webAccess({ canonical: 'https://example.internal', origins: ['https://example.internal'] }));
		proxied.use('/api/plans', createPlanRouter(new PlanController(service)));
		const response = await request(proxied).delete('/api/plans/plan-a?removeData=false')
			.set('Host', 'example.internal').set('Origin', 'https://example.internal')
			.set('X-Forwarded-Proto', 'https').set('X-Forwarded-Host', 'example.internal')
			.set('Cookie', 'token=' + jwt.sign({ user: 'synthetic-user' }, configService.config.SECRET!));
		expect(response.status).toBe(200);
		expect(response.type).toBe('application/json');
		expect(response.body.storageDisposition.status).toBe('retained_by_request');
		expect(manager.removeBackup).toHaveBeenCalledWith('plan-a', expect.objectContaining({ removeRemoteData: false }));
	});
	it('serves DELETE as JSON at the approved HTTPS origin over a private HTTP application hop', async () => {
		const proxied = express();
		proxied.use(express.json());
		proxied.use(webAccess({ canonical: 'https://example.internal', origins: ['https://example.internal'] }));
		proxied.use('/api/plans', createPlanRouter(new PlanController(service)));
		const response = await request(proxied).delete('/api/plans/plan-a?removeData=false')
			.set('Host', 'example.internal').set('Origin', 'https://example.internal')
			.set('X-Forwarded-Proto', 'https').set('X-Forwarded-Host', 'example.internal')
			.set('Cookie', 'token=' + jwt.sign({ user: 'synthetic-user' }, configService.config.SECRET!));
		expect(response.status).toBe(200);
		expect(response.type).toBe('application/json');
		expect(response.body.storageDisposition.status).toBe('retained_by_request');
		expect(manager.removeBackup).toHaveBeenCalledWith('plan-a', expect.objectContaining({ removeRemoteData: false }));
	});
});

describe('whole-directory purge path boundaries', () => {
	it.each(['', '.', '/', 'C:\\', '../retained', '/synthetic/../retained'])(
		'refuses dangerous root/traversal %s',
		storagePath => {
			expect(() =>
				assertStorageRemovalScope({ storageId: 'storage-a', storagePath, local: true }, [], {
					planId: 'plan-a',
					kind: 'plan',
				})
			).toThrow();
		}
	);
	it.each(['/synthetic/a', '/synthetic/a/child', '/synthetic'])(
		'refuses equal or nested retained path %s',
		storagePath => {
			expect(() =>
				assertStorageRemovalScope(
					{ storageId: 'storage-a', storagePath: '/synthetic/a', local: true },
					[{ planId: 'plan-b', storageId: 'storage-a', storagePath, kind: 'primary' }],
					{ planId: 'plan-a', kind: 'plan' }
				)
			).toThrow();
		}
	);
	it('does not confuse a sibling prefix with a nested repository', () => {
		expect(() =>
			assertStorageRemovalScope(
				{ storageId: 'storage-a', storagePath: '/synthetic/a', local: true },
				[
					{
						planId: 'plan-b',
						storageId: 'storage-a',
						storagePath: '/synthetic/another',
						kind: 'primary',
					},
				],
				{ planId: 'plan-a', kind: 'plan' }
			)
		).not.toThrow();
	});
});
