import { useMutation } from '@tanstack/react-query';
import { toast } from 'react-toastify';
import { RestoreFileItem, RestoreSettings } from '../../../@types/restores';
import { getSnapshotSelection } from '../../../services/backups';
import Icon from '../../common/Icon/Icon';
import RestoreFileSelector, { RestoreIndexSource } from '../RestoreFileSelector/RestoreFileSelector';
import { withRootRule } from '../RestoreFileSelector/useRestoreFileSource';
import classes from './RestoreWizard.module.scss';

interface RestoreFileSelectorStepProps {
   backupId: string;
   settings: RestoreSettings;
   files: RestoreFileItem[];
   source?: RestoreIndexSource;
   isLoading: boolean;
   errorFetching: string | null;
   currentStep: number;
   method: string;
   updateSettings: (settings: RestoreSettings) => void;
   fileSelectCondition?: (file: RestoreFileItem) => boolean;
   goBack: () => void;
   goNext: () => void;
   close: () => void;
   nextLabel?: string;
}

const RestoreFileSelectorStep = ({
   backupId,
   settings,
   files,
   source,
   isLoading,
   errorFetching,
   nextLabel,
   currentStep,
   method = 'backup',
   updateSettings,
   goBack,
   goNext,
   close,
}: RestoreFileSelectorStepProps) => {
   const normalizeSelection = useMutation({
      mutationFn: (target: RestoreIndexSource) =>
         getSnapshotSelection(target, { includes: settings.includes, excludes: withRootRule(settings.includes, settings.excludes) }),
   });

   // Restic takes one list only. With no rules the index is not needed, so a full restore still works if it failed.
   const handleNext = () => {
      if (!source || (settings.includes.length === 0 && settings.excludes.length === 0)) {
         goNext();
         return;
      }
      normalizeSelection.mutate(source, {
         onSuccess: ({ normalized }) => {
            if (normalized.includes.length === 0 && normalized.excludes.includes('/')) {
               toast.error('Select at least one item to restore.');
               return;
            }
            updateSettings({ ...settings, ...normalized });
            goNext();
         },
         onError: (error) => {
            toast.error(error.message === 'selection_too_complex' ? 'Select fewer separate items.' : error.message);
         },
      });
   };

   return (
      <div className={classes.stepContent}>
         <div className={classes.step}>
            <RestoreFileSelector
               backupId={backupId}
               selected={{
                  includes: new Set(settings.includes),
                  excludes: new Set(settings.excludes),
               }}
               onSelect={(fileSettings) => {
                  updateSettings({
                     ...settings,
                     includes: Array.from(fileSettings.includes),
                     excludes: Array.from(fileSettings.excludes),
                  });
               }}
               files={files}
               source={source}
               isLoading={isLoading}
               errorFetching={errorFetching || null}
               fileSelectCondition={method === 'sync' ? (file) => file.changeType === 'modified' || file.changeType === 'removed' : undefined}
               showChange={method === 'sync' ? true : false}
            />
         </div>

         <div className={classes.footer}>
            <div className={classes.footerLeft}>
               {currentStep > 1 && (
                  <button className={classes.backButton} onClick={() => goBack()} disabled={isLoading}>
                     <Icon type="arrow-left" size={14} /> Back
                  </button>
               )}
            </div>
            <div className={classes.footerRight}>
               <button onClick={() => close()}>Cancel</button>
               <button onClick={handleNext} disabled={normalizeSelection.isPending}>
                  {nextLabel || 'Next: Preview Restore'} <Icon type="arrow-right" size={14} />
               </button>
            </div>
         </div>
      </div>
   );
};

export default RestoreFileSelectorStep;
