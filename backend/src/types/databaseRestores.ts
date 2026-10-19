import type { RecoveryDatabaseResult, RecoveryTarget } from './recoveryTests';

export const RESTORE_PURPOSE = 'pluton-persistent-database-restore-v1';
export type DatabaseRestoreStatus =
	| 'provisioning_required'
	| 'queued'
	| 'importing'
	| 'active'
	| 'stopped'
	| 'expired'
	| 'deleting'
	| 'cleanup_required'
	| 'deleted'
	| 'failed'
	| 'cancelled';
export type DatabaseRestoreCleanup =
	| 'none'
	| 'requested'
	| 'database_removed'
	| 'infrastructure_pending'
	| 'verified'
	| 'uncertain';
export type DatabaseRestoreInspection = {
	engine: string;
	version: string;
	database: string;
	tables: number;
	views: number;
	bytes: number | null;
	catalog: { schema: string; name: string; type: string }[];
	observedAt: number;
	catalogTruncated: boolean;
};
export type DatabaseRestore = {
	id: string;
	owner: string;
	purpose: typeof RESTORE_PURPOSE;
	planId: string;
	repositoryId: string;
	backupId: string;
	snapshotId: string;
	databaseId: string;
	artifact: RecoveryDatabaseResult;
	metadataToken: string;
	mode: 'internal' | 'custom';
	targetId: string;
	targetFingerprint: string | null;
	encryptedApproval: string | null;
	ownerToken: string;
	database: string | null;
	status: DatabaseRestoreStatus;
	stage: string;
	cleanup: DatabaseRestoreCleanup;
	createdAt: number;
	startedAt: number | null;
	completedAt?: number | null;
	failureStage?: string | null;
	failureCode?: string | null;
	expiresAt: number;
	ttlSeconds: number;
	lastValidatedAt: number | null;
	inspection: DatabaseRestoreInspection | null;
	errorCode: string | null;
	cancelRequested: boolean;
};
export type PersistentTargetApproval = {
	version: 1;
	id: string;
	purpose: typeof RESTORE_PURPOSE;
	mode: 'internal' | 'custom';
	activationId: string;
	engine: 'mariadb' | 'mysql' | 'postgresql';
	database: string;
	target: RecoveryTarget;
	caSha256: string;
	maxSqlBytes: number;
	maxRetentionSeconds: number;
	storage: { id: string; quotaBytes: number; kind: 'fixed-ext4' | 'operator-approved-external' };
	binding?: { restoreId: string; snapshotId: string; sha256: string };
	containerId?: string;
};
export type PersistentRestoreLease = {
	restoreId: string;
	targetId: string;
	database: string;
	ownerToken: string;
	state: 'intended' | 'created' | 'validated';
};
