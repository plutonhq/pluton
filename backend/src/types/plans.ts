import { NewPlan, Plan } from '../db/schema/plans';
import { Restore } from '../db/schema/restores';
import { IntegrationTypes } from './settings';
import { SourceTypes } from './source';
import { Backup } from '../db/schema/backups';
import { Device } from '../db/schema/devices';

export type PlanPrune = {
	snapCount: number;
	policy: string; // forgetByAge, forgetByDate, custom
	revisions?: boolean; //for sync backup types.
	revisionSkipThreshold?: number; // Auto-skip revisions when sync changes exceed this count (default: 50000, 0 = disabled)
	forgetAge?: string;
	forgetDate?: string;
	keepDailySnaps?: number;
	keepWeeklySnaps?: number;
	keepMonthlySnaps?: number;
};

export type PlanNotificationCase = 'start' | 'end' | 'success' | 'failure' | 'both';
export type PlanNotificationType = 'start' | 'end' | 'success' | 'failure' | 'replication_failure';

export type PlanNotification = {
	email: {
		enabled: boolean;
		case: PlanNotificationCase;
		type: IntegrationTypes;
		emails: string;
	};
	webhook: {
		enabled: boolean;
		case: PlanNotificationCase;
		method: 'GET' | 'POST';
		contentType: 'application/json' | 'application/x-www-form-urlencoded' | 'text/plain';
		url: string;
	};
	push: {
		enabled: boolean;
		case: PlanNotificationCase;
		url: string;
		authType: string;
		authToken: string;
		tags: string;
	};
	slack: {
		enabled: boolean;
		case: PlanNotificationCase;
		url: string;
	};
	discord: {
		enabled: boolean;
		case: PlanNotificationCase;
		url: string;
	};
};

export type PlanInterval = {
	type: 'hourly' | 'daily' | 'weekly' | 'monthly' | 'days' | 'hours' | 'minutes';
	minutes?: number;
	time?: string; // 10:00AM, 02:00PM etc.
	days?: string; // When type is "days", run on days of a week (comma separated). eg: sun,tue,fri
	hours?: string;
};

export type PlanSource = {
	includes: string[];
	excludes: string[];
};

export type PlanIntegritySettings = {
	enabled: boolean;
	interval: PlanInterval; // in days
	method: string; //full, no-read, read-10%,
	notification: PlanNotification;
};

export type BackupVerifiedResult = {
	message: string;
	logs: string[];
	fix?: string;
	hasError: boolean;
	errorType?: string;
};

export type SyncVerifiedResult = {
	differences: number;
	matchingFiles: number;
	missingFiles: number;
	errors: number;
	failed: boolean;
	logs: string[];
	hasError: boolean;
	message?: string;
};

export type PlanVerification = {
	status: string;
	result?: Record<string, BackupVerifiedResult> | SyncVerifiedResult;
	hasError: boolean;
	errorMsg?: string;
	startedAt: number;
	endedAt: number | null;
};

export type PlanScript = {
	id: string;
	type: string;
	enabled: boolean;
	scriptPath: string; // Absolute path to a script file on the device
	logOutput: boolean;
	timeout?: number;
	abortOnError?: boolean; // only when event type is onBackupStart
	runAsRoot?: boolean;
};

export type PlanPerformanceSettings = {
	maxProcessor?: number;
	readConcurrency?: number;
	packSize?: string;
	scan?: boolean;
	transfers?: number; // [rclone] --transfers. Controls concurrent file uploads. default: 4
	bufferSize?: string; // [rclone] --buffer-size. Helps with streaming large files. default: 16M
	multiThreadStream?: number; // [rclone] --multi-thread-streams. Useful for large files. default: 4
	maxDuration?: number; //sync [rclone] --max-duration. Maximum duration rclone will transfer data for (default 0s)
	maxTransfer?: string; //sync [rclone] --max-transfer. Maximum size of data to transfer (default off)
	multiThreadChunkSize?: string; //sync [rclone] --multi-thread-chunk-size. Chunk size for multi-thread downloads / uploads, if not set by filesystem (default 64Mi)
	multiThreadCutoff?: string; //sync [rclone] --multi-thread-cutoff. Use multi-thread downloads for files above this size (default 256Mi)
	multiThreadWriteBufferSize?: string; //sync [rclone] --multi-thread-write-buffer-size.  In memory buffer size for writing when in multi-thread mode (default 128Ki)
	syncStrategy?: string; // sync [rclone] checksum | size-only | default
	maxChangeFiles?: number; // Max number of individual file changes stored per sync entry (default: 10000)
};

