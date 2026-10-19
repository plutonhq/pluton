import { useEffect, useRef } from 'react';
import classes from './PlanSettings.module.scss';
import PathPicker from '../../common/PathPicker/PathPicker';
import { NewPlanSettings } from '../../../@types/plans';
import { useGetDevices } from '../../../services/devices';
import { useGetStorages } from '../../../services/storage';
import Select from '../../common/form/Select/Select';
import StoragePicker from '../../common/form/StoragePicker/StoragePicker';
import Input from '../../common/form/Input/Input';
import { Device } from '../../../@types/devices';

interface PlanSourceSettingsProps {
   plan: NewPlanSettings;
   isEditing: boolean;
   onUpdate: (plan: NewPlanSettings) => void;
   error: string;
}

const PlanSourceSettings = ({ plan, onUpdate, error, isEditing }: PlanSourceSettingsProps) => {
   const { data } = useGetDevices();
   const { data: storageData } = useGetStorages();
   const isStorageSource = plan.sourceType === 'storage';
   const devices = (data?.success && data.result ? data.result : []) as Device[];
   const selectedDevice = devices.find((device) => device.id === plan.sourceId);
   const isRemoteFilesystemSource = Boolean(selectedDevice?.isRemote);
   const canUseRemoteFilesystem = (device: Device) =>
      device.isRemote === true &&
      device.agent?.status !== 'revoked' &&
      device.agent?.capabilities?.filesystemRootsConfigured === true &&
      device.agent?.capabilities?.commandTypes?.includes('BACKUP_FILESYSTEM') === true &&
      Boolean(device.agent?.resticVersion && device.agent?.rcloneVersion);
   const deviceList = [];
   const deviceId = plan.sourceId || 'main';
   const selectDevice = (nextDeviceId: string) => {
      const nextDevice = devices.find((device) => device.id === nextDeviceId);
      const nextIsRemoteFilesystem = nextDevice?.isRemote === true;
      onUpdate({
         ...plan,
         sourceId: nextDeviceId,
         ...(nextIsRemoteFilesystem
            ? {
                 settings: {
                    ...plan.settings,
                    // Replication runs on the server; arbitrary scripts never run on an agent.
                    scripts: undefined,
                 },
              }
            : {}),
      });
   };
   if (data?.success && data.result) {
      deviceList.push(
         ...devices.map((device: Device) => ({
            label: `${device.name} ${device.id === 'main' ? '(Main)' : device.isRemote ? (canUseRemoteFilesystem(device) ? '(Remote filesystem backup)' : '(Remote agent: backup unavailable)') : ''}`,
            value: device.id,
            icon: device.id === 'main' ? 'computer' : 'computer-remote',
            disabled: device.isRemote === true && !canUseRemoteFilesystem(device),
         })),
      );
   }

   // When the device changes, reset the sourceConfig paths to prevent invalid paths from being submitted.
   // Use a ref to track the previous deviceId so we only reset on an actual change (not on mount/remount,
   // e.g. when navigating between steps in the Add Plan form).
   const prevDeviceIdRef = useRef<string | null>(null);
   useEffect(() => {
      if (isEditing || isStorageSource) {
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

   if (isStorageSource) {
      const storages = (storageData?.result as { id: string; name: string }[]) || [];
      const sourceStorage = storages.find((s) => s.id === plan.sourceId);
      const prefix = sourceStorage ? `${sourceStorage.name}:` : '';
      const bakedPath = plan.sourceConfig.includes[0] || '';
      const sourcePath = prefix && bakedPath.startsWith(prefix) ? bakedPath.slice(prefix.length) : bakedPath;

      return (
         <div className={classes.field}>
            <label className={classes.label}>Source Storage*</label>
            {error && <span className={classes.fieldErrorLabel}>{error}</span>}
            <StoragePicker
               storageId={plan.sourceId}
               storagePath={sourcePath}
               deviceId="main"
               excludeStorageIds={plan.storage.id ? [plan.storage.id] : []}
               disabled={isEditing}
               disabledHint="The source storage can't be changed after a plan is created."
               onUpdate={(s) =>
                  onUpdate({
                     ...plan,
                     sourceId: s.storage.id,
                     sourceConfig: { ...plan.sourceConfig, includes: [s.path] },
                  })
               }
            />
         </div>
      );
   }

   return (
      <>
         <div className={classes.field}>
            <label className={classes.label}>Select Device*</label>
            <Select options={deviceList} fieldValue={deviceId} disabled={isEditing} full={true} onUpdate={selectDevice} />
         </div>
         {isRemoteFilesystemSource ? (
            <div className={classes.field}>
               <label className={classes.label}>Remote Backup Source*</label>
               {error && <span className={classes.fieldErrorLabel}>{error}</span>}
               <Input
                  fieldValue={plan.sourceConfig.includes[0] || ''}
                  onUpdate={(sourcePath) =>
                     onUpdate({
                        ...plan,
                        sourceConfig: { ...plan.sourceConfig, includes: sourcePath ? [sourcePath] : [] },
                     })
                  }
                  placeholder="/srv/example-app"
                  full={true}
                  disabled={isEditing}
                  required={true}
               />
               <p className={classes.fieldNotice}>
                  Enter one absolute Linux path inside an allowed source root. The agent validates its real path again and does not expose a remote
                  file browser.
               </p>
            </div>
         ) : (
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
         )}
      </>
   );
};

export default PlanSourceSettings;
