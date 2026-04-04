import classes from './PlanSettings.module.scss';
import Select from '../../common/form/Select/Select';
import Input from '../../common/form/Input/Input';
import Toggle from '../../common/form/Toggle/Toggle';
import { PlanNotification, PlanNotificationCase } from '../../../@types/plans';
import { NavLink } from 'react-router';
import PlanNotificationSettingsTester from './PlanNotificationSettingsTester';
import { Icon } from '../..';

interface PlanNotificationSettingsProps {
   types: string[];
   isSync: boolean;
   notificationType?: 'backup' | 'integrity';
   admin_email?: string;
   planID?: string;
   notificationSettings: PlanNotification;
   onUpdate: (notificationSettings: PlanNotification) => void;
}

const PlanNotificationSettings = ({
   planID,
   isSync,
   types = [],
   admin_email = '',
   notificationSettings,
   notificationType = 'backup',
   onUpdate,
}: PlanNotificationSettingsProps) => {
   const hasConnectedIntegrations = types.length > 0;
   const defaultEmail = !hasConnectedIntegrations && admin_email ? admin_email : '';

   const updateNotificationEmails = (emails: string) => {
      onUpdate({ ...notificationSettings, email: { ...notificationSettings.email, emails } });
   };

   const caseOptions = [
      { label: 'On Start', value: 'start' },
      { label: 'On End', value: 'end' },
      { label: 'On Both Start & End', value: 'both' },
      { label: 'On Success Only', value: 'success' },
      { label: 'On Failure Only', value: 'failure' },
   ];

   return (
      <>
         <div className={classes.notificationSettingsSection}>
            <div className={`${classes.field} ${classes.notificationToggle}`}>
               <Icon type="email" size={14} />
               <Toggle
                  label="Enable Email Notifications"
                  fieldValue={notificationSettings?.email?.enabled || false}
                  onUpdate={(val: boolean) => onUpdate({ ...notificationSettings, email: { ...notificationSettings.email, enabled: val } })}
                  hint={'Notify me via email when Backup fails or succeeds'}
                  inline={true}
               />
            </div>
            {notificationSettings?.email?.enabled && (
               <div className={classes.notificationSettings}>
                  {!isSync && (
                     <div className={classes.field}>
                        <Select
                           label="Send Notification"
                           fieldValue={notificationSettings?.email?.case || 'failure'}
                           options={caseOptions}
                           onUpdate={(val: string) =>
                              onUpdate({ ...notificationSettings, email: { ...notificationSettings.email, case: val as PlanNotificationCase } })
                           }
                           inline={true}
                        />
                     </div>
                  )}
                  <div className={classes.field}>
                     <Input
                        label="Email Addresses"
                        fieldValue={notificationSettings?.email?.emails || defaultEmail}
                        onUpdate={(val) => updateNotificationEmails(val)}
                        placeholder="john@gmail.com, chris@icloud.com"
                        full={true}
                        inline={true}
                        required={true}
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
               </div>
            )}
         </div>

         {/* Slack Notification */}
         <div className={classes.notificationSettingsSection}>
            <div className={`${classes.field} ${classes.notificationToggle}`}>
               <Icon type="slack" size={14} />
               <Toggle
                  label="Enable Slack Notifications"
                  fieldValue={notificationSettings?.slack?.enabled || false}
                  onUpdate={(val: boolean) =>
                     onUpdate({
                        ...notificationSettings,
                        slack: { ...notificationSettings.slack, enabled: val, url: notificationSettings.slack?.url || '' },
                     })
                  }
                  hint="Send notifications to a Slack channel via webhook"
                  inline={true}
               />
            </div>
            {notificationSettings?.slack?.enabled && (
               <div className={classes.notificationSettings}>
                  {!isSync && (
                     <div className={classes.field}>
                        <Select
                           label="Send Slack Notification"
                           fieldValue={notificationSettings?.slack?.case || 'failure'}
                           options={caseOptions}
                           onUpdate={(val: string) =>
                              onUpdate({ ...notificationSettings, slack: { ...notificationSettings.slack, case: val as PlanNotificationCase } })
                           }
                           inline={true}
                        />
                     </div>
                  )}
                  <div className={classes.field}>
                     <Input
                        label="Slack Webhook URL"
                        fieldValue={notificationSettings?.slack?.url || ''}
                        onUpdate={(val) => onUpdate({ ...notificationSettings, slack: { ...notificationSettings.slack, url: val } })}
                        placeholder="https://hooks.slack.com/services/T00/B00/xxxx"
                        required={true}
                        inline={true}
                        full={true}
                        error={notificationSettings?.slack?.enabled && !notificationSettings?.slack?.url ? 'Required' : undefined}
                     />
                  </div>
                  <div className={`${classes.field} ${classes.notificationTestField}`}>
                     <PlanNotificationSettingsTester
                        planId={planID || ''}
                        notificationChannel="slack"
                        notificationSettings={notificationSettings}
                        notificationType={notificationType}
                     />
                  </div>
               </div>
            )}
         </div>

         {/* Discord Notification */}
         <div className={classes.notificationSettingsSection}>
            <div className={`${classes.field} ${classes.notificationToggle}`}>
               <Icon type="discord" size={14} />
               <Toggle
                  label="Send Discord Notifications"
                  fieldValue={notificationSettings?.discord?.enabled || false}
                  onUpdate={(val: boolean) =>
                     onUpdate({
                        ...notificationSettings,
                        discord: { ...notificationSettings.discord, enabled: val, url: notificationSettings.discord?.url || '' },
                     })
                  }
                  hint="Send notifications to a Discord channel via webhook"
                  inline={true}
               />
            </div>
            {notificationSettings?.discord?.enabled && (
               <div className={classes.notificationSettings}>
                  {!isSync && (
                     <div className={classes.field}>
                        <Select
                           label="Send Discord Notification"
                           fieldValue={notificationSettings?.discord?.case || 'failure'}
                           options={caseOptions}
                           onUpdate={(val: string) =>
                              onUpdate({ ...notificationSettings, discord: { ...notificationSettings.discord, case: val as PlanNotificationCase } })
                           }
                           inline={true}
                        />
                     </div>
                  )}
                  <div className={classes.field}>
                     <Input
                        label="Discord Webhook URL"
                        fieldValue={notificationSettings?.discord?.url || ''}
                        onUpdate={(val) => onUpdate({ ...notificationSettings, discord: { ...notificationSettings.discord, url: val } })}
                        placeholder="https://discord.com/api/webhooks/xxxx/xxxx"
                        required={true}
                        inline={true}
                        full={true}
                        error={notificationSettings?.discord?.enabled && !notificationSettings?.discord?.url ? 'Required' : undefined}
                     />
                  </div>
                  <div className={`${classes.field} ${classes.notificationTestField}`}>
                     <PlanNotificationSettingsTester
                        planId={planID || ''}
                        notificationChannel="discord"
                        notificationType={notificationType}
                        notificationSettings={notificationSettings}
                     />
                  </div>
               </div>
            )}
         </div>
      </>
   );
};

export default PlanNotificationSettings;
