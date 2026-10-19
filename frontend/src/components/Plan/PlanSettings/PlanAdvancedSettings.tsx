import { useEffect, useMemo, useState } from 'react';
import Icon from '../../common/Icon/Icon';
import classes from './PlanSettings.module.scss';
import PlanNotificationSettings from './PlanNotificationSettings';
import PlanPerformanceSettings from './PlanPerformanceSettings';
import { NewPlanSettings, PlanAddRunSettings } from '../../../@types/plans';
import TagsInput from '../../common/form/TagsInput/TagsInput';
import PlanGeneralSettings from './PlanGeneralSettings';
import { isMobile } from '../../../utils/helpers';
import Select from '../../common/form/Select/Select';
import PlanScriptsSettings from './PlanScriptsSettings';
import { Device } from '../../../@types/devices';
import PlanRemoteLifecycleSettings from './PlanRemoteLifecycleSettings';
import RecoverySettings from '../RecoveryTesting/RecoverySettings';
import ManagedPlanNotifications from './ManagedPlanNotifications';

interface PlanAdvancedSettingsProps {
   plan: NewPlanSettings;
   appSettings?: Record<string, any>;
   device: Device;
   onUpdate: (notificationSettings: NewPlanSettings) => void;
   isEditing: boolean;
   runSettings?: PlanAddRunSettings;
   setRunSettings?: (runSettings: PlanAddRunSettings) => void;
   allowScripts?: boolean;
}

