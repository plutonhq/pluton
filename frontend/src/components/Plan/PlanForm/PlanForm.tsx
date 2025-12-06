import { useState } from 'react';
import Icon from '../../common/Icon/Icon';
import SidePanel from '../../common/SidePanel/SidePanel';
import StoragePicker from '../../common/form/StoragePicker/StoragePicker';
import PlanStrategySettings from '../PlanSettings/PlanStrategySettings';
import PlanSourceSettings from '../PlanSettings/PlanSourceSettings';
import { NewPlanSettings } from '../../../@types/plans';
import NumberInput from '../../common/form/NumberInput/NumberInput';
import classes from '../AddPlan/AddPlan.module.scss';
import PFClasses from './PlanForm.module.scss';
import { useGetSettings } from '../../../services/settings';
import PlanAdvancedSettings from '../PlanSettings/PlanAdvancedSettings';
import { isPlanSettingsValid } from '../../../utils/plans';
import IntervalField from '../../common/form/IntervalField/IntervalField';
import PlanFormNav from './PlanFormNav';
import { useGetDevice } from '../../../services/devices';

type PlanFormProps = {
   title: string;
   planSettings: NewPlanSettings;
   type: 'add' | 'edit';
   onPlanSettingsChange: (settings: NewPlanSettings) => void;
   onSubmit: () => void;
   isSubmitting: boolean;
   close: () => void;
   storagePath?: string;
   storageId?: string;
};

