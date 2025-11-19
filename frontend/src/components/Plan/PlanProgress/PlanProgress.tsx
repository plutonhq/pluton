import { Backup } from '../../../@types/backups';
import { Plan } from '../../../@types/plans';
import { RestoreSlim } from '../../../@types/restores';
import BackupProgress from '../BackupProgress/BackupProgress';
import PlanPendingBackup from '../PlanPendingBackup/PlanPendingBackup';
import classes from './PlanProgress.module.scss';

interface PlanProgressProps {
   plan: Plan;
   isBackupPending: boolean;
   activeBackups: Backup[];
   activeRestores: RestoreSlim[];
   refetchPlan: () => void;
}

const PlanProgress = ({ plan, isBackupPending, activeBackups, activeRestores, refetchPlan }: PlanProgressProps) => {
   return (
      <div>
         {isBackupPending && (
            <div className={classes.activeBackups}>
               <div className={classes.backupsHeader}>
                  <h3>Backup in Progress</h3>
               </div>
               <div className={classes.activeBackupsTable}>
                  <PlanPendingBackup planId={plan.id} onPendingBackupDetect={() => refetchPlan()} />
               </div>
            </div>
         )}

         {activeBackups.length > 0 && (
            <div className={classes.activeBackups}>
               <div className={classes.backupsHeader}>
                  <h3>
                     Active Backups <span>{activeBackups.length}</span>
                  </h3>
               </div>
               <div className={classes.activeBackupsTable}>
                  {activeBackups.map((backup) => (
                     <BackupProgress
                        key={backup.id}
                        type={'backup'}
                        item={backup}
                        sourceId={plan.sourceId || ''}
                        sourceType={'main'}
                        planId={plan.id}
                     />
                  ))}
               </div>
            </div>
         )}

         {activeRestores.length > 0 && (
            <div className={classes.activeBackups}>
               <div className={classes.backupsHeader}>
                  <h3>Restoring Backup</h3>
               </div>
               <div className={classes.activeBackupsTable}>
                  {activeRestores.map((restore) => (
                     <BackupProgress
                        key={restore.id}
                        type={'restore'}
                        item={restore}
                        sourceId={plan.sourceId || ''}
                        sourceType={'main'}
                        planId={plan.id}
                     />
                  ))}
               </div>
            </div>
         )}
      </div>
   );
};

export default PlanProgress;
