export type LegacyRepositoryValidationStatus = 'unknown' | 'available' | 'unavailable';

export interface LegacyRepository {
   id: string;
   displayName: string;
   repositoryPath: string;
   backend: 'local';
   isReadOnly: true;
   validationStatus: LegacyRepositoryValidationStatus;
   lastValidatedAt: string | null;
   createdAt: string;
   updatedAt: string | null;
}

export interface LegacyRepositorySnapshot {
   id: string;
   shortId: string;
   time: string;
   hostname: string;
   tags: string[];
   paths: string[];
   parent?: string;
}

export interface LegacyRepositorySnapshotFilters {
   tag?: string;
   path?: string;
   host?: string;
   workload?: string;
   dataset?: string;
   page?: number;
   pageSize?: LegacyRepositorySnapshotPageSize;
}

export type LegacyRepositorySnapshotPageSize = 10 | 30 | 60 | 100 | 'all';

export interface LegacyRepositorySnapshotPage {
   items: LegacyRepositorySnapshot[];
   total: number;
   page: number;
   pageSize: LegacyRepositorySnapshotPageSize;
   totalPages: number;
   workloads: string[];
   datasets: string[];
}

export interface LegacyRepositoryStats {
   totalSize: number;
   totalUncompressedSize: number;
   compressionRatio: number;
   totalBlobCount: number;
   snapshotCount: number;
}

export type LegacySnapshotEntryType = 'file' | 'directory' | 'symlink' | 'other';

export interface LegacySnapshotEntry {
   name: string;
   path: string;
   type: LegacySnapshotEntryType;
   size: number | null;
   modifiedAt: string | null;
   permissions: string | null;
   isSymlink: boolean;
}

export interface LegacySnapshotDirectory {
   path: string;
   entries: LegacySnapshotEntry[];
}

export type LegacyRestoreJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface LegacyRestoreJob {
   id: string;
   repositoryId: string;
   snapshotId: string;
   selectedPaths: string[];
   status: LegacyRestoreJobStatus;
   errorMessage: string | null;
   restoredFileCount: number | null;
   restoredBytes: number | null;
   stagingArea: 'isolated';
   createdAt: string;
   startedAt: string | null;
   completedAt: string | null;
   updatedAt: string | null;
}

export interface LegacyRestoreRequest {
   snapshotId: string;
   paths: string[];
}

export interface LegacyRepositoryRegistration {
   displayName: string;
   repositoryPath: string;
   password: string;
}
