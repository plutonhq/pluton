import { NewPlanSettings, PlanAddRunSettings } from '../../../@types/plans';
import NumberInput from '../../common/form/NumberInput/NumberInput';
import Toggle from '../../common/form/Toggle/Toggle';
import classes from './PlanSettings.module.scss';

interface PlanGeneralSettingsProps {
   settings: NewPlanSettings['settings'];
   onUpdate: (settings: NewPlanSettings['settings']) => void;
   isEditing: boolean;
   runSettings?: PlanAddRunSettings;
   setRunSettings?: (runSettings: PlanAddRunSettings) => void;
}

const PlanGeneralSettings = ({ settings, onUpdate, isEditing, runSettings, setRunSettings }: PlanGeneralSettingsProps) => {
   const { encryption, compression, retries, retryDelay } = settings;
   return (
      <>
         <div className={classes.field}>
            <label className={classes.label}>Encryption</label>
            <Toggle
               fieldValue={encryption}
               disabled={isEditing}
               onUpdate={(val: boolean) => onUpdate({ ...settings, encryption: val })}
               description="Encrypt Source Files before backup"
            />
         </div>
         <div className={classes.field}>
            <label className={classes.label}>Compression</label>
            <Toggle
               fieldValue={compression}
               onUpdate={(val: boolean) => onUpdate({ ...settings, compression: val })}
               description="Compress Source Files before backup"
            />
         </div>
         <div className={classes.field}>
            <NumberInput
               label="Retries"
               fieldValue={retries}
               onUpdate={(val: number) => onUpdate({ ...settings, retries: val })}
               hint="How many times a failed backups is retried. Default: 5."
               inline={false}
            />
         </div>
         <div className={classes.field}>
            <NumberInput
               label="Retries Delay"
               fieldValue={retryDelay}
               onUpdate={(val: number) => onUpdate({ ...settings, retryDelay: val })}
               hint="How long to wait before retrying a failed backup. Default: 300 seconds."
               inline={false}
            />
         </div>
         {!isEditing && setRunSettings && (
            <div className={`${classes.field} ${classes.runNowField}`}>
               <label className={classes.label}>Run Backup Now</label>
               <Toggle
                  fieldValue={runSettings?.runNow ?? true}
                  onUpdate={(val: boolean) => setRunSettings && setRunSettings({ ...runSettings, runNow: val })}
                  description={'Run backup immediately after creating the plan'}
               />
            </div>
         )}
      </>
   );
};

export default PlanGeneralSettings;
