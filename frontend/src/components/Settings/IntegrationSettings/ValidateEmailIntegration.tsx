import { useState } from 'react';
import Input from '../../common/form/Input/Input';
import ActionModal from '../../common/ActionModal/ActionModal';
import { useValidateIntegration } from '../../../services';
import { INTEGRATIONS_AVAILABLE, IntegrationSettings, IntegrationTypes } from '../../../@types';

interface ValidateEmailIntegrationProps {
   settingsID: number;
   settings: IntegrationSettings;
   integrationType: IntegrationTypes;
   onClose: () => void;
}

const ValidateEmailIntegration = ({ settingsID, settings, integrationType, onClose }: ValidateEmailIntegrationProps) => {
   const [testEmail, setTestEmail] = useState('');
   const validationMutation = useValidateIntegration();
   const integrationName = INTEGRATIONS_AVAILABLE[integrationType as IntegrationTypes].name;

   return (
      <ActionModal
         title={`Test ${integrationName} Integration`}
         message={
            <>
               <Input
                  label="Send Test Email to this email"
                  full={true}
                  inline={false}
                  fieldValue={testEmail}
                  onUpdate={(val) => setTestEmail(val)}
                  type="email"
                  placeholder="test@test.com"
               />
            </>
         }
         errorMessage={validationMutation.error?.message}
         successMessage={validationMutation.isSuccess ? `Test email sent. ${integrationName} validated successfully.` : ''}
         closeModal={onClose}
         width="400px"
         secondaryAction={{ title: 'Close', action: onClose }}
         primaryAction={{
            title: 'Send Test Email',
            type: 'default',
            icon: 'email',
            isPending: validationMutation.isPending,
            action: () =>
               testEmail &&
               validationMutation.mutate({
                  settingsID,
                  type: integrationType,
                  settings: { ...settings },
                  test: { email: testEmail },
               }),
         }}
      />
   );
};

export default ValidateEmailIntegration;
