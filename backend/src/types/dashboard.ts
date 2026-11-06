import type { Backup } from '../db/schema/backups';

export type DashboardBackupRow = Pick<
	Backup,
	| 'id'
	| 'planId'
	| 'status'
	| 'success'
	| 'errorMsg'
	| 'mirrors'
	| 'started'
	| 'ended'
	| 'completionStats'
>;

export type DashboardEventType = 'success' | 'warning' | 'failure';

export type DashboardResultCounts = {
	total: number;
	success: number;
	warning: number;
	failure: number;
	successPct: number;
	warningPct: number;
	failurePct: number;
};

export type DashboardMonth = DashboardResultCounts & { month: string };

export type DashboardInventory = {
	workstations: number;
	servers: number;
	virtualMachines: number;
	databases: number;
};

export type DashboardStorageUsage = {
	series: { month: string; size: number }[];
	totalNow: number;
	monthChange: number;
	topPlan: { id: string; title: string; bytes: number } | null;
};

export type DashboardSummary = {
	successRate: DashboardResultCounts;
	monthly: DashboardMonth[];
	inventory: DashboardInventory;
	storageUsage: DashboardStorageUsage;
};

export type DashboardSystem = { cpu: number; memory: number; disk: number };

export type DashboardEvent = {
	id: string;
	type: DashboardEventType;
	source: 'backup' | 'app' | 'plan';
	planId?: string;
	planTitle?: string;
	backupId?: string;
	message: string;
	time: number;
};
