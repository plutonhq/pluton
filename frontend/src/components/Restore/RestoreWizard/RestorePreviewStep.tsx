import { useEffect } from 'react';
import classes from './RestoreWizard.module.scss';
import { useGetDryRestoreStats } from '../../../services/restores';
import { RestoredFileItem, RestoredItemsStats, RestoreSettings } from '../../../@types/restores';
import RestoredFileBrowser from '../RestoredFileBrowser/RestoredFileBrowser';
import Icon from '../../common/Icon/Icon';

interface RestorePreviewStepProps {
   backupId: string;
   planId: string;
   settings: RestoreSettings;
   preview: { stats: RestoredItemsStats | null; files: RestoredFileItem[] };
   nextLabel?: string;
   updatePreview: (preview: RestorePreviewStepProps['preview']) => void;
   goBack: () => void;
   goNext: () => void;
   close: () => void;
}

const RestorePreviewStep = ({ backupId, planId, settings, preview, nextLabel, goBack, updatePreview, goNext, close }: RestorePreviewStepProps) => {
   const restoreStats = preview.stats;
   const restoredFiles = preview.files || [];
   // const [previousSettings, setPreviousSettings] = useState({ type: 'original', path: '', overwrite: 'always' });
   const previousSettings: undefined | RestorePreviewStepProps['settings'] = (window as any)[`pluton-restore-prev-${backupId}-settings`];
   const restoreStatsMutation = useGetDryRestoreStats();

   useEffect(() => {
      if (settings.includes !== previousSettings?.includes || settings.excludes !== previousSettings?.excludes) {
         updatePreview({ files: [], stats: null });
         restoreStatsMutation.reset();
      }
      if (settings.delete !== previousSettings?.delete) {
         updatePreview({ files: [], stats: null });
         restoreStatsMutation.reset();
      }
      if ((settings.type === 'custom' && settings.path) || settings.type === 'original') {
         const settingsChanged =
            previousSettings &&
            (previousSettings.type !== settings.type || previousSettings.path !== settings.path || previousSettings.overwrite !== settings.overwrite);
         console.log('settingsChanged :', settingsChanged, settings, previousSettings);
         if (settingsChanged) {
            updatePreview({ files: [], stats: null });
            restoreStatsMutation.reset();
         }
      }
   }, [settings, previousSettings]);

   const getDryRestoreStats = () => {
      console.log('restore :', backupId);

      restoreStatsMutation.mutate(
         {
            backupId: backupId,
            planId,
            target: settings.type === 'custom' ? settings.path : '',
            overwrite: settings.overwrite,
            includes: settings.includes,
            excludes: settings.excludes,
            deleteOption: settings.delete,
         },
         {
            onSuccess: (data) => {
               console.log('getDryRestoreStats Data :', data);
               updatePreview({ files: data?.result?.files || [], stats: data?.result?.stats || null });
               (window as any)[`pluton-restore-prev-${backupId}-settings`] = settings;
            },
         },
      );
   };

   console.log('[RestorePreviewStep] :', settings, restoreStats);

   return (
      <div className={classes.stepContent}>
         <div className={classes.step}>
            {!restoreStats && (
               <div className={`${classes.preview} ${!restoreStats ? classes.previewEmpty : ''}`}>
                  {restoreStatsMutation.isError && (
                     <div className={classes.previewError}>{restoreStatsMutation.error?.message || 'Failed to Generate Preview'}</div>
                  )}
                  <p>Before proceeding with the restoration, perform a dry run to preview what files will be restored</p>
                  <button
                     className={`${classes.previewButton} ${restoreStatsMutation.isPending ? classes.restoreDisabled : ''}`}
                     onClick={() => getDryRestoreStats()}
                     disabled={restoreStatsMutation.isPending}
                  >
                     {restoreStatsMutation.isPending ? (
                        <>
                           <Icon type="loading" size={12} /> Generating Preview...
                        </>
                     ) : (
                        <>
                           <Icon type="eye" size={13} /> Generate Preview
                        </>
                     )}
                  </button>
               </div>
            )}
            {restoreStats && <RestoredFileBrowser files={restoredFiles} stats={restoreStats} isPreview={true} />}
         </div>
         <div className={classes.footer}>
            <div className={classes.footerLeft}>
               <button className={classes.backButton} onClick={() => goBack()} disabled={restoreStatsMutation.isPending}>
                  <Icon type="arrow-left" size={14} /> Back
               </button>
            </div>
            <div className={classes.footerRight}>
               <button onClick={() => close()} disabled={restoreStatsMutation.isPending}>
                  Cancel
               </button>
               <button
                  title={!restoreStats ? 'Generate the Preview First' : ''}
                  className={!restoreStats ? classes.restoreDisabled : ''}
                  onClick={() => ((settings.type === 'custom' && settings.path) || settings.type === 'original') && restoreStats && goNext()}
               >
                  {nextLabel || 'Next: Restore Backup'} <Icon type="arrow-right" size={14} />
               </button>
            </div>
         </div>
      </div>
   );
};

export default RestorePreviewStep;
