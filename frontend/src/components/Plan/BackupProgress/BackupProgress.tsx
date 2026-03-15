import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-toastify';
import Icon from '../../common/Icon/Icon';
import { useCancelBackup, useGetBackupProgress } from '../../../services/backups';
import classes from './BackupProgress.module.scss';
import { formatBytes, formatDateTime, formatSeconds, timeAgo } from '../../../utils/helpers';
import {
   generateBackupProgressMessage,
   extractResticData,
   generateRestoreProgressMessage,
   generateMirrorProgressMessage,
} from '../../../utils/progressHelpers';
import { Backup } from '../../../@types/backups';
import { RestoreSlim } from '../../../@types/restores';
import ActionModal from '../../common/ActionModal/ActionModal';
import { useCancelRestore, useGetRestoreProgress } from '../../../services/restores';
import BackupEvents from '../BackupEvents/BackupEvents';
import { ReplicationProgressData } from '../../../@types/backups';

interface BackupProgressProps {
   item: Backup | RestoreSlim;
   sourceId: string;
   sourceType: string;
   planId: string;
   type: 'backup' | 'restore';
}

const BackupProgress = ({ item, sourceId, sourceType, planId, type = 'backup' }: BackupProgressProps) => {
   const [showCancelModal, setShowCancelModal] = useState(false);
   const [showProgressDetails, setShowProgressDetails] = useState(false);
   const queryClient = useQueryClient();
   const cancelRestoreMutation = useCancelRestore();
   const cancelBackupMutation = useCancelBackup();

   const { id, started } = item;
   const { data: progressData } =
      type === 'backup' ? useGetBackupProgress({ id, sourceId, sourceType, planId }) : useGetRestoreProgress({ id, sourceId, sourceType, planId });

   console.log('#### data :', progressData);

   const resticData = extractResticData(progressData);
   const progressMessage = type === 'backup' ? generateBackupProgressMessage(progressData) : generateRestoreProgressMessage(progressData);

   // Extract progress values from restic data or use defaults
   const {
      total_files_processed: total_files = resticData?.total_files || 0,
      files_done = 0,
      total_bytes_processed: total_bytes = resticData?.total_bytes_processed || resticData?.total_bytes || 0,
      bytes_done = 0,
      bytes_restored = 0,
      files_restored = 0,
      seconds_remaining = 0,
      percent_done = 0,
   } = resticData || {};

   let filesProcessed = files_done;
   let bytesProcessed = bytes_done;
   let totalBytes = total_bytes;
   let totalFiles = total_files;
   let progressPercent = total_bytes ? Math.round((bytes_done / total_bytes) * 100) : 0;

   if (type === 'restore') {
      progressPercent = Math.round(percent_done * 100);
      if (resticData?.total_bytes) {
         totalBytes = resticData.total_bytes;
      }
      if (bytes_restored) {
         bytesProcessed = bytes_restored;
      } else {
         if (resticData?.total_bytes) {
            bytesProcessed = Math.round(percent_done * resticData.total_bytes);
         }
      }
      if (files_restored) {
         filesProcessed = files_restored;
      } else {
         if (resticData?.total_files) {
            filesProcessed = Math.round(percent_done * resticData.total_files);
         }
      }
   }

   // For completed backups, show 100% if we have summary data
   if (resticData?.message_type === 'summary') {
      progressPercent = 100;
      filesProcessed = totalFiles;
      bytesProcessed = totalBytes;
   }

   const cancel = () => {
      console.log('cancel :', type, item);
      if (type === 'backup') {
         toast.promise(
            cancelBackupMutation.mutateAsync(
               { planId, backupId: item.id },
               {
                  onSuccess: () => queryClient.invalidateQueries({ queryKey: ['plan', planId] }),
               },
            ),
            {
               pending: 'Sending Cancel Request...',
               success: 'Backup process Cancelled!',
               error: {
                  render({ data }: any) {
                     // When the promise reject, data will contains the error
                     return `Failed to cancel backup process. ${data?.message || 'Unknown Error.'}`;
                  },
               },
            },
         );
      } else {
         toast.promise(
            cancelRestoreMutation.mutateAsync(
               { planId, restoreId: item.id },
               {
                  onSuccess: () => queryClient.invalidateQueries({ queryKey: ['plan', planId] }),
               },
            ),
            {
               pending: 'Sending Cancel Request...',
               success: 'Restore process Cancelled!',
               error: {
                  render({ data }: any) {
                     // When the promise reject, data will contains the error
                     return `Failed to cancel restore process. ${data?.message || 'Unknown Error.'}`;
                  },
               },
            },
         );
      }
   };

   return (
      <div key={item.id} className={classes.backup}>
         <div key={item.id} className={classes.backupProgress}>
            <div className={classes.backupIcon}>
               <Icon type="loading" size={24} />
            </div>
            <div className={classes.backupLeft}>
               <div className={classes.backupId}>
                  {type === 'restore' ? 'Restoring ' : ''}backup-{id}
                  <span className={classes.backupTime} title={formatDateTime(started)}>
                     <Icon type="clock" size={12} /> Started {started ? timeAgo(new Date(started)) : 'a few seconds ago'}
                  </span>
                  {item.errorMsg && (
                     <span className={classes.backupError}>
                        <Icon type="error-circle-filled" size={13} />{' '}
                        <i data-tooltip-id="htmlToolTip" data-tooltip-place="top" data-tooltip-html={item.errorMsg}>
                           <u>Error</u> Occurred.
                        </i>{' '}
                        Retrying...
                     </span>
                  )}
               </div>
               <div className={classes.backupStart}>
                  <div>
                     <span className={classes.progressMessage} onClick={() => setShowProgressDetails(true)}>
                        {progressMessage}
                     </span>
                     {/* <Icon type="clock" size={12} /> Started {started ? timeAgo(new Date(started)) : 'a few seconds ago'} */}
                  </div>
                  <button onClick={() => setShowCancelModal(true)} title={`Cancel ${type}`}>
                     <Icon type="close" size={12} /> Cancel
                  </button>
               </div>
            </div>
            <div className={classes.backupRight}>
               <div className={classes.ProgressStats}>
                  <div className={classes.ProgressStatsLeft}>
                     <span>
                        {filesProcessed} / {totalFiles} Files
                     </span>
                     <i></i>
                     <span>
                        {formatBytes(bytesProcessed)} / {formatBytes(totalBytes)}
                     </span>
                  </div>
                  <div className={classes.ProgressStatsRight}>{type !== 'restore' && <>Remaining: {formatSeconds(seconds_remaining)}</>}</div>
               </div>
               <div className={classes.progressBar}>
                  <div
                     className={`${classes.progressBarFill} ${progressPercent > 3 ? classes.progressBarFilled : ''}`}
                     style={{ width: progressPercent + '%' }}
                  >
                     <span>{progressPercent}%</span>
                  </div>
               </div>
            </div>

            {showCancelModal && (
               <ActionModal
                  title={`Cancel ${type}`}
                  message={<>{`Are you sure you want to cancel the ${type} process?`}</>}
                  closeModal={() => setShowCancelModal(false)}
                  width="400px"
                  primaryAction={{
                     title: `Yes, Cancel ${type}`,
                     type: 'danger',
                     isPending: type === 'restore' ? cancelRestoreMutation.isPending : cancelBackupMutation.isPending,
                     action: () => cancel(),
                  }}
               />
            )}
            {showProgressDetails && (
               <BackupEvents
                  id={id}
                  type={type}
                  planId={planId}
                  sourceId={sourceId}
                  sourceType={sourceType}
                  progressData={progressData}
                  inProgress={true}
                  close={() => setShowProgressDetails(false)}
               />
            )}
         </div>
         {/* Mirrors Progress */}
         {progressData?.mirrors && Object.keys(progressData.mirrors).length > 0 && (
            <div className={classes.mirrorsSection}>
               <div className={classes.mirrorsTitle}>Replicating</div>
               <div className={classes.mirrorsList}>
                  {Object.entries(progressData.mirrors as Record<string, ReplicationProgressData>).map(([storageId, mirror]) => {
                     const mirrorResticData = mirror.events
                        ?.slice()
                        .reverse()
                        .find((e: any) => e.resticData)?.resticData;
                     const mirrorPercent = mirrorResticData?.percent_done ? Math.round(mirrorResticData.percent_done * 100) : 0;
                     const mirrorMessage = generateMirrorProgressMessage(mirror);

                     let mirrorStatusClass = classes.mirrorPending;
                     if (mirror.status === 'running')
                        mirrorStatusClass = mirrorPercent > 0 ? classes.mirrorRunning : classes.mirrorRunningIndeterminate;
                     if (mirror.status === 'completed') mirrorStatusClass = classes.mirrorCompleted;
                     if (mirror.status === 'failed') mirrorStatusClass = classes.mirrorFailed;
                     if (mirror.status === 'retrying') mirrorStatusClass = classes.mirrorRunningIndeterminate;

                     return (
                        <div key={storageId} className={classes.mirrorItem}>
                           <div className={classes.mirrorStorageIcon}>
                              {(mirror.status === 'running' || mirror.status === 'pending' || mirror.status === 'retrying') && (
                                 <Icon type="loading" size={12} />
                              )}
                              <img src={`/providers/${mirror.storageType}.png`} />
                           </div>
                           <div className={classes.mirrorProgress}>
                              <div className={classes.mirrorInfo}>
                                 <span className={classes.mirrorName}>{mirror.storageName}</span>
                                 <span className={`${classes.mirrorStatus} ${mirrorStatusClass}`}>
                                    {mirror.status === 'pending' && 'Pending'}
                                    {mirror.status === 'running' && (mirrorPercent > 0 ? `${mirrorPercent}% — ${mirrorMessage}` : mirrorMessage)}
                                    {mirror.status === 'completed' && (
                                       <>
                                          <Icon type="check" size={10} /> Completed
                                       </>
                                    )}
                                    {mirror.status === 'failed' && (
                                       <span data-tooltip-id="htmlToolTip" data-tooltip-html={mirror.error || 'Replication failed'}>
                                          <Icon type="error" size={12} /> Failed
                                       </span>
                                    )}
                                    {mirror.status === 'retrying' && mirrorMessage}
                                 </span>
                              </div>
                              <div className={classes.mirrorBar}>
                                 <div
                                    className={`${classes.mirrorBarFill} ${mirrorStatusClass}`}
                                    style={{
                                       width:
                                          mirror.status === 'completed'
                                             ? '100%'
                                             : mirror.status === 'failed'
                                               ? '100%'
                                               : mirrorPercent > 0
                                                 ? `${mirrorPercent}%`
                                                 : undefined,
                                    }}
                                 />
                              </div>
                           </div>
                        </div>
                     );
                  })}
               </div>
            </div>
         )}
      </div>
   );
};
export default BackupProgress;
