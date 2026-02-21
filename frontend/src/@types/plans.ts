import { Backup } from './backups';
import { RestoreSlim } from './restores';

export type PlanPrune = {
   snapCount: number;
   policy: string; // forgetByAge, forgetByDate, custom
   forgetAge?: string;
   forgetDate?: string;
   keepDailySnaps?: number;
   keepWeeklySnaps?: number;
   keepMonthlySnaps?: number;
   revisions?: boolean; // for sync backups
};

export type PlanNotificationCase = 'start' | 'end' | 'success' | 'failure' | 'both';

export type PlanNotification = {
   email: {
      enabled: boolean;
      case: PlanNotificationCase;
      type: string;
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
};

export type PlanInterval = {
   type: 'hourly' | 'daily' | 'weekly' | 'monthly' | 'days' | 'hours' | 'minutes';
   minutes?: number;
   hours?: string;
   time?: string; // 10:00AM, 02:00PM etc.
   days?: string; // When type is "days", run on days of a week (comma separated). eg: sun,tue,fri
};

export type PlanSource = {
   includes: string[];
   excludes: string[];
};

export type SyncVerifiedResult = {
   differences: number;
   matchingFiles: number;
   missingFiles: number;
   errors: number;
   failed: boolean;
   logs: string[];
   hasError: boolean;
};

export type PlanVerifiedResult = {
   message: string;
   logs: string[];
   fix?: string;
   hasError: boolean;
};

export type PlanVerification = {
   status: string;
   result: PlanVerifiedResult | SyncVerifiedResult;
   startedAt: number;
   hasError: boolean;
   endedAt: number | null;
};

export type PlanPerformanceSettings = {
   maxProcessor?: number;
   readConcurrency?: number;
   packSize?: string;
   scan?: boolean;
   transfers?: number;
   bufferSize?: string;
   multiThreadStream?: number;
   maxDuration?: number; //sync
   maxTransfer?: string; //sync
   multiThreadChunkSize?: string; //sync
   multiThreadCutoff?: string; //sync
   multiThreadWriteBufferSize?: string; //sync
   syncStrategy?: string;
};

export type PlanIntegritySettings = {
   enabled: boolean;
   interval: PlanInterval; // in days
   method: string; //full, no-read, read-10%,
   notification: {
      email: {
         enabled: boolean;
         type: string;
         emails: string;
      };
      webhook: {
         enabled: boolean;
         method: 'GET' | 'POST';
         contentType: 'application/json' | 'application/x-www-form-urlencoded' | 'text/plain';
         url: string;
      };
      push: {
         enabled: boolean;
         url: string;
         authType: string;
         authToken: string;
         tags: string;
      };
   };
};

export type PlanScript = {
   id: string;
   type: string;
   enabled: boolean;
   scriptPath: string; // Absolute path to a script file on the device
   logOutput: boolean;
   timeout?: number;
   abortOnError?: boolean;
};

export type PlanSettings = {
   interval: PlanInterval;
   prune: PlanPrune;
   encryption: boolean;
   compression: boolean;
   retries: number;
   retryDelay: number; // in seconds
   performance: PlanPerformanceSettings;
   integrity: PlanIntegritySettings;
   notification: PlanNotification;
   scripts?: {
      onBackupStart?: PlanScript[];
      onBackupEnd?: PlanScript[];
      onBackupError?: PlanScript[];
      onBackupFailure?: PlanScript[];
      onBackupComplete?: PlanScript[];
   };
};

export type PlanStats = {
   size: number;
   snapshots: string[];
};

export type Plan = {
   id: string;
   title: string;
   description?: string;
   method: string;
   inProgress: boolean;
   isActive: boolean;
   createdAt: string;
   lastBackupTime: string | null;
   lastUpdated: string | null;
   storageId: string;
   sourceId: string;
   sourceType: 'device' | 'database' | 'googleworkspace' | 'microsoft365';
   storagePath: string;
   sourceConfig: PlanSource;
   tags: string[];
   verified: PlanVerification;
   stats: PlanStats;
   settings: PlanSettings;

   storage: { name: string; type: string; id: string };
   device: { name: string; id: string; hostname: string };
   backups: Backup[];
   restores?: RestoreSlim[];
};

export interface NewPlanSettings {
   id?: string;
   description?: string;
   title: string;
   method: string;
   sourceConfig: {
      includes: string[];
      excludes: string[];
   };
   sourceId: string;
   sourceType: 'device' | 'database' | 'googleworkspace' | 'microsoft365';
   storage: { id: string; name: string };
   storagePath: string;
   tags: string[];
   settings: PlanSettings;
}

export type PlanChildItem = Pick<Plan, 'id' | 'title' | 'createdAt' | 'isActive' | 'stats' | 'method'>;
