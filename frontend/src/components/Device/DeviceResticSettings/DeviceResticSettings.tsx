import { DeviceSettings } from '../../../@types/devices';
import Input from '../../common/form/Input/Input';
import NumberInput from '../../common/form/NumberInput/NumberInput';
import classes from '../EditDevice/EditDevice.module.scss';

interface DeviceResticSettingsProps {
   settings?: DeviceSettings['restic'];
   onUpdate: (settings: DeviceResticSettingsProps['settings']) => void;
}

const DeviceResticSettings = ({ settings = {}, onUpdate }: DeviceResticSettingsProps) => {
   return (
      <div>
         <div className={classes.field}>
            <Input
               label="Cache Directory"
               fieldValue={settings?.cacheDir || ''}
               onUpdate={(val) => onUpdate({ ...settings, cacheDir: val })}
               hint="Where Restic will store it's cache."
               inline={true}
            />
         </div>
         <div className={classes.field}>
            <NumberInput
               label="Max Processor Cores"
               fieldValue={settings?.maxProcessor || ''}
               onUpdate={(val) => onUpdate({ ...settings, maxProcessor: val === 0 ? '' : val })}
               min={0}
               max={64}
               hint="Keep 0 or empty to use all cores. Uses all cores by default."
               inline={true}
            />
         </div>
         <div className={classes.field}>
            <NumberInput
               label="Read Concurrency"
               fieldValue={settings?.readConcurrency || ''}
               onUpdate={(val) => onUpdate({ ...settings, readConcurrency: val === 0 ? '' : val })}
               min={0}
               hint="Read n files Concurrently. Default: 2"
               inline={true}
            />
         </div>
         <div className={classes.field}>
            <NumberInput
               label="Packet Size (MB)"
               fieldValue={settings?.packSize ? parseInt(settings.packSize.replace('MiB', ''), 10) : ''}
               onUpdate={(val) => onUpdate({ ...settings, packSize: val ? val + 'MiB' : '' })}
               min={0}
               max={4000}
               hint="Packs are blobs of data, which are encrypted and stored in the repository. Increasing the pack size requires more disk space for temporary pack files to be created before uploading."
               inline={true}
            />
         </div>
      </div>
   );
};

export default DeviceResticSettings;
