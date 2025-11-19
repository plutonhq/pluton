import { useState } from 'react';
import Icon from '../../Icon/Icon';
import classes from './SizePicker.module.scss';
import FormField from '../FormField/FormField';

type SizeUnit = 'ki' | 'mi' | 'gi' | 'ti' | 'K' | 'M' | 'G' | 'T';

type SizePickerProps = {
   label?: string;
   description?: string;
   customClasses?: string;
   fieldValue: string;
   inline?: boolean;
   hint?: string;
   type?: 'restic' | 'rclone';
   onUpdate: (value: string) => void;
};

const SizePicker = ({
   label,
   description,
   customClasses = '',
   inline = false,
   fieldValue = '',
   type = 'restic',
   hint = '',
   onUpdate,
}: SizePickerProps) => {
   const [size, setSize] = useState<number | undefined>(() => (fieldValue ? parseInt(fieldValue, 10) : undefined));
   const [unit, setUnit] = useState<SizeUnit>(() => {
      const lastTwoChars = fieldValue.slice(-2) as SizeUnit;
      return lastTwoChars === 'ki' ||
         lastTwoChars === 'mi' ||
         lastTwoChars === 'gi' ||
         lastTwoChars === 'ti' ||
         lastTwoChars === 'K' ||
         lastTwoChars === 'M' ||
         lastTwoChars === 'G' ||
         lastTwoChars === 'T'
         ? lastTwoChars
         : type === 'rclone'
           ? 'M'
           : 'mi';
   });

   const handleSizeChange = (value: string) => {
      const numValue = value === '' ? undefined : Number(value);
      setSize(numValue);
      if (numValue) {
         onUpdate(`${numValue}${unit}`);
      } else {
         onUpdate('');
      }
   };

   const handleUnitChange = (newUnit: SizeUnit) => {
      setUnit(newUnit);
      if (size) {
         onUpdate(`${size}${newUnit}`);
      }
   };

   const units: { label: string; value: SizeUnit }[] = [
      { label: 'KB', value: type === 'rclone' ? 'K' : 'ki' },
      { label: 'MB', value: type === 'rclone' ? 'M' : 'mi' },
      { label: 'GB', value: type === 'rclone' ? 'G' : 'gi' },
      { label: 'TB', value: type === 'rclone' ? 'T' : 'ti' },
   ];

   return (
      <FormField
         type="sizePicker"
         label={label}
         description={description}
         hint={hint}
         inline={inline}
         classes={`${classes.sizePicker} ${inline ? classes.sizePickerInline : ''} ${customClasses}`}
      >
         <div className={classes.inputGroup}>
            <input type="number" min={0} value={size ?? ''} onChange={(e) => handleSizeChange(e.target.value)} className={classes.numberInput} />
            <ul className={classes.unitSelector}>
               {units.map((unitOption) => (
                  <li
                     key={unitOption.value}
                     className={`${classes.unit} ${unit === unitOption.value ? classes.selected : ''}`}
                     onClick={() => handleUnitChange(unitOption.value)}
                  >
                     {unit === unitOption.value && <Icon type="check" size={10} />}
                     {unitOption.label}
                  </li>
               ))}
            </ul>
         </div>
      </FormField>
   );
};

export default SizePicker;