const PlanForm = ({ title, planSettings, type, onPlanSettingsChange, onSubmit, isSubmitting, close, storagePath, storageId }: PlanFormProps) => {
   const [step, setStep] = useState<number>(1);

   const { data: settingsData } = useGetSettings();
   const appSettings = settingsData?.result?.settings || {};
   // const smtpConnected = appSettings?.integration?.smtp?.connected ? true : false;

   const { data: deviceData } = useGetDevice('main', true);
   const deviceInstance = deviceData?.result?.device;

   const buttonTexts: Record<number, { title: string; onClick: () => void }> = {
      1: {
         title: 'Next: Configure Source/Destination',
         onClick: () => isPlanSettingsValid(planSettings, step) && setStep(step + 1),
      },
      2: {
         title: 'Next: Setup Schedule',
         onClick: () => isPlanSettingsValid(planSettings, step) && setStep(step + 1),
      },
      3: { title: 'Next: Advanced Settings', onClick: () => isPlanSettingsValid(planSettings, step) && setStep(step + 1) },
      4: {
         title: 'Create Plan',
         onClick: () => isPlanSettingsValid(planSettings, false) && onSubmit(),
      },
   };

   const gotoStep = (nStep: number) => {
      if (type !== 'edit') {
         return;
      }

      const isSettingsValid = isPlanSettingsValid(planSettings, step);
      if (isSettingsValid) {
         setStep(nStep);
      }
   };

   return (
      <SidePanel
         title={title}
         icon={<Icon type={'backup'} size={20} />}
         close={close}
         withTabs={true}
         footer={
            <>
               <div className={classes.footerLeft}>
                  <div className={classes.summary}>
                     {type === 'add' && step > 1 && (
                        <button className={PFClasses.backButton} onClick={() => step > 0 && setStep(step - 1)} disabled={isSubmitting}>
                           <Icon type="arrow-left" size={14} /> Back
                        </button>
                     )}
                  </div>
               </div>
               <div className={classes.footerRight}>
                  {type === 'add' ? (
                     <button className={classes.createButton} onClick={buttonTexts[step].onClick}>
                        <Icon type="check" size={12} /> {buttonTexts[step].title}
                     </button>
                  ) : (
                     <button className={classes.createButton} onClick={() => isPlanSettingsValid(planSettings, false) && onSubmit()}>
                        <Icon type="check" size={12} /> {'Update Plan'}
                     </button>
                  )}
               </div>
            </>
         }
      >
         <PlanFormNav step={step} type={type} gotoStep={gotoStep} />

         <div className={`${PFClasses.formContent} styled__scrollbar`}>
            {isSubmitting && (
               <div className={classes.loader}>
                  <Icon size={36} type="loading" />
               </div>
            )}
            {step === 1 && (
               <div className={PFClasses.planStep}>
                  <div className={classes.field}>
                     <label className={classes.label}>Backup Plan Name*</label>
                     {!planSettings.title && <span className={classes.fieldErrorLabel}>{'Required'}</span>}
                     <input
                        className={classes.titleInput}
                        type="text"
                        placeholder="Plan Name"
                        value={planSettings.title || ''}
                        onChange={(e) => onPlanSettingsChange({ ...planSettings, title: e.target.value })}
                     />
                  </div>
                  {/* <PlanTypeSettings
                     plan={planSettings}
                     onUpdate={(plan: NewPlanSettings) => onPlanSettingsChange({ ...plan })}
                     disabled={type === 'edit' ? true : false}
                     options={[
                        {
                           value: 'device',
                           icon: 'computer',
                           label: 'Device',
                           description: 'Backup content of a Computer/Server',
                        },
                        {
                           value: 'database',
                           icon: 'database',
                           label: 'Database',
                           description: 'Backup a Database',
                           disabled: true,
                        },
                        {
                           value: 'googleworkspace',
                           icon: 'google-workspace',
                           label: 'Google Workspace',
                           description: 'Backup Google Workspace',
                           disabled: true,
                        },
                        {
                           value: 'microsoft365',
                           icon: 'microsoft-365',
                           label: 'Microsoft 365',
                           description: 'Backup Microsoft 365',
                           disabled: true,
                        },
                     ]}
                  /> */}
                  {planSettings.sourceType === 'device' && (
                     <PlanStrategySettings
                        plan={planSettings}
                        onUpdate={(method) => onPlanSettingsChange({ ...planSettings, method })}
                        disabled={type === 'edit' ? true : false}
                        options={[
                           {
                              value: 'backup',
                              icon: 'backup',
                              label: 'Incremental Backup',
                              description: 'Periodically create Incremental backup snapshots of source',
                           },
                           {
                              value: 'sync',
                              icon: 'reload',
                              label: 'Real-time Sync',
                              description: 'Maintain identical source (with revisions)',
                              disabled: true,
                           },
                           {
                              value: 'rescue',
                              icon: 'rescue',
                              label: 'Linux Server Backup',
                              description: 'Full Linux system backups with bootable ISO image',
                              disabled: true,
                           },
                        ]}
                     />
                  )}
               </div>
            )}
            {step === 2 && (
               <div className={PFClasses.planStep}>
                  <PlanSourceSettings
                     plan={planSettings}
                     onUpdate={(plan) => onPlanSettingsChange({ ...plan })}
                     isEditing={type === 'edit' ? true : false}
                     error={planSettings.sourceConfig.includes.length === 0 ? 'Required' : ''}
                  />
                  <div className={classes.field}>
                     <label className={classes.label}>Backup Destination*</label>
                     {!planSettings.storage.name && <span className={classes.fieldErrorLabel}>{'Required'}</span>}
                     <StoragePicker
                        storagePath={storagePath}
                        storageId={storageId}
                        deviceId={planSettings.sourceId || 'main'}
                        disabled={type === 'edit' ? true : false}
                        onUpdate={(s: { storage: { name: string; id: string; type: string }; path: string }) =>
                           onPlanSettingsChange({
                              ...planSettings,
                              storagePath: s.path,
                              storage: { id: s.storage.id, name: s.storage.name },
                           })
                        }
                     />
                  </div>
               </div>
            )}
            {step === 3 && (
               <div className={PFClasses.planStep}>
                  <div className={classes.field} style={{ width: '150px' }}>
                     <IntervalField
                        label="Backup Interval*"
                        fieldValue={planSettings.settings.interval}
                        onUpdate={(intervalSettings) =>
                           onPlanSettingsChange({ ...planSettings, settings: { ...planSettings.settings, interval: intervalSettings } })
                        }
                     />
                  </div>

                  <div className={classes.field} style={{ width: '150px' }}>
                     <NumberInput
                        label="Snapshots to Keep"
                        fieldValue={planSettings.settings.prune.snapCount}
                        onUpdate={(val) =>
                           onPlanSettingsChange({
                              ...planSettings,
                              settings: { ...planSettings.settings, prune: { ...planSettings.settings.prune, snapCount: val } },
                           })
                        }
                        placeholder="5"
                        min={1}
                        inline={false}
                        hint="Number of Active Restorable Snapshots to Keep"
                     />
                  </div>
               </div>
            )}
            {step === 4 && (
               <div className={PFClasses.planStep}>
                  <PlanAdvancedSettings plan={planSettings} appSettings={appSettings} onUpdate={onPlanSettingsChange} device={deviceInstance} />
               </div>
            )}
         </div>
      </SidePanel>
   );
};

export default PlanForm;
