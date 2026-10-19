import { HISTORY_PAGE_SIZES, historyRange } from '../../../utils/backupHistory';
import type { HistoryPage, HistoryState } from '../../../utils/backupHistory';
import classes from './Pagination.module.scss';

export default function Pagination({
   page,
   onPage,
   onSize,
   busy = false,
}: {
   page: Omit<HistoryPage<never>, 'items' | 'timeZone'>;
   onPage: (page: number) => void;
   onSize: (size: HistoryState['pageSize']) => void;
   busy?: boolean;
}) {
   return (
      <nav className={classes.pagination} aria-label="Backup history pagination" aria-busy={busy}>
         <span aria-live="polite">{busy ? 'Updating backup history…' : historyRange(page.page, page.pageSize, page.total)}</span>
         <div className={classes.controls}>
            <label>
               Rows per page{' '}
               <select value={page.pageSize} onChange={(event) => onSize(Number(event.target.value) as HistoryState['pageSize'])}>
                  {HISTORY_PAGE_SIZES.map((size) => (
                     <option key={size} value={size}>
                        {size}
                     </option>
                  ))}
               </select>
            </label>
            <button type="button" onClick={() => onPage(page.page - 1)} disabled={busy || !page.hasPrevious}>
               Previous
            </button>
            <span>{busy ? 'Loading…' : `Page ${page.page} of ${page.totalPages}`}</span>
            <button type="button" onClick={() => onPage(page.page + 1)} disabled={busy || !page.hasNext}>
               Next
            </button>
         </div>
      </nav>
   );
}
