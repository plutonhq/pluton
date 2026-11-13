import { ReactNode } from 'react';
import classes from './PlanSettings.module.scss';
import Toggle from '../../common/form/Toggle/Toggle';
import { NewPlanSettings } from '../../../@types/plans';
import NumberInput from '../../common/form/NumberInput/NumberInput';

interface PlanPerformanceSettingsProps {
   plan: NewPlanSettings;
   onUpdate: (perfSettings: NewPlanSettings['settings']['performance']) => void;
   /** Performance setting keys to hide, e.g. 'scan'. */
   hiddenFields?: string[];
   children?: ReactNode;
}

const PlanPerformanceSettings = ({ plan, onUpdate, hiddenFields, children }: PlanPerformanceSettingsProps) => {
   const perfSettings = plan.settings?.performance || {};
   const show = (key: string) => !hiddenFields?.includes(key);
   return (
      <>
         {show('maxProcessor') && (
            <div className={classes.field}>
               <NumberInput
                  label="Max Processor Cores"
                  fieldValue={perfSettings?.maxProcessor || ''}
                  onUpdate={(val) => onUpdate({ ...perfSettings, maxProcessor: val })}
                  min={0}
                  max={64}
                  hint="Keep 0 or empty to use all cores"
               />
            </div>
         )}
         {show('readConcurrency') && (
            <div className={classes.field}>
               <NumberInput
                  label="Read Concurrency"
                  fieldValue={perfSettings?.readConcurrency || ''}
                  onUpdate={(val) => onUpdate({ ...perfSettings, readConcurrency: val })}
                  min={0}
                  hint="Read n files Concurrently. Default: 2"
               />
            </div>
         )}
         {show('packSize') && (
            <div className={classes.field}>
               <NumberInput
                  label="Packet Size (MB)"
                  fieldValue={perfSettings?.packSize ? parseInt(perfSettings.packSize, 10) : ''}
                  onUpdate={(val) => onUpdate({ ...perfSettings, packSize: val ? val.toString() : '' })}
                  min={4}
                  max={128}
               />
            </div>
         )}

         {show('transfers') && (
            <div className={classes.field}>
               <NumberInput
                  label="Concurrent File Uploads"
                  fieldValue={perfSettings?.transfers || ''}
                  onUpdate={(val) => onUpdate({ ...perfSettings, transfers: val })}
                  min={0}
                  max={100}
                  hint="Default: 4"
               />
            </div>
         )}
         {show('multiThreadStream') && (
            <div className={classes.field}>
               <NumberInput
                  label="Multi Thread Streams"
                  fieldValue={perfSettings?.multiThreadStream || ''}
                  onUpdate={(val) => onUpdate({ ...perfSettings, multiThreadStream: val })}
                  min={0}
                  max={100}
                  hint="Useful for large files. Default: 4"
               />
            </div>
         )}
         {show('bufferSize') && (
            <div className={classes.field}>
               <NumberInput
                  label="Buffer Size (MB)"
                  fieldValue={perfSettings?.bufferSize ? parseInt(perfSettings.bufferSize.replace('M', ''), 10) : ''}
                  onUpdate={(val) => onUpdate({ ...perfSettings, bufferSize: val ? val + 'M' : '' })}
                  min={0}
                  max={100}
                  hint="In Megabytes. Helps with streaming large files. Default: 4"
               />
            </div>
         )}
         {show('scan') && (
            <div className={classes.field}>
               <Toggle
                  label="Scan Before Backup"
                  fieldValue={perfSettings.scan || false}
                  onUpdate={(val: boolean) => onUpdate({ ...perfSettings, scan: val })}
                  hint="Scan Before Backup for estimated Backup Time"
                  inline={true}
               />
            </div>
         )}
         {children}
      </>
   );
};

export default PlanPerformanceSettings;
