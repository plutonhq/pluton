import { useEffect } from 'react';
import { useSearchParams } from 'react-router';
import { useCheckActiveBackupsOrRestore } from '../../../services/plans';
import classes from './PlanPendingBackup.module.scss';
import Icon from '../../common/Icon/Icon';

interface PlanPendingBackup {
   planId: string;
   type?: 'backup' | 'restore';
   onPendingDetect: () => void;
}

const PlanPendingBackup = ({ planId, type = 'backup', onPendingDetect }: PlanPendingBackup) => {
   const [, setSearchParams] = useSearchParams();
   const checkActivesMutation = useCheckActiveBackupsOrRestore();

   useEffect(() => {
      const interval = window.setInterval(() => {
         checkActivesMutation.mutate(
            { planId, type },
            {
               onSuccess: (data) => {
                  console.log('[isBackupPending] data :', data);
                  if (data.result) {
                     window.clearInterval(interval);
                     setSearchParams((params) => {
                        if (type === 'restore') {
                           params.delete('pendingrestore');
                        } else {
                           params.delete('pendingbackup');
                        }

                        return params;
                     });
                     onPendingDetect();
                  }
               },
            },
         );
      }, 1000);

      return () => window.clearInterval(interval);
   }, [planId, type]);

   return (
      <div className={classes.backup}>
         <div className={classes.backupIcon}>
            <Icon type="loading" size={24} />
         </div>
         <div className={classes.backupLeft}>
            <div className={classes.backupId}>Starting {type}...</div>
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
