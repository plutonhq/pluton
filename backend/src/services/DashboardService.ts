import fs from 'fs';
import { FileHandle, open, readdir } from 'fs/promises';
import path from 'path';
import si from 'systeminformation';
import { BackupStore } from '../stores/BackupStore';
import { DeviceStore } from '../stores/DeviceStore';
import { PlanStore } from '../stores/PlanStore';
import { Device } from '../db/schema/devices';
import { PlanFull } from '../types/plans';
import { appPaths } from '../utils/AppPaths';
import {
	DashboardBackupRow,
	DashboardEvent,
	DashboardEventType,
	DashboardInventory,
	DashboardMonth,
	DashboardResultCounts,
	DashboardStorageUsage,
	DashboardSummary,
	DashboardSystem,
} from '../types/dashboard';

type DashboardPlan = Pick<PlanFull, 'id' | 'title' | 'createdAt' | 'stats'>;

const STORAGE_SERIES_MONTHS = 9;
const EVENTS_DAYS = 30;
const LOG_TAIL_BYTES = 256 * 1024;

const round1 = (value: number) => Math.round(value * 10) / 10;
const toPct = (part: number, total: number) => (total > 0 ? round1((part / total) * 100) : 0);
const monthKey = (date: Date) =>
	`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
const monthStart = (now: Date, monthsBack: number) =>
	new Date(now.getFullYear(), now.getMonth() - monthsBack, 1);
const endedMs = (b: DashboardBackupRow) => (b.ended ? new Date(b.ended).getTime() : 0);

/**
 * The one rule the dashboard uses to count a backup. Cancelled and in-progress
 * backups are not counted.
 */
export function classifyBackup(
	b: Pick<DashboardBackupRow, 'status' | 'errorMsg' | 'mirrors'>
): DashboardEventType | null {
	if (b.status === 'failed') return 'failure';
	if (b.status !== 'completed') return null;
	if (b.errorMsg || (b.mirrors || []).some(m => m.status === 'failed')) return 'warning';
	return 'success';
}

export class DashboardService {
	constructor(
		protected planStore: PlanStore,
		protected backupStore: BackupStore,
		protected deviceStore: DeviceStore
	) {}

	async getSummary(months: number = 6): Promise<DashboardSummary> {
		const now = new Date();
		const since = monthStart(now, Math.max(months, STORAGE_SERIES_MONTHS) - 1);
		const [rows, plans, devices] = await Promise.all([
			this.backupStore.getEndedSince(since),
			this.planStore.getAll(false),
			this.deviceStore.getAll(),
		]);
		const monthly = this.buildMonthly(rows, months, now);
		return {
			successRate: this.countResults(rows.filter(b => endedMs(b) >= monthStart(now, 0).getTime())),
			monthly,
			inventory: this.countInventory(devices || []),
			storageUsage: this.buildStorageUsage(plans || [], rows, now),
		};
	}

	async getSystem(): Promise<DashboardSystem> {
		const [load, mem] = await Promise.all([si.currentLoad(), si.mem()]);
		let disk = 0;
		try {
			const stats = await fs.promises.statfs(appPaths.getDataDir());
			const used = (stats.blocks - stats.bfree) * stats.bsize;
			const usable = used + stats.bavail * stats.bsize;
			disk = toPct(used, usable);
		} catch {
			// Leave disk at 0 when the data dir cannot be measured
		}
		return {
			cpu: round1(load.currentLoad || 0),
			memory: toPct(mem.total - mem.available, mem.total),
			disk,
		};
	}

	async getEvents(
		type: DashboardEventType | 'all' = 'all',
		limit: number = 50
	): Promise<DashboardEvent[]> {
		const since = new Date(Date.now() - EVENTS_DAYS * 24 * 60 * 60 * 1000);
		const [rows, plans] = await Promise.all([
			this.backupStore.getEndedSince(since),
			this.planStore.getAll(false),
		]);
		const planTitles = new Map((plans || []).map(p => [p.id, p.title]));
		const logEvents = await this.readLogEvents(planTitles, since.getTime());
		return this.mergeEvents(this.buildBackupEvents(rows, planTitles), logEvents, type, limit);
	}

	countResults(
		rows: Pick<DashboardBackupRow, 'status' | 'errorMsg' | 'mirrors'>[]
	): DashboardResultCounts {
		const counts = { success: 0, warning: 0, failure: 0 };
		for (const row of rows) {
			const result = classifyBackup(row);
			if (result) counts[result]++;
		}
		const total = counts.success + counts.warning + counts.failure;
		return {
			total,
			...counts,
			successPct: toPct(counts.success, total),
			warningPct: toPct(counts.warning, total),
			failurePct: toPct(counts.failure, total),
		};
	}

	buildMonthly(rows: DashboardBackupRow[], months: number, now: Date): DashboardMonth[] {
		const result: DashboardMonth[] = [];
		for (let i = months - 1; i >= 0; i--) {
			const start = monthStart(now, i).getTime();
			const end = monthStart(now, i - 1).getTime();
			const inMonth = rows.filter(b => endedMs(b) >= start && endedMs(b) < end);
			result.push({ month: monthKey(monthStart(now, i)), ...this.countResults(inMonth) });
		}
		return result;
	}

	countInventory(devices: Pick<Device, 'type' | 'metrics' | 'platform'>[]): DashboardInventory {
		const inventory = { workstations: 0, servers: 0, virtualMachines: 0, databases: 0 };
		for (const device of devices) {
			if (device.type === 'vm') {
				inventory.virtualMachines++;
			} else if (device.type === 'database') {
				inventory.databases++;
			} else {
				// Older rows can hold a non-boolean isServer, so use the platform for those
				const isServer = device.metrics?.os?.isServer;
				const server =
					typeof isServer === 'boolean'
						? isServer
						: (device.platform || '').toLowerCase() === 'linux';
				if (server) inventory.servers++;
				else inventory.workstations++;
			}
		}
		return inventory;
	}

	/**
	 * Month-end repo size per plan. A row with plan_size gives the size directly.
	 * Older rows have none, so the size is worked back from the next known size
	 * (or the live plan stats) minus the data each backup in between added.
	 */
	buildStorageUsage(
		plans: DashboardPlan[],
		rows: DashboardBackupRow[],
		now: Date
	): DashboardStorageUsage {
		const completed = rows
			.filter(b => b.status === 'completed' && b.ended)
			.sort((a, b) => endedMs(a) - endedMs(b));
		const series = Array.from({ length: STORAGE_SERIES_MONTHS }, (_, i) => ({
			month: monthKey(monthStart(now, STORAGE_SERIES_MONTHS - 1 - i)),
			size: 0,
		}));
		const currentMonthStart = monthStart(now, 0).getTime();
		let topPlan: DashboardStorageUsage['topPlan'] = null;

		for (const plan of plans) {
			const planRows = completed.filter(b => b.planId === plan.id);
			const liveSize =
				(plan.stats?.size || 0) +
				(plan.stats?.mirrors || []).reduce((acc, m) => acc + (m.size || 0), 0);
			const createdMs = plan.createdAt ? new Date(plan.createdAt).getTime() : 0;
			const knownSize = (b: DashboardBackupRow) =>
				b.completionStats?.plan_size !== undefined
					? b.completionStats.plan_size + (b.completionStats.mirrors_size || 0)
					: undefined;
			const added = (b: DashboardBackupRow) =>
				b.completionStats?.data_added_packed ?? b.completionStats?.data_added ?? 0;

			for (let i = 0; i < STORAGE_SERIES_MONTHS - 1; i++) {
				const bucketEnd = monthStart(now, STORAGE_SERIES_MONTHS - 2 - i).getTime();
				if (createdMs >= bucketEnd) continue;
				const before = planRows.filter(b => endedMs(b) < bucketEnd && knownSize(b) !== undefined);
				if (before.length > 0) {
					series[i].size += knownSize(before[before.length - 1]) as number;
					continue;
				}
				const anchor = planRows.find(b => endedMs(b) >= bucketEnd && knownSize(b) !== undefined);
				const anchorMs = anchor ? endedMs(anchor) : Infinity;
				const addedAfter = planRows
					.filter(b => endedMs(b) >= bucketEnd && endedMs(b) <= anchorMs)
					.reduce((acc, b) => acc + added(b), 0);
				series[i].size += Math.max(
					0,
					(anchor ? (knownSize(anchor) as number) : liveSize) - addedAfter
				);
			}
			series[STORAGE_SERIES_MONTHS - 1].size += liveSize;

			const bytes = planRows
				.filter(b => endedMs(b) >= currentMonthStart)
				.reduce((acc, b) => acc + (b.completionStats?.data_added || 0), 0);
			if (bytes > 0 && (!topPlan || bytes > topPlan.bytes)) {
				topPlan = { id: plan.id, title: plan.title, bytes };
			}
		}

		const totalNow = series[STORAGE_SERIES_MONTHS - 1].size;
		return {
			series,
			totalNow,
			monthChange: totalNow - series[STORAGE_SERIES_MONTHS - 2].size,
			topPlan,
		};
	}

	buildBackupEvents(rows: DashboardBackupRow[], planTitles: Map<string, string>): DashboardEvent[] {
		const messages: Record<DashboardEventType, string> = {
			success: 'Successfully backed up',
			warning: 'Backup completed with warnings for',
			failure: 'Backup failed for',
		};
		const events: DashboardEvent[] = [];
		for (const row of rows) {
			const type = classifyBackup(row);
			if (!type) continue;
			const planTitle = (row.planId && planTitles.get(row.planId)) || row.planId || 'Unknown Plan';
			events.push({
				id: row.id,
				type,
				source: 'backup',
				...(row.planId ? { planId: row.planId } : {}),
				planTitle,
				backupId: row.id,
				message: `${messages[type]} ${planTitle}`,
				time: endedMs(row),
			});
		}
		return events;
	}

	/**
	 * Merges backup and log events, newest first. A log line that belongs to a
	 * backup already in the list is dropped, so one run is not shown twice.
	 */
	mergeEvents(
		backupEvents: DashboardEvent[],
		logEvents: DashboardEvent[],
		type: DashboardEventType | 'all',
		limit: number
	): DashboardEvent[] {
		const backupIds = new Set(backupEvents.map(e => e.id));
		const logs = logEvents.filter(e => !e.backupId || !backupIds.has(e.backupId));
		return [...backupEvents, ...logs]
			.filter(e => type === 'all' || e.type === type)
			.sort((a, b) => b.time - a.time)
			.slice(0, limit);
	}

	protected async readLogEvents(
		planTitles: Map<string, string>,
		sinceMs: number
	): Promise<DashboardEvent[]> {
		const logsDir = appPaths.getLogsDir();
		let files: string[] = [];
		try {
			files = await readdir(logsDir);
		} catch {
			return [];
		}
		const events: DashboardEvent[] = [];
		for (const file of files) {
			const planId = file.match(/^plan-(.+)\.log$/)?.[1];
			if (file !== 'app.log' && !(planId && planTitles.has(planId))) continue;
			const source = planId ? 'plan' : 'app';
			const lines = await this.readLogTail(path.join(logsDir, file));
			lines.forEach((line, index) => {
				let entry: any;
				try {
					entry = JSON.parse(line);
				} catch {
					return;
				}
				if (!(entry?.level >= 40) || !(entry.time >= sinceMs)) return;
				const entryPlanId: string | undefined = planId || entry.planId;
				events.push({
					id: `${file}-${entry.time}-${index}`,
					type: entry.level >= 50 ? 'failure' : 'warning',
					source,
					...(entryPlanId ? { planId: entryPlanId } : {}),
					...(entryPlanId && planTitles.has(entryPlanId)
						? { planTitle: planTitles.get(entryPlanId) }
						: {}),
					message: String(entry.msg || ''),
					time: entry.time,
					...(entry.backupId ? { backupId: entry.backupId } : {}),
				});
			});
		}
		return events;
	}

	protected async readLogTail(filePath: string): Promise<string[]> {
		let handle: FileHandle | undefined;
		try {
			handle = await open(filePath, 'r');
			const { size } = await handle.stat();
			const start = Math.max(0, size - LOG_TAIL_BYTES);
			const buffer = Buffer.alloc(size - start);
			await handle.read(buffer, 0, buffer.length, start);
			const lines = buffer.toString('utf8').split(/\r?\n/);
			// The first line is cut when the read starts mid-file
			if (start > 0) lines.shift();
			return lines.filter(line => line.trim() !== '');
		} catch {
			return [];
		} finally {
			await handle?.close();
		}
	}
}
