import type {
	LegacyRepository,
	LegacyRepositoryBackend,
	LegacyRepositoryValidationStatus,
} from '../db/schema/legacyRepositories';
import type { LegacyRestoreJobStatus } from '../db/schema/legacyRestoreJobs';

export type LegacyRepositoryPublic = Omit<LegacyRepository, 'encryptedPassword'>;

export type LegacyRepositoryRegistration = {
	displayName: string;
	repositoryPath: string;
	password: string;
};

export type LegacyRepositorySnapshot = {
	id: string;
	shortId: string;
	time: string;
	hostname: string;
	tags: string[];
	paths: string[];
	parent?: string;
};

export type LegacyRepositorySnapshotFilters = {
	tag?: string;
	path?: string;
	host?: string;
	workload?: string;
	dataset?: string;
	page?: number;
	pageSize?: LegacyRepositorySnapshotPageSize;
};

export type LegacyRepositorySnapshotPageSize = 10 | 30 | 60 | 100 | 'all';

export type LegacyRepositorySnapshotPage = {
	items: LegacyRepositorySnapshot[];
	total: number;
	page: number;
	pageSize: LegacyRepositorySnapshotPageSize;
	totalPages: number;
	workloads: string[];
	datasets: string[];
};

export type LegacyRepositoryStats = {
	totalSize: number;
	totalUncompressedSize: number;
	compressionRatio: number;
	totalBlobCount: number;
	snapshotCount: number;
};

export type LegacySnapshotEntryType = 'file' | 'directory' | 'symlink' | 'other';

/** A direct child of a logical snapshot directory. `path` is always relative. */
export type LegacySnapshotEntry = {
	name: string;
	path: string;
	type: LegacySnapshotEntryType;
	size: number | null;
	modifiedAt: string | null;
	permissions: string | null;
	isSymlink: boolean;
};

export type LegacySnapshotDirectory = {
	path: string;
	entries: LegacySnapshotEntry[];
};

export type LegacyRestoreRequest = {
	snapshotId: string;
	paths: string[];
};

export type LegacyRestoreJobPublic = {
	id: string;
	repositoryId: string;
	snapshotId: string;
	selectedPaths: string[];
	status: LegacyRestoreJobStatus;
	errorMessage: string | null;
	restoredFileCount: number | null;
	restoredBytes: number | null;
	stagingArea: 'isolated';
	createdAt: Date;
	startedAt: Date | null;
	completedAt: Date | null;
	updatedAt: Date | null;
};

export type LegacyRepositoryConnectionStatus = {
	validationStatus: LegacyRepositoryValidationStatus;
	lastValidatedAt: Date | null;
};

export type { LegacyRepositoryBackend, LegacyRepositoryValidationStatus };
export type { LegacyRestoreJobStatus };
