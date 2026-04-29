import { useEffect, useRef } from 'react';
import classes from './PlanSettings.module.scss';
import PathPicker from '../../common/PathPicker/PathPicker';
import { NewPlanSettings } from '../../../@types/plans';
import { useGetDevices } from '../../../services/devices';
import Select from '../../common/form/Select/Select';
import { Device } from '../../../@types/devices';

interface PlanSourceSettingsProps {
   plan: NewPlanSettings;
   isEditing: boolean;
   onUpdate: (plan: NewPlanSettings) => void;
   error: string;
}

const PlanSourceSettings = ({ plan, onUpdate, error, isEditing }: PlanSourceSettingsProps) => {
   const { data } = useGetDevices();
   const deviceList = [];
   const deviceId = plan.sourceId || 'main';
   if (data?.success && data.result) {
      deviceList.push(
         ...data.result.map((device: Device) => ({
            label: `${device.name} ${device.id === 'main' ? '(Main)' : ''}`,
            value: device.id,
            icon: device.id === 'main' ? 'computer' : 'computer-remote',
            // disabled: device.id === 'main' || device.connected ? false : true,
         })),
      );
   }

   // When the device changes, reset the sourceConfig paths to prevent invalid paths from being submitted.
   // Use a ref to track the previous deviceId so we only reset on an actual change (not on mount/remount,
   // e.g. when navigating between steps in the Add Plan form).
   const prevDeviceIdRef = useRef<string | null>(null);
   useEffect(() => {
      if (isEditing) {
         prevDeviceIdRef.current = deviceId;
         return;
      }
      if (prevDeviceIdRef.current !== null && prevDeviceIdRef.current !== deviceId) {
         onUpdate({
            ...plan,
            sourceConfig: {
               includes: [],
               excludes: [],
            },
         });
      }
      prevDeviceIdRef.current = deviceId;
   }, [isEditing, deviceId]);

   return (
      <>
         <div className={classes.field}>
            <label className={classes.label}>Select Device*</label>
            <Select
               options={deviceList}
               fieldValue={deviceId}
               disabled={isEditing}
               full={true}
               onUpdate={(val) => onUpdate({ ...plan, sourceId: val })}
            />
         </div>
         <div className={classes.field}>
            <label className={classes.label}>Backup Sources*</label>
            {error && <span className={classes.fieldErrorLabel}>{error}</span>}
            <PathPicker
               paths={{ includes: plan.sourceConfig.includes, excludes: plan.sourceConfig.excludes }}
               onUpdate={(paths) => onUpdate({ ...plan, sourceConfig: { ...paths } })}
               deviceId={deviceId}
               single={plan.method === 'sync'}
               disallowChange={plan.method === 'sync' && isEditing}
            />
         </div>
      </>
   );
};

export default PlanSourceSettings;
