import classes from './PlanSettings.module.scss';
import Select from '../../common/form/Select/Select';
import Input from '../../common/form/Input/Input';
import Tristate from '../../common/form/Tristate/Tristate';
import { NewPlanSettings } from '../../../@types/plans';
import NumberInput from '../../common/form/NumberInput/NumberInput';

interface PlanPruneSettingsProps {
   plan: NewPlanSettings;
   onUpdate: (pruneSettings: NewPlanSettings['settings']['prune']) => void;
}

const PlanPruneSettings = ({ plan, onUpdate }: PlanPruneSettingsProps) => {
   const pruneSettings = plan.settings?.prune;

   return (
      <>
         <div className={classes.field}>
            <label className={classes.label}>Snapshot Removal Policy</label>
            <Select
               options={[
                  { label: 'Remove by Age', value: 'forgetByAge' },
                  { label: 'Remove by Date', value: 'forgetByDate' },
                  { label: 'Custom Prune Policy', value: 'custom' },
               ]}
               fieldValue={pruneSettings.policy}
               onUpdate={(val: string) => onUpdate({ ...pruneSettings, policy: val })}
            />
         </div>
         {pruneSettings.policy === 'forgetByAge' && (
            <div className={classes.field}>
               <label className={classes.label}>Remove Snapshots Older Than</label>
               <div className={classes.forgetByAgeField}>
                  <NumberInput
                     fieldValue={pruneSettings.forgetAge ? parseInt(pruneSettings.forgetAge.replace(/\D/g, ''), 10) : 3}
                     onUpdate={(val) =>
                        onUpdate({
                           ...pruneSettings,
                           forgetAge: (pruneSettings.forgetAge || '3m').replace(/\d+/g, val.toString()),
                        })
                     }
                     placeholder="5"
                     min={1}
                     full={true}
                  />
                  <Tristate
                     fieldValue={(pruneSettings.forgetAge || '3m').replace(/\d/g, '')}
                     options={[
                        { label: 'Days', value: 'd' },
                        { label: 'Weeks', value: 'w' },
                        { label: 'Months', value: 'm' },
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
         )}
         {pruneSettings.policy === 'forgetByDate' && (
            <div className={classes.field} style={{ width: '200px' }}>
               <label className={classes.label}>Remove Snapshots Older Than</label>
               <Input type="date" fieldValue={pruneSettings.forgetDate || ''} onUpdate={(val) => onUpdate({ ...pruneSettings, forgetDate: val })} />
            </div>
         )}
         {pruneSettings.policy === 'custom' && (
            <>
               <div className={classes.field}>
                  <label className={classes.label}>Custom Policy Settings</label>
                  <div className={classes.customPolicyOption}>
                     <span>Keep Daily Snapshots for </span>
                     <NumberInput
                        fieldValue={pruneSettings.keepDailySnaps || ''}
                        onUpdate={(val) => onUpdate({ ...pruneSettings, keepDailySnaps: val })}
                     />
                     <span>Days</span>
                  </div>
                  <div className={classes.customPolicyOption}>
                     <span>Keep Weekly Snapshots for </span>
                     <NumberInput
                        fieldValue={pruneSettings.keepWeeklySnaps || ''}
                        onUpdate={(val) => onUpdate({ ...pruneSettings, keepWeeklySnaps: val })}
                     />
                     <span>Days</span>
                  </div>
                  <div className={classes.customPolicyOption}>
                     <span>Keep Monthly Snapshots for </span>
                     <NumberInput
                        fieldValue={pruneSettings.keepMonthlySnaps || ''}
                        onUpdate={(val) => onUpdate({ ...pruneSettings, keepMonthlySnaps: val })}
                     />
                     <span>Days</span>
                  </div>
               </div>
            </>
         )}
      </>
   );
};

export default PlanPruneSettings;
