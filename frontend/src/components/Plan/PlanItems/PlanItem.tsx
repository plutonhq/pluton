import { useContext } from 'react';
import { NavLink } from 'react-router';
import { Plan, PlanSourceDisplayResolver } from '../../../@types/plans';
import { ComponentOverrideContext } from '../../../context/ComponentOverrideContext';
import { formatBytes, formatDateTime, getBackupIconName, timeAgo } from '../../../utils/helpers';
import Icon from '../../common/Icon/Icon';
import StorageIcon from '../../common/Icon/StorageIcon';
import classes from './PlanItem.module.scss';
import PlanActions from './PlanActions';
import { useGetStorages } from '../../../services/storage';
import { planIntervalName } from '../../../utils/plans';
import PlanHistory from '../PlanHistory/PlanHistory';
import PlanStorageInfo from '../PlanStorageInfo/PlanStorageInfo';

interface PlanItemProps {
   plan: Plan;
   layout?: 'grid' | 'list';
}

const PlanItem = ({ plan, layout = 'list' }: PlanItemProps) => {
   const {
      id,
      title,
      description,
      sourceConfig = { includes: [], excludes: [] },
      settings,
      inProgress,
      lastBackupTime = '',
      stats,
      backups = [],
      storage,
      isActive = false,
      verified,
      device,
      method = 'backup',
   } = plan;

   const { interval = { type: 'daily', time: '10:00AM' }, encryption = false, compression = false } = settings;

   const resolveSourceDisplay = useContext(ComponentOverrideContext)['PlanSourceDisplay'] as unknown as PlanSourceDisplayResolver | undefined;
   const sourceDisplay = resolveSourceDisplay?.(plan);

   const isStorageSource = plan.sourceType === 'storage';
   const { data: storageData } = useGetStorages();
   const sourceStorage = isStorageSource
      ? ((storageData?.result as { id: string; name: string; type: string }[]) || []).find((s) => s.id === plan.sourceId)
      : undefined;


   return (
      <div
         key={id}
         className={`${classes.plan} ${layout === 'grid' ? classes.planGrid : classes.planList} ${verified && verified.hasError ? classes.planHasError : ''}`}
      >
         <div className={classes.leftContent}>
            <div className={`${classes.status} ${!isActive ? classes.paused : ''}  ${inProgress ? classes.inProgress : ''}`}>
               {inProgress && (
                  <span className={classes.inProgressIcon}>
                     <Icon type="loading" size={14} />
                  </span>
               )}
               <Icon type={getBackupIconName(method, plan.sourceType)} size={24} />
            </div>

            <div className={classes.content}>
               <NavLink to={`/plan/${id}`}>
                  <div className={classes.title}>
                     <h4>{title}</h4>
                     {description && (
                        <i
                           className={classes.planDescription}
                           data-tooltip-id="appTooltip"
                           data-tooltip-content={description}
                           data-tooltip-place="top"
                        >
                           <Icon type="note" size={13} />
                        </i>
                     )}
                     {encryption && (
                        <i data-tooltip-id="appTooltip" data-tooltip-content={`Encrypted`} data-tooltip-place="top">
                           <Icon type="encrypted" size={14} />
                        </i>
                     )}
                     {compression && (
                        <i data-tooltip-id="appTooltip" data-tooltip-content={`Compressed`} data-tooltip-place="top">
                           <Icon type="compressed" size={14} />
                        </i>
                     )}
                     {!isActive && (
                        <i data-tooltip-id="appTooltip" data-tooltip-content={`Plan Paused`} data-tooltip-place="top">
                           <Icon type="pause" size={14} />
                        </i>
                     )}
                     {verified && verified.hasError && (
                        <i data-tooltip-id="appTooltip" data-tooltip-content={`Plan Has Error`} data-tooltip-place="top">
                           <Icon size={14} type={'error-circle-filled'} color="#dd6b6b" />
                        </i>
                     )}
                  </div>
                  <div className={classes.sources}>
                     <span
                        data-tooltip-id="htmlToolTip"
                        data-tooltip-place="top"
                        data-tooltip-hidden={!!sourceDisplay}
                        data-tooltip-html={sourceConfig?.includes ? sourceConfig.includes.map((p) => `<div>${p}</div>`).join('') : ''}
                     >
                        {sourceDisplay ? (
                           <>
                              <Icon type={sourceDisplay.icon} size={13} /> {sourceDisplay.label}
                           </>
                        ) : isStorageSource ? (
                           <>
                              <StorageIcon type={sourceStorage?.type} size={13} /> {sourceStorage?.name}
                           </>
                        ) : (
                           device?.name && (
                              <>
                                 <Icon type={device.id === 'main' ? 'computer' : 'computer-remote'} size={13} /> {device.name}
                              </>
                           )
                        )}
                        {!sourceDisplay && <span className={classes.sourceCount}>{sourceConfig.includes.length}</span>}
                     </span>{' '}
                     {'-->'}
                     <PlanStorageInfo replicationSettings={plan.settings.replication} storage={storage} storagePath={plan.storagePath} />
                  </div>
               </NavLink>
            </div>
         </div>
         <div className={classes.rightContent}>
            <div
               className={classes.size}
               data-tooltip-id="appTooltip"
               data-tooltip-place="top"
               data-tooltip-hidden={!stats.snapshots || method === 'sync'}
               data-tooltip-content={`Total Snapshots: ${stats.snapshots.length}`}
            >
               <Icon type="disk" size={14} /> <i>{formatBytes(stats.size)}</i>
            </div>
            <div className={classes.interval}>
               <Icon type="interval" size={14} />{' '}
               <i title={interval.type === 'days' ? 'Every ' + interval.days?.replace(/-/g, ', ') : ''}>{planIntervalName(interval)}</i>
            </div>
            <div
               className={classes.time}
               data-tooltip-id="appTooltip"
               data-tooltip-content={lastBackupTime ? `Last backed up on ${formatDateTime(lastBackupTime as string)}` : "Hasn't been backed up yet"}
               data-tooltip-place="top"
               data-tooltip-hidden={inProgress}
            >
               <Icon type={inProgress ? 'loading' : 'clock'} size={14} />{' '}
               {inProgress ? 'In Progress' : lastBackupTime ? timeAgo(new Date(lastBackupTime as string)) : 'Not Yet'}
            </div>
            <PlanHistory planId={id} history={backups} />
            <PlanActions plan={plan} />
         </div>
      </div>
   );
};

export default PlanItem;
