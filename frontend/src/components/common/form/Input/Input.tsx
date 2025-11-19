import FormField from '../FormField/FormField';
import classes from './Input.module.scss';

type InputProps = {
   label?: string;
   type?: 'text' | 'password' | 'email' | 'number' | 'date';
   size?: 'large' | 'medium' | 'small';
   full?: boolean;
   inline?: boolean;
   description?: string;
   placeholder?: string;
   customClasses?: string;
   fieldValue: string | number;
   required?: boolean;
   disabled?: boolean;
   min?: number;
   max?: number;
   hint?: string;
   error?: string;
   onUpdate: (value: string) => void;
};

const Input = ({
   label,
   type = 'text',
   size = 'medium',
   inline = true,
   full = false,
   description,
   placeholder,
   customClasses = '',
   fieldValue = '',
   hint = '',
   error = '',
   required = false,
   disabled = false,
   min,
   max,
   onUpdate,
}: InputProps) => {
   const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
      onUpdate(event.target.value);
   };

   return (
      <FormField
         type="input"
         label={label}
         description={description}
         hint={hint}
         error={error}
         required={required}
         inline={inline}
         classes={`${classes.inputField} ${classes[size]} ${full ? classes.inputFieldFull : ''} 
         ${full ? classes.inputFieldInline : ''} ${size === 'large' ? classes.inputFieldLarge : ''} ${customClasses}`}
      >
         <input
            type={type}
            className={`${classes.input} ${disabled ? classes.disabled : ''}`}
            value={fieldValue}
            onChange={handleChange}
            placeholder={placeholder}
            required={required}
            min={type === 'number' ? min : undefined}
            max={type === 'number' ? max : undefined}
            disabled={disabled}
         />
      </FormField>
   );
};

export default Input;
