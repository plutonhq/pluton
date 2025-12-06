import classes from '../DeviceInfo/DeviceInfo.module.scss';
import { DeviceMetrics } from '../../../@types/devices';
import Icon from '../../common/Icon/Icon';
import { getProcessorIcon } from '../../../utils/helpers';

interface DeviceCPUProps {
   cpu: DeviceMetrics['cpu'];
}

const DeviceCPU = ({ cpu }: DeviceCPUProps) => {
   const processorIcon = getProcessorIcon(cpu.manufacturer);

   const cpuPercent = cpu.load?.currentLoad ? Math.round(cpu.load?.currentLoad) : 0;
   const cpuName = cpu.manufacturer && cpu.brand ? `${cpu.manufacturer} ${cpu.brand}` : 'Unknown';

   return (
      <div className={`${classes.widget} ${classes.cpu}`}>
         <div className={classes.widgetTitle}>
            <Icon type="speed" size={12} /> CPU
         </div>
         <div className={classes.widgetContent}>
            <div className={classes.infoBlock}>
               <div className={classes.iconBlock}>
                  <Icon type={processorIcon} size={24} />
               </div>
               <div className={classes.infoBlockRight}>
                  <span>Processor</span>
                  <span title={cpuName}>{cpuName}</span>
               </div>
            </div>
            <div className={classes.infoBlock}>
               <div className={classes.iconBlock}>
                  <Icon type={'cpu'} size={20} />
               </div>
               <div className={classes.infoBlockRight}>
                  <span>Physical Cores / Cores</span>
                  <span>{`${cpu.physicalCores} / ${cpu.cores}`}</span>
               </div>
            </div>
            <div className={classes.infoBlock}>
               <div className={classes.iconBlock}>
                  <Icon type={'speed'} size={20} />
               </div>
               <div className={classes.infoBlockRight}>
                  <span>CPU Usage</span>
                  <div className={classes.progressBar}>
                     <div
                        className={`${classes.progressBarFill} ${cpuPercent > 10 ? classes.progressBarFilled : ''}`}
                        style={{ width: cpuPercent + '%' }}
                     >
                        <span>{cpuPercent}%</span>
                     </div>
                  </div>
               </div>
            </div>
         </div>
      </div>
   );
};

export default DeviceCPU;
