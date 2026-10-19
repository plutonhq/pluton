import type { RecoveryPreparation, RecoverySelection, RecoveryEngine } from '../@types/recoveryTests';
import { internalResourceSafety } from './internalResourceSafety.ts';

export function recoveryResourceSafety(preview: RecoveryPreparation, selection: RecoverySelection, checking = false) {
   if (selection.databaseImport !== 'required') return [];
   const engines = [
      ...new Set(
         preview.databases.filter((entry) => entry.engine && selection.targetModes?.[entry.engine] === 'internal').map((entry) => entry.engine!),
      ),
   ];
   return engines.map((engine) => {
      const target = preview.internalTargets.find((view) => view.engine === engine);
      return internalResourceSafety({
         engine,
         bytes: preview.databases.filter((entry) => entry.engine === engine).reduce((sum, entry) => sum + entry.bytes, 0),
         maxSqlBytes: target?.admission?.maxSqlBytes || 128 * 1024 ** 2,
         resources: preview.resources,
         automatic: preview.lifecycle === 'automatic',
         available:
            ((target?.status === 'ready' && !!target.admission) || target?.status === 'running') &&
            (engine !== 'mysql' || preview.mysqlWorker === 'ready'),
         workloadBusy: target?.status === 'running' || engines.length > 1 || Object.values(preview.workloads).some(Boolean),
         checking,
         admission: target?.admission,
      });
   });
}

export function initialRecoverySelection(preview: RecoveryPreparation): RecoverySelection {
   return { databaseImport: preview.policy.databaseImport, targetModes: { ...preview.policy.targetModes } };
}
export function recoveryDestinationStatus(preview: RecoveryPreparation, selection: RecoverySelection, engine?: RecoveryEngine) {
   if (selection.databaseImport === 'disabled') return 'SQL import NOT TESTED — artifact integrity only';
   if (!engine) return 'Engine metadata missing — native import unavailable';
   const internal = selection.targetModes?.[engine] === 'internal';
   if (internal) {
      if (engine === 'mysql' && preview.mysqlWorker !== 'ready') return 'Worker Unavailable';
      const target = preview.internalTargets.find((view) => view.engine === engine);
      if (target?.status === 'running')
         return 'Internal lifecycle occupied — wait for current work, or delete a retained restore only when finished; Stop retains its slot';
      if (target?.status !== 'ready') return target?.status === 'cleanup_required' ? 'Cleanup Required' : 'Not Provisioned / unavailable';
      if (target.admission?.status !== 'admitted') return `Insufficient Resources / ${target.admission?.reason || 'capacity-unknown'}`;
      return target.mode === 'automatic'
         ? 'Ready to provision — automatic provisioning and verified disposable cleanup; execution checks again'
         : 'Ready — operator-managed; execution checks again';
   }
   if (!preview.customTargets.some((target) => target.engine === engine && target.status === 'configured')) return 'Not Configured';
   if (engine === 'mysql' && preview.mysqlWorker !== 'ready') return 'Worker Unavailable';
   return 'Configured — TLS, guard, permissions and compatibility checked at execution';
}
export function canConfirmRecovery(preview: RecoveryPreparation, selection: RecoverySelection, acknowledged: boolean) {
   if (!acknowledged) return false;
   if (preview.policy.databaseImport === 'required' && selection.databaseImport !== 'required') return false;
   if (selection.databaseImport === 'disabled') return true;
   if (Object.values(preview.workloads).some(Boolean)) return false;
   const internalEngines = new Set(
      preview.databases.filter((entry) => entry.engine && selection.targetModes?.[entry.engine] === 'internal').map((entry) => entry.engine),
   );
   return (
      internalEngines.size <= 1 &&
      recoveryResourceSafety(preview, selection).every((view) => view.allowed) &&
      preview.databases.every(
         (entry) => !!entry.engine && !!entry.database && /^(Ready|Configured)/.test(recoveryDestinationStatus(preview, selection, entry.engine)),
      )
   );
}
export function recoveryConfirmationBody(preview: RecoveryPreparation, selection: RecoverySelection) {
   return {
      backupId: preview.backupId,
      snapshotId: preview.snapshotId,
      metadataToken: preview.metadataToken,
      resourcesAcknowledged: true as const,
      selection: {
         databaseImport: selection.databaseImport,
         targetModes: {
            mariadb: selection.targetModes?.mariadb || 'custom',
            postgresql: selection.targetModes?.postgresql || 'custom',
            ...(selection.targetModes?.mysql ? { mysql: selection.targetModes.mysql } : {}),
         },
      },
   };
}
