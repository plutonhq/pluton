import { useState } from 'react';
import { useNotificationActions, useNotificationChannels, useNotificationHistory } from '../../../services/notifications';
import { deliveryDescription, type Channel } from '../../../utils/notificationDelivery';
import ChannelEditor from './ChannelEditor';
import classes from './NotificationSettings.module.scss';
export default function NotificationSettings() {
   const channels = useNotificationChannels();
   const [page, setPage] = useState(0);
   const history = useNotificationHistory(page);
   const action = useNotificationActions();
   const [editor, setEditor] = useState<{ kind: 'webhook' | 'smtp'; saved?: Channel }>();
   const [notice, setNotice] = useState('');
   const run = (type: 'delete' | 'test' | 'retry', id: string) =>
      action.mutate(
         { type, id },
         {
            onSuccess: () => {
               if (type === 'test') setPage(0);
               setNotice(
                  type === 'delete'
                     ? 'Channel deleted. Pending deliveries will not send.'
                     : 'Notification queued. Check delivery history for the actual result.',
               );
            },
         },
      );
   return (
      <section className={classes.panel} aria-label="Webhook and SMTP notifications">
         <h3>Webhooks & Email</h3>
         <p>
            Durable outbound notifications. Configure channels here, then select channels and events in Edit Plan → Advanced → Notification. Backup
            and recovery results are independent. Delivery failures never change job results.
         </p>
         <div className={classes.actions}>
            <button type="button" onClick={() => setEditor({ kind: 'webhook' })}>
               Add Webhook
            </button>
            <button type="button" onClick={() => setEditor({ kind: 'smtp' })}>
               Add SMTP channel
            </button>
         </div>
         {editor && (
            <ChannelEditor
               key={editor.saved?.id || editor.kind}
               {...editor}
               close={(saved) => {
                  setEditor(undefined);
                  setNotice(saved ? 'Channel saved. Configure its per-plan subscriptions to send job notifications.' : '');
               }}
            />
         )}
         {channels.isLoading ? (
            <p>Loading channels…</p>
         ) : channels.error ? (
            <p role="alert">{channels.error.message}</p>
         ) : !channels.data?.length ? (
            <p>No channels configured. Notifications are opt-in; historical jobs will not be replayed.</p>
         ) : (
            channels.data.map((channel) => (
               <article className={classes.card} key={channel.id}>
                  <h4>
                     {channel.name} — {channel.kind === 'smtp' ? 'SMTP email' : 'Webhook'}
                  </h4>
                  <p>
                     {channel.enabled ? 'Enabled' : 'Disabled'} · {channel.events.length} subscribed events · Credential{' '}
                     {channel.secretConfigured ? 'saved privately' : 'not configured'}
                  </p>
                  <div className={classes.actions}>
                     <button type="button" onClick={() => setEditor({ kind: channel.kind, saved: channel })}>
                        Edit {channel.name}
                     </button>
                     <button type="button" disabled={!channel.enabled || action.isPending} onClick={() => run('test', channel.id)}>
                        {channel.kind === 'smtp' ? 'Send Test Email' : 'Send Test Webhook'}
                     </button>
                     <button
                        type="button"
                        disabled={action.isPending}
                        onClick={() => {
                           if (window.confirm(`Delete ${channel.name}? Pending deliveries will be refused. Existing job history is unchanged.`))
                              run('delete', channel.id);
                        }}
                     >
                        Delete
                     </button>
                  </div>
               </article>
            ))
         )}
         {notice && <p role="status">{notice}</p>}
         {action.error && <p role="alert">{action.error.message}</p>}
         <h3>Delivery History</h3>
         <p>
            “Succeeded” means HTTP 2xx or SMTP relay acceptance, not inbox delivery. Test notifications are labeled separately. External delivery is
            at least once; webhook receivers should deduplicate event IDs.
         </p>
         <button type="button" disabled={history.isFetching} onClick={() => history.refetch()}>
            Refresh history
         </button>
         {history.isLoading ? (
            <p>Loading delivery history…</p>
         ) : history.error ? (
            <p role="alert">{history.error.message}</p>
         ) : !history.data?.length ? (
            <p>No deliveries on this page.</p>
         ) : (
            <div className={classes.history}>
               <table>
                  <caption>Notification delivery results</caption>
                  <thead>
                     <tr>
                        <th>Event / Plan</th>
                        <th>Destination</th>
                        <th>Queued / Last attempt</th>
                        <th>Status / Attempts</th>
                        <th>Last sanitized error</th>
                        <th>Action</th>
                     </tr>
                  </thead>
                  <tbody>
                     {history.data.map((row) => (
                        <tr key={row.id}>
                           <td>
                              {row.eventType}
                              <br />
                              {row.planName || 'Test notification'}
                              <br />
                              <small>{row.eventId}</small>
                           </td>
                           <td>
                              {row.channelName}
                              <br />
                              {row.kind}
                           </td>
                           <td>
                              {new Date(row.createdAt).toLocaleString()}
                              <br />
                              {row.lastAttemptAt ? new Date(row.lastAttemptAt).toLocaleString() : 'Not attempted'}
                           </td>
                           <td>
                              {row.status}
                              <br />
                              {deliveryDescription(row.status, row.kind)}
                              <br />
                              {row.attemptCount} attempts{row.httpStatus ? ` · HTTP ${row.httpStatus}` : ''}
                              {row.status === 'pending' && row.nextAttemptAt && (
                                 <>
                                    <br />
                                    Next: {new Date(row.nextAttemptAt).toLocaleString()}
                                 </>
                              )}
                           </td>
                           <td>
                              {row.error || '—'}
                              {row.errorCode && (
                                 <>
                                    <br />
                                    <code>{row.errorCode}</code>
                                 </>
                              )}
                           </td>
                           <td>
                              {row.canRetry ? (
                                 <button type="button" disabled={action.isPending} onClick={() => run('retry', row.id)}>
                                    Retry (review current channel)
                                 </button>
                              ) : (
                                 '—'
                              )}
                           </td>
                        </tr>
                     ))}
                  </tbody>
               </table>
            </div>
         )}
         <div className={classes.actions}>
            <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>
               Previous page
            </button>
            <span>Page {page + 1}</span>
            <button type="button" disabled={(history.data?.length || 0) < 50 || page >= 400} onClick={() => setPage(page + 1)}>
               Next page
            </button>
         </div>
      </section>
   );
}
