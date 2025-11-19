import { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import Icon from '../../common/Icon/Icon';
import SidePanel from '../../common/SidePanel/SidePanel';
import classes from './EditDevice.module.scss';
import { Device, DeviceSettings } from '../../../@types/devices';
import Input from '../../common/form/Input/Input';
import { useUpdateDevice } from '../../../services/devices';
import FolderPicker from '../../common/FolderPicker/FolderPicker';
import DeviceRcloneSettings from '../DeviceRcloneSettings/DeviceRcloneSettings';
import DeviceResticSettings from '../DeviceResticSettings/DeviceResticSettings';
import Tabs, { Tab, TabList, TabPanel } from '../../common/Tabs/Tabs';

type EditDeviceProps = {
   device: Device;
   close: () => void;
};

const EditDevice = ({ close, device }: EditDeviceProps) => {
   const [inputError, setInputErrors] = useState({ name: '' });
   const [newDevice, setNewDevice] = useState<{ name: string; settings: DeviceSettings | undefined }>(() => ({
      name: device.name,
      settings: device.settings || {},
   }));
   const [showFileManager, setShowFileManager] = useState(false);
   const updateDeviceMutation = useUpdateDevice();

   useEffect(() => {
      if (newDevice.name) {
         setInputErrors((currentState) => ({ ...currentState, name: '' }));
      }
   }, [newDevice.name]);

   const updateDevice = () => {
      console.log('newDevice :', newDevice);
      setInputErrors({ name: '' });

      const errors = { ...inputError };

      if (!newDevice.name) {
         errors.name = 'Required';
      }

      setInputErrors(errors);

      if (Object.values(errors).some((error) => error !== '') === false) {
         updateDeviceMutation.mutate(
            {
               id: device.id,
               data: newDevice,
            },
            {
               onError: (error: any) => {
                  console.log('error :', error);
                  toast.error(error.message || `Error Updating Device.`);
               },
               onSuccess: (data: any) => {
                  console.log('Success :', data);
                  toast.success(`Device Updated!`, { autoClose: 5000 });
               },
            },
         );
      }
   };
   return (
      <SidePanel
         title={`Edit Device ${device.name}`}
         icon={<Icon type={'devices'} size={20} />}
         close={close}
         footer={
            <>
               <div className={classes.footerLeft}>
                  <div className={classes.summary}></div>
               </div>
               <div className={classes.footerRight}>
                  <button className={classes.createButton} onClick={() => updateDevice()}>
                     <Icon type="check" size={12} /> Update Device
                  </button>
               </div>
            </>
         }
      >
         {updateDeviceMutation.isPending && (
            <div className={classes.loader}>
               <Icon size={36} type="loading" />
            </div>
         )}
         <div className={classes.field}>
            <label className={classes.label}>Device Name*</label>
            {inputError.name && <span className={classes.fieldErrorLabel}>{inputError.name}</span>}
            <input
               className={classes.titleInput}
               type="text"
               placeholder="Device Name"
               value={newDevice.name || ''}
               onChange={(e) => setNewDevice({ ...newDevice, name: e.target.value })}
            />
         </div>
         <Tabs defaultValue="general">
            <TabList>
               <Tab value="general" label="General" icon="settings" />
               <Tab value="restic" label="Restic" icon="restic" />
               <Tab value="rclone" label="Rclone" icon="rclone" />
            </TabList>
            <TabPanel value="general">
               <>
                  <div className={classes.field}>
                     <Input
                        label="Temporary Working Directory"
                        fieldValue={newDevice.settings?.tempDir || ''}
                        onUpdate={(val) => setNewDevice({ ...newDevice, settings: { ...newDevice.settings, tempDir: val } })}
                        full={true}
                        hint="Where the backup, restores and downloads will be temporarily stored."
                     />
                     <button
                        className={classes.fileManagerBtn}
                        data-tooltip-id="appTooltip"
                        data-tooltip-content="Open FileManager to Select Directory"
                        data-tooltip-place="top"
                        onClick={() => setShowFileManager(true)}
                     >
                        <Icon type="folders" size={16} />
                     </button>
                  </div>
               </>
            </TabPanel>
            <TabPanel value="restic">
               <DeviceResticSettings
                  settings={newDevice.settings?.restic}
                  onUpdate={(resticSettings) => setNewDevice({ ...newDevice, settings: { ...newDevice.settings, restic: resticSettings } })}
               />
            </TabPanel>
            <TabPanel value="rclone">
               <DeviceRcloneSettings
                  settings={newDevice.settings?.rclone}
                  onUpdate={(rcloneSettings) => setNewDevice({ ...newDevice, settings: { ...newDevice.settings, rclone: rcloneSettings } })}
               />
            </TabPanel>
         </Tabs>

         {showFileManager && (
            <FolderPicker
               deviceId={device.id}
               title="Select Temporary Working Directory"
               selected={newDevice.settings?.tempDir || ''}
               close={() => setShowFileManager(false)}
               onSelect={(val) => setNewDevice({ ...newDevice, settings: { ...newDevice.settings, tempDir: val } })}
            />
         )}
      </SidePanel>
   );
};

export default EditDevice;
