import Icon from '../../common/Icon/Icon';
import SidePanel from '../../common/SidePanel/SidePanel';
import { getBackupEventActionMessage, getRestoreEventActionMessage } from '../../../utils/progressHelpers';
import classes from './BackupEvents.module.scss';
import { BackupProgressData } from '../../../@types/backups';
import { useGetBackupProgressOnce } from '../../../services/backups';
import { useGetRestoreProgressOnce } from '../../../services/restores';
import { useMemo, useState } from 'react';
import Modal from '../../common/Modal/Modal';
import { formatDuration } from '../../../utils/helpers';

interface BackupEventsProps {
   id: string;
   planId: string;
   sourceId: string;
   sourceType: string;
   type?: 'backup' | 'restore';
   inProgress?: boolean;
   progressData?: BackupProgressData | null;
   close: () => void;
}

const BackupEvents = ({ id, type = 'backup', sourceId, sourceType, planId, inProgress, progressData, close }: BackupEventsProps) => {
   const [showError, setShowError] = useState<false | number>(false);
   const { data: fetchedProgressData } =
      type === 'backup'
         ? useGetBackupProgressOnce({ id, sourceId, sourceType, planId })
         : useGetRestoreProgressOnce({ id, sourceId, sourceType, planId });

   const progressDataToUse: BackupProgressData | null = progressData || fetchedProgressData;

   console.log('progressDataToUse :', progressDataToUse);
   const hasFinished = useMemo(() => {
      if (!progressDataToUse || !progressDataToUse.events) return '';
      let finishedEvent = '';
      progressDataToUse.events.forEach((event) => {
         if (event.action === 'TASK_COMPLETED') {
            finishedEvent = 'Completed';
         } else if (event.action === 'TASK_CANCELLED') {
            finishedEvent = 'Cancelled';
         } else if (event.action === 'FAILED_PERMANENTLY') {
            finishedEvent = 'Failed';
         }
      });
      return finishedEvent;
   }, [progressDataToUse]);

   return (
      <SidePanel title={`${type}-${id} Events`} width="1000px" icon={<Icon type={'logs'} size={18} />} footer={<></>} close={close}>
         <div className={classes.backupEventsContainer}>
            <div className={classes.header}>
               <div
                  title="Status"
                  className={`${classes.status} ${inProgress ? classes.inProgress : ''} 
               ${!inProgress && hasFinished === 'Completed' ? classes.hasCompleted : ''} ${!inProgress && hasFinished === 'Failed' ? classes.hasFailed : ''}`}
               >
                  <Icon type={inProgress ? 'loading' : hasFinished === 'Completed' ? 'check-circle-filled' : 'error-circle-filled'} size={14} />{' '}
                  {inProgress ? `${type} In Progress` : `${type} ${hasFinished}` || 'Unknown'}
               </div>
               <div title="Duration" className={classes.duration}>
                  <Icon type="clock" size={14} /> {(progressDataToUse?.duration && formatDuration(progressDataToUse.duration / 1000)) || 'N/A'}
               </div>
            </div>
            {progressDataToUse && progressDataToUse.events && progressDataToUse.events.length > 0 ? (
               <ul className={classes.eventList}>
                  {progressDataToUse.events.map((event: any, index: number) => {
                     const completed = event.phase === 'finished' && event.action === 'TASK_COMPLETED';
                     const failed = event.phase === 'finished' && event.action === 'FAILED_PERMANENTLY';
                     const retrying = event.action.includes('RETRY_ATTEMPT_');
                     const isError = event.action === 'TASK_FAILED';
                     const isWarning =
                        event.action === 'BACKUP_WARNING' ||
                        event.action === 'RESTORE_WARNING' ||
                        event.action === 'POST_BACKUP_PRUNE_FAILED' ||
                        event.action === 'POST_BACKUP_REPO_STATS_FAILED';
                     return (
                        <li
                           key={index}
                           className={`${classes.eventItem} ${event.error ? classes.error : ''} 
                           ${completed ? classes.completed : ''} ${failed ? classes.failed : ''} 
                           ${retrying ? classes.retrying : ''} ${isError ? classes.isError : ''} 
                           ${isWarning ? classes.isWarning : ''}`}
                        >
                           <span className={classes.icon}>
                              <Icon type={event.error || isWarning ? 'error-circle-filled' : 'check-circle-filled'} size={16} />
                           </span>
                           {/* Timestamp should be converted to time only eg: 10:20:23 AM */}
                           <span className={classes.time}>{new Date(event.timestamp).toLocaleTimeString()}</span>
                           <span className={classes.phase}>{event.phase}</span>
                           <span className={classes.action}>
                              {type === 'backup' ? getBackupEventActionMessage(event.action) : getRestoreEventActionMessage(event.action)}
                              {event.error && (
                                 <span className={classes.viewError} onClick={() => setShowError(index)}>
                                    View Error
                                 </span>
                              )}
                           </span>
                        </li>
                     );
                  })}
               </ul>
            ) : null}
         </div>
         {showError && (
            <Modal title="Error Details" closeModal={() => setShowError(false)} width="400px">
               <div className={classes.errorDetails}>{progressDataToUse?.events[showError]?.error || 'Unknown error occurred.'}</div>
            </Modal>
         )}
      </SidePanel>
   );
};

export default BackupEvents;
