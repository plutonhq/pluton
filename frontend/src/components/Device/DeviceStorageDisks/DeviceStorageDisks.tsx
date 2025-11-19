import classes from '../DeviceInfo/DeviceInfo.module.scss';
import { DeviceMetrics } from '../../../@types/devices';
import Icon from '../../common/Icon/Icon';
import { formatBytes } from '../../../utils/helpers';

interface DeviceStorageDisksProps {
   storageDisks: DeviceMetrics['disks']['physical'];
}

const DeviceStorageDisks = ({ storageDisks }: DeviceStorageDisksProps) => {
   return (
      <div className={classes.component}>
         <div className={classes.componentTitle}>
            <Icon type="storage-disk" size={12} /> Storage Disks
         </div>
         <div className={classes.componentContent}>
            {storageDisks.map((sd, index) => {
               return (
                  <div key={`${sd.name}-${index}`} className={classes.item}>
                     <div className={classes.iconBlock}>
                        <Icon type="storage-disk" size={24} />
                     </div>
                     <div className={classes.contentBlock}>
                        <h4 title={`${sd.name} ${sd.type !== 'Unspecified' ? `(${sd.type})` : ''}`}>
                           {sd.name} {sd.type !== 'Unspecified' && `(${sd.type})`}
                        </h4>
                        <div>{sd.interfaceType}</div>
                        <div>{formatBytes(sd.size)}</div>
                     </div>
                  </div>
               );
            })}
         </div>
      </div>
   );
};

export default DeviceStorageDisks;
