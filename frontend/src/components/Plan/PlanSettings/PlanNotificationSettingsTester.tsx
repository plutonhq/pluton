import { toast } from 'react-toastify';
import { useState } from 'react';
import { useTestNotification } from '../../../services';
import { Icon } from '../..';
import { NewPlanSettings, PlanNotificationCase } from '../../..';
import classes from './PlanSettings.module.scss';
import { isValidURL } from '../../../utils';

const PlanNotificationSettingsTester = ({
   planId,
   notificationChannel,
   notificationSettings,
   notificationType = 'backup',
}: {
   planId: string;
   notificationType?: 'backup' | 'integrity';
   notificationChannel: 'webhook' | 'slack' | 'discord';
   notificationSettings: NewPlanSettings['settings']['notification'];
}) => {
   const [showTestNotificationOptions, setShowTestNotificationOptions] = useState(false);
   const testNotificationMutation = useTestNotification();
   const channelSettings = notificationSettings[notificationChannel as 'webhook' | 'slack' | 'discord'];
   const integrityNotification = notificationType === 'integrity';

   const sendTestNotification = (notificationCase: PlanNotificationCase | 'integrity_failure') => {
      setShowTestNotificationOptions(false);
      if (!planId) {
         return toast.error('Test notification can be sent after creating the Plan');
      }
      if (!channelSettings?.url || !isValidURL(channelSettings.url)) {
         return toast.error(`Please enter a valid URL to send test notifications`);
      }

      toast.promise(
         testNotificationMutation.mutateAsync({
            planId,
            notificationCase: notificationCase,
            notificationChannel,
            channelSettings: channelSettings,
         }),
         {
            pending: `Sending Test Request to your ${notificationChannel}...`,
            success: 'Test Request Sent Successfully!',
            error: {
               render({ data }: any) {
                  return data.message || 'Failed to send test request';
               },
            },
         },
      );
   };

   return (
      <div className={classes.testNotificationContainer}>
         <button
            onClick={() =>
               integrityNotification ? sendTestNotification('integrity_failure') : setShowTestNotificationOptions(!showTestNotificationOptions)
            }
            className={`${classes.testNotificationButton} ${!channelSettings?.url ? classes.disabled : ''}`}
            disabled={!channelSettings?.url || !planId}
            title={
               !planId
                  ? 'Create the Plan first to send test notifications'
                  : !channelSettings?.url
                    ? `Enter ${notificationChannel === 'webhook' ? 'the' : notificationChannel.charAt(0).toUpperCase() + notificationChannel.slice(1)} Webhook URL to send test notifications`
                    : undefined
            }
         >
            <Icon type="send" size={12} /> Send Test Request
         </button>
         {!integrityNotification && showTestNotificationOptions && (
            <div className={classes.testNotificationOptions}>
               <ul>
                  <li onClick={() => sendTestNotification('start')}>Start Notification</li>
                  <li onClick={() => sendTestNotification('end')}>End Notification</li>
                  <li onClick={() => sendTestNotification('success')}>Success Notification</li>
                  <li onClick={() => sendTestNotification('failure')}>Failure Notification</li>
               </ul>
            </div>
         )}
      </div>
   );
};

export default PlanNotificationSettingsTester;
