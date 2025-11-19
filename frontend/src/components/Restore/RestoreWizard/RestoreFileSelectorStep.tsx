import { RestoreFileItem, RestoreSettings } from '../../../@types/restores';
import Icon from '../../common/Icon/Icon';
import RestoreFileSelector from '../RestoreFileSelector/RestoreFileSelector';
import classes from './RestoreWizard.module.scss';

interface RestoreFileSelectorStepProps {
   backupId: string;
   settings: RestoreSettings;
   files: RestoreFileItem[];
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
               <button onClick={() => goNext()}>
                  {nextLabel || 'Next: Preview Restore'} <Icon type="arrow-right" size={14} />
               </button>
            </div>
         </div>
      </div>
   );
};

export default RestoreFileSelectorStep;