const PlanAdvancedSettings = ({
   plan,
   appSettings,
   device,
   onUpdate,
   isEditing,
   runSettings,
   setRunSettings,
   allowScripts = true,
}: PlanAdvancedSettingsProps) => {
   const [advancedTab, setAdvancedTab] = useState('General');
   const settings = plan.settings;
   const remoteLifecycle = plan.sourceType === 'device' && plan.sourceId !== 'main';

   useEffect(() => {
      if (!allowScripts && advancedTab === 'Scripts') setAdvancedTab('General');
   }, [allowScripts, advancedTab]);

   const integrationTypes = useMemo(() => {
      const types: string[] = [];
      if (appSettings?.integration) {
         Object.keys(appSettings.integration).forEach((k) => {
            if (appSettings.integration[k] && appSettings.integration[k].connected) {
               types.push(k);
            }
         });
      }
      return types;
   }, [appSettings]);

   return (
      <div className={`${classes.advancedOptions} styled__scrollbar`}>
         {isMobile() ? (
            <Select
               customClasses={classes.advancedSettingsSelect}
               options={[
                  { label: 'General', value: 'General', icon: 'folders' },
                  // { label: 'Prune', value: 'Prune', icon: 'prune' },
                  { label: 'Performance', value: 'Performance', icon: 'performance' },
                  { label: 'Notification', value: 'Notification', icon: 'notification' },
                  { label: 'Misc.', value: 'Misc', icon: 'settings-alt' },
                  ...(remoteLifecycle ? [{ label: 'Database & Hooks', value: 'Lifecycle', icon: 'cli' as const }] : []),
                  ...(remoteLifecycle && plan.method === 'backup'
                     ? [{ label: 'Recovery Testing', value: 'Recovery', icon: 'restore' as const }]
                     : []),
               ]}
               fieldValue={advancedTab}
               full={true}
               onUpdate={(val) => setAdvancedTab(val)}
            />
         ) : (
            <>
               <ul className={classes.advancedTabs}>
                  <li onClick={() => setAdvancedTab('General')} className={advancedTab === 'General' ? classes.advancedTabActive : ''}>
                     <Icon size={13} type="folders" /> General
                  </li>
                  {/* <li onClick={() => setAdvancedTab('Prune')} className={advancedTab === 'Prune' ? classes.advancedTabActive : ''}>
                     <Icon size={13} type="prune" /> Prune
                  </li> */}
                  <li onClick={() => setAdvancedTab('Performance')} className={advancedTab === 'Performance' ? classes.advancedTabActive : ''}>
                     <Icon size={13} type="performance" /> Performance
                  </li>
                  <li onClick={() => setAdvancedTab('Notification')} className={advancedTab === 'Notification' ? classes.advancedTabActive : ''}>
                     <Icon size={13} type="notification" /> Notification
                  </li>
                  {allowScripts && (
                     <li onClick={() => setAdvancedTab('Scripts')} className={advancedTab === 'Scripts' ? classes.advancedTabActive : ''}>
                        <Icon size={13} type="cli" /> Scripts
                     </li>
                  )}
                  {remoteLifecycle && (
                     <li onClick={() => setAdvancedTab('Lifecycle')} className={advancedTab === 'Lifecycle' ? classes.advancedTabActive : ''}>
                        <Icon size={13} type="cli" /> Database & Hooks
                     </li>
                  )}
                  {remoteLifecycle && plan.method === 'backup' && (
                     <li onClick={() => setAdvancedTab('Recovery')} className={advancedTab === 'Recovery' ? classes.advancedTabActive : ''}>
                        <Icon type="restore" size={13} /> Recovery Testing
                     </li>
                  )}
                  <li onClick={() => setAdvancedTab('Misc')} className={advancedTab === 'Misc' ? classes.advancedTabActive : ''}>
                     <Icon size={14} type="settings-alt" /> Misc.
                  </li>
               </ul>
            </>
         )}
         <div className={classes.advancedTabContent}>
            {remoteLifecycle && plan.method === 'backup' && advancedTab === 'Recovery' && (
               <RecoverySettings planId={isEditing ? plan.id : undefined} />
            )}
            {remoteLifecycle && advancedTab === 'Lifecycle' && (
               <PlanRemoteLifecycleSettings
                  value={settings.remoteLifecycle}
                  onUpdate={(value) =>
                     onUpdate({
                        ...plan,
                        settings: { ...settings, remoteLifecycle: value },
                     })
                  }
               />
            )}
            {advancedTab === 'General' && (
               <PlanGeneralSettings
                  settings={settings}
                  onUpdate={(newSettings) => onUpdate({ ...plan, settings: newSettings })}
                  isEditing={isEditing}
                  runSettings={runSettings}
                  setRunSettings={setRunSettings}
               />
            )}
            {advancedTab === 'Notification' && (
               <>
                  <ManagedPlanNotifications planId={isEditing ? plan.id : undefined} />
                  <details>
                     <summary>Existing community notification settings (separate delivery path)</summary>
                     <PlanNotificationSettings
                        types={integrationTypes}
                        planID={plan.id}
                        isSync={plan.method === 'sync'}
                        admin_email={appSettings?.admin_email}
                        notificationSettings={plan.settings?.notification || {}}
                        onUpdate={(notification) => onUpdate({ ...plan, settings: { ...settings, notification } })}
                     />
                  </details>
               </>
            )}
            {/* {advancedTab === 'Prune' && (
               <PlanPruneSettings plan={plan} onUpdate={(prune) => onUpdate({ ...plan, settings: { ...settings, prune } })} />
            )} */}
            {advancedTab === 'Performance' && (
               <PlanPerformanceSettings plan={plan} onUpdate={(performance) => onUpdate({ ...plan, settings: { ...settings, performance } })} />
            )}
            {advancedTab === 'Misc' && (
               <div className={classes.field}>
                  <label className={classes.label}>Tags</label>
                  <TagsInput fieldValue={plan.tags || []} onUpdate={(val) => onUpdate({ ...plan, tags: val })} />
               </div>
            )}
            {allowScripts && advancedTab === 'Scripts' && (
               <PlanScriptsSettings
                  settings={plan.settings?.scripts || {}}
                  platform={device?.platform || undefined}
                  onUpdate={(scripts: NewPlanSettings['settings']['scripts']) => onUpdate({ ...plan, settings: { ...plan.settings, scripts } })}
               />
            )}
         </div>
      </div>
   );
};

export default PlanAdvancedSettings;
