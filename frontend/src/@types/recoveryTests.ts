export type RecoveryEngine = 'mariadb' | 'mysql' | 'postgresql';
export type RecoverySelection = { databaseImport: 'disabled' | 'required'; targetModes?: RecoveryPolicy['targetModes'] };
export type RecoveryPreparation = {
   planId: string;
   planTitle: string;
   backupId: string;
   repositoryId: string;
   snapshotId: string;
   metadataToken: string;
   databases: { databaseId?: string; engine?: RecoveryEngine; database?: string; path: string; bytes: number; sha256: string }[];
   policy: RecoveryPolicy;
   customTargets: { engine: RecoveryEngine; status: 'configured' | 'not_configured' }[];
   internalTargets: (InternalTargetView & { admission?: { status: 'admitted' | 'refused'; code?: string; reason?: string; maxSqlBytes?: number } })[];
   mysqlWorker: 'ready' | 'unavailable';
   resources: {
      status: 'measured' | 'unknown';
      observedAt: number;
      sample: null | {
         cpuAvailable?: number;
         operatorTotal?: number;
         operatorAvailable?: number;
         operatorCpuAvailable?: number;
         operatorDiskAvailable?: number;
         operatorObservedAt?: number;
         operatorSwapUsed?: number;
         operatorCgroupSwap?: number;
         operatorPressure?: number;
         total: number;
         available: number;
         swapUsed: number;
         pressure: number;
         limit: number;
         used: number;
         cgroupSwap: number;
         diskAvailable: number;
      };
   };
   lifecycle: 'operator-managed' | 'automatic';
   workloads: { backup: boolean; restore: boolean; recovery: boolean };
   versionCompatibility: 'not-recorded-in-receipt';
   persistentRestore: { status: 'unavailable'; reason: string };
};
export type RecoveryPolicy = {
   enabled: boolean;
   databaseImport: 'disabled' | 'required';
   targetModes?: Partial<Record<RecoveryEngine, 'internal' | 'custom'>>;
};
export type InternalTargetView = {
   engine: RecoveryEngine;
   status: 'not_provisioned' | 'ready' | 'running' | 'cleanup_required';
   mode: 'operator-managed' | 'automatic';
};
export type RecoveryTarget = {
   engine: RecoveryEngine;
   host: string;
   port: number;
   username: string;
   tls: 'local' | 'verify-identity';
   enabled: boolean;
   dedicated: true;
   passwordConfigured: boolean;
};
export type RecoveryTest = {
   id: string;
   planId: string;
   backupId: string;
   snapshotId: string;
   status: 'queued' | 'running' | 'passed' | 'failed' | 'cancelled' | 'passed_with_warning';
   trigger: 'manual' | 'after_backup';
   createdAt: string;
   startedAt?: string;
   completedAt?: string;
   failureStage?: string;
   stage?: string;
   failureCode?: string;
   warnings: { stage: string; code: string }[];
   result?: {
      internalEngine?: RecoveryEngine;
      filesystem?: { files: number; bytes: number; sourceTrees: number; integrity: string };
      databases: {
         databaseId?: string;
         engine?: RecoveryEngine;
         database?: string;
         path: string;
         bytes: number;
         sha256: string;
         artifactValidation: string;
         importValidation: string;
         failureCode?: string;
         tables?: number;
         views?: number;
         versionValidation?: 'header-and-target-checked' | 'not-recorded';
      }[];
      cleanup: { workspace: boolean; databases: boolean; infrastructure?: boolean };
   };
};
