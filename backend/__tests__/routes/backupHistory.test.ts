import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { backups, backupRelations } from '../../src/db/schema/backups';
import { plans, plansRelations } from '../../src/db/schema/plans';
import { devices, deviceRelations } from '../../src/db/schema/devices';
import { storages, storageRelations } from '../../src/db/schema/storages';
import { restores, restoreRelations } from '../../src/db/schema/restores';
import { PlanStore } from '../../src/stores/PlanStore';
import { BackupStore } from '../../src/stores/BackupStore';
import { PlanService } from '../../src/services/PlanService';
import { PlanController } from '../../src/controllers/PlanController';
import { createPlanRouter } from '../../src/routes/plans';
import { parseBackupHistoryQuery } from '../../src/utils/backupHistoryQuery';
import { webAccess } from '../../src/middlewares/webAccess';
import { parseWebOrigins } from '../../src/utils/webOrigins';
import { configService } from '../../src/services/ConfigService';

jest.mock('../../src/services/ConfigService', () => ({
	configService: {
		config: {
			SECRET: 'synthetic-history-session-signing-only',
			APP_URL: 'http://example.internal',
			APP_ALLOWED_ORIGINS: '',
		},
	},
}));

describe('bounded backup history API against real migrated disposable SQLite', () => {
	let sqlite: Database.Database;
	let store: BackupStore;
	let planStore: PlanStore;
	let app: express.Express;
	let controller: PlanController;
	const cookie = `token=${jwt.sign({ user: 'example-admin' }, 'synthetic-history-session-signing-only')}`;
	const schema = {
		backups,
		backupRelations,
		plans,
		plansRelations,
		devices,
		deviceRelations,
		storages,
		storageRelations,
		restores,
		restoreRelations,
	};
	let db: ReturnType<typeof drizzle<typeof schema>>;
	const api = (suffix = '', planId = 'plan-01') =>
		request(app).get(`/api/plans/${planId}/backups${suffix}`).set('Cookie', cookie);

	beforeEach(() => {
		Object.assign(configService.config, {
			APP_URL: 'http://example.internal',
			APP_ALLOWED_ORIGINS: '',
		});
		sqlite = new Database(':memory:');
		db = drizzle(sqlite, { schema });
		migrate(db, { migrationsFolder: path.resolve(__dirname, '../../drizzle') });
		db.insert(devices).values({ id: 'app-01', name: 'app-01' }).run();
		for (const id of ['plan-01', 'plan-02'])
			db.insert(plans)
				.values({
					id,
					title: 'Example plan',
					sourceId: 'app-01',
					method: 'backup',
					sourceConfig: { includes: ['/srv/example-app'], excludes: [] },
					settings: {
						replication: {
							enabled: true,
							concurrent: false,
							storages: [{ storageId: 'mirror-current' }],
						},
					} as any,
					stats: { snapshots: ['a'.repeat(64)], size: 100 },
				})
				.run();
		store = new BackupStore(db as any);
		planStore = new PlanStore(db as any);
		const service = new PlanService({} as any, planStore, store, {} as any, {} as any, {} as any);
		app = express();
		controller = new PlanController(service);
		app.use('/api/plans', createPlanRouter(controller));
	});
	afterEach(() => sqlite.close());
	function seed(count: number, planId = 'plan-01') {
		for (let i = 0; i < count; i++)
			db.insert(backups)
				.values({
					id: `${planId}-backup-${String(i).padStart(4, '0')}`,
					planId,
					sourceId: 'app-01',
					method: 'backup',
					status: 'completed',
					inProgress: false,
					started: new Date('2026-01-01T00:00:00Z'),
					ended: new Date(Date.parse('2026-01-01T00:01:00Z') + Math.floor(i / 3) * 1000),
					completionStats: { snapshot_id: 'a'.repeat(64), total_bytes_processed: 100 } as any,
				})
				.run();
	}
	it.each([0, 1, 10, 11, 50, 51, 237])(
		'pages %i records with exact totals, boundaries and no duplicated/missing IDs',
		async count => {
			seed(count);
			seed(3, 'plan-02');
			const ids: string[] = [];
			for (let page = 1; page <= Math.max(1, Math.ceil(count / 10)); page++) {
				const response = await api(`?page=${page}`);
				expect(response.status).toBe(200);
				expect(response.headers['cache-control']).toBe('private, no-store');
				const result = response.body.result;
				expect(result).toMatchObject({
					page,
					pageSize: 10,
					total: count,
					totalPages: Math.max(1, Math.ceil(count / 10)),
					hasPrevious: page > 1,
					hasNext: page * 10 < count,
				});
				expect(result.items.length).toBe(Math.min(10, count - (page - 1) * 10));
				ids.push(...result.items.map((row: any) => row.id));
			}
			expect(new Set(ids).size).toBe(count);
			expect(ids).toEqual([...ids].sort().reverse()); // Equal-time ties use ID DESC.
		}
	);
	it.each([10, 20, 50])(
		'bounds rows at page size %i and clamps after deleting a last page',
		async pageSize => {
			seed(51);
			const last = (await api(`?page=999&pageSize=${pageSize}`)).body.result;
			expect(last.page).toBe(Math.ceil(51 / pageSize));
			for (const row of last.items) await store.delete(row.id);
			const updated = (await api(`?page=${last.page}&pageSize=${pageSize}`)).body.result;
			expect(updated.page).toBe(last.page - 1);
			expect(updated.items).toHaveLength(pageSize);
		}
	);
	it('filters the displayed ended -> started -> created timestamp with a half-open inclusive calendar range', async () => {
		for (const [id, ended, started, created] of [
			['before', '2025-12-31T16:59:59Z', '2025-12-31T10:00Z', '2025-12-31T09:00Z'],
			['first', '2025-12-31T17:00:00Z', '2025-12-31T10:00Z', '2025-12-31T09:00Z'],
			['last', '2026-01-01T16:59:59Z', '2025-12-31T10:00Z', '2025-12-31T09:00Z'],
			['after', '2026-01-01T17:00:00Z', '2026-01-01T15:00Z', '2025-12-31T09:00Z'],
			['started-only', null, '2026-01-01T01:00Z', '2025-12-31T09:00Z'],
			['created-only', null, null, '2026-01-01T02:00Z'],
		] as const)
			db.insert(backups)
				.values({
					id,
					planId: 'plan-01',
					sourceId: 'app-01',
					method: 'backup',
					status: 'failed',
					inProgress: false,
					ended: ended && new Date(ended),
					started: started && new Date(started),
					createdAt: new Date(created),
				})
				.run();
		const filtered = (await api('?startDate=2026-01-01&endDate=2026-01-01&timeZone=Asia%2FJakarta'))
			.body.result;
		expect(filtered.total).toBe(4);
		expect(filtered.items.map((row: any) => row.id)).toEqual([
			'last',
			'created-only',
			'started-only',
			'first',
		]);
		expect((await api('?startDate=2024-01-01&endDate=2024-01-01')).body.result).toMatchObject({
			total: 0,
			page: 1,
			items: [],
		});
		expect((await api()).body.result.total).toBe(6);
		expect((await api('?startDate=2026-01-01&timeZone=Asia%2FJakarta')).body.result.total).toBe(5);
	});
	it('does not expose source config, storage credentials, progress internals or another plan through query overrides', async () => {
		seed(1);
		seed(1, 'plan-02');
		const item = (await api()).body.result.items[0];
		for (const field of [
			'sourceConfig',
			'storage',
			'credentials',
			'password',
			'progressStats',
			'planId',
		])
			expect(item).not.toHaveProperty(field);
		expect((await api('?planId=plan-02')).status).toBe(400);
		expect((await api('', 'missing-plan')).status).toBe(404);
		expect((await api('', 'plan-02')).body.result.items[0].id).toContain('plan-02');
	});
	it('enforces sessions; arbitrary API keys and unauthenticated parameter changes cannot read any plan', async () => {
		expect((await request(app).get('/api/plans/plan-01/backups?page=1')).status).toBe(401);
		expect(
			(
				await request(app)
					.get('/api/plans/plan-02/backups?page=1')
					.set('Authorization', 'Bearer not-a-session')
			).status
		).toBe(401);
	});

	it('retains approved HTTPS/private HTTP sessions and rejects forged origin/proxy/host headers on history reads', async () => {
		const policyConfig = {
			APP_URL: 'https://backup.example.internal',
			APP_ALLOWED_ORIGINS: 'http://192.0.2.10:5173',
		};
		Object.assign(configService.config, policyConfig);
		const secured = express();
		secured.use(webAccess(parseWebOrigins(policyConfig)));
		secured.use('/api/plans', createPlanRouter(controller));
		for (const origin of [policyConfig.APP_URL, policyConfig.APP_ALLOWED_ORIGINS]) {
			const session = `token=${jwt.sign({ user: 'example-admin', webOrigin: origin }, 'synthetic-history-session-signing-only')}`;
			const response = await request(secured)
				.get('/api/plans/plan-01/backups?pageSize=10')
				.set('Host', new URL(origin).host)
				.set('Origin', origin)
				.set('Cookie', session);
			expect(response.status).toBe(200);
		}
		for (const headers of [
			{ Host: 'backup.example.internal', Origin: 'https://evil.example.internal' },
			{ 'Host': 'backup.example.internal', 'X-Forwarded-Proto': 'http' },
			{ 'Host': 'backup.example.internal', 'X-Forwarded-Host': 'evil.example.internal' },
			{ 'Host': 'evil.example.internal', 'X-Forwarded-Host': 'backup.example.internal' },
		]) {
			const response = await request(secured)
				.get('/api/plans/plan-02/backups?page=2')
				.set(headers)
				.set('Cookie', cookie);
			expect(response.status).toBe(403);
			expect(response.body).not.toHaveProperty('result');
		}
		const boundElsewhere = `token=${jwt.sign({ user: 'example-admin', webOrigin: policyConfig.APP_URL }, 'synthetic-history-session-signing-only')}`;
		expect(
			(
				await request(secured)
					.get('/api/plans/plan-02/backups')
					.set('Host', '192.0.2.10:5173')
					.set('Cookie', boundElsewhere)
			).status
		).toBe(401);
	});
	it.each([
		'pageSize=100',
		'pageSize=10&pageSize=50',
		'page=-1',
		'timeZone=Invalid',
		'endDate=2026-02-30',
		'startDate=2026-02-02&endDate=2026-02-01',
		'sourceId=app-02',
	])('returns safe 400 for %s', async query => {
		const response = await api(`?${query}`);
		expect(response.status).toBe(400);
		expect(response.body.error).toContain('Invalid backup history query');
	});
	it('retains exact remote snapshot eligibility and filters only stale mirror IDs on the paged rows', async () => {
		seed(2);
		const first = (await store.getHistoryPage('plan-01', parseBackupHistoryQuery({}))).items[0];
		await store.update(first.id, {
			mirrors: [{ storageId: 'mirror-current' }, { storageId: 'mirror-removed' }] as any,
		});
		const item = (await api()).body.result.items[0];
		expect(item.active).toBe(true);
		expect(item.completionStats.snapshot_id).toBe('a'.repeat(64));
		expect(item.mirrors.map((row: any) => row.storageId)).toEqual(['mirror-current']);
		await store.update(first.id, { completionStats: { snapshot_id: 'b'.repeat(64) } as any });
		expect((await api()).body.result.items[0].active).toBe(false);
	});
	it('keeps active tasks and latest completed measurements in a bounded separate header summary', async () => {
		seed(200);
		await store.update('plan-01-backup-0000', { inProgress: true, status: 'started', ended: null });
		const summary = await planStore.getById('plan-01', true, true);
		expect(summary!.backups.length).toBeLessThanOrEqual(92);
		expect(summary!.backups.some(row => row.id === 'plan-01-backup-0000' && row.inProgress)).toBe(
			true
		);
		expect((await api()).body.result.total).toBe(199);
	});

	it('preserves the previous 999-point chart budget with counters only, independent of page/health limits', async () => {
		seed(1050);
		seed(1, 'plan-02');
		await store.update('plan-02-backup-0000', {
			ended: new Date('2030-01-01T00:00Z'),
			completionStats: { total_bytes_processed: 777 } as any,
		});
		// Invalid old metadata outside the 90-outcome header must not break the
		// chart projection or be hydrated as a credential/artifact/restore DTO.
		sqlite
			.prepare('UPDATE backups SET completion_stats = ?, task_stats = ? WHERE id = ?')
			.run('invalid-old-metadata', 'invalid-old-metadata', 'plan-01-backup-0055');
		await store.update('plan-01-backup-0056', {
			completionStats: { total_bytes_processed: 'unsafe-counter-placeholder' } as any,
		});
		const response = await request(app)
			.get('/api/plans/plan-01?backupHistory=summary')
			.set('Cookie', cookie);
		expect(response.status).toBe(200);
		const summary = response.body.result;
		expect(JSON.stringify(summary.backupChart)).not.toContain('unsafe-counter-placeholder');
		expect(summary.backups.length).toBeLessThanOrEqual(92);
		expect(summary.backupChart).toHaveLength(999);
		expect(summary.backupChart.some((point: any) => point.completionStats === null)).toBe(true);
		for (const point of summary.backupChart) {
			expect(Object.keys(point).sort()).toEqual([
				'completionStats',
				'started',
				'status',
				'totalFiles',
				'totalSize',
			]);
			if (point.completionStats) {
				expect(Object.keys(point.completionStats).sort()).toEqual([
					'total_bytes_processed',
					'total_files_processed',
				]);
				expect(point.completionStats.total_bytes_processed).not.toBe(777);
			}
		}
	});
	it('uses the additive index for plan/date/order lookups and allows application rollback without schema/data loss', () => {
		seed(5);
		const sql = `SELECT id FROM backups WHERE plan_id = ? AND coalesce(ended_at,started_at,created_at) >= ? ORDER BY coalesce(ended_at,started_at,created_at) DESC, id DESC LIMIT 10`;
		const explanation = sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all('plan-01', 0) as {
			detail: string;
		}[];
		expect(explanation.map(row => row.detail).join(' ')).toContain('backups_plan_history_date_idx');
		expect(explanation.map(row => row.detail).join(' ')).not.toContain('TEMP B-TREE');
		const migration = readFileSync(
			path.resolve(__dirname, '../../drizzle/0013_backup_history_index.sql'),
			'utf8'
		);
		expect(migration).not.toMatch(/UPDATE|DELETE|ALTER TABLE|DROP TABLE/i);
		expect(sqlite.prepare('SELECT count(*) AS count FROM backups').get()).toEqual({ count: 5 });
	});
});
