import { useEffect, useState } from 'react';
import { elapsedLabel, elapsedSeconds, timestamp } from '../../../utils/recoveryProgress';
import type { OperationProgressState } from '../../../utils/recoveryProgress';
import classes from './OperationProgress.module.scss';

/** Request activity is not backend job progress or a successful admission. */
export function RequestActivity({ checking, submitting, failed = false }: { checking: boolean; submitting: boolean; failed?: boolean }) {
   const busy = checking || submitting;
   const label = submitting
      ? 'Sending request — awaiting server acceptance…'
      : checking
        ? 'Checking snapshot, operator and resource availability…'
        : failed
          ? 'Request/check failed — review the error before retrying.'
          : 'Checks finished — review admission below. No new operation is running from this dialog.';
   return (
      <section className={classes.requestActivity} aria-label="Request activity" aria-busy={busy}>
         <div role="status" aria-live="polite" aria-atomic="true">
            {label}
         </div>
         <div className={classes.track}>{busy && <progress aria-label={label} />}</div>
         <small>
            {busy ? 'Activity indicator only; percentage is not measurable.' : 'Blocked is not a background check; a refusal needs attention.'}
         </small>
      </section>
   );
}

export function ElapsedTime({
   start,
   end,
   running,
   label = 'Elapsed since request',
}: {
   start?: number | string | null;
   end?: number | string | null;
   running: boolean;
   label?: string;
}) {
   const [now, setNow] = useState(Date.now);
   const first = timestamp(start),
      last = timestamp(end);
   useEffect(() => {
      if (!running || first === null || end != null) return;
      const timer = window.setInterval(() => setNow((previous) => Math.max(previous, Date.now())), 1000);
      return () => window.clearInterval(timer);
   }, [first, last, end, running]);
   return (
      <span aria-live="off" className={classes.elapsed}>
         {label}: <span>{elapsedLabel(!running && end == null ? null : elapsedSeconds(start, end, now))}</span>
      </span>
   );
}
export default function OperationProgress({
   state,
   start,
   end,
   timeLabel,
}: {
   state: OperationProgressState;
   start?: number | string | null;
   end?: number | string | null;
   timeLabel?: string;
}) {
   return (
      <section className={classes.progress} aria-label="Operation progress">
         <div role="status" aria-live="polite" aria-atomic="true">
            {state.label}
         </div>
         <div className={classes.track} aria-busy={state.busy}>
            {(state.busy || state.complete) && <progress aria-label={state.label} max={1} value={state.complete ? 1 : undefined} />}
         </div>
         <div className={classes.caption}>
            {state.busy
               ? 'In progress — percentage is not measurable.'
               : state.complete
                 ? 'Completion reported by the server.'
                 : 'No successful completion reported.'}
         </div>
         <ElapsedTime start={start} end={end} running={state.busy} label={timeLabel} />
      </section>
   );
}
