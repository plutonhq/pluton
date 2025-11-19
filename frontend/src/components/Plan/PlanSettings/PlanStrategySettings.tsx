import classes from './PlanSettings.module.scss';
import { NewPlanSettings } from '../../../@types/plans';
import RadioIconSelect from '../../common/form/RadioIconSelect/RadioIconSelect';

interface PlanStrategySettingsProps {
   plan: NewPlanSettings;
   disabled?: boolean;
   options?: {
      value: string;
      icon: string;
      label: string;
      description: string;
      disabled?: boolean;
   }[];
   onUpdate: (method: string) => void;
}

const PlanStrategySettings = ({ plan, options = [], disabled = false, onUpdate }: PlanStrategySettingsProps) => {
   return (
      <div className={`${classes.field}`}>
         <RadioIconSelect
            label="Backup Strategy*"
            options={options}
            fieldValue={plan.method}
            onUpdate={(method) => onUpdate(method)}
            disabled={disabled}
            showDescription={true}
            layout="list"
         />
      </div>
   );
};

export default PlanStrategySettings;
