import { useState } from 'react';
import classes from './IntegrationSettings.module.scss';
import SMTPSettings from './SMTPSettings';
import NtfySettings from './NtfySettings';
import Icon from '../../common/Icon/Icon';
import Select from '../../common/form/Select/Select';
import { isMobile } from '../../../utils';

interface IntegrationSettingsProps {
   settingsID: number;
   settings: Record<string, any>;
   onUpdate: (settings: IntegrationSettingsProps['settings']) => void;
}

const IntegrationSettings = ({ settingsID, settings, onUpdate }: IntegrationSettingsProps) => {
   const [tab, setTab] = useState<'smtp' | 'ntfy'>('smtp');
   const integrationSettings = settings?.integration || {};
   const { smtp, ntfy } = integrationSettings || {};

   const onIntegrationUpdate = (key: string, intSettings: Record<string, any>) => {
      console.log('onIntegrationUpdate :', key, intSettings);
      onUpdate({ ...integrationSettings, [key]: { ...integrationSettings[key], ...intSettings } });
   };

   return (
      <div className={classes.integrations}>
         {isMobile() ? (
            <Select
               customClasses={classes.integrationSelect}
               options={[
                  { label: 'SMTP', value: 'smtp', icon: 'email' },
                  { label: 'Ntfy', value: 'ntfy', icon: 'ntfy' },
               ]}
               fieldValue={tab}
               full={true}
               onUpdate={(val) => setTab(val as 'smtp' | 'ntfy')}
            />
         ) : (
            <>
               <ul className={classes.tabs}>
                  <li className={`${tab === 'smtp' ? classes.tabActive : ''}`} onClick={() => setTab('smtp')}>
                     <Icon type="email" size={14} /> SMTP
                     {smtp?.connected && <Icon type="check-circle-filled" size={12} />}
                  </li>
                  <li className={`${tab === 'ntfy' ? classes.tabActive : ''}`} onClick={() => setTab('ntfy')}>
                     <Icon type="ntfy" size={14} /> Ntfy
                     {ntfy?.connected && <Icon type="check-circle-filled" size={12} />}
                  </li>
               </ul>
            </>
         )}
         <div>
            {tab === 'smtp' && (
               <SMTPSettings
                  settingsID={settingsID}
                  settings={integrationSettings}
                  onUpdate={(iSettings) => onIntegrationUpdate('smtp', iSettings)}
               />
            )}
            {tab === 'ntfy' && (
               <NtfySettings
                  settingsID={settingsID}
                  settings={integrationSettings}
                  onUpdate={(iSettings) => onIntegrationUpdate('ntfy', iSettings)}
               />
            )}
         </div>
      </div>
   );
};

export default IntegrationSettings;
