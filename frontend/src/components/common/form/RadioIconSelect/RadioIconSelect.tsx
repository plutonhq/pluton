import { useId } from 'react';
import Icon from '../../Icon/Icon';
import FormField from '../FormField/FormField';
import classes from './RadioIconSelect.module.scss';

interface RadioIconSelectProps {
   label: string;
   options: { label: string; description: string; value: string; icon: string; disabled?: boolean }[];
   fieldValue: string;
   layout?: 'grid' | 'list';
   disabled?: boolean;
   showDescription?: boolean;
   hint?: string;
   inline?: boolean;
   customClasses?: string;
   onUpdate: (type: string) => void;
   onDisableClick?: (value: string) => void;
}

const RadioIconSelect = ({
   label,
   options,
   fieldValue,
   showDescription = false,
   disabled = false,
   hint,
   inline = false,
   layout = 'grid',
   customClasses,
   onUpdate,
   onDisableClick,
}: RadioIconSelectProps) => {
   const groupName = useId();
   return (
      <FormField type="radioIconSelect" label={label} classes={classes.radioIconField} hint={hint} inline={inline}>
         <div
            className={`${classes.radioIconFieldOptions} ${disabled ? classes.radioIconFieldOptionsDisabled : ''} ${showDescription ? classes.radioIconFieldOptionsDesc : ''} ${layout === 'list' ? classes.radioIconFieldList : ''} ${customClasses || ''}`}
         >
            {options.map((option) => {
               const { label, value, icon, description, disabled = false } = option;
               return (
                  <label
                     key={value}
                     className={`${classes.radioIconFieldOption} ${disabled ? classes.radioIconFieldDisabled : ''} ${fieldValue === value ? classes.radioIconFieldActive : ''}`}
                     onClick={() => {
                        if (disabled && onDisableClick) {
                           onDisableClick(value);
                        }
                     }}
                     data-tooltip-id="appTooltip"
                     data-tooltip-content={description}
                     data-tooltip-place="top"
                     data-tooltip-delay-show={300}
                  >
                     <input
                        type="radio"
                        name={groupName}
                        value={value}
                        checked={fieldValue === value}
                        disabled={disabled}
                        onChange={() => onUpdate(value)}
                     />
                     {fieldValue === value && <Icon classes="checkMark" type="check-circle-filled" size={14} />}
                     <div className={classes.radioIconFieldIcon}>
                        <Icon type={icon} size={30} />
                     </div>
                     <div className={classes.radioIconFieldContent}>
                        {showDescription ? (
                           <>
                              <h4>{label}</h4>
                              <p>{description}</p>
                           </>
                        ) : (
                           <h4>{label}</h4>
                        )}
                     </div>
                  </label>
               );
            })}
         </div>
      </FormField>
   );
};

export default RadioIconSelect;
