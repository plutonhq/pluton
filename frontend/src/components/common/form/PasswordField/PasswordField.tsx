import { useState } from 'react';
import Icon from '../../Icon/Icon';
import FormField from '../FormField/FormField';
import classes from './PasswordField.module.scss';

type PasswordFieldProps = {
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
   hint?: string;
   error?: string;
   onUpdate: (value: string) => void;
};

const PasswordField = ({
   label,
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
   onUpdate,
}: PasswordFieldProps) => {
   const [showPassword, setShowPassword] = useState(false);

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
            type={showPassword ? 'text' : 'password'}
            className={`${classes.input} ${disabled ? classes.disabled : ''}`}
            value={fieldValue}
            onChange={handleChange}
            placeholder={placeholder}
            required={required}
            disabled={disabled}
         />

         <button className={classes.viewPassBtn} onClick={() => setShowPassword(!showPassword)} type="button">
            <Icon type={showPassword ? 'eye-hide' : 'eye'} />
         </button>
      </FormField>
   );
};

export default PasswordField;
