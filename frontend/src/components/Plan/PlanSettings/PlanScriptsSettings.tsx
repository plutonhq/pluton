import classes from './PlanSettings.module.scss';
import { useState } from 'react';
import { NewPlanSettings } from '../../../@types/plans';
import Icon from '../../common/Icon/Icon';
import Toggle from '../../common/form/Toggle/Toggle';
import Select from '../../common/form/Select/Select';
import { getAvailableCliApps, secondsToMinutes } from '../../../utils/helpers';
import NumberInput from '../../common/form/NumberInput/NumberInput';

interface PlanScriptsSettingsProps {
   settings: NewPlanSettings['settings']['scripts'];
   onUpdate: (settings: NewPlanSettings['settings']['scripts']) => void;
   platform?: string;
}

type ScriptEventKey = 'onBackupStart' | 'onBackupEnd' | 'onBackupError' | 'onBackupFailure' | 'onBackupComplete';

const scriptEvents: Record<ScriptEventKey, { title: string; description: string }> = {
   onBackupStart: {
      title: 'Before Backup Start',
      description: 'Scripts that run before the backup starts.',
   },
   onBackupEnd: {
      title: 'After Backup End',
      description: 'Scripts that run after the backup ends.',
   },
   onBackupError: {
      title: 'On Backup Error',
      description: 'Scripts that run when there is a backup error.',
   },
   onBackupFailure: {
      title: 'On Backup Failure',
      description: 'Scripts that run when the backup fails.',
   },
   onBackupComplete: {
      title: 'On Backup Complete',
      description: 'Scripts that run when the backup completes.',
   },
};

