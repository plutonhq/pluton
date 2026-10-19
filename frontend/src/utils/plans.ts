import { toast } from 'react-toastify';
import { NewPlanSettings, PlanInterval } from '../@types/plans';
import { isValidEmail } from './helpers';
import { remoteLifecycleValidation } from './remoteLifecycle';
import { replicationSettingsError } from './replication';

export function planIntervalName(interval: PlanInterval): string {
   switch (interval.type) {
      case 'hourly':
         return 'Every Hour';
      case 'daily':
         return 'Every Day';
      case 'weekly':
         return 'Every Week';
      case 'monthly':
         return 'Every Month';
      case 'days':
         return `Every Few Days`;
      case 'hours':
         return `Every ${interval.hours} hrs`;
      case 'minutes':
         return `Every ${interval.minutes} mins`;
      default:
         return '';
   }
}

export function planIntervalAgeName(age: string) {
   //it could be 2w, 3m, 1d
   const match = age.match(/(\d+)([wdm])/);
   if (!match) return age;

   const value = parseInt(match[1], 10);
   const unit = match[2];

   switch (unit) {
      case 'w':
         return `${value} week${value > 1 ? 's' : ''}`;
      case 'm':
         return `${value} month${value > 1 ? 's' : ''}`;
      case 'd':
         return `${value} day${value > 1 ? 's' : ''}`;
      default:
         return age;
   }
}

export function isPlanSettingsValid(newPlan: NewPlanSettings, step: number | false = false): boolean {
   if (step === 4 || step === false) {
      const error = remoteLifecycleValidation(newPlan.settings.remoteLifecycle);
      if (error) {
         toast.error(error);
         return false;
      }
   }
   if ((step === 1 || step === false) && !newPlan.title) {
      toast.error(`Plan Title is required`);
      return false;
   }
   if ((step === 2 || step === false) && !newPlan.storage.name) {
      toast.error(`Storage is required`);
      return false;
   }
   if (step === 2 || step === false) {
      const replicationError = replicationSettingsError(
         newPlan.settings.replication,
         { storageId: newPlan.storage.id, storagePath: newPlan.storagePath },
         newPlan.sourceType === 'device' && newPlan.sourceId !== 'main',
      );
      if (replicationError) {
         toast.error(replicationError);
         return false;
      }
      if (newPlan.sourceType === 'storage') {
         if (!newPlan.sourceId) {
            toast.error(`Source Storage is required`);
            return false;
         }
         if (newPlan.storage.id === newPlan.sourceId) {
            toast.error(`The source storage and the destination storage must be different`);
            return false;
         }
      }
      if (newPlan.sourceConfig.includes.length === 0) {
         toast.error(`Sources are required`);
         return false;
      }
      if (newPlan.sourceType === 'device' && newPlan.sourceId !== 'main') {
         const remoteSource = newPlan.sourceConfig.includes[0]?.trim() || '';
         if (!remoteSource.startsWith('/') || remoteSource.includes('..')) {
            toast.error(`Remote source must be one safe absolute Linux path`);
            return false;
         }
         if (!newPlan.storagePath?.trim()) {
            toast.error(`Remote backup destination path is required`);
            return false;
         }
      }
      if (newPlan.storage.id === 'local' && newPlan.storagePath === '') {
         toast.error(`Storage Path is required`);
         return false;
      }
   }
   if ((step === 4 || step === false) && newPlan.settings.notification.email.enabled && !newPlan.settings.notification.email.emails) {
      toast.error(`Notification Email not provided`);
      return false;
   }
   if ((step === 4 || step === false) && newPlan.settings.notification.webhook.enabled && !newPlan.settings.notification.webhook.url) {
      toast.error(`Webhook URL is not provided`);
      return false;
   }
   if ((step === 4 || step === false) && newPlan.settings.notification.email.emails) {
      const notification_emails = newPlan.settings.notification.email.emails.split(',');
      const invalidEmails = notification_emails.filter((x) => isValidEmail(x) === false);
      console.log('invalidEmails: ', invalidEmails);
      if (invalidEmails.length > 0) {
         toast.error(`Invalid Notification Email Provided: ${invalidEmails.join(', ')}`);
         return false;
      }
   }

   return true;
}
