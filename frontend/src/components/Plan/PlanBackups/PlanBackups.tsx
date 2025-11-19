import { useState } from 'react';
import classes from './PlanBackups.module.scss';
import { formatBytes } from '../../../utils/helpers';
import { Plan } from '../../../@types/plans';
import Restores from '../Restores/Restores';
import Backups from '../Backups/Backups';
import { useComponentOverride } from '../../../context/ComponentOverrideContext';

interface PlanBackupsProps {
   plan: Plan;
}

const PlanBackups = ({ plan }: PlanBackupsProps) => {
   const AllBackups = useComponentOverride('Backups', Backups);
   const [historyTab, setHistoryTab] = useState<'backups' | 'restores'>('backups');

   const { backups = [], stats, restores = [], method, sourceId, sourceType, settings } = plan;

   const sortedHistory = [...(backups || [])].sort((a, b) => new Date(b.started).getTime() - new Date(a.started).getTime());
   const isSync = method === 'sync';
   const snapshotsCount = stats.snapshots?.length || 0;

   return (
      <div className={classes.backups}>
         <div className={classes.backupsHeader}>
            <div className={classes.historyTabs}>
               <button onClick={() => setHistoryTab('backups')} className={historyTab === 'backups' ? classes.historyTabActive : ''}>
                  {isSync ? 'Sync Tasks' : 'Backups'} <i>{sortedHistory.length}</i>
               </button>
               <button onClick={() => setHistoryTab('restores')} className={historyTab === 'restores' ? classes.historyTabActive : ''}>
                  Restores <i>{restores.length}</i>
               </button>
            </div>
            {!isSync && historyTab === 'backups' && (
               <div className={classes.backupsInfo}>
                  {snapshotsCount} Active Snapshots <i className="pipe">|</i> {formatBytes(stats.size)}
               </div>
            )}
         </div>
         {historyTab === 'backups' && (
            <AllBackups
               backups={sortedHistory}
               planId={plan.id}
               method={method}
               sourceId={sourceId}
               sourceType={sourceType}
               snapLimit={settings.prune.snapCount}
            />
         )}
         {historyTab === 'restores' && <Restores restores={restores} planId={plan.id} method={method} sourceId={sourceId} sourceType={sourceType} />}
      </div>
   );
};

export default PlanBackups;
