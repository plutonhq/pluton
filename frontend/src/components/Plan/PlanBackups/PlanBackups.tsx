import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import classes from './PlanBackups.module.scss';
import { formatBytes } from '../../../utils/helpers';
import { Plan } from '../../../@types/plans';
import Restores from '../Restores/Restores';
import Backups from '../Backups/Backups';
import { useComponentOverride } from '../../../context/ComponentOverrideContext';
import RecoverySummary from '../RecoveryTesting/RecoverySummary';
import { latestLogicalSnapshotBytes, statisticHelp } from '../../../utils/backupStatistics';
import { useBackupHistory } from '../../../services/plans';
import { readHistoryState, writeHistoryState } from '../../../utils/backupHistory';
import type { HistoryState } from '../../../utils/backupHistory';
import Pagination from '../../common/Pagination/Pagination';
import BackupHistoryFilters from '../Backups/BackupHistoryFilters';
import historyClasses from '../Backups/BackupHistory.module.scss';

interface PlanBackupsProps {
   plan: Plan;
}

const PlanBackups = ({ plan }: PlanBackupsProps) => {
   const AllBackups = useComponentOverride('Backups', Backups);
   const [historyTab, setHistoryTab] = useState<'backups' | 'restores'>('backups');
   const [params, setParams] = useSearchParams();
   const state = readHistoryState(params);
   const history = useBackupHistory(plan.id, state, historyTab === 'backups');
   const page = history.isPlaceholderData ? undefined : history.data;
   const resolvedPage = page?.page;
   const requestedPage = state.page;
   const setHistory = (next: HistoryState, replace = false) => setParams((current) => writeHistoryState(current, next), { replace });
   useEffect(() => {
      if (resolvedPage !== undefined && resolvedPage !== requestedPage)
         setParams((current) => writeHistoryState(current, { ...readHistoryState(current), page: resolvedPage }), { replace: true });
   }, [resolvedPage, requestedPage, setParams]); // Server clamps a now-empty last page after removal.

   const { backups = [], stats, restores = [], method, sourceId, sourceType, settings, storage } = plan;

   const finishedRestores = restores.filter((r) => r.inProgress === false);

   const isSync = method === 'sync';
   const snapshotsCount = stats.snapshots?.length || 0;
   const remoteManaged = sourceType === 'device' && sourceId !== 'main' && method === 'backup';
   const logicalSize = latestLogicalSnapshotBytes(backups);

   return (
      <div className={classes.backups}>
         <RecoverySummary plan={plan} />
         <div className={classes.backupsHeader}>
            <div className={classes.historyTabs}>
               <button onClick={() => setHistoryTab('backups')} className={historyTab === 'backups' ? classes.historyTabActive : ''}>
                  {isSync ? 'Sync Tasks' : 'Backups'}
               </button>
               <button onClick={() => setHistoryTab('restores')} className={historyTab === 'restores' ? classes.historyTabActive : ''}>
                  Restores <i>{finishedRestores.length}</i>
               </button>
            </div>
            {!isSync && historyTab === 'backups' && (
               <div className={classes.backupsInfo} title={remoteManaged ? statisticHelp.snapshotSize : undefined}>
                  {snapshotsCount} Active Snapshots <i className="pipe">|</i>{' '}
                  {remoteManaged
                     ? `Latest Snapshot: ${logicalSize === undefined ? 'Not measured' : formatBytes(logicalSize)}`
                     : formatBytes(stats.size)}
               </div>
            )}
         </div>
         {historyTab === 'backups' && (
            <section aria-label="Backup history">
               <BackupHistoryFilters key={`${state.startDate}/${state.endDate}/${state.timeZone}`} state={state} apply={setHistory} />
               <div className={historyClasses.results} aria-busy={history.isFetching}>
                  {history.isError ? (
                     <div className={historyClasses.message} role="alert">
                        Could not load backup history. {history.error.message}{' '}
                        <button type="button" onClick={() => history.refetch()}>
                           Retry
                        </button>
                     </div>
                  ) : !page ? (
                     <div className={historyClasses.loading} role="status">
                        Loading backup history…
                     </div>
                  ) : (
                     <AllBackups
                        key={`${page.page}/${page.pageSize}/${state.startDate}/${state.endDate}/${state.timeZone}`}
                        backups={page.items}
                        timeZone={page.timeZone}
                        emptyMessage={state.startDate || state.endDate ? 'No backups match this date range.' : 'No finished backups yet.'}
                        planId={plan.id}
                        method={method}
                        sourceId={sourceId}
                        sourceType={sourceType}
                        deviceId={plan.device?.id || 'main'}
                        storage={storage}
                        snapLimit={settings.prune.snapCount}
                        replicationSettings={settings.replication}
                     />
                  )}
               </div>
               <Pagination
                  page={page || { page: state.page, pageSize: state.pageSize, total: 0, totalPages: 1, hasPrevious: false, hasNext: false }}
                  busy={history.isFetching || history.isError}
                  onPage={(next) => setHistory({ ...state, page: next })}
                  onSize={(pageSize) => setHistory({ ...state, page: 1, pageSize })}
               />
            </section>
         )}
         {historyTab === 'restores' && <Restores restores={restores} planId={plan.id} method={method} sourceId={sourceId} sourceType={sourceType} />}
      </div>
   );
};

export default PlanBackups;
