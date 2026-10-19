import type { DatabaseRestoreView } from '../@types/databaseRestores';
import type { RecoveryTest } from '../@types/recoveryTests';

export const stageLabel = (stage?: string) =>
   (
      ({
         requested: 'Waiting for host admission',
         'checking-resources': 'Checking resources',
         'provisioning-container': 'Provisioning container',
         'starting-database': 'Starting database',
         ready: 'Container ready',
         'snapshot-validation': 'Validating exact snapshot',
         'repository-access': 'Reading repository',
         'staged-restore': 'Restoring to isolated staging',
         'filesystem-validation': 'Validating restored files',
         'database-artifact-validation': 'Verifying SQL artifact integrity',
         'database-target-preflight': 'Validating database target',
         'database-import': 'Importing database',
         'database-import-validation': 'Validating imported database',
         'database-cleanup': 'Cleaning up owned database',
         'workspace-cleanup': 'Cleaning up staging',
         'infrastructure-cleanup': 'Verifying infrastructure cleanup',
         'cleaning-up': 'Cleaning up owned resources',
         'cleanup-required': 'Cleanup requires attention',
         'host-ownership-unverified': 'Host ownership requires verification',
         'operator-provisioning': 'Awaiting manual provisioning',
         'operator-cleanup': 'Awaiting manual infrastructure removal',
         stopped: 'Container stopped',
         removed: 'Owned infrastructure removed',
         active: 'Restore import validated',
         deleted: 'Owned cleanup verified',
      }) as Record<string, string>
   )[stage || ''] || 'Waiting for server stage';

export type OperationProgressState = { label: string; busy: boolean; complete: boolean };
export function restoreProgress(row: DatabaseRestoreView): OperationProgressState {
   if (row.status === 'deleted') return { label: 'Owned cleanup verified', busy: false, complete: true };
   if (['failed', 'cancelled', 'cleanup_required'].includes(row.status))
      return {
         label: row.status === 'cleanup_required' ? 'Cleanup required — verification pending' : 'Restore did not complete; review cleanup',
         busy: false,
         complete: false,
      };
   if (row.cancelRequested || row.expired || row.status === 'deleting')
      return { label: 'Cleaning up — awaiting ownership-verified removal', busy: true, complete: false };
   if (row.status === 'active') return { label: 'Import validated — database retained and active', busy: false, complete: true };
   if (row.status === 'stopped') return { label: 'Database retained and stopped — explicit Resume required', busy: false, complete: true };
   if (row.status === 'provisioning_required' && !row.lifecycle) return { label: 'Awaiting manual host provisioning', busy: false, complete: false };
   if (row.lifecycle?.state === 'stopped') return { label: 'Container stopped — request Resume', busy: false, complete: false };
   const stage = row.status === 'provisioning_required' ? row.lifecycle?.state || row.stage : row.stage;
   return {
      label:
         ['ready', 'requested', 'queued'].includes(stage) && row.status !== 'provisioning_required'
            ? 'Preparing restore and SQL artifact'
            : stageLabel(stage),
      busy: true,
      complete: false,
   };
}
export function recoveryProgress(test: RecoveryTest): OperationProgressState {
   const cleanupPending = test.failureCode === 'internal-cleanup-required' && test.result?.cleanup.infrastructure === false;
   if (cleanupPending) return { label: 'Awaiting ownership-verified infrastructure cleanup', busy: true, complete: false };
   if (test.status === 'passed' || test.status === 'passed_with_warning')
      return {
         label: test.status === 'passed' ? 'Recovery checks completed' : 'Recovery checks completed with warning',
         busy: false,
         complete: true,
      };
   if (test.status === 'failed' || test.status === 'cancelled')
      return {
         label: test.status === 'failed' ? 'Recovery test failed — review result and cleanup' : 'Recovery test cancelled — review cleanup',
         busy: false,
         complete: false,
      };
   return { label: test.status === 'queued' ? 'Queued — awaiting admission' : stageLabel(test.stage), busy: true, complete: false };
}
export function timestamp(value?: string | number | null) {
   const result = typeof value === 'number' ? value : value ? Date.parse(value) : NaN;
   return Number.isFinite(result) && result > 0 ? result : null;
}
export function elapsedSeconds(start?: string | number | null, end?: string | number | null, now = Date.now()) {
   const first = timestamp(start),
      last = end == null ? now : timestamp(end);
   if (first === null || last === null || !Number.isFinite(last) || (end != null && last < first)) return null;
   return Math.max(0, Math.floor((last - first) / 1000));
}
export function elapsedLabel(seconds: number | null) {
   if (seconds === null) return 'Not recorded';
   const hours = Math.floor(seconds / 3600),
      minutes = Math.floor(seconds / 60) % 60,
      rest = seconds % 60;
   return (hours ? hours + ':' + String(minutes).padStart(2, '0') : String(minutes)) + ':' + String(rest).padStart(2, '0');
}
