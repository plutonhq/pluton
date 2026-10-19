export type { Channel, ChannelInput, Subscription, Delivery, NotificationEventType } from '../../../backend/src/types/notificationDelivery.ts';
import type { Channel, ChannelInput, Subscription, NotificationEventType } from '../../../backend/src/types/notificationDelivery.ts';
export const eventChoices: { value: NotificationEventType; label: string }[] = [
   { value: 'backup.completed', label: 'Backup successful' },
   { value: 'backup.completed_with_warning', label: 'Backup completed with warning' },
   { value: 'backup.failed', label: 'Backup failed' },
   { value: 'backup.cancelled', label: 'Backup cancelled' },
   { value: 'recovery.passed', label: 'Recovery test passed' },
   { value: 'recovery.passed_with_warning', label: 'Recovery test passed with warning' },
   { value: 'recovery.failed', label: 'Recovery test failed' },
   { value: 'recovery.cancelled', label: 'Recovery test cancelled' },
];
export function channelDraft(saved?: Channel, kind: 'webhook' | 'smtp' = 'webhook'): ChannelInput {
   if (saved)
      return {
         name: saved.name,
         enabled: saved.enabled,
         events: [...saved.events],
         kind: saved.kind,
         config: structuredClone(saved.config),
      } as ChannelInput;
   const common = { name: '', enabled: false, events: eventChoices.map((event) => event.value) };
   return kind === 'webhook'
      ? { ...common, kind, config: { url: '', timeoutMs: 10000, network: 'public', allowedCidrs: [] } }
      : {
           ...common,
           kind,
           config: {
              host: '',
              port: 587,
              security: 'starttls',
              username: '',
              senderEmail: '',
              senderName: 'Pluton',
              recipients: [],
              timeoutMs: 15000,
              network: 'public',
              allowedCidrs: [],
           },
        };
}
export function channelRequest(draft: ChannelInput, secret: string, clearSecret: boolean, cidrs: string, recipients: string): ChannelInput {
   const result = structuredClone(draft);
   result.config.allowedCidrs =
      draft.config.network === 'trusted-lan'
         ? cidrs
              .split(',')
              .map((value) => value.trim())
              .filter(Boolean)
         : [];
   if (result.kind === 'smtp')
      result.config.recipients = [
         ...new Set(
            recipients
               .split(',')
               .map((value) => value.trim())
               .filter(Boolean),
         ),
      ];
   delete result.secret;
   if (clearSecret) result.secret = '';
   else if (secret) result.secret = secret;
   return result;
}
export function toggleChoice<T extends string>(values: T[], value: T): T[] {
   return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}
export const emptySubscription = (): Subscription => ({ enabled: false, channelIds: [], events: eventChoices.map((event) => event.value) });
export function deliveryDescription(status: string, kind: string): string {
   return status === 'succeeded'
      ? kind === 'smtp'
         ? 'Accepted by SMTP relay (not an inbox delivery guarantee)'
         : 'Accepted by webhook receiver (HTTP 2xx)'
      : status === 'pending'
        ? 'Queued / waiting for a delivery attempt'
        : status === 'sending'
          ? 'Delivery in progress'
          : 'Delivery failed — see sanitized error';
}
