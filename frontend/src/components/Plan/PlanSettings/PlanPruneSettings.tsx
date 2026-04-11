import classes from './PlanSettings.module.scss';
import Select from '../../common/form/Select/Select';
import Tristate from '../../common/form/Tristate/Tristate';
import { NewPlanSettings } from '../../../@types/plans';
import NumberInput from '../../common/form/NumberInput/NumberInput';
import Toggle from '../../common/form/Toggle/Toggle';

interface PlanPruneSettingsProps {
   plan: NewPlanSettings;
   onUpdate: (pruneSettings: NewPlanSettings['settings']['prune']) => void;
}

const PlanPruneSettings = ({ plan, onUpdate }: PlanPruneSettingsProps) => {
   const pruneSettings = plan.settings?.prune || {};

   return (
      <>
         <div className={classes.field}>
            <label className={classes.label}>Backup Retention Policy</label>
            <Select
               options={[
                  { label: 'Keep Number of Backups', value: 'keepLast' },
                  { label: 'Remove Backups By Age', value: 'forgetByAge' },
                  { label: 'Advanced Policy', value: 'custom' },
                  { label: 'Keep All Backups (Disable Pruning)', value: 'disable' },
               ]}
               fieldValue={pruneSettings.policy || 'keepLast'}
               onUpdate={(val: string) => {
                  // Reset snapCount to a default safe value if switching contexts, or retain if preferred
                  onUpdate({ ...pruneSettings, policy: val, snapCount: val === 'keepLast' ? 5 : pruneSettings.snapCount });
               }}
            />
         </div>

         {/* OPTION 1: KEEP LAST N */}
         {pruneSettings.policy === 'keepLast' && (
            <div className={classes.field}>
               <NumberInput
                  label="Number of Backups to Keep"
                  fieldValue={pruneSettings.snapCount || 5}
                  onUpdate={(val) => onUpdate({ ...pruneSettings, snapCount: val })}
                  placeholder="5"
                  min={1}
                  hint="Only the most recent 5 backups will be kept."
                  inline={false}
               />
            </div>
         )}

         {/* OPTION 2: REMOVE BY AGE */}
         {pruneSettings.policy === 'forgetByAge' && (
            <>
               <div className={classes.field}>
                  <label className={classes.label}>Remove Backups Older Than</label>
                  <div className={classes.forgetByAgeField}>
                     <NumberInput
                        fieldValue={pruneSettings.forgetAge ? parseInt(pruneSettings.forgetAge.replace(/\D/g, ''), 10) : 3}
                        onUpdate={(val) =>
                           onUpdate({
                              ...pruneSettings,
                              forgetAge: (pruneSettings.forgetAge || '3m').replace(/\d+/g, val.toString()),
                           })
                        }
                        placeholder="3"
                        min={1}
                        full={true}
                     />
                     <Tristate
                        fieldValue={(pruneSettings.forgetAge || '3m').replace(/\d/g, '')}
                        options={[
                           { label: 'Days', value: 'd' },
                           { label: 'Weeks', value: 'w' },
                           { label: 'Months', value: 'm' },
                           { label: 'Years', value: 'y' },
                        ]}
                        onUpdate={(val: string) =>
                           onUpdate({
                              ...pruneSettings,
                              forgetAge: (pruneSettings.forgetAge || '3m').replace(/\D/g, val),
                           })
                        }
                     />
                  </div>
               </div>

               {/* Fail-safe keeping minimum N backups so they aren't left with 0 backups if backups fail for a month */}
               <div className={classes.field}>
                  <label className={classes.label}>Minimum numbers of backups to keep</label>
                  <div>
                     <NumberInput
                        fieldValue={pruneSettings.snapCount || 1}
                        onUpdate={(val) => onUpdate({ ...pruneSettings, snapCount: val })}
                        min={1}
                        placeholder="3"
                        full={true}
                     />
                  </div>
               </div>
            </>
         )}

         {/* OPTION 3: ADVANCED */}
         {pruneSettings.policy === 'custom' && (
            <div className={classes.field}>
               <label className={classes.label}>Advanced Policy Settings</label>
               <small className={classes.helperText} style={{ marginBottom: '15px', display: 'block', color: 'var(--text-muted)' }}>
                  A backup is kept if it matches <strong>ANY</strong> of the checked rules below.
               </small>

               {/* Keep Daily */}
               <div className={classes.customPolicyOption}>
                  <Toggle
                     fieldValue={!!pruneSettings.keepDailySnaps}
                     onUpdate={(val) => onUpdate({ ...pruneSettings, keepDailySnaps: val ? 7 : undefined })}
                     customClasses={classes.removeRemoteToggle}
                     inline={true}
                  />
                  <span>Keep the latest daily backup for</span>
                  <NumberInput
                     fieldValue={pruneSettings.keepDailySnaps || ''}
                     onUpdate={(val) => onUpdate({ ...pruneSettings, keepDailySnaps: val })}
                     min={1}
                  />
                  <span>Days</span>
               </div>

               {/* Keep Weekly */}
               <div className={classes.customPolicyOption}>
                  <Toggle
                     fieldValue={!!pruneSettings.keepWeeklySnaps}
                     onUpdate={(val) => onUpdate({ ...pruneSettings, keepWeeklySnaps: val ? 4 : undefined })}
                     customClasses={classes.removeRemoteToggle}
                     inline={true}
                  />
                  <span>Keep the latest weekly backup for</span>
                  <NumberInput
                     fieldValue={pruneSettings.keepWeeklySnaps || ''}
                     onUpdate={(val) => onUpdate({ ...pruneSettings, keepWeeklySnaps: val })}
                     min={1}
                  />
                  <span>Weeks</span>
               </div>

               {/* Keep Monthly */}
               <div className={classes.customPolicyOption}>
                  <Toggle
                     fieldValue={!!pruneSettings.keepMonthlySnaps}
                     onUpdate={(val) => onUpdate({ ...pruneSettings, keepMonthlySnaps: val ? 12 : undefined })}
                     customClasses={classes.removeRemoteToggle}
                     inline={true}
                  />
                  <span>Keep the latest monthly backup for</span>
                  <NumberInput
                     fieldValue={pruneSettings.keepMonthlySnaps || ''}
                     onUpdate={(val) => onUpdate({ ...pruneSettings, keepMonthlySnaps: val })}
                     min={1}
                  />
                  <span>Months</span>
               </div>
               {/* Fail-safe keeping minimum N backups so they aren't left with 0 backups if backups fail for a month */}
               <div className={classes.field} style={{ marginTop: '15px' }}>
                  <label className={classes.label}>Minimum numbers of backups to keep</label>
                  <div>
                     <NumberInput
                        fieldValue={pruneSettings.snapCount || 1}
                        onUpdate={(val) => onUpdate({ ...pruneSettings, snapCount: val })}
                        min={1}
                        placeholder="3"
                        full={true}
                     />
                  </div>
               </div>
            </div>
         )}

         {/* OPTION 4: DISABLE */}
         {pruneSettings.policy === 'disable' && (
            <div className={classes.field}>
               <small className={classes.helperText}>
                  Pruning is disabled. Old backups will never be deleted. Make sure you have enough storage!
               </small>
            </div>
         )}
      </>
   );
};

export default PlanPruneSettings;
