import { ReactNode } from 'react';
import Icon from '../../common/Icon/Icon';
import StorageIcon from '../../common/Icon/StorageIcon';
import { Plan } from '../../../@types/plans';
import { useGetStorages } from '../../../services/storage';
import { formatIntervalDisplay, getBackupIconName } from '../../../utils/helpers';
import PlanHistory from '../PlanHistory/PlanHistory';
import PlanSizeChart from '../PlanSizeChart/PlanSizeChart';
import classes from './PlanStats.module.scss';
import PlanStorageInfo from '../PlanStorageInfo/PlanStorageInfo';
import { formatBytes, formatNumberToK } from '../../../utils/helpers';
import { statisticHelp, backupStatistics } from '../../../utils/backupStatistics';

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

   const { data: storageData } = useGetStorages();
   const sourceStorage = isStorageSource
      ? ((storageData?.result as { id: string; name: string; type: string }[]) || []).find((s) => s.id === plan.sourceId)
      : undefined;
   const sourceName = isStorageSource ? sourceStorage?.name || '' : plan.device?.name || '';

   const remoteManaged = plan.method === 'backup' && plan.sourceType === 'device' && plan.sourceId !== 'main';
   const completed = (plan.backups || [])
      .filter((backup) => backup.status === 'completed')
      .slice()
      .sort((a, b) => new Date(b.started).getTime() - new Date(a.started).getTime())[0];
   const measured = backupStatistics(completed?.completionStats as unknown as Record<string, unknown>);
   const totalFiles = remoteManaged ? measured.totalFiles : lastBackupItem?.totalFiles || 0;
   const totalSize = remoteManaged ? measured.logicalBytes : lastBackupItem?.totalSize || 0;

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
               <Icon type={getBackupIconName(plan.method, plan.sourceType)} size={12} /> {isSync ? 'Sync source' : 'Backup source'}
            </div>
            <div className={classes.sourceContent}>
               <div data-tooltip-id="htmlToolTip" data-tooltip-place="top" data-tooltip-html={sourceTooltipHTML(sourceConfig)}>
                  {isStorageSource ? <StorageIcon type={sourceStorage?.type} size={18} /> : <Icon type="folders" size={18} />}
                  <span>{isStorageSource ? sourceName : `${sourceConfig?.includes.length} Sources`}</span>
               </div>
               <div
                  data-tooltip-id="htmlToolTip"
                  data-tooltip-place="top"
                  data-tooltip-html={
                     isActive ? `Scheduled to ${isSync ? 'sync' : 'back up'} ${formatIntervalDisplay(interval)}` : 'Plan is Not Active'
                  }
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
               <Icon type="folders" size={12} /> {isSync ? 'Stats' : 'Snapshot Stats'}{' '}
               <span className={classes.widgetSubTitle} title={statisticHelp.snapshotSize}>
                  {totalFiles === undefined ? 'Not measured' : formatNumberToK(totalFiles) + ' files'} <i>|</i>{' '}
                  {totalSize === undefined ? 'Not measured' : formatBytes(totalSize)}
               </span>
            </div>
            <div className={classes.snapshotsContent}>
               <PlanSizeChart backups={plan.backupChart ?? plan.backups} remoteManaged={remoteManaged} isSync={isSync} />
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
