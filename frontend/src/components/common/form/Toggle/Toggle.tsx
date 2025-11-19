import { nanoid } from 'nanoid';
import classes from './Toggle.module.scss';
import FormField from '../FormField/FormField';

type ToggleProps = {
   label?: string;
   description?: string;
   customClasses?: string;
   inline?: boolean;
   hint?: string;
   error?: string;
   fieldValue: boolean;
   onUpdate: (f: boolean) => void;
};

const Toggle = ({ label, description, customClasses = '', fieldValue = false, inline = false, hint = '', error, onUpdate }: ToggleProps) => {
   const toggleID = nanoid();
   const updateField = (event: React.FormEvent<HTMLInputElement>) => {
      const inputVal = event.currentTarget.value === 'true';
      onUpdate(!inputVal);
   };

   return (
      <FormField type="toggle" label={label} hint={hint} error={error} inline={inline} classes={`${classes.toggleField} ${customClasses}`}>
         <div className={classes.toggleCheckbox}>
            <input type="checkbox" id={toggleID} value={fieldValue.toString()} onChange={updateField} checked={fieldValue} />
            <label htmlFor={toggleID}>{label}</label>
            {description && <span className={classes.description}>{description}</span>}
         </div>
      </FormField>
   );
};

export default Toggle;
