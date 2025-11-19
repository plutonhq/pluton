import FormField from '../FormField/FormField';
import classes from './NumberInput.module.scss';

type NumberInputProps = {
   label?: string;
   size?: 'large' | 'medium' | 'small';
   full?: boolean;
   inline?: boolean;
   description?: string;
   placeholder?: string;
   customClasses?: string;
   fieldValue: number | '';
   required?: boolean;
   min?: number;
   max?: number;
   hint?: string;
   error?: string;
   onUpdate: (value: number) => void;
};

const NumberInput = ({
   label,
   size = 'medium',
   inline = true,
   full = false,
   description,
   placeholder,
   customClasses = '',
   fieldValue = '',
   hint = '',
   required = false,
   min,
   max,
   error,
   onUpdate,
}: NumberInputProps) => {
   const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
      onUpdate(Number(event.target.value));
   };

   const handleIncrement = () => {
      const newValue = (fieldValue || 0) + 1;
      if (max === undefined || newValue <= max) {
         onUpdate(newValue);
      }
   };

   const handleDecrement = () => {
      const newValue = (fieldValue || 0) - 1;
      if (min === undefined || newValue >= min) {
         onUpdate(newValue);
      }
   };

   return (
      <FormField
         type="number"
         label={label}
         description={description}
         hint={hint}
         error={error}
         required={required}
         inline={inline}
         classes={`${classes.numberInputField} ${classes.numberField} ${customClasses} ${inline ? classes.numberFieldInline : ''} ${error ? classes.fieldHasError : ''} ${
            size === 'large' ? classes.numberFieldLarge : ''
         } ${full ? classes.numberFieldFull : ''}`}
      >
         <div className={classes.numberInputWrapper}>
            <button className={classes.numberControl} onClick={handleDecrement}>
               —
            </button>
            <input
               type="number"
               className={classes.input}
               value={fieldValue}
               onChange={handleChange}
               placeholder={placeholder}
               required={required}
               min={min}
               max={max}
            />
            <button className={classes.numberControl} onClick={handleIncrement}>
               +
            </button>
         </div>
      </FormField>
   );
};

export default NumberInput;
