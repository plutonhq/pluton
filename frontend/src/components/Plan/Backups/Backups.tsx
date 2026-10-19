import { useState } from 'react';
import { toast } from 'react-toastify';
import { Plan } from '../../../@types/plans';
import { Backup } from '../../../@types/backups';
import { backupRowActions } from '../../../utils/backupDownload';
import { formatBytes, formatDuration, formatNumberToK } from '../../../utils/helpers';
import Icon from '../../common/Icon/Icon';
import classes from './Backups.module.scss';
import ActionModal from '../../common/ActionModal/ActionModal';
import DeleteDependencyNotice from '../../common/ActionModal/DeleteDependencyNotice';
import {
   useCancelBackupDownload,
   useDeleteBackup,
   useDownloadBackup,
   useGetBackupDownload,
   useUpdateBackup,
   useBrowseSnapshot,
} from '../../../services/backups';
import { useQueryClient } from '@tanstack/react-query';
import RestoreWizard from '../../Restore/RestoreWizard/RestoreWizard';
import StatusLabel from '../../common/StatusLabel/StatusLabel';
import BackupEvents from '../BackupEvents/BackupEvents';
import Input from '../../common/form/Input/Input';
import MirrorStatusBadge from '../Mirrors/MirrorStatusBadge';
import MirrorStorageSelectorModal from '../Mirrors/MirrorStorageSelectorModal';
import { Modal, SidePanel, SnapshotViewer } from '../..';
import { useRecoveryAction, useRecoveryTests } from '../../../services/recoveryTests';
import { canTestRecovery, recoveryActive, recoveryForBackup, recoveryStatusLabel } from '../../../utils/recoveryTests';
import RecoveryResult from '../RecoveryTesting/RecoveryResult';
import RecoveryConfirmation from '../RecoveryTesting/RecoveryConfirmation';
import DatabaseRestoreWizard from '../../Restore/DatabaseRestore/DatabaseRestoreWizard';
import recoveryClasses from '../RecoveryTesting/RecoveryTesting.module.scss';
import { backupStatistics, statisticHelp } from '../../../utils/backupStatistics';
import { displayTimeZone, formatHistoryDate, historyIsoDate } from '../../../utils/backupHistory';
import BackupRowMenu from './BackupRowMenu';

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
   replicationSettings,
   storage,
   deviceId,
   timeZone = displayTimeZone(),
   emptyMessage = "Hasn't been backed up yet.",
   // snapLimit,
}: {
   planId: string;
   method: string;
   backups: Plan['backups'];
   sourceId: string;
   sourceType: string;
   snapLimit: number;
   deviceId: string;
   timeZone?: string;
   emptyMessage?: string;
   storage: {
      id: string;
      type: string;
      name: string;
   };
   replicationSettings: Plan['settings']['replication'];
}) => {
   const [showSnapOptions, setShowSnapOptions] = useState<false | string>(false);
   const [showDeleteModal, setShowDeleteModal] = useState<Backup | false>(false);
   const [showRestoreModal, setShowRestoreModal] = useState<Backup | false>(false);
   const [showBackupEvents, setShowBackupEvents] = useState<false | string>(false);
   const [showSnapshotViewer, setShowSnapshotViewer] = useState<Backup | false>(false);
   const [showBackupError, setShowBackupError] = useState<string | false>(false);
   const [showEditModal, setShowEditModal] = useState<Backup | false>(false);
   const [showStorageSelector, setShowStorageSelector] = useState<Backup | false>(false);
   const queryClient = useQueryClient();
   const deleteBackupMutation = useDeleteBackup();
   const updateBackupMutation = useUpdateBackup();
   const downloadBackupMutation = useDownloadBackup();
   const cancelDownloadMutation = useCancelBackupDownload();
   const getDownloadMutation = useGetBackupDownload();
   const browseSnapshotMutation = useBrowseSnapshot();
   const isSync = method === 'sync';
   const isRemoteManaged = sourceType === 'device' && sourceId !== 'main' && method === 'backup';
   const recoveryTests = useRecoveryTests(
      planId,
      isRemoteManaged,
      backups.map((backup) => backup.id),
   );
   const recoveryAction = useRecoveryAction(planId);
   const [recoveryResultId, setRecoveryResultId] = useState<string>();
   const [recoveryConfirmation, setRecoveryConfirmation] = useState<{ backupId: string; snapshotId: string; operation: 'test' | 'restore' }>();
   const shownRecovery = recoveryTests.data?.find((test) => test.id === recoveryResultId);

   const snapshotFiles = browseSnapshotMutation.data?.result;

   const removeBackup = (backup: Backup) => {
      if (deleteBackupMutation.isPending) return;
      console.log('remove :', backup.id);
      deleteBackupMutation.mutate(backup.id, {
         onError: (error: Error) => {
            toast.error(error.message || `No reliable response for backup removal. Refresh and check its status before trying again.`);
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

   const handleDownloadClick = (backup: Backup) => {
      if (!isRemoteManaged && replicationSettings?.enabled && backup.mirrors && backup.mirrors.some((m) => m.status === 'completed')) {
         setShowStorageSelector(backup);
      } else {
         downloadBackup(backup.id);
      }
   };

   const downloadBackup = (backupId: string, replicationId?: string) => {
      toast.promise(downloadBackupMutation.mutateAsync({ backupId, planId, replicationId }), {
         pending: 'Sending Download Request...',
         success: isRemoteManaged ? 'Download started. Check your browser downloads.' : 'Generating Download. This might take a while..',
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
      <div className={classes.backupsTable} data-backup-table>
         <div className={classes.backupsTableHead}>
            <div>{isSync ? 'Sync' : 'Backup'} ID</div>
            <div>Status</div>
            <div>Duration</div>
            <div>Changes</div>
            <div title={statisticHelp.snapshotSize}>{isSync ? 'Size' : 'Snapshot Size'}</div>
            <div>Date</div>
            <div aria-label="Actions"></div>
         </div>
         <div className={classes.backupsTableContent}>
            {backups
               .filter((s) => !s.inProgress)
               .map((snapshot) => {
                  const { id, title, description, started, ended, download, status, errorMsg, duration, totalFiles, totalSize, changes, active } =
                     snapshot;
                  const dateValue = ended ?? started ?? snapshot.createdAt;
                  const isDownloading = !isRemoteManaged && download && download.status === 'started';
                  const actions = backupRowActions(snapshot, isSync, isRemoteManaged);
                  const lifecycleWarning = status === 'completed' && !!snapshot.completionStats?.lifecycle?.warnings.length;
                  const counters = backupStatistics(snapshot.completionStats as unknown as Record<string, unknown>);
                  const newFiles = isRemoteManaged ? counters.newFiles : changes.new;
                  const modifiedFiles = isRemoteManaged ? counters.modifiedFiles : changes.modified;
                  const measuredFiles = isRemoteManaged ? counters.totalFiles : totalFiles;
                  const measuredSize = isRemoteManaged ? counters.logicalBytes : totalSize;
                  const recovery = recoveryForBackup(recoveryTests.data || [], id, snapshot.completionStats?.snapshot_id);

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
                           {(snapshot.mirrors?.length || (replicationSettings?.enabled && replicationSettings.storages.length > 0)) && (
                              <MirrorStatusBadge mirrors={snapshot.mirrors || []} planId={planId} backupId={id} replicationSettings={replicationSettings} managedAgent={isRemoteManaged} />
                           )}
                           {!isRemoteManaged && download && (
                              <DownloadLabel download={download} downloadBackup={() => getDownloadMutation.mutate(id)} />
                           )}
                        </div>
                        <div
                           className={`${classes.status} ${errorMsg ? classes.statusHasError : ''}`}
                           data-tooltip-id="htmlToolTip"
                           data-tooltip-html={`<div class="linebreak-tooltip-content"><string>Error</string>: ${errorMsg?.slice(0, 120) + (errorMsg && errorMsg.length > 120 ? '...' : '')}</div>`}
                           data-tooltip-hidden={!errorMsg}
                           onClick={() => errorMsg && (lifecycleWarning || errorMsg.length > 120) && setShowBackupError(errorMsg)}
                        >
                           {lifecycleWarning ? (
                              <span title="Snapshot completed; post-backup/cleanup needs attention">Complete · Cleanup warning</span>
                           ) : (
                              <StatusLabel status={status} hasError={!!errorMsg} />
                           )}
                           {isRemoteManaged && status === 'completed' && (
                              <span className={recoveryClasses.badge}>
                                 Recovery: {recoveryTests.error ? 'Unavailable' : recovery ? recoveryStatusLabel[recovery.status] : 'Not tested'}
                              </span>
                           )}
                        </div>
                        <div title={duration + 's'}>{formatDuration(duration)}</div>
                        <div
                           className={classes.changes}
                           data-tooltip-id="htmlToolTip"
                           data-tooltip-html={`
                                          <div><b>New Files</b>: ${newFiles ?? 'Not measured'}</div>
                                          <div><b>Modified Files</b>: ${modifiedFiles ?? 'Not measured'}</div>
                                          <div><b>Unmodified Files</b>: ${counters.unmodifiedFiles ?? 'Not measured'}</div>
                                          <div><b>Deleted Files</b>: ${isSync ? changes.removed || 0 : 'Not measured'}</div>
                                       `}
                        >
                           <span className={classes.changesNew}>
                              <Icon type="file-new" size={12} /> {newFiles ?? '—'}
                           </span>{' '}
                           <span className={classes.changesModified}>
                              <Icon type="file-modified" size={12} /> {modifiedFiles ?? '—'}
                           </span>{' '}
                           {isSync && (
                              <span className={classes.changesRemoved}>
                                 <Icon type="file-removed" size={12} /> {changes.removed || 0}
                              </span>
                           )}
                        </div>
                        <div
                           title={statisticHelp.snapshotSize}
                           data-tooltip-id="htmlToolTip"
                           data-tooltip-html={`${measuredFiles === undefined ? 'Not measured' : formatNumberToK(measuredFiles) + ' Files'} · ${isSync ? 'Sync size' : 'Logical snapshot data'}`}
                        >
                           {measuredSize === undefined ? 'Not measured' : formatBytes(measuredSize)}
                        </div>
                        <div
                           data-tooltip-id="htmlToolTip"
                           data-tooltip-html={`
                                          <div><b>Started</b>: ${started ? formatHistoryDate(started, timeZone) : 'Not recorded'}</div>
                                          <div><b>Ended</b>: ${ended ? formatHistoryDate(ended, timeZone) : 'Not recorded'}</div>
                                       `}
                           title={`${formatHistoryDate(dateValue, timeZone)} (${timeZone})`}
                        >
                           <time dateTime={historyIsoDate(dateValue)}>{formatHistoryDate(dateValue, timeZone)}</time>
                        </div>
                        <div className={classes.snapOptsBtn}>
                           <BackupRowMenu backupId={id} open={showSnapOptions === id} onOpenChange={(open) => setShowSnapOptions(open ? id : false)}>
                              {isRemoteManaged && canTestRecovery(snapshot) && (
                                 <button
                                    disabled={recoveryAction.isPending || (recoveryTests.data || []).some(recoveryActive)}
                                    onClick={() => {
                                       setRecoveryConfirmation({
                                          backupId: id,
                                          snapshotId: snapshot.completionStats!.snapshot_id,
                                          operation: 'test',
                                       });
                                       setShowSnapOptions(false);
                                    }}
                                 >
                                    <Icon type="restore" size={14} /> Run Recovery Test
                                 </button>
                              )}
                              {isRemoteManaged && canTestRecovery(snapshot) && (
                                 <button
                                    onClick={() => {
                                       setRecoveryConfirmation({
                                          backupId: id,
                                          snapshotId: snapshot.completionStats!.snapshot_id,
                                          operation: 'restore',
                                       });
                                       setShowSnapOptions(false);
                                    }}
                                 >
                                    <Icon type="restore" size={14} /> Restore Database
                                 </button>
                              )}
                              {isRemoteManaged && recovery && (
                                 <button
                                    onClick={() => {
                                       setRecoveryResultId(recovery.id);
                                       setShowSnapOptions(false);
                                    }}
                                 >
                                    <Icon type="note" size={14} /> View Recovery Result
                                 </button>
                              )}
                              {actions.download && (
                                 <button
                                    className={downloadBackupMutation.isPending || cancelDownloadMutation.isPending ? 'notAllowed' : ''}
                                    disabled={downloadBackupMutation.isPending || cancelDownloadMutation.isPending}
                                    onClick={() => {
                                       if (isDownloading) {
                                          cancelDownload(id);
                                       } else {
                                          handleDownloadClick(snapshot);
                                       }
                                       setShowSnapOptions(false);
                                    }}
                                 >
                                    <Icon type={isDownloading ? 'close' : 'download'} size={14} /> {isDownloading ? 'Cancel Download' : 'Download'}
                                 </button>
                              )}
                              {actions.browse && (
                                 <button
                                    onClick={() => {
                                       toast.promise(browseSnapshotMutation.mutateAsync({ backupId: id }), {
                                          pending: 'Getting Snapshot Data...',
                                          error: 'Failed to Get Snapshot Data.',
                                       });
                                       setShowSnapOptions(false);
                                       setShowSnapshotViewer(snapshot);
                                    }}
                                 >
                                    <Icon type="folders" size={14} /> Browse
                                 </button>
                              )}
                              {actions.restore && (
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
                              {actions.remove && (
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
                              )}
                           </BackupRowMenu>
                        </div>
                     </div>
                  );
               })}
            {backups.length === 0 && <div className={classes.noBackups}>{emptyMessage}</div>}
         </div>
         {recoveryConfirmation?.operation === 'restore' && (
            <DatabaseRestoreWizard
               selection={{ planId, backupId: recoveryConfirmation.backupId, snapshotId: recoveryConfirmation.snapshotId }}
               close={() => setRecoveryConfirmation(undefined)}
            />
         )}
         {recoveryConfirmation?.operation === 'test' && (
            <RecoveryConfirmation
               {...recoveryConfirmation}
               planId={planId}
               pending={recoveryAction.isPending}
               close={() => !recoveryAction.isPending && setRecoveryConfirmation(undefined)}
               confirm={(body) =>
                  recoveryAction.mutate(body, {
                     onSuccess: (test) => {
                        setRecoveryConfirmation(undefined);
                        setRecoveryResultId(test.id);
                     },
                     onError: (error) => toast.error(error.message),
                  })
               }
            />
         )}
         {shownRecovery && (
            <RecoveryResult
               test={shownRecovery}
               close={() => setRecoveryResultId(undefined)}
               pending={recoveryAction.isPending}
               cancel={() => recoveryAction.mutate({ cancelId: shownRecovery.id }, { onError: (error) => toast.error(error.message) })}
            />
         )}
         {showDeleteModal && (
            <ActionModal
               title="Remove Backup"
               message={
                  <>
                     Are you sure you want to remove the Backup <strong>"backup-{showDeleteModal.id}"</strong>?
                  </>
               }
               closeModal={() => !deleteBackupMutation.isPending && setShowDeleteModal(false)}
               errorMessage={deleteBackupMutation.error ? <DeleteDependencyNotice error={deleteBackupMutation.error} /> : undefined}
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
         {showRestoreModal && (
            <RestoreWizard
               close={() => setShowRestoreModal(false)}
               planId={planId}
               backupId={showRestoreModal.id}
               deviceId={deviceId}
               stagingOnly={isRemoteManaged}
               planStorage={storage}
               mirrors={
                  !isRemoteManaged &&
                  replicationSettings?.enabled &&
                  showRestoreModal.mirrors &&
                  showRestoreModal.mirrors.some((m) => m.status === 'completed')
                     ? showRestoreModal.mirrors
                     : []
               }
            />
         )}
         {showBackupEvents && (
            <BackupEvents
               id={showBackupEvents}
               completionStats={backups.find((backup) => backup.id === showBackupEvents)?.completionStats}
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
         {showStorageSelector && (
            <MirrorStorageSelectorModal
               mirrors={showStorageSelector.mirrors || []}
               primaryStorage={storage}
               onSelect={(replicationId) => {
                  downloadBackup(showStorageSelector.id, replicationId);
                  setShowStorageSelector(false);
               }}
               onClose={() => setShowStorageSelector(false)}
            />
         )}
         {showSnapshotViewer && showSnapshotViewer.id && browseSnapshotMutation.isSuccess && (
            <SidePanel width="100%" title="Browse Snapshot" icon={<Icon type={'folders'} size={20} />} close={() => setShowSnapshotViewer(false)}>
               <SnapshotViewer
                  files={snapshotFiles || []}
                  backup={showSnapshotViewer}
                  planId={planId}
                  isSync={isSync}
                  stagingOnly={isRemoteManaged}
                  onClose={() => setShowSnapshotViewer(false)}
                  mirrors={!isRemoteManaged && replicationSettings?.enabled ? showSnapshotViewer.mirrors : undefined}
                  primaryStorage={!isRemoteManaged && replicationSettings?.enabled ? storage : undefined}
               />
            </SidePanel>
         )}
         {showBackupError && (
            <Modal title="Error Details" closeModal={() => setShowBackupError(false)} width={'600px'}>
               <div className={`${classes.errorDetailsModal} styled__scrollbar`}>
                  {showBackupError.split('\n').map((line, index) => (
                     <p key={index}>{line}</p>
                  ))}
               </div>
            </Modal>
         )}
      </div>
   );
};

export default Backups;
