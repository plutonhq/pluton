import classes from '../DeviceInfo/DeviceInfo.module.scss';
import { DeviceMetrics } from '../../../@types/devices';
import Icon from '../../common/Icon/Icon';
import { formatBytes } from '../../../utils/helpers';

interface DeviceStorageDrivesProps {
   storageDrives: DeviceMetrics['disks']['filesystems'];
}

const DeviceStorageDrives = ({ storageDrives }: DeviceStorageDrivesProps) => {
   return (
      <div className={classes.component}>
         <div className={classes.componentTitle}>
            <Icon type="storage-drive" size={12} /> Storage Drives
         </div>
         <div className={classes.componentContent}>
            {storageDrives.map((sd) => {
               const usedPercent = Math.round((sd.used / sd.size) * 100);
               return (
                  <div key={sd.mount} className={classes.item}>
                     <div className={classes.iconBlock}>
                        <Icon type="storage-drive" size={24} />
                     </div>
                     <div className={classes.contentBlock}>
                        <h4>{sd.name}</h4>
                        <div
                           className={classes.progressBar}
                           data-tooltip-id="htmlToolTip"
                           data-tooltip-place="top"
                           data-tooltip-html={`${formatBytes(sd.used)} / ${formatBytes(sd.size)}`}
                        >
                           <div
                              className={`${classes.progressBarFill} ${usedPercent > 10 ? classes.progressBarFilled : ''}`}
                              style={{ width: usedPercent + '%' }}
                           >
                              <span>{usedPercent}%</span>
                           </div>
                        </div>
                        <div>
                           {formatBytes(sd.size - sd.used)} Free of {formatBytes(sd.size)}
                        </div>
                     </div>
                  </div>
               );
            })}
         </div>
      </div>
   );
};

export default DeviceStorageDrives;
