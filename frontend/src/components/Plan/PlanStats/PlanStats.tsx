import { ReactNode, useContext } from 'react';
import Icon from '../../common/Icon/Icon';
import StorageIcon from '../../common/Icon/StorageIcon';
import { Plan, PlanSourceDisplayResolver } from '../../../@types/plans';
import { ComponentOverrideContext } from '../../../context/ComponentOverrideContext';
import { useGetStorages } from '../../../services/storage';
import { formatIntervalDisplay, getBackupIconName } from '../../../utils/helpers';
import PlanHistory from '../PlanHistory/PlanHistory';
import PlanSizeChart from '../PlanSizeChart/PlanSizeChart';
import classes from './PlanStats.module.scss';
import PlanStorageInfo from '../PlanStorageInfo/PlanStorageInfo';
import { formatBytes, formatNumberToK } from '../../../utils/helpers';

interface PlanStatsProps {
   plan: Plan;
   isSync: boolean;
   lastBackupItem: any;
   storageAction?: ReactNode;
}

const PlanStats = ({ plan, isSync, lastBackupItem, storageAction }: PlanStatsProps) => {
   const { sourceConfig, storage, storagePath, isActive, settings } = plan;
   const { interval } = settings;
   const isStorageSource = plan.sourceType === 'storage';

   const resolveSourceDisplay = useContext(ComponentOverrideContext)['PlanSourceDisplay'] as unknown as PlanSourceDisplayResolver | undefined;
   const sourceDisplay = resolveSourceDisplay?.(plan, { detailed: true });

   const { data: storageData } = useGetStorages();
   const sourceStorage = isStorageSource
      ? ((storageData?.result as { id: string; name: string; type: string }[]) || []).find((s) => s.id === plan.sourceId)
      : undefined;
   const sourceName = isStorageSource ? sourceStorage?.name || '' : plan.device?.name || '';

   // A blocked run uploaded nothing, so the numbers come from the run before it.
   const statsItem =
      lastBackupItem?.status === 'blocked'
         ? [...(plan.backups || [])].filter((b) => b.status !== 'blocked').sort((a, b) => (b.started || 0) - (a.started || 0))[0]
         : lastBackupItem;
   const totalFiles = statsItem?.totalFiles || 0;
   const totalSize = statsItem?.totalSize || 0;

   const sourceTooltipHTML = (sources: Plan['sourceConfig']) => {
      let html = '';
      if (sources && sources.includes && sources.includes.length > 0) {
         html += `<div><strong>Includes</strong></div>`;
         html += sources.includes.map((p) => `<div>${sourceName} -> ${p}</div>`).join('');
      }
      if (sources && sources.excludes && sources.excludes.length > 0) {
         html += `<div><strong>Excludes</strong></div>`;
         html += sources.excludes.map((p) => `<div>${p}</div>`).join('');
      }
      return html;
   };

   return (
      <div className={classes.planStats}>
         <div className={classes.sources}>
            <div className={classes.widgetTitle}>
               <Icon type={getBackupIconName(plan.method, plan.sourceType)} size={12} /> {isSync ? 'Syncing' : 'Backing Up'}
            </div>
            <div className={classes.sourceContent}>
               <div
                  data-tooltip-id="htmlToolTip"
                  data-tooltip-place="top"
                  {...(sourceDisplay
                     ? { 'data-tooltip-html': sourceDisplay.tooltip || sourceDisplay.label }
                     : { 'data-tooltip-html': sourceTooltipHTML(sourceConfig) })}
               >
                  {sourceDisplay ? (
                     <div className={classes.sourceIcon}>
                        <Icon type={sourceDisplay.icon} size={18} />
                        {sourceDisplay.online !== undefined && (
                           <i className={`${classes.sourceStatus} ${sourceDisplay.online ? classes.online : ''}`} />
                        )}
                     </div>
                  ) : isStorageSource ? (
                     <StorageIcon type={sourceStorage?.type} size={18} />
                  ) : (
                     <Icon type="folders" size={18} />
                  )}
                  <span>{sourceDisplay ? sourceDisplay.name || sourceDisplay.label : isStorageSource ? sourceName : `${sourceConfig?.includes.length} Sources`}</span>
               </div>
               <div
                  data-tooltip-id="htmlToolTip"
                  data-tooltip-place="top"
                  data-tooltip-html={isActive ? `${isSync ? 'Syncing' : 'Copying'} changes ${formatIntervalDisplay(interval)}` : 'Plan is Not Active'}
               >
                  <Icon type={isActive ? (isSync ? 'reload' : 'copy') : 'pause'} size={16} />
                  <div className={classes.sourceArrow}>→</div>
               </div>
               <PlanStorageInfo
                  disableTooltip={false}
                  inline={false}
                  replicationSettings={plan.settings.replication}
                  storage={storage}
                  storagePath={storagePath}
                  action={storageAction}
               />
            </div>
         </div>
         <div className={classes.snapshots}>
            <div className={classes.widgetTitle}>
               <Icon type="folders" size={12} /> Stats{' '}
               <span className={classes.widgetSubTitle}>
                  {formatNumberToK(totalFiles)} files <i>|</i> {formatBytes(totalSize)}
               </span>
            </div>
            <div className={classes.snapshotsContent}>
               <PlanSizeChart backups={plan.backups} />
            </div>
         </div>
         <div className={classes.health}>
            <div className={classes.widgetTitle}>
               <Icon type="speed" size={12} /> Health
            </div>
            <div className={classes.healthContent}>
               <PlanHistory planId={plan.id} history={plan.backups} itemsCount={90} />
            </div>
         </div>
      </div>
   );
};

export default PlanStats;
