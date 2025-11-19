import { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import Icon from '../../components/common/Icon/Icon';
import PageHeader from '../../components/common/PageHeader/PageHeader';
import classes from './Settings.module.scss';
import { useGetSettings, useUpdateSettings } from '../../services/settings';
import IntegrationSettings from '../../components/Settings/IntegrationSettings/IntegrationSettings';
import AnimatedWrapper from '../../components/common/AnimatedWrapper/AnimatedWrapper';
import AppLogs from '../../components/Settings/AppLogs/AppLogs';
import SidePanel from '../../components/common/SidePanel/SidePanel';
import GeneralSettings from '../../components/Settings/GeneralSettings/GeneralSettings';

const Settings = () => {
   const [tab, setTab] = useState(() => {
      const params = new URLSearchParams(window.location.search);
      return params.get('t') || 'general';
   });
   const [settings, setSettings] = useState<Record<string, any>>({});
   const [showAppLogs, setShowAppLogs] = useState(false);
   const { data } = useGetSettings();
   const settingsMutation = useUpdateSettings();
   const settingsID = data?.result?.id;
   const rawSettings = data?.result?.settings;

   console.log('Settings data :', settingsID, data);

   useEffect(() => {
      if (rawSettings) {
         setSettings(rawSettings);
      }
   }, [rawSettings]);

   const updateSettings = () => {
      settingsMutation.mutate(
         { id: settingsID, settings: settings },
         {
            onSuccess: () => toast.success('Settings Updated!', { autoClose: 5000 }),
            onError: (error) => toast.error('Failed to Update Settings. ' + error?.message || ''),
         },
      );
   };

   return (
      <div className={classes.settings}>
         <PageHeader
            title={'Settings'}
            icon="settings"
            rightSection={
               <>
                  <button onClick={() => setShowAppLogs(true)}>
                     <Icon type="logs" size={16} /> App Logs
                  </button>
               </>
            }
         />
         <div className={classes.settingsContent}>
            <div className={classes.sidebar}>
               <ul className={classes.tabs}>
                  <li className={`${tab === 'general' ? classes.tabActive : ''}`} onClick={() => setTab('general')}>
                     <Icon type="cog" size={13} /> General
                  </li>
                  <li className={`${tab === 'integration' ? classes.tabActive : ''}`} onClick={() => setTab('integration')}>
                     <Icon type="integration" size={13} /> Integrations
                  </li>
               </ul>
               <button className={classes.updateBtn} onClick={() => updateSettings()}>
                  <Icon type={settingsMutation.isPending ? 'loading' : 'check'} size={11} /> {settingsMutation.isPending ? 'Updating...' : 'Update'}
               </button>
            </div>
            <div className={classes.content}>
               <AnimatedWrapper isVisible={tab === 'general'} animationType="slide-left" animationDuration={100} absolute={true}>
                  <div className={classes.tabContent}>
                     <h4>General Settings</h4>
                     <GeneralSettings
                        settingsID={settingsID}
                        settings={settings}
                        onUpdate={(st: Record<string, any>) => setSettings({ ...settings, ...st })}
                     />
                  </div>
               </AnimatedWrapper>
               <AnimatedWrapper isVisible={tab === 'integration'} animationType="slide-left" animationDuration={100} absolute={true}>
                  <div className={classes.tabContent}>
                     <h4>Notification Integration Settings</h4>
                     <IntegrationSettings
                        settingsID={settingsID}
                        settings={settings}
                        onUpdate={(st: Record<string, any>) => setSettings({ ...settings, integration: st })}
                     />
                  </div>
               </AnimatedWrapper>
            </div>
         </div>
         {showAppLogs && (
            <SidePanel width="80%" title="App Logs" icon={<Icon type={'logs'} size={20} />} close={() => setShowAppLogs(false)}>
               <AppLogs settingsID="1" />
            </SidePanel>
         )}
      </div>
   );
};

export default Settings;
