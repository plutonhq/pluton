import { useState } from 'react';
import Select from '../../common/form/Select/Select';
import Input from '../../common/form/Input/Input';
import Icon from '../../common/Icon/Icon';
import classes from './RestoreWizard.module.scss';
import FolderPicker from '../../common/FolderPicker/FolderPicker';
import { RestoreSettings } from '../../../@types/restores';
import Toggle from '../../common/form/Toggle/Toggle';

interface settingsStepProps {
   backupId: string;
   settings: RestoreSettings;
   updateSettings: (settings: settingsStepProps['settings']) => void;
   goNext: () => void;
   close: () => void;
}

const settingsStep = ({ backupId, settings, updateSettings, goNext, close }: settingsStepProps) => {
   const [showFileManager, setShowFileManager] = useState(false);
   const [showCustomPathError, setShowCustomPathError] = useState(false);

   const gotoPreviewStep = () => {
      if ((settings.type === 'custom' && settings.path) || settings.type === 'original') {
         goNext();
      } else {
         setShowCustomPathError(true);
      }
   };

   return (
      <div className={classes.stepContent}>
         <div className={classes.step}>
            <p>
               Select where you want to restore <strong>"backup-{backupId}"</strong>
            </p>
            <div className={classes.settingBlock}>
               <Select
                  label=""
                  options={[
                     { label: 'Restore to Original Path(s)', value: 'original' },
                     { label: 'Restore to a Custom Path', value: 'custom' },
                  ]}
                  fieldValue={settings.type || 'sun'}
                  onUpdate={(val: string) => updateSettings({ ...settings, type: val as 'original' | 'custom' })}
                  full={true}
               />
            </div>
            {settings.type === 'custom' && (
               <div className={`${classes.settingBlock} ${showCustomPathError ? classes.settingBlockError : ''}`}>
                  <Input
                     label="Restore Backup To"
                     placeholder="Restore Path"
                     fieldValue={settings.path}
                     onUpdate={(val) => {
                        updateSettings({ ...settings, path: val });
                        if (showCustomPathError) {
                           setShowCustomPathError(false);
                        }
                     }}
                     full={true}
                  />
                  <button
                     data-tooltip-id="appTooltip"
                     data-tooltip-content="Open FileManager to Select Path"
                     data-tooltip-place="top"
                     className={classes.fileManagerBtn}
                     onClick={() => setShowFileManager(true)}
                  >
                     <Icon type="folders" size={16} />
                  </button>
               </div>
            )}

            <div className={classes.settingBlock}>
               <div className={classes.checkboxSettings}>
                  <div className={classes.label}>Overwrite Policy</div>
                  <div className={classes.checkboxSettingsOpts}>
                     <div
                        onClick={() => updateSettings({ ...settings, overwrite: 'always' })}
                        className={` ${classes.checkboxOption} ${settings.overwrite === 'always' ? classes.checkboxOptionActive : ''} `}
                     >
                        <div>
                           <Icon type={settings.overwrite === 'always' ? 'check-circle-filled' : 'check-circle'} size={16} />
                        </div>
                        <div>
                           <h5>Always Overwrite (Default)</h5>
                           <div>
                              Always overwrites already existing files. Existing file content will be verified first and only mismatching parts will
                              be restored to minimize downloads. Updates the metadata of all files.
                           </div>
                        </div>
                     </div>
                     <div
                        onClick={() => updateSettings({ ...settings, overwrite: 'if-changed' })}
                        className={` ${classes.checkboxOption} ${settings.overwrite === 'if-changed' ? classes.checkboxOptionActive : ''} `}
                     >
                        <div>
                           <Icon type={settings.overwrite === 'if-changed' ? 'check-circle-filled' : 'check-circle'} size={16} />
                        </div>
                        <div>
                           <h5>Overwrite If Changed</h5>
                           <div>
                              Like the previous case, but speeds up the file content check by assuming that files with matching size and modification
                              time (mtime) are already up to date. In case of a mismatch, the full file content is verified. Updates the metadata of
                              all files.
                           </div>
                        </div>
                     </div>
                     <div
                        onClick={() => updateSettings({ ...settings, overwrite: 'if-newer' })}
                        className={` ${classes.checkboxOption} ${settings.overwrite === 'if-newer' ? classes.checkboxOptionActive : ''} `}
                     >
                        <div>
                           <Icon type={settings.overwrite === 'if-newer' ? 'check-circle-filled' : 'check-circle'} size={16} />
                        </div>
                        <div>
                           <h5>Overwrite If Newer</h5>
                           <div>Only overwrite existing files if the file in the snapshot has a newer modification time (mtime).</div>
                        </div>
                     </div>
                     <div
                        onClick={() => updateSettings({ ...settings, overwrite: 'never' })}
                        className={` ${classes.checkboxOption} ${settings.overwrite === 'never' ? classes.checkboxOptionActive : ''} `}
                     >
                        <div>
                           <Icon type={settings.overwrite === 'never' ? 'check-circle-filled' : 'check-circle'} size={16} />
                        </div>
                        <div>
                           <h5>Never Overwrite</h5>
                           <div>Never overwrite existing files.</div>
                        </div>
                     </div>
                  </div>
               </div>
            </div>
            <div className={classes.settingBlock}>
               <Toggle
                  label="Delete Files that are not in the Snapshot from the Target Restore Path"
                  fieldValue={settings.delete}
                  inline={false}
                  onUpdate={(val) => {
                     updateSettings({ ...settings, delete: val });
                  }}
               />
            </div>
         </div>
         <div className={classes.footer}>
            <div className={classes.footerLeft}></div>
            <div className={classes.footerRight}>
               <button onClick={() => close()}>Cancel</button>
               <button onClick={() => gotoPreviewStep()}>
                  Next: Select Files to Restore <Icon type="arrow-right" size={14} />
               </button>
            </div>
         </div>

         {showFileManager && (
            <FolderPicker
               deviceId={'main'}
               title="Choose a Path to Restore"
               footerText="Select a Path where you want to restore your backup"
               selected={settings.path}
               close={() => setShowFileManager(false)}
               onSelect={(p) => updateSettings({ ...settings, path: p })}
            />
         )}
      </div>
   );
};

export default settingsStep;
