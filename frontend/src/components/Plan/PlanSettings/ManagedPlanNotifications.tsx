import { useEffect, useState } from 'react';
import { NavLink } from 'react-router';
import { useNotificationActions, useNotificationChannels, useNotificationSubscription } from '../../../services/notifications';
import { emptySubscription, toggleChoice } from '../../../utils/notificationDelivery';
import EventSelector from '../../Settings/NotificationSettings/EventSelector';
import classes from '../../Settings/NotificationSettings/NotificationSettings.module.scss';
export default function ManagedPlanNotifications({ planId }: { planId?: string }) {
   const channels = useNotificationChannels();
   const saved = useNotificationSubscription(planId);
   const action = useNotificationActions();
   const [value, setValue] = useState(emptySubscription);
   const [notice, setNotice] = useState('');
   useEffect(() => {
      if (saved.data) setValue(saved.data);
   }, [saved.data]);
   if (!planId) return <p>Save the plan first, then configure durable notifications here.</p>;
   return (
      <section className={classes.panel}>
         <h3>Durable Webhook & Email Notifications</h3>
         <p>
            Channels are managed in <NavLink to="/settings?t=notifications">Settings → Webhooks & Email</NavLink>. This configuration saves separately
            from the plan form and applies to jobs created afterwards.
         </p>
         {channels.isLoading || saved.isLoading ? (
            <p>Loading notification policy…</p>
         ) : channels.error || saved.error ? (
            <p role="alert">{channels.error?.message || saved.error?.message}</p>
         ) : (
            <>
               <div className={classes.choices}>
                  <label>
                     <input type="checkbox" checked={value.enabled} onChange={(e) => setValue({ ...value, enabled: e.target.checked })} />
                     Enable durable notifications for this plan
                  </label>
               </div>
               {!channels.data?.length ? (
                  <p>No channels configured. Create a webhook or SMTP channel in Settings first.</p>
               ) : (
                  <fieldset>
                     <legend>Plan channels</legend>
                     <div className={classes.choices}>
                        {channels.data.map((channel) => (
                           <label key={channel.id}>
                              <input
                                 type="checkbox"
                                 checked={value.channelIds.includes(channel.id)}
                                 onChange={() => setValue({ ...value, channelIds: toggleChoice(value.channelIds, channel.id) })}
                              />
                              {channel.name} ({channel.kind}, {channel.enabled ? 'enabled' : 'disabled'})
                           </label>
                        ))}
                     </div>
                  </fieldset>
               )}
               <EventSelector value={value.events} onChange={(events) => setValue({ ...value, events })} />
               <p>
                  Only events selected by both the channel and this plan are sent. Recovery Passed with Warning can mean artifact integrity passed but
                  SQL import was NOT TESTED.
               </p>
               <button
                  type="button"
                  disabled={action.isPending}
                  onClick={() =>
                     action.mutate(
                        { type: 'subscription', id: planId, value },
                        { onSuccess: () => setNotice('Notification policy saved. Historical / already-started jobs will not be replayed.') },
                     )
                  }
               >
                  {action.isPending ? 'Saving…' : 'Save notification policy'}
               </button>
               {notice && <p role="status">{notice}</p>}
               {action.error && <p role="alert">{action.error.message}</p>}
            </>
         )}
      </section>
   );
}
