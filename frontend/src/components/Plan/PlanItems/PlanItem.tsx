import { useState } from 'react';
import { toast } from 'react-toastify';
import { NavLink } from 'react-router';
import { Plan } from '../../../@types/plans';
import { formatBytes, formatDateTime, timeAgo } from '../../../utils/helpers';
import Icon from '../../common/Icon/Icon';
import classes from './PlanItem.module.scss';
import { useDeletePlan, usePausePlan, usePerformBackup, useResumePlan } from '../../../services/plans';
import { planIntervalName } from '../../../utils/plans';
import PlanHistory from '../PlanHistory/PlanHistory';

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
   const [showSettings, setShowSettings] = useState(false);

   const deletePlanMutation = useDeletePlan();
   const performBackupMutation = usePerformBackup();
   const pauseMutation = usePausePlan();
   const resumeMutation = useResumePlan();
   const shouldBeInaccessible =
      pauseMutation.isPending || resumeMutation.isPending || performBackupMutation.isPending || deletePlanMutation.isPending;
   const isSync = method === 'sync';
   const changeStatus = () => {
      if (inProgress || shouldBeInaccessible) {
         return;
      }
      // isActive, set it to false, else true
      // When the action is being performed, the item should grey out and stay inaccessible.
      // When this happens, the server should stop the restic Cron schedule
      console.log(' changeStatus:', !isActive);
      if (isActive) {
         toast.promise(pauseMutation.mutateAsync(id), {
            pending: 'Pausing backup Plan...',
            success: 'Backup Plan Paused',
            error: {
               render({ data }: any) {
                  return `Failed to Pause Backup Plan. ${data?.message || 'Unknown Error.'}`;
               },
            },
         });
      } else {
         toast.promise(resumeMutation.mutateAsync(id), {
            pending: 'Resuming backup Plan...',
            success: 'Backup Plan Resumed',
            error: {
               render({ data }: any) {
                  return `Failed to Resume Backup Plan. ${data?.message || 'Unknown Error.'}`;
               },
            },
         });
      }
   };

   const backupNow = () => {
      if (shouldBeInaccessible) {
         return;
      }
      toast.promise(
         performBackupMutation.mutateAsync(id),
         {
            pending: `Starting ${isSync ? 'Sync' : 'Backup'}...`,
            success: `${isSync ? 'Sync' : 'Backup'} initiated successfully! 🚀`,
            error: {
               render({ data }: any) {
                  // When the promise reject, data will contains the error
                  return `Failed to start ${isSync ? 'Sync' : 'Backup'}. ${data?.message || 'Unknown Error.'}`;
               },
            },
         },
         {
            style: {
               minWidth: '250px',
            },
         },
      );
      setShowSettings(false);
   };

   return (
      <div
         key={id}
         className={`${classes.plan} ${layout === 'grid' ? classes.planGrid : classes.planList} ${verified && verified.hasError ? classes.planHasError : ''}`}
      >
         <div className={classes.leftContent}>
            <div className={`${classes.status} ${!isActive ? classes.paused : ''}`}>
               <Icon type={method === 'backup' ? 'plans' : 'sync'} size={28} />
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
                        data-tooltip-html={sourceConfig?.includes ? sourceConfig.includes.map((p) => `<div>${p}</div>`).join('') : ''}
                     >
                        {device?.name && (
                           <>
                              <Icon type={device.id === 'main' ? 'computer' : 'computer-remote'} size={13} /> {device.name}
                           </>
                        )}
                        <span className={classes.sourceCount}>{sourceConfig.includes.length}</span>
                     </span>{' '}
                     {'-->'} {storage.type && <img src={`/providers/${storage.type}.png`} />}
                     {storage.name}
                     {/* {storagePath && storagePath !== '/' && '/' + storagePath} */}
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
               <Icon type="interval" size={14} /> <i>{planIntervalName(interval)}</i>
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
            <button className={`${classes.moreBtn} ${showSettings ? classes.moreBtnActive : ''}`} onClick={() => setShowSettings(!showSettings)}>
               <Icon type="dots-vertical" size={14} />
            </button>
         </div>
         {showSettings && (
            <div className={classes.settings}>
               <button onClick={backupNow}>
                  <Icon type="backup" size={14} /> {isSync ? 'Sync' : 'Backup'} Now
               </button>
               <button
                  onClick={() => {
                     changeStatus();
                     setShowSettings(false);
                  }}
               >
                  <Icon type={isActive ? 'pause' : 'resume'} size={14} /> {isActive ? 'Pause Plan' : 'Resume Plan'}
               </button>
            </div>
         )}
      </div>
   );
};

export default PlanItem;
