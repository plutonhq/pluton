import { useState } from 'react';
import { toast } from 'react-toastify';
import { ActionModal } from '../..';
import { useTheme } from '../../../context/ThemeContext';
import { useDisableTwoFactorAuth } from '../../../services/settings';
import Input from '../../common/form/Input/Input';
import Toggle from '../../common/form/Toggle/Toggle';
import Tristate from '../../common/form/Tristate/Tristate';
import TwoFactorSetup from '../TwoFactorSetup/TwoFactorSetup';
import classes from './GeneralSettings.module.scss';

interface GeneralSettingsProps {
   settingsID: number;
   settings: Record<string, any>;
   onUpdate: (settings: Record<string, any>) => void;
}

const GeneralSettings = ({ settings, settingsID, onUpdate }: GeneralSettingsProps) => {
   const { setTheme } = useTheme();
   const [show2FASetupConfirm, setShow2FASetupConfirm] = useState(false);
   const [show2FASetup, setShow2FASetup] = useState(false);
   const [show2FADisableConfirm, setShow2FADisableConfirm] = useState(false);
   const disable2FAMutation = useDisableTwoFactorAuth();

   const { totp } = settings || {};

   const update2FASetting = (enabled: boolean) => {
      if (enabled && !totp?.enabled) {
         setShow2FASetupConfirm(true);
      } else if (!enabled && totp?.enabled) {
         setShow2FADisableConfirm(true);
      }
   };

   const disable2FA = () => {
      disable2FAMutation.mutate(settingsID, {
         onSuccess: () => {
            // Update only the local totp state, so unsaved edits in the form are kept.
            onUpdate({ ...settings, totp: { enabled: false, configured: false } });
            setShow2FADisableConfirm(false);
            toast.success('Two-Factor Authentication (2FA) disabled.', { autoClose: 5000 });
         },
      });
   };

   const handleThemeChange = (newThemeValue: 'auto' | 'light' | 'dark') => {
      setTheme(newThemeValue);
      onUpdate({ ...settings, theme: newThemeValue });
   };

   return (
      <div>
         <div className={classes.field}>
            <Input
               label="App Instance Title"
               fieldValue={(settings?.title || '') as string}
               onUpdate={(val) => onUpdate({ ...settings, title: val })}
               inline={false}
            />
         </div>
         <div className={classes.field}>
            <Input
               label="App Instance Description"
               fieldValue={(settings?.description || '') as string}
               onUpdate={(val) => onUpdate({ ...settings, description: val })}
               inline={false}
            />
         </div>
         <div className={classes.field}>
            <Input
               label="Admin Email"
               fieldValue={settings.admin_email || ''}
               onUpdate={(val) => onUpdate({ ...settings, admin_email: val })}
               type="email"
               placeholder="johndoe@mail.com"
               inline={false}
            />
         </div>
         <div className={classes.field}>
            <Tristate
               label="Color Scheme"
               fieldValue={settings.theme as string}
               options={[
                  { label: 'Auto', value: 'auto' },
                  { label: 'Dark', value: 'dark' },
                  { label: 'Light', value: 'light' },
               ]}
               onUpdate={(val: string) => handleThemeChange(val as 'auto' | 'light' | 'dark')}
               inline={false}
            />
         </div>
         <div className={classes.field}>
            <Toggle
               label="Enable Two-Factor Authentication (2FA)"
               fieldValue={settings?.totp?.enabled || false}
               onUpdate={(val) => update2FASetting(val)}
               inline={false}
            />
         </div>
         {show2FASetupConfirm && (
            <ActionModal
               title={`Enable Two-Factor Authentication (2FA)`}
               message={`Are you sure you want to enable Two-Factor Authentication (2FA) to secure Pluton Login? You will be required to use an authenticator app to login if you enable this feature.`}
               closeModal={() => setShow2FASetupConfirm(false)}
               width="420px"
               primaryAction={{
                  title: `Yes, Enable 2FA`,
                  type: 'default',
                  isPending: false,
                  action: () => setShow2FASetup(true),
               }}
            />
         )}
         {show2FADisableConfirm && (
            <ActionModal
               title={`Disable Two-Factor Authentication (2FA)`}
               message={`Are you sure you want to disable Two-Factor Authentication (2FA)? Your current authenticator codes and recovery codes will stop working. To enable 2FA again, you must set it up again with a new QR code.`}
               closeModal={() => {
                  if (disable2FAMutation.isPending) return;
                  disable2FAMutation.reset();
                  setShow2FADisableConfirm(false);
               }}
               width="420px"
               errorMessage={disable2FAMutation.isError ? disable2FAMutation.error?.message : undefined}
               primaryAction={{
                  title: `Yes, Disable 2FA`,
                  type: 'danger',
                  isPending: disable2FAMutation.isPending,
                  action: disable2FA,
               }}
            />
         )}
         {show2FASetup && <TwoFactorSetup id={settingsID} close={() => setShow2FASetup(false)} />}
      </div>
   );
};

export default GeneralSettings;
