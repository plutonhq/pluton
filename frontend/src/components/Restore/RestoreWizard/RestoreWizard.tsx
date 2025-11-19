import { useMemo, useState } from 'react';
import { useIsFetching, useIsMutating } from '@tanstack/react-query';
import Icon from '../../common/Icon/Icon';
import classes from './RestoreWizard.module.scss';
import RestoreSettingsStep from './RestoreSettingsStep';
import RestorePreviewStep from './RestorePreviewStep';
import RestoreConfirmStep from './RestoreConfirmStep';
import { RestoredFileItem, RestoredItemsStats, RestoreFileItem, RestoreSettings } from '../../../@types/restores';
import { useGetSnapshotFiles } from '../../../services/backups';
import RestoreFileSelectorStep from './RestoreFileSelectorStep';

interface RestoreWizardProps {
   backupId: string;
   planId: string;
   close: () => void;
}

const RestoreWizard = ({ backupId, planId, close }: RestoreWizardProps) => {
   const [step, setStep] = useState(1);
   const [restoreSettings, setRestoreSettings] = useState<RestoreSettings>({
      type: 'original',
      path: '',
      overwrite: 'always',
      includes: [],
      excludes: [],
      delete: false,
   });
   const [restorePreview, setRestorePreview] = useState<{ stats: RestoredItemsStats | null; files: RestoredFileItem[] }>({ stats: null, files: [] });
   const isFetching = useIsFetching();
   const isMutating = useIsMutating();
   const isLoading = isFetching > 0 || isMutating > 0;
   const { data: snapshotData, error: snapShotError } = useGetSnapshotFiles({ backupId });
   const files: RestoreFileItem[] = snapshotData?.result && Array.isArray(snapshotData.result) ? snapshotData.result : [];

   const snapShotsStats = useMemo(() => {
      return {
         total_files: files.length,
         total_bytes: files.reduce((acc, file) => acc + file.size, 0),
      };
   }, [files]);

   return (
      <div className={classes.restoreWizard}>
         <div className={classes.content} style={{ maxWidth: ((step === 2 || step === 3) && 1200) || undefined }}>
            <div className={classes.header}>
               <h3>
                  <Icon type="restore" size={16} /> Restore Backup
               </h3>
               <button className={classes.close} onClick={() => !isLoading && close()}>
                  <Icon type="close" size={24} />
               </button>
            </div>
            <div className={classes.steps}>
               <ul>
                  <li className={` ${step >= 1 ? classes.stepCurrent : ''}  ${step > 1 ? classes.stepPassed : ''}`}>
                     <span>
                        {step > 1 && <Icon type="check" size={11} />}
                        {step === 1 ? '●' : ''}
                     </span>
                     <i>Settings</i>
                  </li>
                  <li className={` ${step >= 2 ? classes.stepCurrent : ''}  ${step > 2 ? classes.stepPassed : ''}`}>
                     <span>
                        {step > 2 && <Icon type="check" size={11} />}
                        {step === 2 ? '●' : ''}
                     </span>
                     <i>Select Files</i>
                  </li>
                  <li className={` ${step >= 3 ? classes.stepCurrent : ''} ${step > 3 ? classes.stepPassed : ''}`}>
                     <span>
                        {step > 3 && <Icon type="check" size={11} />}
                        {step === 3 ? '●' : ''}
                     </span>
                     <i>Preview</i>
                  </li>
                  <li className={` ${step === 4 ? classes.stepCurrent : ''}`}>
                     <span>{step === 4 && <Icon type="check" size={11} />}</span>
                     <i>Restore</i>
                  </li>
               </ul>
            </div>
            {step === 1 && (
               <RestoreSettingsStep
                  backupId={backupId}
                  settings={restoreSettings}
                  updateSettings={(settings) => setRestoreSettings(settings)}
                  goNext={() => setStep(2)}
                  close={close}
               />
            )}
            {step === 2 && (
               <RestoreFileSelectorStep
                  backupId={backupId}
                  settings={restoreSettings}
                  updateSettings={(settings) => setRestoreSettings(settings as RestoreSettings)}
                  files={files}
                  isLoading={isLoading}
                  errorFetching={snapShotError?.message || null}
                  currentStep={step}
                  goBack={() => step > 0 && setStep(step - 1)}
                  goNext={() => setStep(3)}
                  close={close}
                  method="backup"
               />
            )}
            {step === 3 && (
               <RestorePreviewStep
                  backupId={backupId}
                  planId={planId}
                  settings={restoreSettings}
                  preview={restorePreview}
                  updatePreview={(preview) => setRestorePreview(preview)}
                  goBack={() => step > 0 && setStep(step - 1)}
                  goNext={() => setStep(4)}
                  close={close}
               />
            )}
            {step === 4 && (
               <RestoreConfirmStep
                  backupId={backupId}
                  planId={planId}
                  settings={restoreSettings}
                  stats={restorePreview.stats}
                  snapshotsStats={snapShotsStats}
                  method="backup"
                  goBack={() => step > 0 && setStep(step - 1)}
                  close={close}
               />
            )}
         </div>
      </div>
   );
};

export default RestoreWizard;
