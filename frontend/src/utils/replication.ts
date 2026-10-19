import type { PlanReplicationSettings } from '../@types/plans';
import type { BackupMirror } from '../@types/backups';

export const MAX_REPLICATION_DESTINATIONS = 2;

/** UI validation supplements the server's storage identity and ownership checks. */
export function replicationSettingsError(
   settings: PlanReplicationSettings | undefined,
   primary: { storageId: string; storagePath: string },
   managedAgent = false,
): string | undefined {
   if (!settings) return;
   if (settings.storages.length > MAX_REPLICATION_DESTINATIONS) return 'A backup plan supports at most two replication destinations.';
   if (!settings.enabled) return;
   if (!settings.storages.length) return 'Select at least one replication destination, or disable replication.';
   const seen = new Set<string>();
   for (const destination of settings.storages) {
      if (!destination.storageId) return 'Select a storage for each replication destination.';
      if (managedAgent && !['s3', 's3compatible'].includes(destination.storageType))
         return 'Managed Agent replication requires S3 or S3-compatible storage.';
      if (managedAgent && !destination.storagePath?.trim()) return 'A dedicated repository path is required for each replication destination.';
      const identity = JSON.stringify([destination.storageId, destination.storagePath]);
      if (seen.has(identity)) return 'Each replication destination must use a different repository path.';
      seen.add(identity);
      if (destination.storageId === primary.storageId && destination.storagePath === primary.storagePath)
         return 'A replication destination must be different from the primary repository.';
   }
}

export function mirrorSummary(mirrors: BackupMirror[], expectedDestinations = mirrors.length) {
   const total = Math.max(mirrors.length, expectedDestinations);
   const completed = mirrors.filter((mirror) => mirror.status === 'completed').length;
   const failed = mirrors.filter((mirror) => mirror.status === 'failed').length;
   const pending = Math.max(0, total - completed - failed);
   if (completed === total && total > 0)
      return { state: 'success' as const, label: `${completed}/${total} mirrors complete`, incomplete: false };
   if (failed > 0)
      return { state: 'failed' as const, label: `Redundancy incomplete: ${completed}/${total} mirrors complete`, incomplete: true };
   return { state: 'pending' as const, label: `Replication pending: ${pending}/${total} mirrors incomplete`, incomplete: true };
}

export function mirrorStatusLabel(status: BackupMirror['status']) {
   return status === 'completed' ? 'Completed' : status === 'failed' ? 'Failed' : status === 'started' ? 'In progress' : 'Pending';
}

export function hasPendingMirrors(backups: { mirrors?: BackupMirror[] }[]) {
   return backups.some(backup => backup.mirrors?.some(mirror => mirror.status === 'pending' || mirror.status === 'started'));
}
