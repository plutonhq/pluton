import { useMemo, useState } from 'react';
import Icon from '../../common/Icon/Icon';
import classes from './PlanSettings.module.scss';
import PlanNotificationSettings from './PlanNotificationSettings';
import PlanPruneSettings from './PlanPruneSettings';
import PlanPerformanceSettings from './PlanPerformanceSettings';
import { NewPlanSettings } from '../../../@types/plans';
import TagsInput from '../../common/form/TagsInput/TagsInput';
import PlanGeneralSettings from './PlanGeneralSettings';
import { isMobile } from '../../../utils/helpers';
import Select from '../../common/form/Select/Select';
import PlanScriptsSettings from './PlanScriptsSettings';
import { Device } from '../../../@types/devices';

interface PlanAdvancedSettingsProps {
   plan: NewPlanSettings;
   appSettings?: Record<string, any>;
   device: Device;
   onUpdate: (notificationSettings: NewPlanSettings) => void;
}

const PlanAdvancedSettings = ({ plan, appSettings, device, onUpdate }: PlanAdvancedSettingsProps) => {
   const [advancedTab, setAdvancedTab] = useState('General');
   const settings = plan.settings;
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
                  { label: 'Prune', value: 'Prune', icon: 'prune' },
                  { label: 'Performance', value: 'Performance', icon: 'performance' },
                  { label: 'Notification', value: 'Notification', icon: 'notification' },
                  { label: 'Misc.', value: 'Misc', icon: 'settings-alt' },
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
                  <li onClick={() => setAdvancedTab('Scripts')} className={advancedTab === 'Scripts' ? classes.advancedTabActive : ''}>
                     <Icon size={13} type="cli" /> Scripts
                  </li>
                  <li onClick={() => setAdvancedTab('Misc')} className={advancedTab === 'Misc' ? classes.advancedTabActive : ''}>
                     <Icon size={14} type="settings-alt" /> Misc.
                  </li>
               </ul>
            </>
         )}
         <div className={classes.advancedTabContent}>
            {advancedTab === 'General' && (
               <PlanGeneralSettings settings={settings} onUpdate={(newSettings) => onUpdate({ ...plan, settings: newSettings })} />
            )}
            {advancedTab === 'Notification' && (
               <PlanNotificationSettings
                  types={integrationTypes}
                  plan={plan}
                  admin_email={appSettings?.admin_email}
                  onUpdate={(notification: NewPlanSettings['settings']['notification']) =>
                     onUpdate({ ...plan, settings: { ...settings, notification } })
                  }
               />
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
            {advancedTab === 'Scripts' && (
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
