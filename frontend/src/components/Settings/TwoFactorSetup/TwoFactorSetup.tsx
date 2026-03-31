import { useEffect, useState } from 'react';
import { useSetupTwoFactorAuth, useVerifyTwoFactorAuth } from '../../../services';
import Icon from '../../common/Icon/Icon';
import Modal from '../../common/Modal/Modal';
import Input from '../../common/form/Input/Input';
import Button from '../../common/Button/Button';
import classes from './TwoFactorSetup.module.scss';

interface TwoFactorSetupProps {
   id: number;
   close: () => void;
}

const TwoFactorSetup = ({ close, id = 1 }: TwoFactorSetupProps) => {
   const [verificationCode, setVerificationCode] = useState('');
   const setupMutation = useSetupTwoFactorAuth();
   const verifyMutation = useVerifyTwoFactorAuth();
   const isLoading = setupMutation.isPending || verifyMutation.isPending;

   const qrCodeUrl: string = setupMutation.data?.result?.qrCodeDataUrl || '';
   const setupKey: string = setupMutation.data?.result?.setupKey || '';
   const recoveryCodes: string[] = verifyMutation.data?.result?.recoveryCodes || [];

   useEffect(() => {
      setupMutation.mutate(id);
   }, []);

   const verify2FA = () => {
      verifyMutation.mutate({ code: verificationCode, id });
   };

   return (
      <>
         {!verifyMutation.isSuccess && (
            <Modal title="Two-Factor Authentication (2FA) Setup" closeModal={() => !isLoading && close()} width="500px" disableBackdropClick={true}>
               <div className={classes.twoFactorSetup}>
                  {setupMutation.isPending && (
                     <p>
                        <Icon type="loading" /> Setting up 2FA...
                     </p>
                  )}
                  {setupMutation.isError && <p className={classes.error}>Error setting up 2FA. Please try again.</p>}
                  {setupMutation.isSuccess && (
                     <div className={classes.setupContainer}>
                        <div className={classes.instructions}>
                           <h4>Setup Instructions</h4>
                           <ol>
                              <li>
                                 Download and install an authenticator app on your mobile device (e.g., Google Authenticator, Authy, Microsoft
                                 Authenticator).
                              </li>
                              <li>Open the authenticator app and choose to add a new account.</li>
                              <li>Scan the QR code below using the authenticator app or manually enter the setup key provided.</li>
                              <li>Once added, the app will generate a 6-digit verification code that refreshes every 30 seconds.</li>
                              <li>Enter the current 6-digit code from the authenticator app into the field below to complete the setup.</li>
                           </ol>
                        </div>
                        <div className={classes.qrSection}>
                           <div className={classes.qrCode}>{qrCodeUrl && <img src={qrCodeUrl} alt="2FA QR Code" />}</div>
                           <div className={classes.setupKey}>Setup Key: {setupKey}</div>
                           {verifyMutation.isError && <p className={classes.errorMsg}>{verifyMutation.error?.message}</p>}
                           <div className={classes.verifySection}>
                              <Input
                                 type="text"
                                 placeholder="Enter 6-digit code"
                                 fieldValue={verificationCode}
                                 onUpdate={(val) => setVerificationCode(val)}
                                 full={true}
                              />
                              <Button text="Verify & Enable 2FA" onClick={() => verify2FA()} variant="primary" size="sm" />
                           </div>
                        </div>
                     </div>
                  )}
               </div>
            </Modal>
         )}

         {verifyMutation.isSuccess && (
            <Modal
               title="Two-Factor Authentication (2FA) Setup"
               closeModal={() => !isLoading && location.reload()}
               width="500px"
               disableBackdropClick={true}
            >
               <div className={classes.successMessage}>
                  <p className={classes.successMsg}>Two-Factor Authentication (2FA) has been successfully enabled.</p>
                  <p>
                     <strong>
                        Save these backup codes in a secure place. They will be required to access your account if you lose your device. They won't be
                        shown again.
                     </strong>
                  </p>
                  <code className={classes.recoveryCodes}>{recoveryCodes.join('\n')}</code>
               </div>
            </Modal>
         )}
      </>
   );
};

export default TwoFactorSetup;
