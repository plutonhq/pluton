import { useState } from 'react';
import classes from './IntegrationSettings.module.scss';
import Input from '../../common/form/Input/Input';
import ActionModal from '../../common/ActionModal/ActionModal';
import { useValidateIntegration } from '../../../services/settings';
import SMTPSettings from './SMTPSettings';

interface IntegrationSettingsProps {
   settingsID: number;
   settings: Record<string, any>;
   onUpdate: (settings: IntegrationSettingsProps['settings']) => void;
}

const IntegrationSettings = ({ settingsID, settings, onUpdate }: IntegrationSettingsProps) => {
   const [testEmail, setTestEmail] = useState('');
   const [showEmailTestModal, setShowEmailTestModal] = useState<'' | 'smtp'>('');
   const integrationSettings = settings?.integration || {};
   const { smtp } = integrationSettings || {};

   const validationMutation = useValidateIntegration();

   console.log('smtp :', smtp);

   return (
      <div className={classes.integrations}>
         <div>
            <SMTPSettings settings={smtp} onUpdate={onUpdate} showTestModal={setShowEmailTestModal} />
         </div>
         {showEmailTestModal && (
            <ActionModal
               title={`Test SMTP Integration`}
               message={
                  <>
                     <Input
                        label="Send Test Email to this email"
                        full={true}
                        fieldValue={testEmail}
                        onUpdate={(val) => setTestEmail(val)}
                        type="email"
                        placeholder="test@test.com"
                     />
                  </>
               }
               errorMessage={validationMutation.error?.message}
               successMessage={validationMutation.isSuccess ? 'Test email sent. Integration validated successfully.' : ''}
               closeModal={() => setShowEmailTestModal('')}
               width="400px"
               secondaryAction={{ title: 'Close', action: () => setShowEmailTestModal('') }}
               primaryAction={{
                  title: `Send Test Email`,
                  type: 'default',
                  icon: 'email',
                  isPending: validationMutation.isPending,
                  action: () => validationMutation.mutate({ settingsID, type: 'smtp', settings: settings, test: { email: testEmail } }),
               }}
            />
         )}
      </div>
   );
};

export default IntegrationSettings;
