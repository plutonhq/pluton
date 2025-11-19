import classes from './PlanSettings.module.scss';
import { NewPlanSettings } from '../../../@types/plans';
import RadioIconSelect from '../../common/form/RadioIconSelect/RadioIconSelect';

interface PlanTypeSettingsProps {
   plan: NewPlanSettings;
   disabled?: boolean;
   options: {
      value: string;
      icon: string;
      label: string;
      description: string;
      disabled?: boolean;
   }[];
   onUpdate: (plan: NewPlanSettings) => void;
}

const PlanTypeSettings = ({ plan, options=[], disabled = false, onUpdate }: PlanTypeSettingsProps) => {
   return (
      <div>
         <div className={`${classes.field}`}>
            <RadioIconSelect
               label="Backup Type*"
               options={options}
               fieldValue={plan.sourceType}
               onUpdate={(type) => onUpdate({ ...plan, sourceType: type as NewPlanSettings['sourceType'] })}
               disabled={disabled}
            />
         </div>
      </div>
   );
};

export default PlanTypeSettings;