export type PlanScripts = {
	onBackupStart?: PlanScript[];
	onBackupEnd?: PlanScript[];
	onBackupError?: PlanScript[];
	onBackupFailure?: PlanScript[];
	onBackupComplete?: PlanScript[];
};

export interface PlanRescueSettings {
	outputFormat: 'ISO'; // Start with ISO, can be extended later
	isoEncryptionPassword?: string; // Will be stored encrypted in the DB
}

export interface PlanSourceRescueConfig extends PlanSource {
	// Store the discovered and user-selected filesystems for backup
	discoveredFilesystems: Array<{
		device: string;
		mountpoint: string;
		size: number;
		isCritical: boolean; // Was it auto-selected as an OS partition?
	}>;
}

export interface PlanReplicationStorage {
	replicationId: string;
	storageId: string;
	storagePath: string;
	storageType: string;
	addedAt: number;
	storageName: string;
}

export interface PlanReplicationSettings {
	enabled: boolean;
	concurrent: boolean;
	storages: PlanReplicationStorage[];
}

export interface PlanBackupSettings {
	interval: PlanInterval;
	prune: PlanPrune;
	notification: PlanNotification;
	performance: PlanPerformanceSettings;
	integrity: PlanIntegritySettings;
	encryption: boolean;
	compression: boolean;
	retries: number;
	retryDelay: number; // in seconds
	scripts?: PlanScripts;
	rescue?: PlanRescueSettings;
	replication?: PlanReplicationSettings;
}

export type PlanError = {
	message: string;
	code: string;
	date: number;
};

export type PlanStats = {
	size: number;
	snapshots: string[];
	mirrors?: {
		replicationId: string;
		storageId: string;
		storagePath: string;
		size: number;
		snapshots: string[];
	}[];
};

export interface NewPlanReq {
	title: string;
	description?: string;
	method: string;
	sourceConfig: {
		includes: string[];
		excludes: string[];
	};
	sourceId: string;
	sourceType: SourceTypes;
	storage: { id: string; name: string };
	storagePath: string;
	tags: string[];
	settings: PlanBackupSettings;
}

export interface BackupPlanArgs extends NewPlan {
	storage: {
		name: string;
		type: string;
		authType: string;
		settings: Record<string, string>;
		credentials: Record<string, string>;
		defaultPath: string;
		options?: Record<string, string>;
	};
	cronExpression: string;
}

export type PlanChildItem = Pick<
	Plan,
	'id' | 'title' | 'createdAt' | 'isActive' | 'stats' | 'method'
>;
export type PlanBackupItem = Pick<
	Backup,
	| 'id'
	| 'title'
	| 'description'
	| 'status'
	| 'inProgress'
	| 'errorMsg'
	| 'download'
	| 'started'
	| 'ended'
	| 'completionStats'
	| 'taskStats'
	| 'mirrors'
> & { active?: boolean };
export type PlanRestoreItem = Pick<
	Restore,
	| 'id'
	| 'status'
	| 'backupId'
	| 'config'
	| 'errorMsg'
	| 'started'
	| 'ended'
	| 'completionStats'
	| 'taskStats'
>;
export type PlanStorageItem = Pick<Storage, 'id' | 'name' | 'type'>;
export type PlanDeviceItem = Pick<Device, 'id' | 'name' | 'hostname'>;
export interface PlanFull extends Plan {
	device: PlanDeviceItem | null;
	storage: PlanStorageItem | null;
	backups: PlanBackupItem[];
	restores: PlanRestoreItem[];
}

export type PlanLogItem = {
	formattedTime: string;
	hostname: string;
	level: number;
	module: string;
	msg: string;
	pid: number;
	planId: string;
	time: number;
};
