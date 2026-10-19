import type { RecoveryTest } from '../@types/recoveryTests.ts';
export const recoveryStatusLabel = {
   queued: 'Queued',
   running: 'Running',
   passed: 'Passed',
   failed: 'Failed',
   cancelled: 'Cancelled',
   passed_with_warning: 'Passed with warning',
};
export const recoveryStatusExplanation: Record<string, string> = {
   passed: 'All configured recovery checks passed for this exact snapshot. This is not a production cutover or a guarantee of application behavior.',
   passed_with_warning:
      'Completed recovery checks passed, but a check was skipped or cleanup needs attention. Review the warning before treating recovery as fully validated.',
   failed: 'At least one required recovery check failed. Backup Complete does not imply Recovery Passed.',
   cancelled: 'Recovery validation was cancelled; unexecuted checks are not passed.',
};
export function databaseImportLabel(status: string): string {
   if (status === 'passed') return 'SQL import validation PASSED in a disposable recovery database';
   if (status === 'failed') return 'SQL import validation FAILED';
   if (status === 'disabled') return 'SQL import NOT TESTED (Disabled). Artifact integrity is not semantic database recovery validation.';
   return 'SQL import NOT TESTED (not executed or not configured).';
}
export function recoveryForBackup(tests: RecoveryTest[], backupId: string, snapshotId?: string): RecoveryTest | undefined {
   if (!snapshotId || !/^[a-f0-9]{64}$/.test(snapshotId)) return undefined;
   // Both identities must match; an older pass never validates a newer snapshot.
   return tests.find((test) => test.backupId === backupId && test.snapshotId === snapshotId);
}
export function recoveryActive(test?: RecoveryTest) {
   return !!test && ['queued', 'running'].includes(test.status);
}
export function canTestRecovery(backup: { status: string; inProgress?: boolean; completionStats?: { snapshot_id?: string } | null }) {
   return backup.status === 'completed' && !backup.inProgress && /^[a-f0-9]{64}$/.test(backup.completionStats?.snapshot_id || '');
}
