import { useMemo } from 'react';
import { NavLink } from 'react-router';
import { DevicePlan } from '../../../@types/devices';
import Icon from '../../common/Icon/Icon';
import classes from './DeviceBackups.module.scss';
import { formatBytes } from '../../../utils/helpers';

interface DeviceBackupsProps {
   plans: DevicePlan[];
}

const DeviceBackups = ({ plans }: DeviceBackupsProps) => {
   const plansStorages = useMemo(() => {
      const storages: (DevicePlan['storage'] & { size: number })[] = [];

      //first calculate each storage's size from the plan size.
      const storageSizes: { [key: string]: number } = {};
      plans.forEach((plan) => {
         const planStorageId = plan.storage.id;
         if (!storageSizes[planStorageId]) {
            storageSizes[planStorageId] = 0;
         }
         storageSizes[planStorageId] += plan.size;
      });

      plans.forEach((plan) => {
         if (!storages.some((storage) => storage.id === plan.storage.id)) {
            // if (plan.storage.id !== 'local') {
            // TODO: implement this check
            storages.push({ ...plan.storage, size: storageSizes[plan.storage.id] });
            // }
         }
      });
      return storages;
   }, [plans]);

   console.log('plansStorages :', plansStorages);

   return (
      <div className={classes.devicePlans}>
         {/* Backup Plans */}
         <div className={`${classes.widget} ${classes.plans}`}>
            <div className={classes.widgetTitle}>
               <Icon type="plans" size={12} /> Backup Plans
            </div>
            <div className={classes.widgetContent}>
               {plans.length === 0 && <div className={classes.noData}>No backup plans found for this device.</div>}
               {plans.length > 0 &&
                  plans.map(({ id, title, sourceConfig, storage, isActive, method, size }) => (
                     <div key={id} className={classes.planItem}>
                        <div className={`${classes.status} ${!isActive ? classes.paused : ''}`}>
                           <div className={classes.iconBlock}>
                              <Icon type={method === 'backup' ? 'plans' : 'sync'} size={20} />
                           </div>
                        </div>
                        <div className={classes.planContent}>
                           <h4>
                              <NavLink to={`/plan/${id}`}>{title}</NavLink>
                           </h4>
                           <div className={classes.planStats}>
                              <div>
                                 <Icon type="folders" size={12} /> {sourceConfig.includes.length}{' '}
                                 {sourceConfig.includes.length > 1 ? 'paths' : 'path'}
                              </div>
                              <div>
                                 <Icon type="storages" size={12} /> {storage.name}
                              </div>
                              <div>
                                 <Icon type="disk" size={12} /> {formatBytes(size)}
                              </div>
                           </div>
                        </div>
                     </div>
                  ))}
            </div>
         </div>
         {/* Protected Paths */}
         <div className={`${classes.widget} ${classes.paths}`}>
            <div className={classes.widgetTitle}>
               <Icon type="folders" size={12} /> Protected Paths
            </div>
            <div className={classes.widgetContent}>
               {plans.length === 0 && <div className={classes.noData}>No protected paths found for this device.</div>}

               {plans.length > 0 &&
                  plans.map(({ id, title, sourceConfig, method }) => (
                     <div key={id} className={classes.pathItem}>
                        <div className={classes.pathPlanTitle}>
                           <NavLink to={`/plan/${id}`}>
                              <>
                                 <Icon type={method === 'backup' ? 'plans' : 'sync'} size={14} /> {title}
                              </>
                           </NavLink>
                        </div>
                        <div className={classes.planPaths}>
                           {sourceConfig.includes.map((path, index) => (
                              <div key={index} className={classes.path}>
                                 <Icon type="folder" size={14} /> {path}
                              </div>
                           ))}
                        </div>
                     </div>
                  ))}
            </div>
         </div>
         {/* Connected Storages */}
         <div className={`${classes.widget} ${classes.storages}`}>
            <div className={classes.widgetTitle}>
               <Icon type="storages" size={12} /> Connected Storages
            </div>
            <div className={classes.widgetContent}>
               {plans.length === 0 && <div className={classes.noData}>No Remote storages are being used by this device.</div>}
               {plans.length > 0 &&
                  plansStorages.map(({ id, name, size, type, typeName }) => (
                     <div key={id} className={classes.planItem}>
                        <div className={`${classes.status}`}>
                           <div className={classes.iconBlock} title={typeName}>
                              {type === 'local' ? <Icon type="storages" size={12} /> : <img src={`/providers/${type}.png`} />}
                           </div>
                        </div>
                        <div className={classes.planContent}>
                           <h4>
                              <NavLink to={`/storage/${id}`}>{name}</NavLink>
                           </h4>
                           <div className={classes.planStats}>{formatBytes(size)}</div>
                        </div>
                     </div>
                  ))}
            </div>
         </div>
      </div>
   );
};

export default DeviceBackups;
