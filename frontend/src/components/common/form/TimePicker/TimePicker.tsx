import { useEffect, useMemo, useState } from 'react';
import classes from './TimePicker.module.scss';
import Icon from '../../Icon/Icon';

interface TimePickerProps {
   label?: string;
   description?: string;
   customClasses?: string;
   fieldValue: string;
   onUpdate: (s: string) => void;
}

const TimePicker = ({ label, description, customClasses, fieldValue, onUpdate }: TimePickerProps) => {
   const [showPicker, setShowPicker] = useState(false);
   const [hour, setHour] = useState(() => {
      const timeMatch = fieldValue.match(/(\d+):(\d+)(AM|PM)/i);
      return timeMatch ? parseInt(timeMatch[1]) : 10;
   });
   const [minutes, setMinutes] = useState(() => {
      const timeMatch = fieldValue.match(/(\d+):(\d+)(AM|PM)/i);
      return timeMatch ? parseInt(timeMatch[2]) : 0;
   });
   const [ampm, setAmpm] = useState(() => {
      const timeMatch = fieldValue.match(/(\d+):(\d+)(AM|PM)/i);
      return timeMatch ? timeMatch[3].toUpperCase() : 'AM';
   });

   useEffect(() => {
      const formattedMinutes = minutes.toString().padStart(2, '0');
      const formattedHour = hour.toString().padStart(2, '0');
      const newTimeValue = `${formattedHour}:${formattedMinutes}${ampm}`;
      console.log('newTimeValue :', newTimeValue, fieldValue, newTimeValue !== fieldValue);
      if (newTimeValue !== fieldValue) {
         console.log('Value Updated!');
         onUpdate(newTimeValue);
      }
   }, [hour, minutes, ampm]);

   const timeString = useMemo(() => {
      const formattedMinutes = minutes.toString().padStart(2, '0');
      const formattedHour = hour.toString().padStart(2, '0');
      const newTimeValue = `${formattedHour}:${formattedMinutes}${ampm}`;

      return newTimeValue;
   }, [minutes, hour, ampm]);

   return (
      <div className={`${classes.timePickerField} ${customClasses}`}>
         <div className={classes.fieldInner}>
            {label && <div className={classes.fieldLabel}>{label}</div>}
            <div className={classes.currentTime} onClick={() => setShowPicker(!showPicker)}>
               <span>{timeString}</span>
               <button className={classes.dropBtn}>
                  <Icon type={showPicker ? 'caret-up' : 'caret-down'} size={13} />
               </button>
            </div>
            {showPicker && (
               <div className={classes.timeSelect}>
                  <div className={classes.times}>
                     <div>
                        <input
                           className={classes.timeInput}
                           type="number"
                           placeholder="10"
                           value={hour}
                           max={12}
                           min={0}
                           onChange={(e) => setHour(parseInt(e.target.value))}
                        />
                     </div>
                     <span>:</span>
                     <div>
                        <input
                           className={classes.timeInput}
                           type="number"
                           placeholder="20"
                           value={minutes}
                           max={59}
                           min={0}
                           onChange={(e) => setMinutes(parseInt(e.target.value))}
                        />
                     </div>
                  </div>
                  <div className={classes.ampm}>
                     <button onClick={() => setAmpm('AM')} className={ampm === 'AM' ? classes.ampmActive : ''}>
                        AM
                     </button>
                     <button onClick={() => setAmpm('PM')} className={ampm === 'PM' ? classes.ampmActive : ''}>
                        PM
                     </button>
                  </div>
               </div>
            )}
            {description && <span className={classes.description}>{description}</span>}
         </div>
      </div>
   );
};
export default TimePicker;