const PlanScriptsSettings = ({
   settings = {
      onBackupStart: [],
      onBackupEnd: [],
      onBackupError: [],
      onBackupFailure: [],
      onBackupComplete: [],
   },
   platform,
   onUpdate,
}: PlanScriptsSettingsProps) => {
   const [showTimeoutSettings, setShowTimeoutSettings] = useState<string | false>(false);
   const [activeTabs, setActiveTabs] = useState({
      onBackupStart: false,
      onBackupEnd: false,
      onBackupError: false,
      onBackupFailure: false,
      onBackupComplete: false,
   });
   console.log('settings :', settings);
   console.log('### platform :', platform);

   return (
      <div className={classes.eventTabs}>
         {Object.entries(scriptEvents).map(([eventKey, { title, description }]) => {
            const key = eventKey as ScriptEventKey;
            const scripts = settings[key] || [];
            const isActive = activeTabs[key];
            return (
               <div className={classes.eventTab} key={eventKey}>
                  <div className={classes.eventTabHead}>
                     <div>
                        <span className={classes.eventTabHeadTitle} onClick={() => setActiveTabs({ ...activeTabs, [eventKey]: !isActive })}>
                           {title} ({scripts.length || 0})
                        </span>
                        <button
                           onClick={() => {
                              const newScript = {
                                 id: Math.random().toString(36).substring(2, 15),
                                 type: 'command',
                                 enabled: true,
                                 command: '',
                                 shell: 'default',
                                 logOutput: false,
                                 abortOnError: false,
                              };
                              if (!activeTabs[key]) {
                                 setActiveTabs({ ...activeTabs, [eventKey]: true });
                              }
                              onUpdate({ ...settings, [eventKey]: [...(scripts || []), newScript] });
                           }}
                           className={classes.addScriptButton}
                        >
                           +
                        </button>
                     </div>
                     <div>
                        <span
                           className={classes.eventTabHeadDescription}
                           data-tooltip-id="hintTooltip"
                           data-tooltip-place="top"
                           data-tooltip-content={description}
                        >
                           <Icon type="help" size={13} />
                        </span>

                        <button onClick={() => setActiveTabs({ ...activeTabs, [eventKey]: !isActive })}>
                           <Icon type={isActive ? 'caret-up' : 'caret-down'} size={14} />
                        </button>
                     </div>
                  </div>
                  {isActive && (
                     <div className={classes.eventTabContent}>
                        {scripts?.length === 0 && (
                           <div className={classes.noScriptsMessage}>
                              <span>No scripts configured for this event.</span>
                           </div>
                        )}
                        {scripts?.map((script, index) => (
                           <div key={script.id} className={classes.scriptItem}>
                              <div className={classes.scriptHeader}>
                                 <span className={classes.scriptTitle}>
                                    <Icon type="cli" size={13} /> Script {index + 1}
                                 </span>
                                 {scripts.length > 1 && (
                                    <div className={classes.scriptPositionControls}>
                                       <button
                                          title="Move Up"
                                          disabled={index === 0}
                                          onClick={() => {
                                             const updatedScripts = [...(scripts || [])];
                                             const [movedScript] = updatedScripts.splice(index, 1);
                                             updatedScripts.splice(index - 1, 0, movedScript);
                                             onUpdate({ ...settings, [eventKey]: updatedScripts });
                                          }}
                                       >
                                          <Icon type={'caret-up'} size={14} />
                                       </button>
                                       <button
                                          title="Move Down"
                                          disabled={index === scripts.length - 1}
                                          onClick={() => {
                                             const updatedScripts = [...(scripts || [])];
                                             const [movedScript] = updatedScripts.splice(index, 1);
                                             updatedScripts.splice(index + 1, 0, movedScript);
                                             onUpdate({ ...settings, [eventKey]: updatedScripts });
                                          }}
                                       >
                                          <Icon type={'caret-down'} size={14} />
                                       </button>
                                    </div>
                                 )}
                              </div>

                              <textarea
                                 value={script?.command || ''}
                                 data-gramm="false" // Disable Grammarly
                                 placeholder="Enter script command here..."
                                 onChange={(e) => {
                                    const updatedScripts = [...(scripts || [])];
                                    updatedScripts[index] = {
                                       ...updatedScripts[index],
                                       command: e.target.value,
                                    };
                                    onUpdate({ ...settings, [eventKey]: updatedScripts });
                                 }}
                              />
                              <div className={classes.scriptFooter}>
                                 <div className={classes.scriptOptions}>
                                    <div className={classes.scriptOptionCheckbox}>
                                       <Toggle
                                          // label="Enabled"
                                          fieldValue={script?.enabled || false}
                                          inline={true}
                                          onUpdate={(checked: boolean) => {
                                             const updatedScripts = [...(scripts || [])];
                                             updatedScripts[index] = {
                                                ...updatedScripts[index],
                                                enabled: checked,
                                             };
                                             onUpdate({ ...settings, [eventKey]: updatedScripts });
                                          }}
                                       />
                                       <span>Enabled</span>
                                    </div>
                                    <div className={classes.scriptOptionCheckbox}>
                                       <Toggle
                                          fieldValue={script?.logOutput || false}
                                          inline={true}
                                          onUpdate={(checked: boolean) => {
                                             const updatedScripts = [...(scripts || [])];
                                             updatedScripts[index] = {
                                                ...updatedScripts[index],
                                                logOutput: checked,
                                             };
                                             onUpdate({ ...settings, [eventKey]: updatedScripts });
                                          }}
                                       />
                                       <span>Log Output</span>
                                    </div>
                                    <div className={classes.scriptOptionCheckbox}>
                                       <Toggle
                                          // label="Abort On Error"
                                          fieldValue={script?.abortOnError || false}
                                          inline={true}
                                          onUpdate={(checked: boolean) => {
                                             const updatedScripts = [...(scripts || [])];
                                             updatedScripts[index] = {
                                                ...updatedScripts[index],
                                                abortOnError: checked,
                                             };
                                             onUpdate({ ...settings, [eventKey]: updatedScripts });
                                          }}
                                       />
                                       <span>Abort on Error</span>
                                    </div>
                                    <i className="pipe">|</i>
                                    <div className={classes.scriptOptionCheckbox}>
                                       {/* <span>Shell</span> */}
                                       <Select
                                          size="mini"
                                          options={getAvailableCliApps(platform)}
                                          fieldValue={script?.shell || 'default'}
                                          onUpdate={(value) => {
                                             const updatedScripts = [...(scripts || [])];
                                             updatedScripts[index] = {
                                                ...updatedScripts[index],
                                                shell: value,
                                             };
                                             onUpdate({ ...settings, [eventKey]: updatedScripts });
                                          }}
                                          inline={true}
                                       />
                                    </div>
                                    <div
                                       title="Timeout Settings"
                                       className={`${classes.scriptOptionTimeout} ${script.id === showTimeoutSettings ? classes.hasTimeOutSettings : ''}`}
                                    >
                                       <button
                                          onClick={() => setShowTimeoutSettings(script.id === showTimeoutSettings ? false : script.id)}
                                          className={classes.timeoutButton}
                                       >
                                          <Icon type="clock" size={13} /> {(script?.timeout && secondsToMinutes(script.timeout)) || 'Off'}
                                       </button>
                                       {showTimeoutSettings === script.id && (
                                          <div className={classes.timeoutSettings}>
                                             <NumberInput
                                                label="Timeout (seconds)"
                                                inline={true}
                                                fieldValue={script?.timeout || 0}
                                                onUpdate={(value) => {
                                                   const updatedScripts = [...(scripts || [])];
                                                   updatedScripts[index] = {
                                                      ...updatedScripts[index],
                                                      timeout: value,
                                                   };
                                                   onUpdate({ ...settings, [eventKey]: updatedScripts });
                                                }}
                                                min={0}
                                                max={3600} // 1 hour
                                             />
                                          </div>
                                       )}
                                    </div>
                                 </div>
                                 <div className={classes.scriptRemove}>
                                    <button
                                       className={classes.removeScriptButton}
                                       onClick={() => {
                                          const updatedScripts = [...(scripts || [])];
                                          updatedScripts.splice(index, 1);
                                          onUpdate({ ...settings, [eventKey]: updatedScripts });
                                       }}
                                    >
                                       <Icon type="trash" size={18} />
                                    </button>
                                 </div>
                              </div>
                           </div>
                        ))}
                     </div>
                  )}
               </div>
            );
         })}
      </div>
   );
};

export default PlanScriptsSettings;
