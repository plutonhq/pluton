import { Plan } from '../../../@types/plans';
import { formatDateTime, formatDuration } from '../../../utils/helpers';
import classes from './PlanHistory.module.scss';

interface PlanHistoryProps {
   planId: string;
   history: Plan['backups'];
   itemsCount?: number;
}
const PlanHistory = ({ planId, history, itemsCount = 10 }: PlanHistoryProps) => {
   const emptySlots = history.length < itemsCount ? itemsCount - history.length : 0;
   const statusVals = {
      completed: '✔️ Completed',
      failed: '❌ Failed',
      started: '⏳ In Progress',
      cancelled: '🛇 Cancelled',
   };

   const backupChanges = (changes: { new?: number; modified?: number; removed?: number }) => {
      const newCount = changes?.new || 0;
      const modifiedCount = changes?.modified || 0;
      const removedCount = changes?.removed || 0;
      const parts = [];
      if (newCount > 0) parts.push(`${newCount} New`);
      if (modifiedCount > 0) parts.push(`${modifiedCount} Modified`);
      if (removedCount > 0) parts.push(`${removedCount} Removed`);
      return parts.length > 0 ? parts.join(' / ') : 'No Changes';
   };

   return (
      <div className={`${classes.history} ${itemsCount > 10 ? classes.historyFull : ''}`}>
         {emptySlots > 0 &&
            [...Array(emptySlots)].map((_, i) => (
               <div
                  className={classes.historyItemEmpty}
                  key={`${planId}-empty-${i}`}
                  data-tooltip-id="appTooltip"
                  data-tooltip-content="No History"
                  data-tooltip-place="top"
               ></div>
            ))}

         {history.slice(0, itemsCount).map((h, i) => {
            const duration = h.duration || (h.ended ? (new Date(h.ended).getTime() - new Date(h.started).getTime()) / 1000 : 0);
            return (
               <div
                  className={`${h.status === 'completed' ? classes.historyItemSuccess : ''} ${h.status === 'failed' || h.status === 'cancelled' ? classes.historyItemFailed : ''} ${h.inProgress ? classes.historyItemPending : ''}`}
                  key={`${planId}-history-${i}`}
                  data-tooltip-id="htmlToolTip"
                  data-tooltip-html={`
                  <div><b>Status</b>: ${statusVals[h.status as keyof typeof statusVals] || 'Unknown'}</div>
                  <div><b>Changes</b>: ${backupChanges(h.changes)}</div>
                  <div><b>Started</b>: ${formatDateTime(h.started)}</div>
                  <div><b>Ended</b>: ${h.ended ? formatDateTime(h.ended) : ' - '}</div>
                  <div><b>Duration</b>: ${duration ? formatDuration(duration) : '0ms'} </div>
               `}
                  data-tooltip-place="top"
               ></div>
            );
         })}
      </div>
   );
};

export default PlanHistory;
