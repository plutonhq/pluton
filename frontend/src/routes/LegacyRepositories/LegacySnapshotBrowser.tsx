import { useEffect, useMemo, useState } from 'react';
import { toast } from 'react-toastify';
import type { LegacyRepositorySnapshot, LegacySnapshotEntry } from '../../@types/legacyRepositories';
import ActionModal from '../../components/common/ActionModal/ActionModal';
import Icon from '../../components/common/Icon/Icon';
import Modal from '../../components/common/Modal/Modal';
import {
   useCancelLegacyRestore,
   useCreateLegacyRestore,
   useDownloadLegacyRestoredFile,
   useLegacyRestoreJob,
   useLegacySnapshotDirectory,
} from '../../services/legacyRepositories';
import { formatBytes, formatDateTime } from '../../utils/helpers';
import classes from './LegacyRepositories.module.scss';

const MAX_SELECTED_PATHS = 20;

type LegacySnapshotBrowserProps = {
   repositoryId: string;
   snapshot: LegacyRepositorySnapshot;
   close: () => void;
};

const getBreadcrumbs = (snapshotPath: string) => {
   const segments = snapshotPath.split('/').filter(Boolean);
   return [
      { label: 'Root', path: '' },
      ...segments.map((segment, index) => ({
         label: segment,
         path: segments.slice(0, index + 1).join('/'),
      })),
   ];
};

const isRestorable = (entry: LegacySnapshotEntry) => entry.type === 'file' || entry.type === 'directory';

const entryIcon = (entry: LegacySnapshotEntry) => {
   if (entry.type === 'directory') return 'folder-open';
   if (entry.type === 'symlink') return 'link';
   return 'file';
};

