import { useRef, useState } from 'react';
import { displayTimeZone, historyPreset, validateHistoryDates } from '../../../utils/backupHistory';
import type { HistoryState } from '../../../utils/backupHistory';
import Icon from '../../common/Icon/Icon';
import classes from './BackupHistory.module.scss';

export default function BackupHistoryFilters({ state, apply }: { state: HistoryState; apply: (state: HistoryState) => void }) {
   // Only draft calendar fields: a page-size change must not leave a stale size
   // in the form, then silently restore it when Apply/presets are used.
   const [draft, setDraft] = useState({ startDate: state.startDate, endDate: state.endDate, timeZone: state.timeZone });
   const [error, setError] = useState<string>();
   const startInput = useRef<HTMLInputElement>(null);
   const filtered = !!state.startDate || !!state.endDate;
   const zones = [...new Set([displayTimeZone(), 'UTC', state.timeZone])];
   const selectedPreset = ([1, 7, 30] as const).find((days) => {
      const dates = historyPreset(days, state.timeZone);
      return state.startDate === dates.startDate && state.endDate === dates.endDate;
   });
   const dirty = draft.startDate !== state.startDate || draft.endDate !== state.endDate || draft.timeZone !== state.timeZone;
   const appliedSummary = `${filtered ? `Applied: ${state.startDate || 'Any start'} – ${state.endDate || 'Any end'}` : 'All dates'} · ${state.timeZone}`;
   return (
      <form
         className={classes.filters}
         aria-label="Filter backup history by date"
         onSubmit={(event) => {
            event.preventDefault();
            const invalid = validateHistoryDates(draft.startDate, draft.endDate);
            setError(invalid);
            if (!invalid) apply({ ...state, ...draft, page: 1 });
         }}
      >
         <div className={classes.toolbar}>
            <div className={classes.presets} role="group" aria-label="Quick date range">
               {([1, 7, 30] as const).map((days) => (
                  <button
                     type="button"
                     key={days}
                     aria-label={days === 1 ? 'Today' : `Last ${days} days`}
                     aria-pressed={selectedPreset === days}
                     onClick={() => {
                        const dates = historyPreset(days, draft.timeZone);
                        const next = { ...state, ...draft, ...dates, page: 1 };
                        setDraft({ ...dates, timeZone: draft.timeZone });
                        setError(undefined);
                        apply(next);
                     }}
                  >
                     {days === 1 ? 'Today' : `${days} Days`}
                  </button>
               ))}
               <button type="button" aria-label="Custom range" aria-pressed={filtered && !selectedPreset} onClick={() => startInput.current?.focus()}>
                  Custom
               </button>
            </div>
            <div className={classes.dates}>
               <label className={classes.dateField}>
                  <span>Start</span>
                  <input
                     aria-label="Start date"
                     type="date"
                     ref={startInput}
                     min="0001-01-01"
                     max="9998-12-31"
                     value={draft.startDate}
                     onChange={(e) => setDraft({ ...draft, startDate: e.target.value })}
                  />
               </label>
               <label className={classes.dateField}>
                  <span>End</span>
                  <input
                     aria-label="End date"
                     type="date"
                     min="0001-01-01"
                     max="9998-12-31"
                     value={draft.endDate}
                     onChange={(e) => setDraft({ ...draft, endDate: e.target.value })}
                  />
               </label>
            </div>
            <div className={classes.zoneGroup}>
               <label className={classes.zone}>
                  <span className={classes.srOnly}>Display time zone</span>
                  <select value={draft.timeZone} onChange={(e) => setDraft({ ...draft, timeZone: e.target.value })}>
                     {zones.map((zone) => (
                        <option key={zone}>{zone}</option>
                     ))}
                  </select>
               </label>
               <span className={classes.inlineState} data-dirty={dirty || undefined} title={`${appliedSummary}${dirty ? '; Pending changes' : ''}`}>
                  {dirty ? 'Pending' : filtered ? 'Applied' : 'All dates'}
               </span>
               <details
                  className={classes.help}
                  onBlur={(event) => {
                     if (!event.currentTarget.contains(event.relatedTarget as Node | null)) event.currentTarget.open = false;
                  }}
                  onKeyDown={(event) => {
                     if (event.key === 'Escape' && event.currentTarget.open) {
                        event.currentTarget.open = false;
                        event.stopPropagation();
                     }
                  }}
               >
                  <summary aria-label="Date filter help">
                     <Icon type="info" size={18} />
                  </summary>
                  <p className={classes.helpText}>
                     <strong>{appliedSummary}</strong>
                     <span>
                        {dirty ? 'Pending changes are not applied. Use Apply to update the results.' : 'These filters are applied to the results.'}
                     </span>
                     <span>
                        Both selected calendar days are included in {state.timeZone}. Date = finished time, or started time if unfinished; created
                        time is the fallback for older records with neither timestamp.
                     </span>
                  </p>
               </details>
            </div>
            <div className={classes.actions}>
               <button type="submit" className={classes.apply}>
                  <span aria-hidden="true">Apply</span>
                  <span className={classes.srOnly}>Apply filter</span>
               </button>
               <button
                  type="button"
                  onClick={() => {
                     const next = { ...state, page: 1, startDate: '', endDate: '' };
                     setDraft({ startDate: '', endDate: '', timeZone: state.timeZone });
                     setError(undefined);
                     apply(next);
                  }}
               >
                  Clear
               </button>
            </div>
         </div>
         <p className={classes.hint} role="status">
            {appliedSummary}
            {dirty && <span> · Unapplied changes</span>}
         </p>
         {error && (
            <p className={classes.error} role="alert">
               {error}
            </p>
         )}
      </form>
   );
}
