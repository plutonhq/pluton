import { useState } from 'react';
import { toast } from 'react-toastify';
import { useQueryClient } from '@tanstack/react-query';
import Icon from '../../common/Icon/Icon';
import ActionModal from '../../common/ActionModal/ActionModal';
import { RestoreSlim } from '../../../@types/restores';
import { formatBytes, formatDateTime, formatDuration, formatNumberToK, timeAgo } from '../../../utils/helpers';
import classes from '../Backups/Backups.module.scss';
import StatusLabel from '../../common/StatusLabel/StatusLabel';
import { useDeleteRestore } from '../../../services/restores';
import BackupEvents from '../BackupEvents/BackupEvents';
import RestoreChangeViewer from '../../Restore/RestoreChangeViewer/RestoreChangeViewer';

const Restores = ({
   planId,
   method,
   restores = [],
   sourceId,
   sourceType,
}: {
   planId: string;
   method: string;
   sourceId: string;
   sourceType: string;
   restores: RestoreSlim[];
}) => {
   const [showSnapOptions, setShowSnapOptions] = useState<false | string>(false);
   const [previewRestore, setPreviewRestore] = useState<false | RestoreSlim>(false);
   const [showDeleteModal, setShowDeleteModal] = useState<RestoreSlim | false>(false);
   const [showRestoreEvents, setShowRestoreEvents] = useState<false | string>(false);
   const queryClient = useQueryClient();
   const deleteRestoreMutation = useDeleteRestore();

   const removeRestore = (restore: RestoreSlim) => {
      console.log('remove :', restore.id);
      deleteRestoreMutation.mutate(restore.id, {
         onError: () => {
            toast.error(`Failed to Remove Restore Entry`);
         },
         onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['plan', planId] });
            toast.success(`Restore Entry Removed Successfully.`, { autoClose: 5000 });
            setShowDeleteModal(false);
         },
      });
   };

   const isSync = method === 'sync';

   return (
      <div className={classes.backupsTable}>
         <div className={classes.backupsTableHead}>
            <div>Restored Backup</div>
            <div>Status</div>
            <div>Duration</div>
            <div>Restore Path</div>
            <div>Files</div>
            <div>Date</div>
            <div></div>
         </div>
         <div className={classes.backupsTableContent}>
            {restores
               .filter((s) => s.status !== 'started')
               .map((restore) => {
                  const { id, backupId, started, ended, config, status, taskStats, errorMsg } = restore;
                  const duration = started && ended && new Date(ended).getTime() / 1000 - new Date(started).getTime() / 1000;
                  return (
                     <div
                        key={id}
                        className={`${classes.backupsTableRow} ${showSnapOptions && showSnapOptions === id ? classes.backupsTableRowActive : ''}`}
                     >
                        <div className={classes.backupTitle} onClick={() => !isSync && setShowRestoreEvents(id)}>
                           <Icon type={isSync ? 'sync' : 'box'} size={14} /> {isSync ? 'sync' : 'backup'}-{backupId}
                        </div>
                        <div
                           className={classes.status}
                           data-tooltip-id="htmlToolTip"
                           data-tooltip-html={`<div><string>Error</string>: ${errorMsg}</div>`}
                           data-tooltip-hidden={!errorMsg}
                        >
                           <StatusLabel status={status} hasError={!!errorMsg} />
                        </div>
                        <div title={duration + 's'}>{formatDuration(duration)}</div>
                        <div className={classes.target} data-tooltip-id="htmlToolTip" data-tooltip-html={`${config.target}`}>
                           {config.target || 'Original'}
                        </div>
                        <div data-tooltip-id="" data-tooltip-html={formatBytes(taskStats?.bytes_restored || 0)}>
                           {formatNumberToK(taskStats?.files_restored || 0)}
                        </div>
                        <div title={formatDateTime(ended || started)}>{ended ? timeAgo(new Date(ended)) : timeAgo(new Date(started))}</div>
                        <div className={classes.snapOptsBtn}>
                           <button onClick={() => setShowSnapOptions(showSnapOptions && showSnapOptions === id ? false : id)}>
                              <Icon type="dots-vertical" size={12} />
                           </button>
                        </div>
                        {showSnapOptions === id && (
                           <div className={classes.settings}>
                              <button
                                 onClick={() => {
                                    setPreviewRestore(restore);
                                    setShowSnapOptions(false);
                                 }}
                              >
                                 <Icon type={'eye'} size={14} /> View Changes
                              </button>
                              <button
                                 onClick={() => {
                                    setShowDeleteModal(restore);
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
            {restores.length === 0 && <div className={classes.noBackups}>No Backups Restored Yet.</div>}
         </div>
         {showDeleteModal && (
            <ActionModal
               title="Remove Restore Entry"
               message={
                  <>
                     Are you sure you want to remove this Restore entry <strong>"restore-{showDeleteModal.id}"</strong> from the database?
                  </>
               }
               closeModal={() => !deleteRestoreMutation.isPending && setShowDeleteModal(false)}
               width="400px"
               primaryAction={{
                  title: 'Yes, Remove Restore',
                  type: 'danger',
                  icon: 'trash',
                  isPending: deleteRestoreMutation.isPending,
                  action: () => removeRestore(showDeleteModal),
               }}
            />
         )}
         {previewRestore && previewRestore?.taskStats && <RestoreChangeViewer restore={previewRestore} close={() => setPreviewRestore(false)} />}
         {showRestoreEvents && (
            <BackupEvents
               id={showRestoreEvents}
               type="restore"
               planId={planId}
               sourceId={sourceId}
               sourceType={sourceType}
               close={() => setShowRestoreEvents(false)}
            />
         )}
      </div>
   );
};

export default Restores;
