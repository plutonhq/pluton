import Icon from '../../common/Icon/Icon';
import { useRestoreBackup } from '../../../services/restores';
import classes from './RestoreWizard.module.scss';
import { RestoredItemsStats, RestoreSettings } from '../../../@types/restores';

interface RestoreConfirmStepProps {
   backupId: string;
   planId: string;
   settings: RestoreSettings;
   stats: RestoredItemsStats | null;
   method: string;
   snapshotsStats: { total_files: number; total_bytes: number };
   goBack: () => void;
   close: () => void;
}

const RestoreConfirmStep = ({ backupId, planId, settings, stats, snapshotsStats, method, goBack, close }: RestoreConfirmStepProps) => {
   const restoreMutation = useRestoreBackup();
   const restoreStats = stats;
   const isSync = method === 'sync';

   const restoreBackup = () => {
      console.log('restore :', backupId);
      restoreMutation.mutate({
         backupId,
         planId,
         overwrite: settings.overwrite,
         target: settings.type === 'custom' ? settings.path : '',
         includes: settings.includes,
         excludes: settings.excludes,
         deleteOption: settings.delete,
      });
   };

   return (
      <div className={classes.stepContent}>
         <div className={classes.step}>
            {!restoreMutation.isSuccess && (
               <div className={classes.restoreConfirm}>
                  <p>
                     {restoreStats ? (
                        <strong>
                           {restoreStats?.files_restored}
                           {!isSync ? `/${snapshotsStats.total_files} files` : ''}
                        </strong>
                     ) : (
                        `The content of the Backup (${backupId}) `
                     )}{' '}
                     will be restored to{' '}
                     <strong>
                        {settings.type === 'original' ? (isSync ? 'the original source path' : 'their original source paths') : `"${settings.path}"`}
                     </strong>
                     . Are you sure you want to proceed with the Restore?
                  </p>
                  <button
                     className={`${classes.restoreButton} ${restoreMutation.isPending ? classes.restoreDisabled : ''}`}
                     onClick={() => restoreBackup()}
                     disabled={restoreMutation.isPending}
                  >
                     {restoreMutation.isPending ? (
                        <>
                           <Icon type="loading" size={12} /> Starting Restore...
                        </>
                     ) : (
                        <>
                           <Icon type="restore" size={14} /> Yes, Restore
                        </>
                     )}
                  </button>
               </div>
            )}
            {restoreMutation.isSuccess && (
               <p className={classes.restoreSuccessMsg}>
                  <Icon type="check-circle-filled" size={14} color="lightseagreen" /> Restore Process Started.{' '}
                  <button onClick={() => location.reload()}>
                     <Icon type="reload" size={12} /> Reload
                  </button>{' '}
                  the page to view the restoration progress.
               </p>
            )}
            {restoreMutation.isError && (
               <div className={classes.restoreError}>
                  <Icon type="error" size={14} color="red" /> {restoreMutation.error?.message || 'Failed to Generate Preview'}
               </div>
            )}
         </div>
         <div className={classes.footer}>
            <div className={classes.footerLeft}>
               {!restoreMutation.isSuccess && (
                  <button className={classes.backButton} onClick={() => goBack()} disabled={restoreMutation.isPending}>
                     <Icon type="arrow-left" size={14} /> Back
                  </button>
               )}
            </div>
            <div className={classes.footerRight}>
               <button onClick={() => close()} disabled={restoreMutation.isPending}>
                  {restoreMutation.isSuccess ? 'Close' : 'Cancel'}
               </button>
            </div>
         </div>
      </div>
   );
};

export default RestoreConfirmStep;
