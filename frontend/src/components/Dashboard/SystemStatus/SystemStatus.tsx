import DashboardWidget from '../DashboardWidget/DashboardWidget';
import Icon from '../../common/Icon/Icon';
import { useGetDashboardSystem } from '../../../services/dashboard';
import { DashboardSystem } from '../../../@types/dashboard';
import classes from './SystemStatus.module.scss';

const ROWS: { key: keyof DashboardSystem; label: string; icon: string }[] = [
   { key: 'cpu', label: 'CPU', icon: 'cpu' },
   { key: 'memory', label: 'Memory', icon: 'memory' },
   { key: 'disk', label: 'Disk', icon: 'storage-disk' },
];

const SystemStatus = () => {
   const { data, isLoading } = useGetDashboardSystem();
   const system: DashboardSystem | undefined = data?.result;

   return (
      <DashboardWidget title="System Status" isLoading={isLoading} icon="performance">
         <ul className={classes.rows}>
            {ROWS.map(({ key, label, icon }) => {
               const value = Math.min(100, Math.max(0, system?.[key] || 0));
               return (
                  <li key={key} data-tooltip-id="htmlToolTip" data-tooltip-content={`${label}: ${value}%`} data-tooltip-place="top">
                     <span className={classes.icon}>
                        <Icon type={icon} size={15} />
                     </span>
                     <span className={classes.bar}>
                        <span className={classes.barFill} style={{ width: `${value}%` }} />
                     </span>
                     <span className={classes.value}>{String(Math.round(value)).padStart(2, '0')}%</span>
                  </li>
               );
            })}
         </ul>
      </DashboardWidget>
   );
};

export default SystemStatus;
