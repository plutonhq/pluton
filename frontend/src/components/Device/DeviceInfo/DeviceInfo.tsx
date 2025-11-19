import { DeviceMetrics } from '../../../@types/devices';
import classes from './DeviceInfo.module.scss';
import DeviceNetworks from '../DeviceNetworks/DeviceNetworks';
import DeviceStorageDrives from '../DeviceStorageDrives/DeviceStorageDrives';
import DeviceStorageDisks from '../DeviceStorageDisks/DeviceStorageDisks';
import DeviceMemory from '../DeviceMemory/DeviceMemory';
import DeviceCPU from '../DeviceCPU/DeviceCPU';
import DeviceSystem from '../DeviceSystem/DeviceSystem';

interface DeviceInfoProps {
   metrics: DeviceMetrics;
   isRefetching: boolean;
}

const DeviceInfo = ({ metrics, isRefetching }: DeviceInfoProps) => {
   // const { name } = data.device;
   const { os, time, cpu, memory, disks, network } = metrics;

   const storageDisks = disks?.physical || [];
   const storageDrives = disks?.filesystems || [];

   return (
      <div className={`${classes.deviceInfo} ${isRefetching ? classes.reloading : ''}`}>
         <div className={classes.topComponents}>
            {/* SYSTEM */}
            <DeviceSystem os={os} time={time} />
            {/* CPU */}
            <DeviceCPU cpu={cpu} />
            {/* MEMORY */}
            <DeviceMemory memory={memory} />
         </div>
         <div className={classes.otherComponents}>
            {/* Storage Disks */}
            {storageDisks && storageDisks.length > 0 && <DeviceStorageDisks storageDisks={storageDisks} />}
            {/* Storage Drives */}
            {storageDrives && storageDrives.length > 0 && <DeviceStorageDrives storageDrives={storageDrives} />}
            {/* Networks */}
            {network && network.length > 0 && <DeviceNetworks network={network} />}
         </div>
      </div>
   );
};

export default DeviceInfo;
