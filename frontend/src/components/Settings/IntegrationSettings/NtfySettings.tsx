import { useState } from 'react';
import classes from './IntegrationSettings.module.scss';
import { IntegrationSettings, NtfySettingsType } from '../../../@types';
import Icon from '../../common/Icon/Icon';
import Select from '../../common/form/Select/Select';
import Input from '../../common/form/Input/Input';
import ActionModal from '../../common/ActionModal/ActionModal';
import { useValidateIntegration } from '../../../services';
import PasswordField from '../../common/form/PasswordField/PasswordField';

interface NtfySettingsProps {
   settingsID: number;
   settings: IntegrationSettings;
   onUpdate: (settings: NtfySettingsType) => void;
}

const NtfySettings = ({ settingsID, settings, onUpdate }: NtfySettingsProps) => {
   const [ntfySettings, setNtfySettings] = useState<NtfySettingsType>(settings?.ntfy || { authType: 'token', authToken: '', connected: false });
   const [errorFields, setErrorFields] = useState<{ authToken: string }>({ authToken: '' });
   const [showTestModal, setShowTestModal] = useState(false);
   const [testUrl, setTestUrl] = useState('');
   const validationMutation = useValidateIntegration();

   const authType = ntfySettings.authType || 'token';

   const updateNtfySettings = (updated: NtfySettingsType) => {
      setNtfySettings(updated);
      onUpdate(updated);
   };

   const validateSettings = (e: React.FormEvent) => {
      e.preventDefault();

      const newErrors = { authToken: '' };

      if (!ntfySettings?.authToken) {
         newErrors.authToken = 'Required';
      }
      setErrorFields(newErrors);
      const hasErrors = Object.values(newErrors).some((error) => error !== '');
      if (!hasErrors) {
         setShowTestModal(true);
      }
   };

   return (
      <div>
         <div className={classes.field}>
            <Select
               label="Auth Type*"
               fieldValue={authType}
               options={[{ label: 'Token', value: 'token' }]}
               onUpdate={(val) => updateNtfySettings({ ...ntfySettings, authType: val })}
               inline={true}
            />
         </div>
         <div className={classes.field}>
            <PasswordField
               label="Auth Token*"
               fieldValue={ntfySettings.authToken}
               onUpdate={(val) => updateNtfySettings({ ...ntfySettings, authToken: val })}
               error={errorFields?.authToken}
            />
         </div>
         <div className={classes.field}>
            <button className={classes.validateBtn} onClick={validateSettings} type="button">
               <Icon type="check" size={10} /> {ntfySettings.connected ? 'Re-validate Ntfy' : 'Validate Ntfy'}
            </button>
         </div>
         {showTestModal && (
            <ActionModal
               title={`Test Ntfy Integration`}
               message={
                  <>
                     <Input
                        label="Send Test Notification to this topic"
                        full={true}
                        inline={false}
                        fieldValue={testUrl}
                        onUpdate={(val) => setTestUrl(val)}
                        type="text"
                        placeholder="test/topic url. Eg: https://ntfy.sh/testtopic"
                     />
                  </>
               }
               errorMessage={validationMutation.error?.message}
               successMessage={validationMutation.isSuccess ? 'Test notification sent. Integration validated successfully.' : ''}
               closeModal={() => setShowTestModal(false)}
               width="400px"
               secondaryAction={{ title: 'Close', action: () => setShowTestModal(false) }}
               primaryAction={{
                  title: `Send Test Notification`,
                  type: 'default',
                  icon: 'send',
                  isPending: validationMutation.isPending,
                  action: () =>
                     testUrl &&
                     validationMutation.mutate({ settingsID, type: 'ntfy', settings: { ...settings, ntfy: ntfySettings }, test: { url: testUrl } }),
               }}
            />
         )}
      </div>
   );
};

export default NtfySettings;
