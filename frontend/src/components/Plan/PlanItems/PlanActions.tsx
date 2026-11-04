import { useState } from 'react';
import { toast } from 'react-toastify';
import { Plan } from '../../../@types/plans';
import Icon from '../../common/Icon/Icon';
import classes from './PlanItem.module.scss';
import { useDeletePlan, usePausePlan, usePerformBackup, useResumePlan } from '../../../services/plans';

const PlanActions = ({ plan }: { plan: Plan }) => {
   const { id, inProgress, isActive = false, method = 'backup' } = plan;
   const [showSettings, setShowSettings] = useState(false);
   const deletePlanMutation = useDeletePlan();
   const performBackupMutation = usePerformBackup();
   const pauseMutation = usePausePlan();
   const resumeMutation = useResumePlan();
   const shouldBeInaccessible =
      pauseMutation.isPending || resumeMutation.isPending || performBackupMutation.isPending || deletePlanMutation.isPending;
   const isSync = method === 'sync';

   const changeStatus = () => {
      if (inProgress || shouldBeInaccessible) {
         return;
      }
      // isActive, set it to false, else true
      // When the action is being performed, the item should grey out and stay inaccessible.
      // When this happens, the server should stop the restic Cron schedule
      console.log(' changeStatus:', !isActive);
      if (isActive) {
         toast.promise(pauseMutation.mutateAsync(id), {
            pending: 'Pausing backup Plan...',
            success: 'Backup Plan Paused',
            error: {
               render({ data }: any) {
                  return `Failed to Pause Backup Plan. ${data?.message || 'Unknown Error.'}`;
               },
            },
         });
      } else {
         toast.promise(resumeMutation.mutateAsync(id), {
            pending: 'Resuming backup Plan...',
            success: 'Backup Plan Resumed',
            error: {
               render({ data }: any) {
                  return `Failed to Resume Backup Plan. ${data?.message || 'Unknown Error.'}`;
               },
            },
         });
      }
   };

   const backupNow = () => {
      if (shouldBeInaccessible) {
         return;
      }
      toast.promise(
         performBackupMutation.mutateAsync({ id }),
         {
            pending: `Starting ${isSync ? 'Sync' : 'Backup'}...`,
            success: `${isSync ? 'Sync' : 'Backup'} initiated successfully! 🚀`,
            error: {
               render({ data }: any) {
                  // When the promise reject, data will contains the error
                  return `Failed to start ${isSync ? 'Sync' : 'Backup'}. ${data?.message || 'Unknown Error.'}`;
               },
            },
         },
         {
            style: {
               minWidth: '250px',
            },
         },
      );
      setShowSettings(false);
   };

   return (
      <>
         <button className={`${classes.moreBtn} ${showSettings ? classes.moreBtnActive : ''}`} onClick={() => setShowSettings(!showSettings)}>
            <Icon type="dots-vertical" size={14} />
         </button>
         {showSettings && (
            <div className={classes.settings}>
               <button onClick={backupNow}>
                  <Icon type="backup" size={14} /> {isSync ? 'Sync' : 'Backup'} Now
               </button>
               <button
                  onClick={() => {
                     changeStatus();
                     setShowSettings(false);
                  }}
               >
                  <Icon type={isActive ? 'pause' : 'resume'} size={14} /> {isActive ? 'Pause Plan' : 'Resume Plan'}
               </button>
            </div>
         )}
      </>
   );
};

export default PlanActions;
