import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { DashboardService, classifyBackup } from '../../src/services/DashboardService';
import { PlanStore } from '../../src/stores/PlanStore';
import { BackupStore } from '../../src/stores/BackupStore';
import { DeviceStore } from '../../src/stores/DeviceStore';
import { DashboardEvent } from '../../src/types/dashboard';

let mockLogsDir = '';

jest.mock('../../src/db/index', () => ({ db: {} }));
jest.mock('../../src/stores/PlanStore');
jest.mock('../../src/stores/BackupStore');
jest.mock('../../src/stores/DeviceStore');
jest.mock('../../src/utils/AppPaths', () => ({
	appPaths: {
		getLogsDir: () => mockLogsDir,
		getDataDir: () => mockLogsDir,
	},
}));

const row = (overrides: Record<string, any>) =>
	({
		id: 'b1',
		planId: 'p1',
		status: 'completed',
		success: true,
		errorMsg: null,
		mirrors: null,
		started: null,
		ended: new Date(),
		completionStats: null,
		...overrides,
	}) as any;

describe('DashboardService', () => {
	let service: DashboardService;
	let mockPlanStore: jest.Mocked<PlanStore>;
	let mockBackupStore: jest.Mocked<BackupStore>;
	let mockDeviceStore: jest.Mocked<DeviceStore>;

	beforeEach(() => {
		mockPlanStore = new PlanStore(null as any) as jest.Mocked<PlanStore>;
		mockBackupStore = new BackupStore(null as any) as jest.Mocked<BackupStore>;
		mockDeviceStore = new DeviceStore(null as any) as jest.Mocked<DeviceStore>;
		service = new DashboardService(mockPlanStore, mockBackupStore, mockDeviceStore);
	});

	describe('classifyBackup', () => {
		it('classifies failed, warning, success and uncounted backups', () => {
			expect(classifyBackup(row({ status: 'failed' }))).toBe('failure');
			expect(classifyBackup(row({ status: 'completed' }))).toBe('success');
			expect(classifyBackup(row({ status: 'completed', errorMsg: 'unreadable file' }))).toBe(
				'warning'
			);
			expect(classifyBackup(row({ status: 'completed', mirrors: [{ status: 'failed' }] }))).toBe(
				'warning'
			);
			expect(classifyBackup(row({ status: 'completed', mirrors: [{ status: 'completed' }] }))).toBe(
				'success'
			);
			expect(classifyBackup(row({ status: 'cancelled' }))).toBeNull();
			expect(classifyBackup(row({ status: 'started' }))).toBeNull();
		});
	});

	describe('buildMonthly', () => {
		it('returns one entry per month, oldest first, with rounded percentages', () => {
			const now = new Date(2026, 10, 15);
			const rows = [
				row({ ended: new Date(2026, 10, 2) }),
				row({ ended: new Date(2026, 10, 3) }),
				row({ ended: new Date(2026, 10, 4), errorMsg: 'warn' }),
				row({ ended: new Date(2026, 9, 10), status: 'failed' }),
				row({ ended: new Date(2026, 9, 11), status: 'cancelled' }),
			];

			const monthly = service.buildMonthly(rows, 3, now);

			expect(monthly.map(m => m.month)).toEqual(['2026-09', '2026-10', '2026-11']);
			expect(monthly[0]).toMatchObject({ total: 0, successPct: 0, warningPct: 0, failurePct: 0 });
			expect(monthly[1]).toMatchObject({ total: 1, failure: 1, failurePct: 100 });
			expect(monthly[2]).toMatchObject({
				total: 3,
				success: 2,
				warning: 1,
				successPct: 66.7,
				warningPct: 33.3,
				failurePct: 0,
			});
		});
	});

	describe('countInventory', () => {
		it('counts VMs, databases, servers and workstations', () => {
			const devices = [
				{ type: 'vm', platform: 'linux', metrics: null },
				{ type: 'database', platform: null, metrics: null },
				{ type: 'device', platform: 'win32', metrics: { os: { isServer: true } } },
				{ type: 'device', platform: 'linux', metrics: { os: { isServer: false } } },
				{ type: 'device', platform: 'linux', metrics: null },
				{ type: 'device', platform: 'darwin', metrics: null },
				// A Promise saved as JSON leaves an object, not a boolean
				{ type: 'device', platform: 'win32', metrics: { os: { isServer: {} } } },
			] as any[];

			expect(service.countInventory(devices)).toEqual({
				workstations: 3,
				servers: 2,
				virtualMachines: 1,
				databases: 1,
			});
		});
	});

	describe('buildStorageUsage', () => {
		const now = new Date(2026, 10, 15);
		const plan = (overrides: Record<string, any> = {}) =>
			({
				id: 'p1',
				title: 'Plan One',
				createdAt: new Date(2025, 0, 1),
				stats: { size: 1000, snapshots: [], mirrors: [{ size: 500 }] },
				...overrides,
			}) as any;

		it('uses plan_size + mirrors_size when present and live stats for the current month', () => {
			const rows = [
				row({
					ended: new Date(2026, 8, 20),
					completionStats: { plan_size: 600, mirrors_size: 300 },
				}),
				row({
					ended: new Date(2026, 9, 20),
					completionStats: { plan_size: 800, mirrors_size: 400 },
				}),
			];

			const usage = service.buildStorageUsage([plan()], rows, now);

			expect(usage.series).toHaveLength(9);
			expect(usage.series[8]).toEqual({ month: '2026-11', size: 1500 });
			expect(usage.series[7]).toEqual({ month: '2026-10', size: 1200 });
			expect(usage.series[6]).toEqual({ month: '2026-09', size: 900 });
			expect(usage.totalNow).toBe(1500);
			expect(usage.monthChange).toBe(300);
		});

		it('works the size back from data_added_packed for rows without plan_size', () => {
			const rows = [
				row({ ended: new Date(2026, 8, 20), completionStats: { data_added_packed: 100 } }),
				row({ ended: new Date(2026, 9, 20), completionStats: { data_added: 200 } }),
				row({
					ended: new Date(2026, 10, 5),
					completionStats: { data_added_packed: 300, data_added: 900 },
				}),
			];

			const usage = service.buildStorageUsage(
				[plan({ stats: { size: 2000, snapshots: [] } })],
				rows,
				now
			);

			expect(usage.series[8].size).toBe(2000);
			expect(usage.series[7].size).toBe(1700);
			expect(usage.series[6].size).toBe(1500);
			expect(usage.series[5].size).toBe(1400);
			expect(usage.monthChange).toBe(300);
			expect(usage.topPlan).toEqual({ id: 'p1', title: 'Plan One', bytes: 900 });
		});

		it('gives 0 before the plan was created and no top plan without new data', () => {
			const usage = service.buildStorageUsage(
				[plan({ createdAt: new Date(2026, 9, 3), stats: { size: 50, snapshots: [] } })],
				[],
				now
			);

			expect(usage.series.slice(0, 7).every(p => p.size === 0)).toBe(true);
			expect(usage.series[7].size).toBe(50);
			expect(usage.topPlan).toBeNull();
		});
	});

	describe('mergeEvents', () => {
		const event = (overrides: Partial<DashboardEvent>) =>
			({ id: 'e', type: 'success', source: 'backup', message: 'm', time: 0, ...overrides }) as any;

		it('drops log lines of listed backups, filters by type and sorts newest first', () => {
			const backupEvents = [
				event({ id: 'b1', type: 'failure', time: 100 }),
				event({ id: 'b2', type: 'success', time: 300 }),
			];
			const logEvents = [
				event({ id: 'l1', type: 'failure', source: 'plan', backupId: 'b1', time: 110 }),
				event({ id: 'l2', type: 'warning', source: 'app', time: 200 }),
				event({ id: 'l3', type: 'failure', source: 'plan', backupId: 'gone', time: 50 }),
			];

			const all = service.mergeEvents(backupEvents, logEvents, 'all', 50);
			expect(all.map(e => e.id)).toEqual(['b2', 'l2', 'b1', 'l3']);
			expect(all.find(e => e.id === 'l3')?.backupId).toBe('gone');

			const failures = service.mergeEvents(backupEvents, logEvents, 'failure', 50);
			expect(failures.map(e => e.id)).toEqual(['b1', 'l3']);

			expect(service.mergeEvents(backupEvents, logEvents, 'all', 2)).toHaveLength(2);
		});
	});

	describe('getEvents', () => {
		beforeEach(() => {
			mockLogsDir = mkdtempSync(path.join(os.tmpdir(), 'pluton-dash-'));
		});
		afterEach(() => {
			rmSync(mockLogsDir, { recursive: true, force: true });
		});

		it('merges backup rows with warn/error lines from the app and plan logs', async () => {
			const now = Date.now();
			const line = (o: Record<string, any>) => JSON.stringify({ time: now - 1000, ...o });
			writeFileSync(
				path.join(mockLogsDir, 'app.log'),
				[
					line({ level: 30, msg: 'info' }),
					line({ level: 40, msg: 'app warning' }),
					line({ level: 50, msg: 'old', time: now - 40 * 24 * 3600 * 1000 }),
					'not json',
				].join('\n')
			);
			writeFileSync(
				path.join(mockLogsDir, 'plan-p1.log'),
				[
					line({ level: 50, msg: 'run failed', backupId: 'b1' }),
					line({ level: 60, msg: 'plan fatal', time: now - 2000 }),
				].join('\n')
			);
			writeFileSync(path.join(mockLogsDir, 'plan-deleted.log'), line({ level: 50, msg: 'x' }));
			mockBackupStore.getEndedSince.mockResolvedValue([
				row({ id: 'b1', status: 'failed', ended: new Date(now) }),
			]);
			mockPlanStore.getAll.mockResolvedValue([{ id: 'p1', title: 'Plan One' }] as any);

			const events = await service.getEvents('all', 50);

			expect(events.map(e => [e.source, e.type, e.message])).toEqual([
				['backup', 'failure', 'Backup failed for Plan One'],
				['app', 'warning', 'app warning'],
				['plan', 'failure', 'plan fatal'],
			]);
			expect(events[2]).toMatchObject({ planId: 'p1', planTitle: 'Plan One' });
		});
	});
});
