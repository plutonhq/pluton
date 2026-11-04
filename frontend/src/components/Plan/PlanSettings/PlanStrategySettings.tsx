import { useState } from 'react';
import classes from './PlanSettings.module.scss';
import { NewPlanSettings } from '../../../@types/plans';
import RadioIconSelect from '../../common/form/RadioIconSelect/RadioIconSelect';
import Upgrade from '../../Upgrade/Upgrade';

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
   const [showUpgrade, setShowUpgrade] = useState<string | false>(false);

   return (
      <>
         <div className={`${classes.field}`}>
            <RadioIconSelect
               label="Backup Strategy*"
               options={options}
               fieldValue={plan.sourceType === 'storage' ? 'storage-sync' : plan.method}
               onUpdate={(method) => onUpdate(method)}
               onDisableClick={(value) => {
                  const option = options.find((opt) => opt.value === value);
                  if (option && option.disabled) {
                     setShowUpgrade(value);
                  }
               }}
               disabled={disabled}
               showDescription={true}
               layout="list"
               customClasses={classes.planStrategySelect}
            />
         </div>
         {showUpgrade && <Upgrade focus={showUpgrade} onClose={() => setShowUpgrade(false)} />}
      </>
   );
};

export default PlanStrategySettings;
