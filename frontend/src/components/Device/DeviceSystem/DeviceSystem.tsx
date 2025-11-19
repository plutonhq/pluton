import classes from '../DeviceInfo/DeviceInfo.module.scss';
import { DeviceMetrics } from '../../../@types/devices';
import Icon from '../../common/Icon/Icon';
import { getOSIcon } from '../../../utils/helpers';

interface DeviceSystemProps {
   os: DeviceMetrics['os'];
   time: DeviceMetrics['time'];
}

const DeviceSystem = ({ os, time }: DeviceSystemProps) => {
   const osIcon = getOSIcon(os.distro || 'linux');

   return (
      <div className={`${classes.widget} ${classes.system}`}>
         <div className={classes.widgetTitle}>
            <Icon type="computer" size={12} /> System
         </div>
         <div className={classes.widgetContent}>
            <div className={classes.infoBlock}>
               <div className={classes.iconBlock}>
                  <Icon type={osIcon} size={16} />
               </div>
               <div className={classes.infoBlockRight}>
                  <span>Operating System</span>
                  <span title={os.distro + ` (v${os.release})`}>{os.distro + ` (v${os.release})`}</span>
               </div>
            </div>
            <div className={classes.infoBlock}>
               <div className={classes.iconBlock}>
                  <Icon type="computer" size={20} />
               </div>
               <div className={classes.infoBlockRight}>
                  <span>Host Name</span>
                  <span>{os.hostname}</span>
               </div>
            </div>
            <div className={classes.infoBlock}>
               <div className={classes.iconBlock}>
                  <Icon type="clock" size={16} />
               </div>
               <div className={classes.infoBlockRight}>
                  <span>Uptime</span>
                  <span>{time.uptime ? Math.round(time.uptime / 3600) : 0} hours</span>
               </div>
            </div>
         </div>
      </div>
   );
};

export default DeviceSystem;
