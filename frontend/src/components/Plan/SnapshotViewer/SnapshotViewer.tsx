import { useState, useCallback, useEffect, useMemo, useRef, ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'react-toastify';
import Icon from '../../common/Icon/Icon';
import FileIcon from '../../common/FileIcon/FileIcon';
import Select from '../../common/form/Select/Select';
import ActionModal from '../../common/ActionModal/ActionModal';
import { Backup, BackupMirror } from '../../../@types/backups';
import { useRestoreBackup } from '../../../services/restores';
import { useSnapshotEntries } from '../../../services/backups';
import { FileItem } from '../../../@types/system';
import { isMobile, formatBytes, timeAgo } from '../../../utils/helpers';
import SnapshotBrowserToolbar from '../../common/SnapshotBrowser/SnapshotBrowserToolbar';
import SnapshotBrowserDirectories from '../../common/SnapshotBrowser/SnapshotBrowserDirectories';
import SnapshotBrowserFileList from '../../common/SnapshotBrowser/SnapshotBrowserFileList';
import SnapshotIndexProgress from '../../common/SnapshotBrowser/SnapshotIndexProgress';
import SnapshotViewerFile from './SnapshotViewerFile';
import { useSnapshotIndexTree } from '../../common/SnapshotBrowser/hooks/useSnapshotIndexTree';
import { useSnapshotNavigation } from '../../common/SnapshotBrowser/hooks/useSnapshotNavigation';
import { useSnapshotSort } from '../../common/SnapshotBrowser/hooks/useSnapshotSort';
import classes from '../../common/SnapshotBrowser/SnapshotBrowser.module.scss';
import Upgrade from '../../Upgrade/Upgrade';

interface SnapshotViewerProps {
   backup: Backup;
   planId: string;
   isSync?: boolean;
   mirrors?: BackupMirror[];
   onClose: () => void;
   replicationId?: string;
   toolbarLeftContent?: ReactNode;
   toolbarRightContent?: ReactNode;
   isExternalLoading?: boolean;
   /** Render additional action buttons per file row (e.g. View, Download, Compare in Pro). */
   renderFileActions?: (file: FileItem, meta: { fileExtension: string; isDirectory: boolean }) => ReactNode;
   /** Hides the per-file Restore action. */
   hideRestore?: boolean;
   /** Extra elements rendered at the end (e.g. BackupFileLoader modal in Pro). */
   children?: ReactNode;
   primaryStorage?: { id: string; type: string; name: string };
   /** Called when the user selects a different storage mirror. Receives the replicationId (or undefined for primary). */
   onStorageChange?: (replicationId: string | undefined) => void;
}

const isMobileDevice = isMobile();
const GRID_COLUMNS = '1fr 120px minmax(100px, auto) 120px';
const GRID_COLUMNS_SYNC = '1fr 120px minmax(100px, auto)';
const SEARCH_DELAY = 300;
const GO_UP_ROW = { isGoUp: true, path: '..', name: '..', isDirectory: true } as any;

const SnapshotViewer = ({
   backup,
   planId,
   isSync = false,
   mirrors,
   onClose,
   replicationId,
   toolbarLeftContent,
   toolbarRightContent,
   isExternalLoading,
   renderFileActions,
   hideRestore = false,
   children,
   primaryStorage,
   onStorageChange,
}: SnapshotViewerProps) => {
   const [search, setSearch] = useState('');
   const [indexSearch, setIndexSearch] = useState('');
   const [showRestoreModal, setShowRestoreModal] = useState<FileItem | false>(false);
   const [selectedReplicationId, setSelectedReplicationId] = useState<string | undefined>(replicationId);
   const [showUpgrade, setShowUpgrade] = useState<boolean>(false);
   const fileListRef = useRef<HTMLDivElement | null>(null);
   const navigate = useNavigate();

   const backupId = backup.id;
   const restoreMutation = useRestoreBackup();

   const indexTree = useSnapshotIndexTree({ backupId, replicationId: selectedReplicationId });
   const { status: indexStatus, builtAt, restartIndex, discoveredDirectories, expandedFolders, setExpandedFolders } = indexTree;

   const { selectedFolder, setSelectedFolder, handleGoUp, handleDirectoryClick, toggleFolder, isVisible } = useSnapshotNavigation(
      discoveredDirectories,
      expandedFolders,
      setExpandedFolders,
   );

   const { sortField, sortDirection, handleSort } = useSnapshotSort();

   const handleStorageChange = useCallback(
      (replicationIdValue?: string) => {
         setSelectedReplicationId(replicationIdValue);
         onStorageChange?.(replicationIdValue);
         setSelectedFolder('');
      },
      [onStorageChange, setSelectedFolder],
   );

   // Build storage selector for toolbar
   const completedMirrors = mirrors?.filter((m) => m.status === 'completed') || [];
   const showStorageDropdown = primaryStorage && completedMirrors.length > 0;

   const storageSelector = showStorageDropdown ? (
      <Select
         customClasses={classes.storageSelect}
         options={[
            { label: primaryStorage!.name + ' (Primary)', value: 'primary', image: <img src={`/providers/${primaryStorage.type}.png`} /> },
            ...completedMirrors.map((m) => ({
               label: m.storageName + ' (Mirror)',
               value: m.replicationId,
               image: <img src={`/providers/${m.storageType}.png`} />,
            })),
         ]}
         fieldValue={selectedReplicationId || 'primary'}
         onUpdate={(value) => handleStorageChange(value === 'primary' ? undefined : value)}
      />
   ) : undefined;

   useEffect(() => {
      const timer = setTimeout(() => setIndexSearch(search.trim()), SEARCH_DELAY);
      return () => clearTimeout(timer);
   }, [search]);

   const entriesQuery = useSnapshotEntries({
      backupId,
      replicationId: selectedReplicationId,
      builtAt,
      dir: selectedFolder,
      sort: sortField,
      order: sortDirection,
      q: indexSearch,
      enabled: builtAt !== undefined,
   });
   const { data: entriesData, error: entriesError, hasNextPage, isFetchingNextPage, fetchNextPage } = entriesQuery;

   useEffect(() => {
      if (entriesError?.message === 'index_not_ready') restartIndex();
   }, [entriesError, restartIndex]);

   const currentDirectoryFiles = useMemo(() => {
      const rows = entriesData?.pages.flatMap((page) => page.rows) ?? [];
      return selectedFolder ? [GO_UP_ROW, ...rows] : rows;
   }, [entriesData, selectedFolder]);

   const loadMoreEntries = useCallback(() => {
      if (hasNextPage && !isFetchingNextPage) fetchNextPage();
   }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

   const isDirectoryLoading = entriesQuery.isFetching;
   const showIndexProgress = indexStatus?.state !== 'ready';

   // Restore handler
   const restoreFile = (path: string) => {
      restoreMutation.mutate(
         {
            backupId,
            planId,
            target: '',
            includes: [path],
            overwrite: 'always',
            deleteOption: false,
            replicationId: selectedReplicationId,
         },
         {
            onSuccess: (_: any, variables) => {
               toast.success('Restoration Process Started..', { autoClose: 5000 });
               const targetPlanId = variables?.planId;
               if (targetPlanId) {
                  navigate(`/plan/${targetPlanId}?pendingrestore=1`);
               }
               onClose();
            },
            onError: (error) => {
               console.error('Restore error:', error);
               toast.error(`Restore failed. ${error.message || 'Unknown error'}`);
            },
            onSettled: () => {
               setShowRestoreModal(false);
            },
         },
      );
   };

   // File row renderer
   const gridColumns = isSync ? GRID_COLUMNS_SYNC : GRID_COLUMNS;

   const renderFileRow = useCallback(
      ({ index, style }: { index: number; style: React.CSSProperties }) => {
         const file = currentDirectoryFiles[index];
         if (!file) return null;

         return (
            <SnapshotViewerFile
               style={style}
               file={file}
               isSync={isSync}
               gridColumns={gridColumns}
               onGoUp={handleGoUp}
               onDirectoryClick={handleDirectoryClick}
               onRestore={(file) => setShowRestoreModal(file)}
               renderFileActions={renderFileActions}
               hideRestore={hideRestore}
               showUpgradeModal={() => setShowUpgrade(true)}
            />
         );
      },
      [currentDirectoryFiles, isSync, gridColumns, handleGoUp, handleDirectoryClick, renderFileActions, hideRestore],
   );

   const defaultToolbarLeft = (
      <div className={classes.stats}>
         <Icon type="box" />
         <strong>backup-{backup.id}</strong> • {formatBytes(backup.totalSize)} • {timeAgo(new Date(backup.ended))}
      </div>
   );

   return (
      <div className={classes.snapshotBrowser}>
         <SnapshotBrowserToolbar
            search={search}
            onSearchChange={setSearch}
            isLoading={isDirectoryLoading || isExternalLoading}
            leftContent={toolbarLeftContent || defaultToolbarLeft}
            rightContent={
               <>
                  {storageSelector}
                  {toolbarRightContent}
               </>
            }
         />

         {showIndexProgress ? (
            <div className={`${classes.browserContent} ${classes.loadingState}`}>
               <SnapshotIndexProgress status={indexStatus} error={indexTree.statusError} onRetry={() => restartIndex()} />
            </div>
         ) : isExternalLoading ? (
            <div className={`${classes.browserContent} ${classes.loadingState}`}>
               <div>
                  <Icon type="loading" size={16} /> Loading...
               </div>
            </div>
         ) : (
            <div className={classes.browserContent}>
               <SnapshotBrowserDirectories
                  directories={discoveredDirectories}
                  selectedFolder={selectedFolder}
                  expandedFolders={expandedFolders}
                  useProgressiveLoading={indexTree.isLoadingDirectories}
                  onDirectoryClick={handleDirectoryClick}
                  onToggleFolder={toggleFolder}
                  isVisible={isVisible}
                  hasSubdirectories={indexTree.hasSubdirectories}
                  totalDirectories={indexStatus?.state === 'ready' ? indexStatus.stats.dirs : undefined}
                  emptyMessage={indexTree.directoriesError?.message}
                  loadMoreAfter={indexTree.loadMoreAfter}
                  onLoadMore={indexTree.loadMoreDirectories}
                  isLoadingMore={indexTree.isLoadingDirectories}
               />

               <div className={`${classes.content} styled__scrollbar`} ref={fileListRef}>
                  <SnapshotBrowserFileList
                     files={currentDirectoryFiles}
                     height={fileListRef.current?.clientHeight ? fileListRef.current.clientHeight - 45 : 520}
                     itemSize={isMobileDevice ? 65 : 46}
                     headerContent={
                        <>
                           <div onClick={() => handleSort('name')} className={sortField === 'name' ? classes.activeSort : ''}>
                              Name {sortField === 'name' && (sortDirection === 'asc' ? '↑' : '↓')}
                           </div>
                           <div onClick={() => handleSort('modifiedAt')} className={sortField === 'modifiedAt' ? classes.activeSort : ''}>
                              Last Modified {sortField === 'modifiedAt' && (sortDirection === 'asc' ? '↑' : '↓')}
                           </div>
                           <div onClick={() => handleSort('size')} className={sortField === 'size' ? classes.activeSort : ''}>
                              Size {sortField === 'size' && (sortDirection === 'asc' ? '↑' : '↓')}
                           </div>
                           {!isSync && <div className={classes.headerActions}>Actions</div>}
                        </>
                     }
                     renderRow={renderFileRow}
                     selectedFolder={selectedFolder}
                     isLoading={isDirectoryLoading}
                     error={!entriesData ? entriesError?.message : undefined}
                     gridTemplateColumns={gridColumns}
                     onNearEnd={loadMoreEntries}
                  />
               </div>
            </div>
         )}

         {showRestoreModal && (
            <ActionModal
               title={`Restore ${showRestoreModal.isDirectory ? 'Directory' : 'File'}`}
               message={
                  <>
                     <p>Are you sure you want to restore this {showRestoreModal.isDirectory ? 'Directory' : 'File'}?</p>
                     <p className={classes.restoreModalFile}>
                        {showRestoreModal.isDirectory ? <Icon type={'fm-directory'} size={16} /> : <FileIcon filename={showRestoreModal.path} />}{' '}
                        {showRestoreModal.path}
                     </p>
                     <p>This action will overwrite the existing file/directory with the same name in the source.</p>
                  </>
               }
               closeModal={() => setShowRestoreModal(false)}
               width="600px"
               primaryAction={{
                  title: `Yes, Restore ${showRestoreModal.isDirectory ? 'Directory' : 'File'}`,
                  type: 'default',
                  isPending: restoreMutation.isPending,
                  action: () => restoreFile(showRestoreModal.path),
               }}
            />
         )}

         {children}
         {showUpgrade && <Upgrade focus="snapshot" onClose={() => setShowUpgrade(false)} />}
      </div>
   );
};

export default SnapshotViewer;
