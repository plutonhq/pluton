import { backupStatistics, statisticHelp } from '../../../utils/backupStatistics';
import { formatBytes } from '../../../utils/helpers';
import type { BackupCompletionStats } from '../../../@types/backups';
import classes from './BackupEvents.module.scss';

export default function BackupStatistics({ stats }: { stats: BackupCompletionStats }) {
   const values = backupStatistics(stats as unknown as Record<string, unknown>);
   const rows = [
      ['Total Files', values.totalFiles, 'Regular files processed, including configured SQL artifacts.'],
      ['New Files', values.newFiles, statisticHelp.newFiles],
      ['Modified Files', values.modifiedFiles, 'Files changed compared with the selected parent; metadata changes may count as changed.'],
      ['Unmodified Files', values.unmodifiedFiles, 'Files unchanged relative to the selected parent snapshot.'],
      ['Deleted Files', undefined, 'Not measured by the Restic backup summary.'],
      ['Snapshot Size', values.logicalBytes, statisticHelp.snapshotSize, true],
      ['Data Added', values.dataAdded, statisticHelp.dataAdded, true],
      ['Compressed Data Added', values.packedAdded, statisticHelp.packed, true],
   ] as const;
   return (
      <section className={classes.statistics} aria-label="Snapshot statistics">
         <h3>Snapshot Statistics</h3>
         <dl>
            {rows.map(([label, value, help, bytes]) => (
               <div key={label}>
                  <dt title={help}>{label}</dt>
                  <dd>{value === undefined ? 'Not measured' : bytes ? formatBytes(value) : value.toLocaleString()}</dd>
               </div>
            ))}
         </dl>
         <p>{statisticHelp.deduplication}</p>
         <a href="/docs/backup-plans/incremental">Understand these counters</a>
      </section>
   );
}
