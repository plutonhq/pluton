import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useDatabaseRestores, restoreRequest } from '../../services/databaseRestores';
import { restoreStatus, restoreStage, restoreActionNotice } from '../../utils/databaseRestores';
import { restoreProgress, stageLabel } from '../../utils/recoveryProgress';
import OperationProgress, { RequestActivity } from '../../components/common/OperationProgress/OperationProgress';
import type { DatabaseRestoreView } from '../../@types/databaseRestores';
import PageHeader from '../../components/common/PageHeader/PageHeader';
import { formatBytes } from '../../utils/helpers';
import classes from '../../components/Restore/DatabaseRestore/DatabaseRestore.module.scss';

export function RestoreDetails({
   row,
   act,
   pending,
}: {
   row: DatabaseRestoreView;
   act: (operation: string, body?: unknown) => void;
   pending: boolean;
}) {
   const [confirmation, setConfirmation] = useState('');
   const inspectable = row.status === 'active' && !row.expired && !row.cancelRequested;
   const progress = restoreProgress(row);
   const control =
      row.status === 'active'
         ? 'stop'
         : row.status === 'stopped' || (row.status === 'provisioning_required' && row.lifecycle?.state === 'stopped')
           ? 'resume'
           : row.status === 'provisioning_required'
             ? 'provision'
             : null;
   return (
      <div className={classes.card}>
         <h3>{restoreStatus(row)}</h3>
         <OperationProgress
            state={progress}
            start={row.createdAt}
            end={progress.busy ? undefined : row.status === 'deleted' ? row.lastValidatedAt : row.completedAt}
            timeLabel={row.status === 'active' || row.status === 'stopped' ? 'Restore preparation/import duration' : 'Elapsed since request'}
         />
         <p>
            {row.status === 'active' || row.status === 'stopped' ? 'Historical import stage' : 'Last backend restore stage'}:{' '}
            {restoreStage(row.stage)} · Cleanup: {row.cleanup}
            {row.errorCode && ` · Error: ${row.errorCode}`}
         </p>
         {row.failureCode && (
            <p role="status">
               Original failure: {row.failureStage || 'Not recorded'} / {row.failureCode}
            </p>
         )}
         <p>
            Restore: <code>{row.id}</code> · {row.mode} · {row.engine}
            <br />
            Exact snapshot: <code>{row.snapshotId}</code>
            <br />
            Backup: <code>{row.backupId}</code> · Repository: <code>{row.repositoryId}</code>
            <br />
            Archived database: {row.logicalDatabase} · Stable ID: <code>{row.databaseId}</code>
            <br />
            Retained database: {row.database || 'Not imported'}
            <br />
            Approved target: <code>{row.targetId}</code>
            <br />
            SQL: {formatBytes(row.sqlBytes)} · SHA-256: <code>{row.sha256}</code>
         </p>
         <p>
            Created {new Date(row.createdAt).toLocaleString()} · Expires {new Date(row.expiresAt).toLocaleString()}
            <br />
            Started: {row.startedAt ? new Date(row.startedAt).toLocaleString() : 'Not yet'} · Import validated:{' '}
            {row.completedAt ? new Date(row.completedAt).toLocaleString() : 'Not recorded'}
            <br />
            Last validated: {row.lastValidatedAt ? new Date(row.lastValidatedAt).toLocaleString() : 'Not yet'}
         </p>
         {row.mode === 'internal' && row.status !== 'deleted' && (
            <div className={classes.card}>
               <p>
                  {row.lifecycle
                     ? 'Automatic host-operator lifecycle. Successful restores remain retained until TTL or authorized Delete.'
                     : 'Lifecycle is manual operator-managed.'}{' '}
                  Buttons submit a bounded intent, not a Docker command or completion claim.
                  {row.lifecycle &&
                     ' Current host state: ' + stageLabel(row.lifecycle.state) + ' · Storage quota: ' + formatBytes(row.lifecycle.quotaBytes)}
               </p>
               <div style={{ minHeight: '3em' }}>
                  {control && (
                     <button disabled={pending || row.expired || row.cancelRequested} onClick={() => act(control, {})}>
                        {control === 'provision' ? 'Request provisioning' : control === 'stop' ? 'Request stop' : 'Request resume'}
                     </button>
                  )}
               </div>
               {(row.cancelRequested || row.expired) && (
                  <p>
                     {row.lifecycle
                        ? 'The automatic reconciler resumes only the exact owned target when required for database cleanup, then verifies infrastructure removal.'
                        : 'Cleanup Required: an operator may need to resume the target for ownership-checked database cleanup, then approve exact infrastructure removal.'}{' '}
                     No resource is considered Deleted from a missing connection.
                  </p>
               )}
               <p>
                  {row.lifecycle
                     ? 'If Cleanup Required persists, ask the host operator to verify exact ownership; unknown resources are never deleted automatically.'
                     : 'Ask the Linux operator to review this restore ID and its private request. See the persistent restore runbook.'}
               </p>
            </div>
         )}
         <button disabled={pending || !inspectable} onClick={() => act('inspect', {})}>
            Refresh metadata inspection
         </button>
         <p>
            No row data or SQL execution is exposed. Inspection is revoked at expiration. Import/catalog validation does not verify application
            recovery.
         </p>
         {row.mode === 'custom' && (
            <p>
               Custom Target: the successfully restored database is retained. Expiry or confirmed Delete removes only the database whose ownership
               marker matches this restore; it never removes the external database server or unrelated pre-existing data. The history record is
               retained.
            </p>
         )}
         {inspectable && row.inspection && (
            <div>
               <h4>Validated catalog</h4>
               <p>
                  {row.inspection.engine} {row.inspection.version} · {row.inspection.tables} tables · {row.inspection.views} views · Size{' '}
                  {row.inspection.bytes === null ? 'Not measurable' : formatBytes(row.inspection.bytes)} · Observed{' '}
                  {new Date(row.inspection.observedAt).toLocaleString()}
               </p>
               <div className={classes.scroll}>
                  <table>
                     <thead>
                        <tr>
                           <th>Schema</th>
                           <th>Name</th>
                           <th>Type</th>
                        </tr>
                     </thead>
                     <tbody>
                        {row.inspection.catalog.map((item) => (
                           <tr key={item.schema + ':' + item.name}>
                              <td>{item.schema}</td>
                              <td>{item.name}</td>
                              <td>{item.type}</td>
                           </tr>
                        ))}
                     </tbody>
                  </table>
               </div>
               {row.inspection.catalogTruncated && <p>Catalog display limited to 200 entries; counts cover all entries.</p>}
            </div>
         )}
         {row.status !== 'deleted' && (
            <div className={classes.card}>
               <h4>Delete / cancel this restore</h4>
               <p>
                  Deletes only the exact owned restored database and requests owned infrastructure removal. Original backups and snapshots are
                  untouched. Uncertain resources are retained for investigation.
               </p>
               <label>
                  Type the exact restore ID
                  <input
                     aria-label="Restore ID confirmation"
                     value={confirmation}
                     onChange={(event) => setConfirmation(event.target.value)}
                     autoComplete="off"
                  />
               </label>
               <button disabled={pending || confirmation !== row.id} onClick={() => act('delete', { confirmation })}>
                  Confirm owned deletion
               </button>
            </div>
         )}
      </div>
   );
}
export default function DatabaseRestores() {
   const { id } = useParams(),
      query = useDatabaseRestores(id),
      client = useQueryClient();
   const action = useMutation({
      mutationFn: ({ operation, body }: { operation: string; body?: unknown }) =>
         restoreRequest(`/${encodeURIComponent(id!)}/${operation}`, body || {}),
      onSuccess: () => client.invalidateQueries({ queryKey: ['databaseRestores'] }),
   });
   const [notice, setNotice] = useState('');
   const act = (operation: string, body?: unknown) => {
      setNotice('');
      action.mutate(
         { operation, body },
         {
            onSuccess: () => setNotice(restoreActionNotice(operation, !!(query.data && !Array.isArray(query.data) && query.data.lifecycle))),
         },
      );
   };
   return (
      <>
         <PageHeader title="Database Restore Management" icon="restore" />
         <div className={classes.panel}>
            <p>Retained restores are separate from disposable Recovery Tests. Start a restore from a completed backup’s menu.</p>
            {id && <Link to="/database-restores">All restores</Link>}
            <button disabled={query.isFetching} onClick={() => void query.refetch()}>
               Refresh
            </button>
            {(query.isLoading || action.isPending) && <RequestActivity checking={query.isLoading} submitting={action.isPending} />}
            {query.error && <p role="alert">{query.error.message}</p>}
            {action.error && <p role="alert">{action.error.message}</p>}
            {notice && <p role="status">{notice}</p>}
            {query.data &&
               (Array.isArray(query.data) ? (
                  <>
                     {!query.data.length && <p>No persistent database restores yet.</p>}
                     {query.data.map((row) => (
                        <div key={row.id} className={classes.card}>
                           <Link to={`/database-restores/${row.id}`}>
                              {row.logicalDatabase} · {row.engine} · {row.mode}
                           </Link>
                           <p>
                              {restoreStatus(row)} · Cleanup: {row.cleanup}
                              <br />
                              Expires {new Date(row.expiresAt).toLocaleString()} · <code>{row.id}</code>
                           </p>
                        </div>
                     ))}
                  </>
               ) : (
                  <RestoreDetails key={query.data.id} row={query.data} act={act} pending={action.isPending} />
               ))}
         </div>
      </>
   );
}
