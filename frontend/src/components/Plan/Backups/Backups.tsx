import { useState } from 'react';
import { toast } from 'react-toastify';
import { Plan } from '../../../@types/plans';
import { Backup } from '../../../@types/backups';
import { formatBytes, formatDateTime, formatDuration, formatNumberToK, timeAgo } from '../../../utils/helpers';
import Icon from '../../common/Icon/Icon';
import classes from './Backups.module.scss';
import ActionModal from '../../common/ActionModal/ActionModal';
import { useCancelBackupDownload, useDeleteBackup, useDownloadBackup, useGetBackupDownload, useUpdateBackup } from '../../../services/backups';
import { useQueryClient } from '@tanstack/react-query';
import RestoreWizard from '../../Restore/RestoreWizard/RestoreWizard';
import StatusLabel from '../../common/StatusLabel/StatusLabel';
import BackupEvents from '../BackupEvents/BackupEvents';
import Input from '../../common/form/Input/Input';

const DownloadLabel = ({ download, downloadBackup }: { download: Backup['download']; downloadBackup: () => void }) => {
   if (download?.status === 'started') {
      return (
         <span
            className={classes.downloadLabel}
            data-tooltip-id="htmlToolTip"
            data-tooltip-place="top"
            data-tooltip-html={`<div>Generating Download...</div>`}
         >
            <Icon type="downloading" size={14} />
         </span>
      );
   } else if (download?.status === 'failed') {
      return (
         <span
            className={`${classes.downloadLabelFailed} ${classes.downloadLabel}`}
            data-tooltip-id="htmlToolTip"
            data-tooltip-place="top"
            data-tooltip-html={`<div><div>Download Generation Failed!</div>${download.error ? `<div>${download.error}<div>` : ''}</div>`}
         >
            <Icon type="error" size={12} />
         </span>
      );
   } else if (download?.status === 'complete') {
      let remainingHours;
      if (download?.ended) {
         const endTime = download.ended * 1000;
         const validUntil = endTime + 24 * 60 * 60 * 1000;
         const now = Date.now();
         remainingHours = Math.max(0, Math.floor((validUntil - now) / (60 * 60 * 1000)));
      }

      return remainingHours ? (
         <span
            className={`${classes.downloadLabelDone} ${classes.downloadLabel}`}
            onClick={downloadBackup}
            data-tooltip-id="htmlToolTip"
            data-tooltip-place="top"
            data-tooltip-html={`<div><div>Download Generated. Click to Download. ${remainingHours ? `Valid for the next ${remainingHours} hours.` : '⚠ Download Expired!'} </div>`}
         >
            <Icon type="download" size={12} />
         </span>
      ) : null;
   } else {
      return;
   }
};

