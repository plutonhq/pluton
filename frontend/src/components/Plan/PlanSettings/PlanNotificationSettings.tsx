import classes from './PlanSettings.module.scss';
import Select from '../../common/form/Select/Select';
import Input from '../../common/form/Input/Input';
import Toggle from '../../common/form/Toggle/Toggle';
import { NewPlanSettings, PlanNotificationCase } from '../../../@types/plans';
import { NavLink } from 'react-router';

interface PlanNotificationSettingsProps {
   plan: NewPlanSettings;
   types: string[];
   admin_email?: string;
   onUpdate: (notificationSettings: NewPlanSettings['settings']['notification']) => void;
}

const PlanNotificationSettings = ({ plan, types = [], admin_email = '', onUpdate }: PlanNotificationSettingsProps) => {
   const notificationSettings = plan.settings?.notification || {};

   const updateNotificationEmails = (emails: string) => {
      onUpdate({ ...notificationSettings, email: { ...notificationSettings.email, emails } });
   };

   const hasConnectedIntegrations = types.length > 0;
   const defaultEmail = !hasConnectedIntegrations && admin_email ? admin_email : '';

   return (
      <>
         <div className={classes.field}>
            <label className={classes.label}>Notification</label>
            <Toggle
               fieldValue={notificationSettings?.email?.enabled || false}
               onUpdate={(val: boolean) => onUpdate({ ...notificationSettings, email: { ...notificationSettings.email, enabled: val } })}
               description={plan.method === 'sync' ? 'Notify Me when Sync fails' : 'Notify Me when Backup fails or succeeds'}
            />
         </div>
         {notificationSettings?.email?.enabled && (
            <>
               {plan.method !== 'sync' && (
                  <div className={classes.field}>
                     <label className={classes.label}>Send Notification</label>
                     <Select
                        fieldValue={notificationSettings?.email?.case || 'failure'}
                        options={[
                           { label: 'On Start', value: 'start' },
                           { label: 'On End', value: 'end' },
                           { label: 'On Both Start & End', value: 'both' },
                           { label: 'On Success Only', value: 'success' },
                           { label: 'On Failure Only', value: 'failure' },
                        ]}
                        onUpdate={(val: string) =>
                           onUpdate({ ...notificationSettings, email: { ...notificationSettings.email, case: val as PlanNotificationCase } })
                        }
                     />
                  </div>
               )}
               <div className={classes.field}>
                  <label className={classes.label}>Email Addresses</label>
                  <Input
                     fieldValue={notificationSettings?.email?.emails || defaultEmail}
                     onUpdate={(val) => updateNotificationEmails(val)}
                     placeholder="john@gmail.com, chris@icloud.com"
                     full={true}
                     disabled={!hasConnectedIntegrations}
                     error={!notificationSettings?.email?.emails ? 'Required' : undefined}
                  />
                  {!hasConnectedIntegrations && (
                     <div className={classes.fieldNotice}>
                        ⚠️ SMTP has not been setup yet. Set it up in <NavLink to={`/settings?t=integration`}>Settings</NavLink> to enable Email
                        Notification.
                     </div>
                  )}
               </div>
            </>
         )}
      </>
   );
};

export default PlanNotificationSettings;
