import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { execFileSync } from 'child_process';
import Cryptr from 'cryptr';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { PlanStore } from '../../src/stores/PlanStore';
import { StorageStore } from '../../src/stores/StorageStore';
import { configService } from '../../src/services/ConfigService';
import { fixture } from '../integration/persistentRestore.fixture';
import {
	ManagedReplicationStore,
	type ManagedReplicationEnqueue,
} from '../../src/stores/ManagedReplicationStore';
import {
	configureReplicaScopeResolver,
	validateReplicationSettings,
} from '../../src/utils/managedReplicationPolicy';
import { s3RepositoryScope } from '../../src/utils/storageSecurity';

describe('managed replication durable source, destination and execution fences', () => {
	let context: ReturnType<typeof fixture>, store: ManagedReplicationStore;
	const destination = (patch = {}) => ({
		destinationFingerprint: 'f'.repeat(64),
		planId: 'plan-01',
		replicationId: 'mirror-01',
		sourceRepositoryId: 'repo-01',
		destinationStorageId: 'storage-02',
		destinationStoragePath: 'synthetic-bucket/pluton/fixture',
		destinationAuthority: 'https://s3.example.internal/synthetic-bucket',
		destinationPrefix: 'pluton/fixture',
		...patch,
	});
	const input = (patch: Partial<ManagedReplicationEnqueue> = {}): ManagedReplicationEnqueue => ({
		id: 'job-01',
		backupId: 'backup-01',
		planId: 'plan-01',
		repositoryId: 'repo-01',
		agentId: 'agent-01',
		sourceStorageId: 'storage-01',
		sourceStoragePath: 'managed/fixture',
		sourceSnapshotId: 'b'.repeat(64),
		sourceRepositoryConfigId: 'c'.repeat(64),
		sourceTreeId: 'd'.repeat(64),
		sourceBindingHash: 'e'.repeat(64),
		replicationId: 'mirror-01',
		destinationStorageId: 'storage-02',
		destinationStoragePath: destination().destinationStoragePath,
		destinationFingerprint: 'f'.repeat(64),
		createdAt: 1,
		...patch,
	});
	beforeEach(() => {
		configureReplicaScopeResolver(s3RepositoryScope);
		context = fixture();
		context.sqlite.exec(
			"UPDATE plans SET storage_path='managed/fixture'; UPDATE remote_managed_repositories SET initialized_at=1;"
		);
		store = new ManagedReplicationStore(context.sqlite);
		store.reserveDestination(destination());
	});
	afterEach(() => {
		configureReplicaScopeResolver(undefined);
		context.sqlite.close();
	});
	it('enqueues idempotently with immutable full binding; no credential payload', () => {
		const original = store.enqueue(input());
		expect(store.enqueue(input({ id: 'other-id', createdAt: 2 }))).toEqual(original);
		expect(() => store.enqueue(input({ sourceTreeId: 'a'.repeat(64) }))).toThrow('immutable');
		expect(Object.keys(original).some(key => /password|secret|credential/i.test(key))).toBe(false);
	});
	it.each(['sourceSnapshotId', 'repositoryId', 'agentId', 'sourceStoragePath'] as const)(
		'rejects mismatched %s before reservation',
		key => {
			expect(() => store.enqueue(input({ [key]: 'wrong-binding' }))).toThrow();
			expect(store.listRunnable()).toEqual([]);
		}
	);
	it.each([
		'UPDATE backups SET success=0',
		'UPDATE backups SET in_progress=1',
		"UPDATE backups SET status='failed'",
		"UPDATE agent_identities SET device_id='other-device'",
	])('refuses stale completion %s', sql => {
		// Invalid fixture mutation is contained in this disposable in-memory database.
		if (sql.includes('other-device'))
			context.sqlite.exec("INSERT INTO devices(id,name) VALUES('other-device','Other fixture')");
		context.sqlite.exec(sql);
		expect(() => store.enqueue(input())).toThrow();
	});
	it('never adopts aliases or overlapping retained prefixes', () => {
		expect(() =>
			store.reserveDestination(destination({ destinationStorageId: 'storage-alias' }))
		).toThrow('ownership');
		expect(() =>
			store.reserveDestination(
				destination({
					destinationFingerprint: 'a'.repeat(64),
					planId: 'plan-other',
					destinationPrefix: 'pluton',
					replicationId: 'other',
				})
			)
		).toThrow('overlaps');
		store.detach('plan-01');
		expect(() => store.reserveDestination(destination())).toThrow('ownership');
	});
	it('atomically refuses late standard primary/replica aliases and reverse reservations, retaining unrelated scopes', async () => {
		const cipher = new Cryptr(configService.config.SECRET);
		const credentials = (endpoint: string) => Object.fromEntries(Object.entries({
			endpoint, bucket: 'synthetic-bucket', access_key_id: 'synthetic-access', secret_access_key: 'synthetic-secret',
		}).map(([key, value]) => [key, cipher.encrypt(value)]));
		context.sqlite.prepare('INSERT INTO storages(id,name,type,credentials,settings) VALUES(?,?,?,?,?)')
			.run('alias-01', 'alias_01', 's3compatible', JSON.stringify(credentials('https://synthetic-bucket.s3.example.internal')), '{}');
		context.sqlite.exec("INSERT INTO devices(id,name) VALUES('main','Synthetic server')");
		const plans = new PlanStore(drizzle(context.sqlite) as any);
		const base: any = { id: 'standard-01', title: 'Synthetic standard plan', sourceId: 'main', sourceType: 'device', method: 'backup', sourceConfig: { includes: ['/srv/example-app'] }, storageId: 'alias-01', storagePath: 'synthetic-bucket/pluton/fixture/child', settings: {} };
		for (const storagePath of [base.storagePath, 'synthetic-bucket', ''])
			await expect(plans.create({ ...base, storagePath })).rejects.toMatchObject({ statusCode: 409 });
		expect(context.sqlite.prepare("SELECT 1 FROM plans WHERE id='standard-01'").get()).toBeUndefined();
		await plans.create({ ...base, storagePath: 'synthetic-bucket/unrelated' });
		await expect(plans.update(base.id, { settings: { replication: { enabled: true, storages: [{ replicationId: 'legacy-01', storageId: 'alias-01', storagePath: 'synthetic-bucket/pluton/fixture' }] } } } as any)).rejects.toMatchObject({ statusCode: 409 });
		expect(() => store.reserveDestination(destination({ replicationId: 'mirror-02', destinationFingerprint: 'a'.repeat(64), destinationPrefix: 'unrelated', destinationStoragePath: 'synthetic-bucket/unrelated' }))).toThrow(expect.objectContaining({ statusCode: 409 }));
		store.detach('plan-01');
		await expect(plans.create({ ...base, id: 'standard-02' })).rejects.toMatchObject({ statusCode: 409 });
		expect(JSON.parse((context.sqlite.prepare('SELECT settings FROM plans WHERE id=?').get(base.id) as any).settings)).toEqual({});
	});
	it('refuses redirecting an existing standard storage alias into a retained repository', async () => {
		const cipher = new Cryptr(configService.config.SECRET);
		const credentials = (endpoint: string) => Object.fromEntries(Object.entries({ endpoint, bucket: 'synthetic-bucket', access_key_id: 'synthetic-access', secret_access_key: 'synthetic-secret' }).map(([key, value]) => [key, cipher.encrypt(value)]));
		const original = JSON.stringify(credentials('https://other.example.internal'));
		context.sqlite.prepare('INSERT INTO storages(id,name,type,credentials,settings) VALUES(?,?,?,?,?)').run('alias-01', 'alias_01', 's3compatible', original, '{}');
		context.sqlite.exec("INSERT INTO plans(id,title,source_id,source_type,method,storage_id,storage_path,source_config,settings) VALUES('standard-01','Synthetic plan','app-01','device','backup','alias-01','synthetic-bucket/pluton/fixture','{}','{}')");
		const storages = new StorageStore(drizzle(context.sqlite) as any);
		await expect(storages.update('alias-01', { credentials: credentials('https://s3.example.internal') })).rejects.toMatchObject({ statusCode: 409 });
		expect((context.sqlite.prepare("SELECT credentials FROM storages WHERE id='alias-01'").get() as any).credentials).toBe(original);
	});
	it('fails closed before writing a plan when protected scope verification is unavailable', async () => {
		context.sqlite.exec("INSERT INTO storages(id,name,type) VALUES('alias-01','Synthetic S3','s3compatible')");
		configureReplicaScopeResolver(undefined);
		const plans = new PlanStore(drizzle(context.sqlite) as any);
		await expect(plans.create({
			id: 'standard-01', title: 'Synthetic plan', sourceId: 'app-01',
			method: 'backup', sourceType: 'device', sourceConfig: {}, settings: {},
			storageId: 'alias-01', storagePath: 'synthetic-bucket/pluton/fixture',
		} as any)).rejects.toMatchObject({ statusCode: 503 });
		expect(context.sqlite.prepare("SELECT 1 FROM plans WHERE id='standard-01'").get()).toBeUndefined();
		expect(store.getDestination('f'.repeat(64))?.initState).toBe('uninitialized');
	});
	it('persists initialization intent before side effects and requires claim ownership', () => {
		store.enqueue(input());
		const token = 'a'.repeat(64);
		expect(store.beginInitialization('f'.repeat(64), token)).toBe(false);
		expect(store.claim('job-01', token)?.status).toBe('running');
		expect(store.beginInitialization('f'.repeat(64), token)).toBe(true);
		expect(store.getDestination('f'.repeat(64))?.initState).toBe('initializing');
		expect(store.finalizeInitialization('f'.repeat(64), 'b'.repeat(64), 'c'.repeat(64))).toBe(
			false
		);
		expect(store.finalizeInitialization('f'.repeat(64), token, 'c'.repeat(64))).toBe(true);
		expect(store.getDestination('f'.repeat(64))?.actualRepositoryId).toBe('c'.repeat(64));
	});
	it('completed receipt is owner-bound, full-snapshot verified, and never changes primary success', () => {
		store.enqueue(input());
		const token = 'a'.repeat(64);
		store.claim('job-01', token);
		expect(() => store.finish('job-01', token, { status: 'completed' })).toThrow();
		expect(
			store.finish('job-01', 'b'.repeat(64), { status: 'failed', failureCode: 'denied' })
		).toBe(false);
		expect(
			store.finish('job-01', token, { status: 'failed', failureCode: 'retention-denied' })
		).toBe(true);
		expect(context.sqlite.prepare('SELECT success FROM backups').pluck().get()).toBe(1);
		expect(store.listRunnable()).toEqual([]);
		expect(store.retry('job-01')).toBe(true);
		expect(store.claim('job-01', token)?.attempts).toBe(2);
	});
	it('restart retains uncertain execution slot, preventing replay or concurrent deletion', () => {
		store.enqueue(input());
		store.claim('job-01', 'a'.repeat(64));
		store.markInterrupted();
		const restarted = new ManagedReplicationStore(context.sqlite);
		expect(restarted.getById('job-01')?.status).toBe('uncertain');
		expect(() => restarted.retry('job-01')).toThrow('Uncertain');
		expect(restarted.claim('job-01', 'b'.repeat(64))).toBeNull();
		expect(() => context.sqlite.prepare("DELETE FROM plans WHERE id='plan-01'").run()).toThrow(
			'MANAGED_REPLICATION_BUSY'
		);
		expect(() => context.sqlite.prepare("DELETE FROM backups WHERE id='backup-01'").run()).toThrow(
			'MANAGED_REPLICATION_BUSY'
		);
		expect(() =>
			context.sqlite.prepare("UPDATE plans SET settings='{}' WHERE id='plan-01'").run()
		).toThrow('MANAGED_REPLICATION_BUSY');
		expect(() =>
			context.sqlite.prepare("UPDATE storages SET credentials='{}' WHERE id='storage-01'").run()
		).toThrow('MANAGED_REPLICATION_BUSY');
	});
	it('bounded reconciliation does not hot-loop a refused second destination', () => {
		context.sqlite
			.prepare('UPDATE plans SET settings=?')
			.run(
				JSON.stringify({
					replication: {
						enabled: true,
						storages: [{ replicationId: 'mirror-01' }, { replicationId: 'mirror-02' }],
					},
				})
			);
		store.enqueue(input());
		expect(store.completedBackupCandidates()).toEqual(['backup-01']);
		context.sqlite.prepare('UPDATE backups SET mirrors=?').run(
			JSON.stringify([
				{ replicationId: 'mirror-01', status: 'pending' },
				{ replicationId: 'mirror-02', status: 'failed', lastErrorCode: 'admission-409' },
			])
		);
		expect(store.completedBackupCandidates()).toEqual([]);
	});
	it('a separate process cannot acquire the global execution slot', async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'managed-replication-'));
		const filename = path.join(dir, 'fixture.sqlite');
		let disk: Database.Database | undefined;
		try {
			context.sqlite
				.exec(`INSERT INTO backups(id,plan_id,source_id,source_type,method,storage_id,storage_path,status,in_progress,success,completion_stats)
			 SELECT 'backup-02',plan_id,source_id,source_type,method,storage_id,storage_path,status,in_progress,success,completion_stats FROM backups WHERE id='backup-01'`);
			store.enqueue(input());
			store.enqueue(input({ id: 'job-02', backupId: 'backup-02' }));
			await context.sqlite.backup(filename);
			disk = new Database(filename);
			const first = new ManagedReplicationStore(disk);
			const token = 'a'.repeat(64);
			expect(first.claim('job-01', token)?.status).toBe('running');
			const script = `const Database=require('better-sqlite3');const {ManagedReplicationStore}=require('./src/stores/ManagedReplicationStore.ts');const db=new Database(process.argv[1]);console.log(new ManagedReplicationStore(db).claim('job-02','${'b'.repeat(64)}')?'claimed':'blocked');db.close();`;
			const run = () =>
				execFileSync(process.execPath, ['--import', 'tsx', '-e', script, filename], {
					cwd: process.cwd(),
					env: { ...process.env, NODE_ENV: 'test', PLUTON_DATA_DIR: path.join(dir, 'child-data') },
					encoding: 'utf8',
					timeout: 15000,
				}).trim().split(/\r?\n/).at(-1);
			expect(run()).toBe('blocked');
			first.finish('job-01', token, { status: 'failed', failureCode: 'synthetic-refusal' });
			expect(run()).toBe('claimed');
		} finally {
			disk?.close();
			if (path.dirname(dir) !== path.resolve(os.tmpdir()))
				throw new Error('Invalid synthetic test cleanup');
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe('server replica limit', () => {
	it.each([0, 1, 2])('accepts %i destinations', count =>
		expect(() =>
			validateReplicationSettings({
				enabled: count > 0,
				concurrent: false,
				storages: Array.from({ length: count }, (_, i) => ({
					replicationId: `mirror-${i}`,
					storageId: `storage-${i}`,
					storagePath: `bucket/prefix-${i}`,
				})),
			})
		).not.toThrow()
	);
	it('refuses >2 and duplicate identities even while disabled', () => {
		const r = { replicationId: 'mirror', storageId: 'storage', storagePath: 'bucket/prefix' };
		expect(() => validateReplicationSettings({ enabled: false, storages: [r, r, r] })).toThrow();
		expect(() => validateReplicationSettings({ enabled: true, storages: [r, r] })).toThrow();
	});
});
