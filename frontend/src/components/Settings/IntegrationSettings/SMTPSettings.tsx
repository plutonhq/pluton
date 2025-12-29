import { useState } from 'react';
import Input from '../../common/form/Input/Input';
import Icon from '../../common/Icon/Icon';
import { isValidEmail } from '../../../utils/helpers';
import { SmtpSettingsType } from '../../../@types/settings';
import classes from './IntegrationSettings.module.scss';

interface SMTPSettingsProps {
   settings: SmtpSettingsType;
   onUpdate: (settings: SmtpSettingsType) => void;
   showTestModal: (type: 'smtp') => void;
}

const SMTPSettings = ({ settings, onUpdate, showTestModal }: SMTPSettingsProps) => {
   const [errorFields, setErrorFields] = useState<{ server: string; port: string; senderEmail: string }>({
      server: '',
      port: '',
      senderEmail: '',
   });

   const validateSettings = (e: React.FormEvent) => {
      e.preventDefault();

      const newErrors = { server: '', port: '', senderEmail: '' };

      if (!settings?.server) {
         newErrors.server = 'Server is required';
      }
      if (!settings?.port) {
         newErrors.port = 'Port is required';
      }
      if (!settings?.senderEmail) {
         newErrors.senderEmail = 'Sender Email is required';
      } else if (!isValidEmail(settings.senderEmail)) {
         newErrors.senderEmail = 'Invalid email';
      }

      setErrorFields(newErrors);
      const hasErrors = Object.values(newErrors).some((error) => error !== '');
      if (!hasErrors) {
         showTestModal('smtp');
      }
   };

   return (
      <div className={classes.integrations}>
         <div className={classes.field}>
            <Input
               label="SMTP Server*"
               fieldValue={(settings?.server || '') as string}
               onUpdate={(val) => onUpdate({ ...settings, server: val })}
               error={errorFields?.server}
            />
         </div>
         <div className={classes.field}>
            <Input
               label="SMTP PORT*"
               fieldValue={(settings?.port || '') as string}
               onUpdate={(val) => onUpdate({ ...settings, port: parseInt(val, 10) })}
               error={errorFields?.port}
            />
         </div>
         <div className={classes.field}>
            <Input
               label="Sender Email*"
               type="email"
               fieldValue={(settings?.senderEmail || '') as string}
               onUpdate={(val) => onUpdate({ ...settings, senderEmail: val })}
               error={errorFields?.senderEmail}
            />
         </div>
         <div className={classes.field}>
            <Input
               label="SMTP Username"
               fieldValue={(settings?.username || '') as string}
               onUpdate={(val) => onUpdate({ ...settings, username: val })}
            />
         </div>
         <div className={classes.field}>
            <Input
               label="SMTP Password"
               fieldValue={(settings?.password || '') as string}
               type="password"
               onUpdate={(val) => onUpdate({ ...settings, password: val })}
            />
         </div>

         <div className={classes.field}>
            <button className={classes.validateBtn} onClick={validateSettings} type="button">
               <Icon type="check" size={10} /> {settings?.connected ? 'Re-validate SMTP' : 'Validate SMTP'}
            </button>
         </div>
      </div>
   );
};

export default SMTPSettings;
