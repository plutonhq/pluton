import type { Plan } from '../../../@types/plans';
import { useRecoveryTests } from '../../../services/recoveryTests';
import { recoveryForBackup, recoveryStatusLabel } from '../../../utils/recoveryTests';
import classes from './RecoveryTesting.module.scss';
export default function RecoverySummary({ plan }: { plan: Plan }) {
   const remote = plan.method === 'backup' && plan.sourceType === 'device' && plan.sourceId !== 'main';
   const query = useRecoveryTests(
      plan.id,
      remote,
      plan.backups.map((backup) => backup.id),
   );
   if (!remote) return null;
   const backup = [...plan.backups].sort((a, b) => new Date(b.started || 0).getTime() - new Date(a.started || 0).getTime())[0];
   const tests = query.data || [];
   const current = backup ? recoveryForBackup(tests, backup.id, backup.completionStats?.snapshot_id) : undefined;
   const latest = tests[0];
   return (
      <div className={classes.summary}>
         <div>Latest Backup: {backup ? `backup-${backup.id} · ${backup.status}` : 'None'}</div>
         <div>Recovery for this backup: {query.error ? 'Unavailable' : current ? recoveryStatusLabel[current.status] : 'Not tested'}</div>
         <div>Latest Recovery Test: {latest ? `${latest.id} · ${recoveryStatusLabel[latest.status]} · backup-${latest.backupId}` : 'None'}</div>
         <div>Tested Snapshot: {latest ? <code>{latest.snapshotId}</code> : 'None'}</div>
         <div>Tested At: {latest?.completedAt ? new Date(latest.completedAt).toLocaleString() : 'Not completed'}</div>
      </div>
   );
}
