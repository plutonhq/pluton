import Icon from '../Icon/Icon';
import classes from './Button.module.scss';

interface ButtonProps {
   text: string;
   onClick: () => void;
   variant?: 'primary' | 'secondary' | 'tertiary' | 'danger';
   customClass?: string;
   disabled?: boolean;
   icon?: React.ReactNode | string;
   size?: 'sm' | 'md' | 'lg';
   minWidth?: string;
   padding?: string;
   fillWidth?: boolean;
}

const Button = ({ text, size = 'md', customClass, disabled = false, variant, onClick, minWidth, padding, fillWidth, icon }: ButtonProps) => {
   return (
      <button
         style={{ minWidth, padding, width: fillWidth ? '100%' : undefined }}
         onClick={onClick}
         className={`
            ${classes.button} 
            ${customClass} 
            ${size ? classes[`button--${size}`] : ''} 
            ${variant ? classes[`button--${variant}`] : ''}`}
         disabled={disabled}
         type="button"
      >
         {icon && typeof icon === 'string' ? <Icon type={icon} size={13} /> : icon}
         {text}
      </button>
   );
};

export default Button;
