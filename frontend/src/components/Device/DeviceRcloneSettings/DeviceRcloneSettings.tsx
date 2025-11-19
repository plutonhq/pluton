import { DeviceSettings } from '../../../@types/devices';
import Input from '../../common/form/Input/Input';
import NumberInput from '../../common/form/NumberInput/NumberInput';
import SizePicker from '../../common/form/SizePicker/SizePicker';
import classes from '../EditDevice/EditDevice.module.scss';

interface DeviceRcloneSettingsProps {
   settings?: DeviceSettings['rclone'];
   onUpdate: (settings: DeviceRcloneSettingsProps['settings']) => void;
}

const DeviceRcloneSettings = ({ settings = {}, onUpdate }: DeviceRcloneSettingsProps) => {
   const currentBWLimit = settings?.bwlimit ? settings?.bwlimit.split(':') : '';
   const uploadLimit = Array.isArray(currentBWLimit) && currentBWLimit[0] && currentBWLimit[0] !== 'off' ? currentBWLimit[0] : '';
   const downloadLimit = Array.isArray(currentBWLimit) && currentBWLimit[1] && currentBWLimit[1] !== 'off' ? currentBWLimit[1] : '';

   const update = (key: string, value: string | number | boolean) => {
      let theValue = value;
      if (key === 'bwlimit' && value === 'off:off') {
         theValue = '';
      }
      if (value === 0) {
         theValue = '';
      }
      onUpdate({ ...settings, [key]: theValue });
   };
   return (
      <div>
         <div className={classes.field}>
            <Input
               label="Temporary Directory"
               fieldValue={settings?.tempDir || ''}
               onUpdate={(val) => update('tempDir', val)}
               hint="Where Rclone will temporarily store the data for it's operations. default: OS temp directory."
               inline={true}
            />
         </div>
         <div className={classes.field}>
            <Input
               label="Cache Directory"
               fieldValue={settings?.cacheDir || ''}
               onUpdate={(val) => update('cacheDir', val)}
               hint="Where Rclone will store it's cache."
               inline={true}
            />
         </div>
         <div className={classes.field}>
            <SizePicker
               label={'Upload Bandwidth Limit'}
               inline={true}
               type="rclone"
               fieldValue={uploadLimit}
               hint={'Limit the Upload Bandwidth for backups'}
               onUpdate={(newVal: string) =>
                  update('bwlimit', `${newVal || 'off'}:${Array.isArray(currentBWLimit) && currentBWLimit[1] ? currentBWLimit[1] : 'off'}`)
               }
            />
         </div>
         <div className={classes.field}>
            <SizePicker
               label={'Download Bandwidth Limit'}
               inline={true}
               type="rclone"
               fieldValue={downloadLimit}
               hint={'Limit the Download Bandwidth'}
               onUpdate={(newVal: string) =>
                  update('bwlimit', `${Array.isArray(currentBWLimit) && currentBWLimit[0] ? currentBWLimit[0] : 'off'}:${newVal || 'off'}`)
               }
            />
         </div>
         <div className={classes.field}>
            <SizePicker
               label={'Buffer Size'}
               inline={true}
               type="rclone"
               fieldValue={settings?.bufferSize || ''}
               hint={
                  'Use this sized buffer to speed up file transfers. Buffer Size is multiplied by the number of simultaneous "Transfer" setting value.'
               }
               onUpdate={(newVal: string) => update('bufferSize', newVal)}
            />
         </div>
         <div className={classes.field}>
            <Input
               label="Timeout"
               fieldValue={settings?.timeout || ''}
               onUpdate={(val) => update('timeout', val)}
               inline={true}
               hint="Inset value in  m(minutes) or s(seconds). eg: 5m, 30s. This sets the IO idle timeout. If a transfer has started but then becomes idle for this long it is considered broken and disconnected. Default: 5m."
            />
         </div>
         <div className={classes.field}>
            <NumberInput
               label="Retries"
               fieldValue={settings?.retries || ''}
               onUpdate={(val) => update('retries', val)}
               hint="How many times a failed transfer is retried. Default: 3."
               inline={true}
            />
         </div>
         <div className={classes.field}>
            <NumberInput
               label="Low Level Retries"
               fieldValue={settings?.lowLevelRetries || ''}
               onUpdate={(val) => update('lowLevelRetries', val)}
               hint="A low level retry is used to retry a failing operation. Default: 3."
               inline={true}
            />
         </div>
         <div className={classes.field}>
            <NumberInput
               label="Transfers"
               fieldValue={settings?.transfers || ''}
               onUpdate={(val) => update('transfers', val)}
               hint="The number of file transfers to run in parallel. Default: 4."
               inline={true}
            />
         </div>
         <div className={classes.field}>
            <NumberInput
               label="Checkers"
               fieldValue={settings?.checkers || ''}
               onUpdate={(val) => update('checkers', val)}
               hint="number of file checkers to run in parallel. Default: 8."
               inline={true}
            />
         </div>
         <div className={classes.field}>
            <NumberInput
               label="Multi Thread Streams"
               fieldValue={settings?.multiThreadStream || ''}
               onUpdate={(val) => update('multiThreadStream', val)}
               hint="When using multi thread transfers this sets the number of streams to use. Default: 4."
               inline={true}
            />
         </div>
         <div className={classes.field}>
            <Input
               label="Config File Password"
               fieldValue={settings?.configPass || ''}
               onUpdate={(val) => update('configPass', val)}
               hint="Encrypt the config file with a password."
               inline={true}
            />
         </div>
      </div>
   );
};

export default DeviceRcloneSettings;
