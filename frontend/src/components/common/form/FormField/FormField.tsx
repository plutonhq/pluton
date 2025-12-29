import Icon from '../../Icon/Icon';
import classes from './FormField.module.scss';

interface FormFieldProps {
   type: string;
   label?: string;
   description?: string;
   hint?: string;
   error?: string;
   required?: boolean;
   children: React.ReactNode;
   inline?: boolean;
   classes?: string;
}

const FormField = ({ label, description, hint, error, required, children, inline, classes: customClasses }: FormFieldProps) => {
   return (
      <div className={`${classes.formField} ${inline ? classes.inline : classes.notLine} ${error ? classes.hasError : ''} ${customClasses}`}>
         <div className={classes.fieldInner}>
            {label && (
               <label className={classes.fieldLabel}>
                  {label}
                  {required && <span className={classes.required}>*</span>}
                  {hint && (
                     <i data-tooltip-id="hintTooltip" data-tooltip-content={hint}>
                        <Icon type="help" size={13} />
                     </i>
                  )}
               </label>
            )}
            {error && <span className={classes.fieldErrorLabel}>{error}</span>}
            {children}
         </div>
         {description && <span className={classes.description}>{description}</span>}
      </div>
   );
};
export default FormField;