const LegacySnapshotBrowser = ({ repositoryId, snapshot, close }: LegacySnapshotBrowserProps) => {
   const [currentPath, setCurrentPath] = useState('');
   const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
   const [showConfirmation, setShowConfirmation] = useState(false);
   const [restoreJobId, setRestoreJobId] = useState<string>();
   const treeQuery = useLegacySnapshotDirectory(repositoryId, snapshot.id, currentPath);
   const restoreMutation = useCreateLegacyRestore();
   const cancelMutation = useCancelLegacyRestore();
   const downloadMutation = useDownloadLegacyRestoredFile();
   const restoreJobQuery = useLegacyRestoreJob(repositoryId, restoreJobId);
   const tree = treeQuery.data?.result;
   const restoreJob = restoreJobQuery.data?.result;
   const breadcrumbs = useMemo(() => getBreadcrumbs(currentPath), [currentPath]);

   useEffect(() => {
      setCurrentPath('');
      setSelectedPaths([]);
      setShowConfirmation(false);
      setRestoreJobId(undefined);
   }, [repositoryId, snapshot.id]);

   const toggleSelection = (entry: LegacySnapshotEntry) => {
      if (!isRestorable(entry)) return;

      setSelectedPaths(current => {
         if (current.includes(entry.path)) {
            return current.filter(selectedPath => selectedPath !== entry.path);
         }

         if (current.some(selectedPath => entry.path.startsWith(`${selectedPath}/`))) {
            toast.info('A selected parent directory already includes this item.');
            return current;
         }

         const withoutDescendants = current.filter(selectedPath => !selectedPath.startsWith(`${entry.path}/`));
         if (withoutDescendants.length >= MAX_SELECTED_PATHS) {
            toast.info(`Select up to ${MAX_SELECTED_PATHS} files or directories for one staged restore.`);
            return current;
         }
         return [...withoutDescendants, entry.path].sort();
      });
   };

   const startRestore = () => {
      restoreMutation.mutate(
         {
            repositoryId,
            request: { snapshotId: snapshot.id, paths: selectedPaths },
         },
         {
            onSuccess: data => {
               setRestoreJobId(data.result.id);
               setShowConfirmation(false);
               setSelectedPaths([]);
               toast.info('Staged restore queued. The repository remains read-only.');
            },
            onError: (error: Error) => toast.error(error.message),
         }
      );
   };

   const cancelRestore = () => {
      if (!restoreJob) return;
      cancelMutation.mutate(
         { repositoryId, jobId: restoreJob.id },
         {
            onSuccess: () => toast.info('Restore cancellation requested.'),
            onError: (error: Error) => toast.error(error.message),
         }
      );
   };

   const downloadFile = (entry: LegacySnapshotEntry) => {
      if (!restoreJob || restoreJob.status !== 'completed' || entry.type !== 'file') return;
      downloadMutation.mutate(
         { repositoryId, jobId: restoreJob.id, path: entry.path },
         {
            onSuccess: () => toast.success('Restored file download started.'),
            onError: (error: Error) => toast.error(error.message),
         }
      );
   };

   const isActiveRestore = restoreJob?.status === 'queued' || restoreJob?.status === 'running';

   return (
      <>
         <Modal title={`Browse snapshot ${snapshot.shortId}`} width="1050px" closeModal={close} classNames={classes.browserModal}>
            <div className={classes.browserIntro}>
               <div>
                  <strong>READ ONLY REPOSITORY</strong>
                  <p>Browsing reads structured snapshot metadata. A selected restore writes only to an isolated Pluton staging area.</p>
               </div>
               <div className={classes.snapshotSummary}>
                  <span>{formatDateTime(snapshot.time)}</span>
                  <span>{snapshot.hostname || 'Unknown host'}</span>
                  <code>{snapshot.id}</code>
               </div>
            </div>

            <nav className={classes.breadcrumbs} aria-label="Snapshot path">
               {breadcrumbs.map((breadcrumb, index) => (
                  <span key={breadcrumb.path || 'root'}>
                     {index > 0 && <span className={classes.breadcrumbSeparator}>/</span>}
                     <button type="button" onClick={() => setCurrentPath(breadcrumb.path)} disabled={breadcrumb.path === currentPath}>
                        {breadcrumb.label}
                     </button>
                  </span>
               ))}
            </nav>

            <div className={classes.selectionBar}>
               <span>{selectedPaths.length ? `${selectedPaths.length} item${selectedPaths.length === 1 ? '' : 's'} selected` : 'Select files or directories to restore'}</span>
               <div>
                  {selectedPaths.length > 0 && (
                     <button className={classes.textButton} type="button" onClick={() => setSelectedPaths([])}>
                        Clear selection
                     </button>
                  )}
                  <button className={classes.primaryButton} type="button" disabled={selectedPaths.length === 0 || restoreMutation.isPending} onClick={() => setShowConfirmation(true)}>
                     <Icon type="restore" size={14} /> Restore selected to staging
                  </button>
               </div>
            </div>

            {treeQuery.isLoading && <div className={classes.browserLoading}><Icon type="loading" size={24} /></div>}
            {treeQuery.error && <p className={classes.safeError}>{(treeQuery.error as Error).message}</p>}
            {tree && (
               <div className={classes.browserTable} role="table" aria-label="Snapshot files">
                  <div className={`${classes.browserRow} ${classes.browserHeaderRow}`} role="row">
                     <span role="columnheader">Select</span>
                     <span role="columnheader">Name</span>
                     <span role="columnheader">Type</span>
                     <span role="columnheader">Size</span>
                     <span role="columnheader">Modified</span>
                     <span role="columnheader">Mode</span>
                     <span role="columnheader">Action</span>
                  </div>
                  {tree.entries.map(entry => {
                     const coveredBySelectedDirectory = selectedPaths.some(selectedPath => entry.path.startsWith(`${selectedPath}/`));
                     const entryIsSelected = selectedPaths.includes(entry.path);
                     const selectionDisabled = !isRestorable(entry) || coveredBySelectedDirectory;
                     return (
                        <div className={classes.browserRow} role="row" key={entry.path}>
                           <span role="cell">
                              <input
                                 type="checkbox"
                                 aria-label={`Select ${entry.path}`}
                                 checked={entryIsSelected || coveredBySelectedDirectory}
                                 disabled={selectionDisabled}
                                 onChange={() => toggleSelection(entry)}
                              />
                           </span>
                           <span className={classes.browserName} role="cell">
                              {entry.type === 'directory' ? (
                                 <button type="button" onClick={() => setCurrentPath(entry.path)}>
                                    <Icon type={entryIcon(entry)} size={15} /> {entry.name}
                                 </button>
                              ) : (
                                 <span><Icon type={entryIcon(entry)} size={15} /> {entry.name}</span>
                              )}
                              <small>{entry.path}</small>
                           </span>
                           <span role="cell">
                              <span className={`${classes.entryType} ${entry.isSymlink ? classes.symlink : ''}`}>{entry.type}</span>
                           </span>
                           <span role="cell">{entry.size === null ? '—' : formatBytes(entry.size)}</span>
                           <span role="cell">{entry.modifiedAt ? formatDateTime(entry.modifiedAt) : '—'}</span>
                           <span role="cell"><code>{entry.permissions || '—'}</code></span>
                           <span role="cell">
                              {entry.type === 'directory' && (
                                 <button className={classes.textButton} type="button" onClick={() => setCurrentPath(entry.path)}>Open</button>
                              )}
                              {entry.type === 'file' && restoreJob?.status === 'completed' && (
                                 <button className={classes.secondaryButton} type="button" disabled={downloadMutation.isPending} onClick={() => downloadFile(entry)}>
                                    <Icon type={downloadMutation.isPending ? 'loading' : 'download'} size={13} /> Download
                                 </button>
                              )}
                              {entry.type === 'symlink' && <small className={classes.unsafeEntry}>Not selectable</small>}
                           </span>
                        </div>
                     );
                  })}
                  {tree.entries.length === 0 && <p className={classes.emptyText}>This snapshot directory is empty.</p>}
               </div>
            )}

            {restoreJobQuery.error && <p className={classes.safeError}>{(restoreJobQuery.error as Error).message}</p>}
            {restoreJob && (
               <section className={classes.restoreJobPanel} aria-live="polite">
                  <div>
                     <span>Staged restore job</span>
                     <strong className={`${classes.restoreStatus} ${classes[`restore${restoreJob.status}`]}`}>{restoreJob.status}</strong>
                  </div>
                  <p>
                     {restoreJob.status === 'completed' && `Restored ${restoreJob.restoredFileCount ?? 0} file${restoreJob.restoredFileCount === 1 ? '' : 's'} (${formatBytes(restoreJob.restoredBytes ?? 0)}).`}
                     {restoreJob.status === 'queued' && 'Waiting to run in its isolated staging area.'}
                     {restoreJob.status === 'running' && 'Restoring selected paths into its isolated staging area.'}
                     {restoreJob.status === 'cancelled' && 'The staged restore was cancelled.'}
                     {restoreJob.status === 'failed' && (restoreJob.errorMessage || 'The staged restore failed safely.')}
                  </p>
                  {isActiveRestore && (
                     <button className={classes.secondaryButton} type="button" disabled={cancelMutation.isPending} onClick={cancelRestore}>
                        {cancelMutation.isPending ? <Icon type="loading" size={13} /> : null} Cancel restore
                     </button>
                  )}
               </section>
            )}
         </Modal>

         {showConfirmation && (
            <ActionModal
               title="Restore selected items to staging"
               closeModal={() => setShowConfirmation(false)}
               message={
                  <div>
                     <p>This restore reads the repository and writes only to an isolated staging area controlled by Pluton. It does not modify repository contents.</p>
                     <p><strong>Snapshot:</strong> <code>{snapshot.id}</code></p>
                     <p><strong>Selected paths:</strong></p>
                     <ul className={classes.restorePaths}>
                        {selectedPaths.map(selectedPath => <li key={selectedPath}><code>{selectedPath}</code></li>)}
                     </ul>
                  </div>
               }
               primaryAction={{
                  title: 'Restore to staging',
                  type: 'default',
                  icon: 'restore',
                  isPending: restoreMutation.isPending,
                  action: startRestore,
               }}
            />
         )}
      </>
   );
};

export default LegacySnapshotBrowser;
