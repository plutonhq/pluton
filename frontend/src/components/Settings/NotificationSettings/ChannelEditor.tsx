import { useState } from 'react';
import { channelDraft, channelRequest, type Channel } from '../../../utils/notificationDelivery';
import { useNotificationActions } from '../../../services/notifications';
import EventSelector from './EventSelector';
import classes from './NotificationSettings.module.scss';
export default function ChannelEditor({ saved, kind, close }: { saved?: Channel; kind: 'webhook' | 'smtp'; close: (saved?: boolean) => void }) {
   const [draft, setDraft] = useState(() => channelDraft(saved, kind));
   const [secret, setSecret] = useState('');
   const [clearSecret, setClearSecret] = useState(false);
   const [cidrs, setCidrs] = useState(saved?.config.allowedCidrs.join(', ') || '');
   const [recipients, setRecipients] = useState(saved?.kind === 'smtp' ? saved.config.recipients.join(', ') : '');
   const action = useNotificationActions();
   const config = draft.config;
   const update = (change: Record<string, unknown>) => setDraft({ ...draft, config: { ...config, ...change } } as typeof draft);
   return (
      <form
         className={classes.card}
         onSubmit={(event) => {
            event.preventDefault();
            action.mutate(
               { type: 'save', id: saved?.id, value: channelRequest(draft, secret, clearSecret, cidrs, recipients) },
               { onSuccess: () => close(true) },
            );
         }}
      >
         <h3>
            {saved ? 'Edit' : 'Create'} {draft.kind === 'webhook' ? 'Webhook' : 'SMTP'} channel
         </h3>
         <div className={classes.grid}>
            <label>
               Channel name
               <input required maxLength={120} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </label>
            <label>
               Delivery timeout (milliseconds)
               <input
                  type="number"
                  min={1000}
                  max={30000}
                  required
                  value={config.timeoutMs}
                  onChange={(e) => update({ timeoutMs: Number(e.target.value) })}
               />
            </label>
            {draft.kind === 'webhook' ? (
               <label>
                  Webhook URL
                  <input
                     required
                     type="url"
                     placeholder="https://notify.example.internal/events"
                     value={draft.config.url}
                     onChange={(e) => update({ url: e.target.value })}
                  />
               </label>
            ) : (
               <>
                  <label>
                     SMTP hostname
                     <input required value={draft.config.host} onChange={(e) => update({ host: e.target.value })} />
                  </label>
                  <label>
                     SMTP port
                     <input
                        type="number"
                        required
                        min={1}
                        max={65535}
                        value={draft.config.port}
                        onChange={(e) => update({ port: Number(e.target.value) })}
                     />
                  </label>
                  <label>
                     SMTP security
                     <select value={draft.config.security} onChange={(e) => update({ security: e.target.value })}>
                        <option value="starttls">STARTTLS — required, verified</option>
                        <option value="tls">Implicit TLS — verified</option>
                        <option value="plain">Plain SMTP — explicitly trusted LAN only</option>
                     </select>
                  </label>
                  <label>
                     SMTP username (optional authentication)
                     <input autoComplete="off" value={draft.config.username} onChange={(e) => update({ username: e.target.value })} />
                  </label>
                  <label>
                     Sender email
                     <input required type="email" value={draft.config.senderEmail} onChange={(e) => update({ senderEmail: e.target.value })} />
                  </label>
                  <label>
                     Sender display name
                     <input maxLength={120} value={draft.config.senderName} onChange={(e) => update({ senderName: e.target.value })} />
                  </label>
                  <label>
                     Recipients (comma-separated, up to 20)
                     <input required value={recipients} onChange={(e) => setRecipients(e.target.value)} />
                  </label>
               </>
            )}
            <label>
               {draft.kind === 'webhook' ? 'Optional HMAC signing secret' : 'SMTP password'}
               <input
                  type="password"
                  autoComplete="new-password"
                  value={secret}
                  disabled={clearSecret}
                  onChange={(e) => setSecret(e.target.value)}
                  placeholder={saved?.secretConfigured ? 'Saved privately — leave blank to keep' : 'Not configured'}
               />
            </label>
            <label>
               Network approval
               <select value={config.network} onChange={(e) => update({ network: e.target.value })}>
                  <option value="public">Public HTTPS / verified SMTP TLS</option>
                  <option value="trusted-lan">I approve this restricted private LAN destination</option>
               </select>
            </label>
            {config.network === 'trusted-lan' && (
               <label>
                  Approved private CIDRs
                  <input required placeholder="192.168.50.20/32" value={cidrs} onChange={(e) => setCidrs(e.target.value)} />
               </label>
            )}
         </div>
         <p>
            Use narrow private CIDRs (prefer /32 or /24). Loopback, link-local and metadata addresses are always refused. No credentials in webhook
            URLs, redirects or TLS verification bypass. Plain transport does not encrypt traffic.
         </p>
         <div className={classes.choices}>
            <label>
               <input type="checkbox" checked={draft.enabled} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} />
               Enable this channel
            </label>
            {saved?.secretConfigured && (
               <label>
                  <input type="checkbox" checked={clearSecret} onChange={(e) => setClearSecret(e.target.checked)} />
                  Explicitly clear the saved credential
               </label>
            )}
         </div>
         <EventSelector value={draft.events} onChange={(events) => setDraft({ ...draft, events })} />
         <p>
            New / re-enabled channels apply only to jobs created afterwards. Editing a channel invalidates its pending deliveries; review history
            before an explicit retry.
         </p>
         {action.error && <p role="alert">{action.error.message}</p>}
         <div className={classes.actions}>
            <button type="submit" disabled={action.isPending}>
               {action.isPending ? 'Saving…' : 'Save channel'}
            </button>
            <button type="button" onClick={() => close(false)} disabled={action.isPending}>
               Cancel
            </button>
         </div>
      </form>
   );
}
