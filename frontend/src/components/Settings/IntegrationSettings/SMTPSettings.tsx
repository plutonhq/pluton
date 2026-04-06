import { useState } from 'react';
import Input from '../../common/form/Input/Input';
import Icon from '../../common/Icon/Icon';
import { isValidEmail } from '../../../utils/helpers';
import { SmtpSettingsType } from '../../../@types/settings';
import { IntegrationSettings } from '../../../@types';
import classes from './IntegrationSettings.module.scss';
import ValidateEmailIntegration from './ValidateEmailIntegration';

interface SMTPSettingsProps {
   settingsID: number;
   settings: IntegrationSettings;
   onUpdate: (settings: SmtpSettingsType) => void;
}

const SMTPSettings = ({ settingsID, settings, onUpdate }: SMTPSettingsProps) => {
   const [showTestModal, setShowTestModal] = useState(false);
   const [errorFields, setErrorFields] = useState<{ server: string; port: string; senderEmail: string }>({
      server: '',
      port: '',
      senderEmail: '',
   });

   const smtpSettings = settings?.smtp || { server: '', port: 587, senderEmail: '', username: '', password: '', connected: false };

   const validateSettings = (e: React.FormEvent) => {
      e.preventDefault();

      const newErrors = { server: '', port: '', senderEmail: '' };

      if (!smtpSettings?.server) {
         newErrors.server = 'Server is required';
      }
      if (!smtpSettings?.port) {
         newErrors.port = 'Port is required';
      }
      if (!smtpSettings?.senderEmail) {
         newErrors.senderEmail = 'Sender Email is required';
      } else if (!isValidEmail(smtpSettings.senderEmail)) {
         newErrors.senderEmail = 'Invalid email';
      }

      setErrorFields(newErrors);
      const hasErrors = Object.values(newErrors).some((error) => error !== '');
      if (!hasErrors) {
         setShowTestModal(true);
      }
   };

   return (
      <div className={classes.integrations}>
         <div className={classes.field}>
            <Input
               label="SMTP Server*"
               fieldValue={(smtpSettings?.server || '') as string}
               onUpdate={(val) => onUpdate({ ...smtpSettings, server: val })}
               error={errorFields?.server}
            />
         </div>
         <div className={classes.field}>
            <Input
               label="SMTP PORT*"
               fieldValue={(smtpSettings?.port || '') as string}
               onUpdate={(val) => onUpdate({ ...smtpSettings, port: parseInt(val, 10) })}
               error={errorFields?.port}
            />
         </div>
         <div className={classes.field}>
            <Input
               label="Sender Email*"
               type="email"
               fieldValue={(smtpSettings?.senderEmail || '') as string}
               onUpdate={(val) => onUpdate({ ...smtpSettings, senderEmail: val })}
               error={errorFields?.senderEmail}
            />
         </div>
         <div className={classes.field}>
            <Input
               label="SMTP Username"
               fieldValue={(smtpSettings?.username || '') as string}
               onUpdate={(val) => onUpdate({ ...smtpSettings, username: val })}
            />
         </div>
         <div className={classes.field}>
            <Input
               label="SMTP Password"
               fieldValue={(smtpSettings?.password || '') as string}
               type="password"
               onUpdate={(val) => onUpdate({ ...smtpSettings, password: val })}
            />
         </div>

         <div className={classes.field}>
            <button className={classes.validateBtn} onClick={validateSettings} type="button">
               <Icon type="check" size={10} /> {smtpSettings?.connected ? 'Re-validate SMTP' : 'Validate SMTP'}
            </button>
         </div>

         {showTestModal && (
            <ValidateEmailIntegration settingsID={settingsID} settings={settings} integrationType="smtp" onClose={() => setShowTestModal(false)} />
         )}
      </div>
   );
};

export default SMTPSettings;
