import classes from '../DeviceInfo/DeviceInfo.module.scss';
import { DeviceMetrics } from '../../../@types/devices';
import Icon from '../../common/Icon/Icon';
import { formatBytes } from '../../../utils/helpers';
import { useMemo } from 'react';

interface DeviceMemoryProps {
   memory: DeviceMetrics['memory'];
}

const DeviceMemory = ({ memory }: DeviceMemoryProps) => {
   const memoryPercent = Math.round((memory.used / memory.total) * 100);

   const memoryComponents = useMemo(() => {
      const memoryLayout = memory?.layout;
      if (!memoryLayout || memoryLayout.length === 0) {
         return 'No memory information available';
      }

      const memoryGroups: Record<string, number> = {};
      (memoryLayout as DeviceMetrics['memory']['layout']).forEach((mem) => {
         const key = `${mem.manufacturer} ${formatBytes(mem.size)} ${mem.type}`;
         memoryGroups[key] = (memoryGroups[key] || 0) + 1;
      });
      const sortedGroups = Object.entries(memoryGroups).sort((a, b) => b[1] - a[1]);
      const primaryGroup = sortedGroups[0];
      const mainText = `${primaryGroup[1] || 1}x ${primaryGroup[0] || 'Unknown'}`;
      const remainingCount = sortedGroups.slice(1).reduce((sum, group) => sum + group[1], 0);

      if (remainingCount > 0) {
         const tooltipContent = (memoryLayout as DeviceMetrics['memory']['layout'])
            .map((mem) => `<div>1x ${mem.manufacturer} ${formatBytes(mem.size)} ${mem.type} (${mem.formFactor})</div>`)
            .join('');
         return (
            <>
               {mainText}{' '}
               <i className={classes.additionalMemory} data-tooltip-id="htmlToolTip" data-tooltip-place="top" data-tooltip-html={tooltipContent}>
                  +{remainingCount}
               </i>
            </>
         );
      }

      return mainText;
   }, [memory?.layout]);

   return (
      <div className={`${classes.widget} ${classes.memory}`}>
         <div className={classes.widgetTitle}>
            <Icon type="performance" size={12} /> Memory
         </div>
         <div className={classes.widgetContent}>
            <div className={classes.infoBlock}>
               <div className={classes.iconBlock}>
                  <Icon type={'memory'} size={18} />
               </div>
               <div className={classes.infoBlockRight}>
                  <span>Memory Components</span>
                  <span>{memoryComponents}</span>
               </div>
            </div>
            <div className={classes.infoBlock}>
               <div className={classes.iconBlock}>
                  <Icon type={'percent'} size={16} />
               </div>
               <div className={classes.infoBlockRight}>
                  <span>Total Memory</span>
                  <span>{formatBytes(memory.total)}</span>
               </div>
            </div>
            <div className={classes.infoBlock}>
               <div className={classes.iconBlock}>
                  <Icon type={'speed'} size={20} />
               </div>
               <div className={classes.infoBlockRight}>
                  <span>Memory Usage</span>
                  <div
                     className={classes.progressBar}
                     data-tooltip-id="htmlToolTip"
                     data-tooltip-place="top"
                     data-tooltip-html={`${formatBytes(memory.used)} / ${formatBytes(memory.total)}`}
                  >
                     <div
                        className={`${classes.progressBarFill} ${memoryPercent > 10 ? classes.progressBarFilled : ''}`}
                        style={{ width: memoryPercent + '%' }}
                     >
                        <span>{memoryPercent}%</span>
                     </div>
                  </div>
               </div>
            </div>
         </div>
      </div>
   );
};

export default DeviceMemory;
