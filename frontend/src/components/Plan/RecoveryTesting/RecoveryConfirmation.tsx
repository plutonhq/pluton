import { useId, useState } from 'react';
import type { RecoveryPreparation, RecoverySelection } from '../../../@types/recoveryTests';
import { useRecoveryPreparation } from '../../../services/recoveryTests';
import {
   canConfirmRecovery,
   initialRecoverySelection,
   recoveryConfirmationBody,
   recoveryDestinationStatus,
   recoveryResourceSafety,
} from '../../../utils/recoveryConfirmation';
import InternalResourceWarning from '../../common/InternalResourceWarning';
import { RequestActivity } from '../../common/OperationProgress/OperationProgress';
import { formatBytes } from '../../../utils/helpers';
import Modal from '../../common/Modal/Modal';
import classes from './RecoveryTesting.module.scss';

type Confirm = (body: ReturnType<typeof recoveryConfirmationBody>) => void;
export function RecoveryConfirmationContent({
   preview,
   operation,
   pending,
   confirm,
   refresh,
   checking = false,
}: {
   preview: RecoveryPreparation;
   operation: 'test' | 'restore';
   pending: boolean;
   confirm: Confirm;
   refresh: () => void;
   checking?: boolean;
}) {
   const [selection, setSelection] = useState<RecoverySelection>(() => initialRecoverySelection(preview));
   const [acknowledgedToken, setAcknowledgedToken] = useState<string>();
   const acknowledged = acknowledgedToken === preview.metadataToken;
   const [databaseId, setDatabaseId] = useState(preview.databases[0]?.path || '');
   const [retention, setRetention] = useState('24');
   const restore = operation === 'restore';
   const sample = preview.resources.sample;
   const databases = restore ? preview.databases.filter((entry) => entry.path === databaseId) : preview.databases;
   const resourceId = useId();
   const resourceSafety = recoveryResourceSafety(preview, selection, checking);
   return (
      <div className={`${classes.panel} styled__scrollbar`}>
         <div className={classes.detail}>
            <div>
               Plan: {preview.planTitle} · <code>{preview.planId}</code>
            </div>
            <div>
               Backup: <code>{preview.backupId}</code>
            </div>
            <div>
               Exact snapshot: <code>{preview.snapshotId}</code>
            </div>
         </div>
         <p>
            Engine and database identity come from the authenticated backup receipt and the exact snapshot path/size checks, never SQL filenames. SQL
            bytes and SHA-256 are reverified before import. Source/dump version metadata was not recorded; version compatibility is not certified by
            this preview.
         </p>
         {restore && (
            <>
               <label>
                  Recorded database
                  <select value={databaseId} onChange={(event) => setDatabaseId(event.target.value)}>
                     {preview.databases.map((entry) => (
                        <option key={entry.path} value={entry.path}>
                           {entry.database || entry.path} · {entry.engine || 'Unknown'}
                        </option>
                     ))}
                  </select>
               </label>
               <p role="alert">
                  Persistent Database Restore: Not Available. Bounded persistent storage, a separate durable ownership/TTL lifecycle and an approved
                  controller are not implemented. No import will run.
               </p>
               <p>
                  Internal Database Restore retains database resources after import until the restore is deleted or expires. The current temporary
                  testing targets cannot retain restores.
               </p>
               <label>
                  Retention (not active)
                  <select value={retention} onChange={(event) => setRetention(event.target.value)}>
                     <option value="1">1 hour</option>
                     <option value="6">6 hours</option>
                     <option value="24">24 hours</option>
                  </select>
               </label>
               <button type="button" disabled>
                  Internal — Not Available
               </button>
               <button type="button" disabled>
                  Custom persistent restore — Not Available
               </button>
            </>
         )}
         {!restore && (
            <label>
               Validation mode
               <select
                  value={selection.databaseImport}
                  onChange={(event) => setSelection({ ...selection, databaseImport: event.target.value as 'required' | 'disabled' })}
               >
                  <option value="required">Native import — every recorded database required</option>
                  <option value="disabled" disabled={preview.policy.databaseImport === 'required'}>
                     Artifact-only — SQL import NOT TESTED
                  </option>
               </select>
            </label>
         )}
         {!databases.length && (
            <p>No database artifacts recorded. Filesystem recovery validation remains available; no database engine is guessed.</p>
         )}
         {databases.map((entry) => (
            <div className={classes.card} key={entry.path}>
               <div>
                  {entry.database || 'Historical name not recorded'} · Engine: {entry.engine || 'Not recorded'} (read-only)
               </div>
               <div>
                  {entry.databaseId || 'Historical artifact'} · {formatBytes(entry.bytes)} · <code>{entry.path}</code>
               </div>
               {!restore &&
                  selection.databaseImport === 'required' &&
                  entry.engine &&
                  (entry.engine !== 'mysql' || preview.lifecycle === 'automatic') && (
                     <label>
                        <input
                           type="checkbox"
                           checked={selection.targetModes?.[entry.engine] === 'internal'}
                           onChange={(event) =>
                              setSelection({
                                 ...selection,
                                 targetModes: { ...selection.targetModes, [entry.engine!]: event.target.checked ? 'internal' : 'custom' },
                              })
                           }
                        />{' '}
                        Use Internal Recovery Container ({entry.engine})
                     </label>
                  )}
               {entry.engine === 'mysql' && (
                  <p>Oracle MySQL requires the genuine worker. Internal additionally requires the approved automatic host operator.</p>
               )}
               {!restore && <p role="status">{recoveryDestinationStatus(preview, selection, entry.engine)}</p>}
            </div>
         ))}
         {resourceSafety.map((safety) => (
            <InternalResourceWarning
               key={safety.engine}
               id={`${resourceId}-${safety.engine}`}
               safety={safety}
               resources={preview.resources}
               workloadBusy={Object.values(preview.workloads).some(Boolean) || preview.internalTargets.some((target) => target.engine === safety.engine && target.status === 'running')}
            />
         ))}
         <h4>Measured server resources</h4>
         <p>
            Current workloads: Backup {preview.workloads.backup ? 'Running' : 'Not active'} · Restore{' '}
            {preview.workloads.restore ? 'Running' : 'Not active'} · Recovery {preview.workloads.recovery ? 'Running' : 'Not active'}. Native imports
            wait for existing work; capacity is checked again before execution.
         </p>
         {preview.resources.status === 'measured' && sample ? (
            <div className={classes.detail}>
               <div>
                  Host RAM: {formatBytes(sample.total)} · Available: {formatBytes(sample.available)} · Swap used: {formatBytes(sample.swapUsed)}
               </div>
               <div>
                  Memory pressure avg10: {sample.pressure}% · Server cgroup: {formatBytes(sample.used)} /{' '}
                  {sample.limit ? formatBytes(sample.limit) : 'Unknown/unbounded'}
               </div>
               <div>
                  Free staging storage: {formatBytes(sample.diskAvailable)} · Measured: {new Date(preview.resources.observedAt).toLocaleString()}
               </div>
            </div>
         ) : (
            <p role="alert">Capacity unknown — not a safety approval. Internal admission fails closed.</p>
         )}
         <p role="alert">
            Limited resources: an Internal engine needs additional RAM and storage. Large imports may affect backup availability. A checkbox cannot
            override server limits or the operator SQL budget (default 128 MiB).
         </p>
         <p>
            {preview.lifecycle === 'automatic'
               ? 'The installed host operator automatically provisions a disposable Internal target after admission.'
               : 'Lifecycle is operator-managed, not automatic container startup/shutdown. An approved target must already be active.'}{' '}
            After testing, database/workspace cleanup and the exact operator removal receipt are mandatory before Passed. Disposable targets are never
            retained as persistent restores.
         </p>
         <p>
            One native import/test at a time. All recorded databases are included; partial tests are not offered. Saved plan policies and after-backup
            automation are unchanged.
         </p>
         <button type="button" disabled={pending} onClick={refresh}>
            Refresh snapshot and resource checks
         </button>
         {!restore && (
            <label>
               <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(event) => setAcknowledgedToken(event.target.checked ? preview.metadataToken : undefined)}
               />{' '}
               I understand the additional resource usage and required cleanup. This is not a resource override.
            </label>
         )}
         <button
            type="button"
            aria-describedby={resourceSafety.map((safety) => `${resourceId}-${safety.engine}`).join(' ') || undefined}
            disabled={restore || pending || !canConfirmRecovery(preview, selection, acknowledged)}
            onClick={() => confirm(recoveryConfirmationBody(preview, selection))}
         >
            {restore ? 'Database Restore — Not Available' : pending ? 'Queuing…' : 'Run Recovery Test'}
         </button>
         {restore && (
            <p>
               Use the existing Restore to Staging or Download action to extract the original SQL. Staged SQL is not a running restored database.
               Restore Management/inspection/delete are not available until a persistent executor is reviewed.
            </p>
         )}
      </div>
   );
}
export default function RecoveryConfirmation({
   planId,
   backupId,
   snapshotId,
   operation,
   pending,
   close,
   confirm,
}: {
   planId: string;
   backupId: string;
   snapshotId: string;
   operation: 'test' | 'restore';
   pending: boolean;
   close: () => void;
   confirm: Confirm;
}) {
   const preview = useRecoveryPreparation(planId, backupId, snapshotId);
   return (
      <Modal
         width="820px"
         stableLayout
         closeDisabled={pending}
         title={operation === 'test' ? 'Confirm Recovery Test' : 'Restore Database — availability'}
         closeModal={close}
      >
         <RequestActivity checking={preview.isFetching} submitting={pending} failed={!!preview.error} />
         {preview.error && (
            <div role="alert">
               {preview.error.message}
               <button onClick={() => void preview.refetch()}>Retry preparation</button>
            </div>
         )}
         {preview.data && (
            <RecoveryConfirmationContent
               key={`${preview.data.planId}:${preview.data.backupId}:${preview.data.snapshotId}:${operation}`}
               preview={preview.data}
               operation={operation}
               pending={pending || preview.isFetching || !!preview.error}
               confirm={confirm}
               refresh={() => void preview.refetch()}
               checking={preview.isFetching}
            />
         )}
      </Modal>
   );
}
