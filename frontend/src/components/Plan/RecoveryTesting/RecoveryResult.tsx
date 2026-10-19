import type { RecoveryTest } from '../../../@types/recoveryTests';
import { recoveryActive, recoveryStatusLabel, recoveryStatusExplanation, databaseImportLabel } from '../../../utils/recoveryTests';
import { formatBytes } from '../../../utils/helpers';
import Modal from '../../common/Modal/Modal';
import classes from './RecoveryTesting.module.scss';
import { restoreStage } from '../../../utils/databaseRestores';
import { recoveryProgress } from '../../../utils/recoveryProgress';
import OperationProgress from '../../common/OperationProgress/OperationProgress';
export default function RecoveryResult({
   test,
   close,
   cancel,
   pending,
}: {
   test: RecoveryTest;
   close: () => void;
   cancel: () => void;
   pending: boolean;
}) {
   const progress = recoveryProgress(test);
   return (
      <Modal width="760px" title="Recovery Test Result" closeModal={close} stableLayout>
         <div className={`${classes.panel} styled__scrollbar`}>
            <OperationProgress state={progress} start={test.createdAt} end={progress.busy ? undefined : test.completedAt} />
            <div className={classes.detail}>
               <div>
                  Backup: <code>{test.backupId}</code>
               </div>
               <div>
                  Test: <code>{test.id}</code> · {test.trigger === 'manual' ? 'Manual' : 'After backup'}
               </div>
               <div>
                  Exact snapshot: <code>{test.snapshotId}</code>
               </div>
               <div>Backend recovery status: {recoveryStatusLabel[test.status]}</div>
               {test.stage && <div>Last reported stage: {restoreStage(test.stage)}</div>}
               <div>Tested at: {test.completedAt ? new Date(test.completedAt).toLocaleString() : 'Not completed'}</div>
               {test.failureCode && (
                  <div role="alert">
                     {test.failureStage} / {test.failureCode}
                  </div>
               )}
            </div>
            {recoveryStatusExplanation[test.status] && <p>{recoveryStatusExplanation[test.status]}</p>}
            <h4>Filesystem</h4>
            {test.result?.filesystem ? (
               <p>
                  Exact snapshot restored and structurally validated: {test.result.filesystem.files} regular files ·{' '}
                  {formatBytes(test.result.filesystem.bytes)} · {test.result.filesystem.sourceTrees} source trees.
               </p>
            ) : (
               <p>Not yet validated.</p>
            )}
            <p>Restic restore integrity and file/path/size checks are not application semantic checks or per-file hash comparisons.</p>
            <h4>Databases</h4>
            {test.result?.databases.map((database) => (
               <div key={database.path} className={classes.card}>
                  <div>
                     {database.engine || 'Historical engine not recorded'} · {database.databaseId || 'Historical single-DB artifact'} ·{' '}
                     {database.database || database.path}
                  </div>
                  <div>
                     Artifact integrity: {database.artifactValidation === 'passed' ? 'PASSED' : database.artifactValidation} ·{' '}
                     {formatBytes(database.bytes)}
                  </div>
                  <code>SHA-256: {database.sha256}</code>
                  <div>
                     {databaseImportLabel(database.importValidation)} {database.failureCode && `· ${database.failureCode}`}
                  </div>
                  <div>
                     Version check:{' '}
                     {database.versionValidation === 'header-and-target-checked'
                        ? 'Recorded-engine SQL header and actual target checked; not an application compatibility guarantee'
                        : 'Source/dump version not recorded or not reported by worker v1 — compatibility not certified'}
                  </div>
                  {database.importValidation === 'passed' && database.tables !== undefined && (
                     <div>
                        Catalog verified: {database.tables} tables · {database.views || 0} views
                     </div>
                  )}
               </div>
            ))}
            {!test.result?.databases.length && <p>No database artifact checks recorded.</p>}
            <h4>Cleanup</h4>
            {test.result?.internalEngine && (
               <p>
                  Internal {test.result.internalEngine} infrastructure:{' '}
                  {test.result.cleanup.infrastructure
                     ? 'Complete — owned removal verified'
                     : 'Cleanup pending — awaiting ownership-verified host removal'}
                  . SQL/catalog success alone is not a completed recovery test.
               </p>
            )}
            <p>
               Workspace: {test.result?.cleanup.workspace ? 'Complete' : 'Not confirmed'} · Temporary databases:{' '}
               {test.result?.cleanup.databases ? 'Complete' : 'Not confirmed'}
            </p>
            {test.warnings.map((warning, index) => (
               <p key={index}>
                  {warning.stage} / {warning.code}
               </p>
            ))}
            {recoveryActive(test) && (
               <button type="button" disabled={pending} onClick={cancel}>
                  Cancel Recovery Test
               </button>
            )}
            <p>Closing this view does not cancel the server-side job. Backup status is unchanged by its recovery result.</p>
         </div>
      </Modal>
   );
}