const Backups = ({
   planId,
   method,
   backups = [],
   sourceId,
   sourceType,
   // snapLimit,
}: {
   planId: string;
   method: string;
   backups: Plan['backups'];
   sourceId: string;
   sourceType: string;
   snapLimit: number;
}) => {
   const [showSnapOptions, setShowSnapOptions] = useState<false | string>(false);
   const [showDeleteModal, setShowDeleteModal] = useState<Backup | false>(false);
   const [showRestoreModal, setShowRestoreModal] = useState<Backup | false>(false);
   const [showBackupEvents, setShowBackupEvents] = useState<false | string>(false);
   const [showEditModal, setShowEditModal] = useState<Backup | false>(false);
   const queryClient = useQueryClient();
   const deleteBackupMutation = useDeleteBackup();
   const updateBackupMutation = useUpdateBackup();
   const downloadBackupMutation = useDownloadBackup();
   const cancelDownloadMutation = useCancelBackupDownload();
   const getDownloadMutation = useGetBackupDownload();
   const isSync = method === 'sync';

   console.log('backups :', backups);

   const removeBackup = (backup: Backup) => {
      console.log('remove :', backup.id);
      deleteBackupMutation.mutate(backup.id, {
         onError: () => {
            toast.error(`Failed to Remove "backup-${backup.id}"`);
         },
         onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['plan', planId] });
            toast.success(`Backup "backup-${backup.id}" Removed Successfully.`);
            setShowDeleteModal(false);
         },
      });
   };

   const updateBackup = (backup: Backup) => {
      const payload = {
         title: backup.title,
         description: backup.description,
      };
      console.log('update :', backup.id, payload);
      if (!payload.title && !payload.description) {
         return;
      }
      updateBackupMutation.mutate(
         { backupId: backup.id, updatePayload: payload },
         {
            onError: () => {
               toast.error(`Failed to Update "backup-${backup.id}"`);
            },
            onSuccess: () => {
               queryClient.invalidateQueries({ queryKey: ['plan', planId] });
               toast.success(`Backup "backup-${backup.id}" Updated Successfully.`);
               setShowEditModal(false);
            },
         },
      );
   };

   const downloadBackup = (backupId: string) => {
      toast.promise(downloadBackupMutation.mutateAsync({ backupId, planId }), {
         pending: 'Sending Download Request...',
         success: 'Generating Download. This might take a while..',
         error: {
            render({ data }: any) {
               return `Failed to Generate Download. ${data?.message || 'Unknown Error.'}`;
            },
         },
      });
   };

   const cancelDownload = (backupId: string) => {
      toast.promise(cancelDownloadMutation.mutateAsync({ backupId, planId }), {
         pending: 'Cancelling Download...',
         success: 'Download Cancelled',
         error: {
            render({ data }: any) {
               return `Failed to Cancel Download. ${data?.message || 'Unknown Error.'}`;
            },
         },
      });
   };

   return (
      <div className={classes.backupsTable}>
         <div className={classes.backupsTableHead}>
            <div>{isSync ? 'Sync' : 'Backup'} ID</div>
            <div>Status</div>
            <div>Duration</div>
            <div>Changes</div>
            <div>Size</div>
            <div>Date</div>
            <div></div>
         </div>
         <div className={classes.backupsTableContent}>
            {backups
               .filter((s) => !s.inProgress)
               .map((snapshot) => {
                  const { id, title, description, started, ended, download, status, errorMsg, duration, totalFiles, totalSize, changes, active } =
                     snapshot;
                  const isDownloading = download && download.status === 'started';

                  return (
                     <div
                        key={id}
                        className={`${classes.backupsTableRow} ${showSnapOptions && showSnapOptions === id ? classes.backupsTableRowActive : ''}`}
                     >
                        <div>
                           <span
                              className={classes.editIcon}
                              onClick={() => setShowEditModal(snapshot)}
                              data-tooltip-id="htmlToolTip"
                              data-tooltip-html={`Edit Title & Description`}
                           >
                              <Icon type="edit" size={12} />
                           </span>
                           <span className={classes.backupTitle} onClick={() => !isSync && setShowBackupEvents(id)}>
                              <Icon type={isSync ? 'sync' : 'box'} size={14} /> {title ? title : isSync ? `sync-${id}` : `backup-${id}`}{' '}
                           </span>
                           {description && (
                              <span className={classes.backupDescription} data-tooltip-id="htmlToolTip" data-tooltip-content={description}>
                                 <Icon type="note" size={13} />
                              </span>
                           )}
                           {!isSync && active && (
                              <span className={classes.activeBackup} data-tooltip-id="htmlToolTip" data-tooltip-html={`Active Snapshot`}>
                                 <Icon type="bolt" size={14} />
                              </span>
                           )}
                           {download && <DownloadLabel download={download} downloadBackup={() => getDownloadMutation.mutate(id)} />}
                        </div>
                        <div
                           className={`${classes.status} ${errorMsg ? classes.statusHasError : ''}`}
                           data-tooltip-id="htmlToolTip"
                           data-tooltip-html={`<div><string>Error</string>: ${errorMsg}</div>`}
                           data-tooltip-hidden={!errorMsg}
                        >
                           <StatusLabel status={status} hasError={!!errorMsg} />
                        </div>
                        <div title={duration + 's'}>{formatDuration(duration)}</div>
                        <div
                           className={classes.changes}
                           data-tooltip-id="htmlToolTip"
                           data-tooltip-html={`
                                          <div><b>New Items</b>: ${changes.new}</div>
                                          <div><b>Modified Items</b>: ${changes.modified}</div>
                                          <div><b>Deleted Items</b>: ${changes.removed || 0}</div>
                                       `}
                        >
                           <span className={classes.changesNew}>
                              <Icon type="file-new" size={12} /> {changes.new}
                           </span>{' '}
                           <span className={classes.changesModified}>
                              <Icon type="file-modified" size={12} /> {changes.modified}
                           </span>{' '}
                           <span className={classes.changesRemoved}>
                              <Icon type="file-removed" size={12} /> {changes.removed || 0}
                           </span>
                        </div>
                        <div data-tooltip-id="htmlToolTip" data-tooltip-html={`${formatNumberToK(totalFiles)} Files `}>
                           {formatBytes(totalSize)}
                        </div>
                        <div
                           data-tooltip-id="htmlToolTip"
                           data-tooltip-html={`
                                          <div><b>Started</b>: ${formatDateTime(started)}</div>
                                          <div><b>Ended</b>: ${ended ? formatDateTime(ended) : ''}</div>
                                       `}
                           title={formatDateTime(ended || started)}
                        >
                           {ended ? timeAgo(new Date(ended)) : timeAgo(started ? new Date(started) : new Date())}
                        </div>
                        <div className={classes.snapOptsBtn}>
                           <button onClick={() => setShowSnapOptions(showSnapOptions && showSnapOptions === id ? false : id)}>
                              <Icon type="dots-vertical" size={12} />
                           </button>
                        </div>
                        {showSnapOptions === id && (
                           <div className={classes.settings}>
                              {!isSync && status === 'completed' && active && (
                                 <button
                                    className={downloadBackupMutation.isPending || cancelDownloadMutation.isPending ? 'notAllowed' : ''}
                                    disabled={downloadBackupMutation.isPending || cancelDownloadMutation.isPending}
                                    onClick={() => {
                                       if (isDownloading) {
                                          cancelDownload(id);
                                       } else {
                                          downloadBackup(id);
                                       }
                                       setShowSnapOptions(false);
                                    }}
                                 >
                                    <Icon type={isDownloading ? 'close' : 'download'} size={14} /> {isDownloading ? 'Cancel Download' : 'Download'}
                                 </button>
                              )}
                              {status === 'completed' && active && (
                                 <button
                                    className={isDownloading ? 'notAllowed' : ''}
                                    disabled={isDownloading}
                                    onClick={() => {
                                       if (isDownloading) {
                                          return;
                                       }
                                       setShowRestoreModal(snapshot);
                                       setShowSnapOptions(false);
                                    }}
                                 >
                                    <Icon type="restore" size={14} /> Restore
                                 </button>
                              )}
                              <button
                                 className={isDownloading ? 'notAllowed' : ''}
                                 disabled={isDownloading}
                                 onClick={() => {
                                    if (isDownloading) {
                                       return;
                                    }
                                    setShowDeleteModal(snapshot);
                                    setShowSnapOptions(false);
                                 }}
                              >
                                 <Icon type="trash" size={14} /> Remove
                              </button>
                           </div>
                        )}
                     </div>
                  );
               })}
            {backups.length === 0 && <div className={classes.noBackups}>Hasn't been backed up yet.</div>}
         </div>
         {showDeleteModal && (
            <ActionModal
               title="Remove Backup"
               message={
                  <>
                     Are you sure you want to remove the Backup <strong>"backup-{showDeleteModal.id}"</strong>?
                  </>
               }
               closeModal={() => !deleteBackupMutation.isPending && setShowDeleteModal(false)}
               width="400px"
               primaryAction={{
                  title: 'Yes, Remove Backup',
                  type: 'danger',
                  icon: 'trash',
                  isPending: deleteBackupMutation.isPending,
                  action: () => removeBackup(showDeleteModal),
               }}
            />
         )}
         {showRestoreModal && <RestoreWizard close={() => setShowRestoreModal(false)} planId={planId} backupId={showRestoreModal.id} />}
         {showBackupEvents && (
            <BackupEvents
               id={showBackupEvents}
               planId={planId}
               sourceId={sourceId}
               sourceType={sourceType}
               close={() => setShowBackupEvents(false)}
            />
         )}
         {showEditModal && (
            <ActionModal
               title="Edit Backup Title & Description"
               message={
                  <div className={classes.updateModalContent}>
                     <div className={classes.field}>
                        <Input
                           label="Title"
                           fieldValue={showEditModal.title || ''}
                           onUpdate={(val) => setShowEditModal({ ...showEditModal, title: val })}
                           placeholder="Enter Backup Title"
                           full={true}
                           inline={false}
                        />
                     </div>
                     <div className={classes.field}>
                        <Input
                           label="Description"
                           fieldValue={showEditModal.description || ''}
                           onUpdate={(val) => setShowEditModal({ ...showEditModal, description: val })}
                           placeholder="Enter Backup Description"
                           full={true}
                           inline={false}
                        />
                     </div>
                  </div>
               }
               closeModal={() => !updateBackupMutation.isPending && setShowEditModal(false)}
               width="400px"
               primaryAction={{
                  title: 'Update Backup',
                  type: 'default',
                  isPending: updateBackupMutation.isPending,
                  action: () => updateBackup(showEditModal),
               }}
            />
         )}
      </div>
   );
};

export default Backups;
