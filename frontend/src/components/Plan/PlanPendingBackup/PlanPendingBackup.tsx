import { useEffect } from 'react';
import { useSearchParams } from 'react-router';
import { useCheckActiveBackups } from '../../../services/plans';
import classes from './PlanPendingBackup.module.scss';
import Icon from '../../common/Icon/Icon';

interface PlanPendingBackup {
   planId: string;
   onPendingBackupDetect: () => void;
}

const PlanPendingBackup = ({ planId, onPendingBackupDetect }: PlanPendingBackup) => {
   const [, setSearchParams] = useSearchParams();
   const checkActiveBackupsMutation = useCheckActiveBackups();

   useEffect(() => {
      const interval = window.setInterval(() => {
         checkActiveBackupsMutation.mutate(planId, {
            onSuccess: (data) => {
               console.log('[isBackupPending] data :', data);
               if (data.result) {
                  window.clearInterval(interval);
                  setSearchParams((params) => {
                     params.delete('pendingbackup');
                     return params;
                  });
                  onPendingBackupDetect();
               }
            },
         });
      }, 1000);

      return () => window.clearInterval(interval);
   }, [planId]);

   return (
      <div className={classes.backup}>
         <div className={classes.backupIcon}>
            <Icon type="loading" size={24} />
         </div>
         <div className={classes.backupLeft}>
            <div className={classes.backupId}>Starting Backup...</div>
            <div className={classes.backupStart}>
               <div>
                  <Icon type="clock" size={12} /> Starting in a few seconds
               </div>
            </div>
         </div>
         <div className={classes.backupRight}>
            <span className={`skeleton-box ${classes.progressSkeleton}`} />
         </div>
      </div>
   );
};
export default PlanPendingBackup;
