import { PlanInterval } from '../../../../@types/plans';
import Icon from '../../Icon/Icon';
import FormField from '../FormField/FormField';
import Select from '../Select/Select';
import TimePicker from '../TimePicker/TimePicker';
import classes from './IntervalField.module.scss';

type IntervalFieldProps = {
   label?: string;
   description?: string;
   customClasses?: string;
   hint?: string;
   error?: string;
   required?: boolean;
   fieldValue: PlanInterval;
   onUpdate: (value: PlanInterval) => void;
};

const IntervalField = ({
   label,
   fieldValue,
   description,
   customClasses = '',
   hint = '',
   error = '',
   required = false,
   onUpdate,
}: IntervalFieldProps) => {
   return (
      <FormField
         type="interval"
         label={label}
         hint={hint}
         error={error}
         required={required}
         description={description}
         classes={`${classes.intervalField} ${customClasses} ${error ? classes.fieldHasError : ''}`}
      >
         <div className={classes.intervalFieldInner}>
            <div className={classes.intervalFieldOptions}>
               <Select
                  options={[
                     { label: 'Hourly', value: 'hourly' },
                     { label: 'Daily', value: 'daily' },
                     { label: 'Weekly', value: 'weekly' },
                     { label: 'Monthly', value: 'monthly' },
                     { label: 'Every x Hours', value: 'hours' },
                     { label: 'Every x Days', value: 'days' },
                  ]}
                  fieldValue={fieldValue.type}
                  onUpdate={(val) =>
                     onUpdate({
                        ...fieldValue,
                        type: val as PlanInterval['type'],
                        time: fieldValue.time || '',
                        days: fieldValue.days || '',
                        hours: fieldValue.hours || '',
                     })
                  }
                  full={true}
                  customClasses={classes.intervalSelect}
               />
               {fieldValue.type === 'days' && (
                  <>
                     <div className={classes.weekDays}>
                        {['sun', 'mon', 'tue', 'wed', 'thur', 'fri', 'sat'].map((d) => {
                           return (
                              <button
                                 key={'weekday' + d}
                                 className={fieldValue?.days?.includes(d) ? classes.weekDayActive : ''}
                                 onClick={() =>
                                    onUpdate({
                                       ...fieldValue,
                                       days: fieldValue?.days?.includes(d)
                                          ? fieldValue.days?.replace(d + '-', '').replace(d, '')
                                          : fieldValue.days + d + '-',
                                    })
                                 }
                              >
                                 <Icon type="check" size={10} /> {d}
                              </button>
                           );
                        })}
                     </div>
                  </>
               )}
               {fieldValue.type !== 'hourly' && fieldValue.type !== 'hours' && (
                  <>
                     <span>at</span>
                     <TimePicker fieldValue={fieldValue.time || '10:00AM'} onUpdate={(val) => onUpdate({ ...fieldValue, time: val })} />
                  </>
               )}

               {fieldValue.type === 'weekly' && (
                  <>
                     <span>on</span>
                     <Select
                        options={[
                           { label: 'Sunday', value: 'sun' },
                           { label: 'Monday', value: 'mon' },
                           { label: 'Tuesday', value: 'tue' },
                           { label: 'Wednesday', value: 'wed' },
                           { label: 'Thursday', value: 'thur' },
                           { label: 'Friday', value: 'fri' },
                           { label: 'Saturday', value: 'sat' },
                        ]}
                        fieldValue={fieldValue.days || 'sun'}
                        onUpdate={(val: string) => onUpdate({ ...fieldValue, days: val })}
                     />
                  </>
               )}
               {fieldValue.type === 'monthly' && (
                  <>
                     <span>on</span>
                     <Select
                        options={[
                           { label: '1st day of the Month', value: 'first' },
                           { label: '15th day of the Month', value: 'middle' },
                           { label: 'Last day of the Month', value: 'last' },
                        ]}
                        fieldValue={fieldValue.days || 'first'}
                        onUpdate={(val: string) => onUpdate({ ...fieldValue, days: val })}
                     />
                  </>
               )}
               {fieldValue.type === 'hours' && (
                  <>
                     <span>Every</span>
                     <Select
                        options={[
                           { label: '3 hours', value: '3hrs' },
                           { label: '6 hours', value: '6hrs' },
                           { label: '9 hours', value: '9hrs' },
                           { label: '12 hours', value: '12hrs' },
                           { label: '18 hours', value: '18hrs' },
                        ]}
                        fieldValue={fieldValue.hours || '3hrs'}
                        onUpdate={(val: string) => onUpdate({ ...fieldValue, hours: val })}
                     />
                  </>
               )}
            </div>
         </div>
      </FormField>
   );
};

export default IntervalField;
