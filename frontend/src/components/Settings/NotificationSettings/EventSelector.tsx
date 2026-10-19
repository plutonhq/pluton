import { eventChoices, toggleChoice, type NotificationEventType } from '../../../utils/notificationDelivery';
import classes from './NotificationSettings.module.scss';
export default function EventSelector({ value, onChange }: { value: NotificationEventType[]; onChange: (value: NotificationEventType[]) => void }) {
   return (
      <fieldset>
         <legend>Subscribed terminal events</legend>
         <div className={classes.choices}>
            {eventChoices.map((event) => (
               <label key={event.value}>
                  <input type="checkbox" checked={value.includes(event.value)} onChange={() => onChange(toggleChoice(value, event.value))} />
                  {event.label}
               </label>
            ))}
         </div>
      </fieldset>
   );
}
