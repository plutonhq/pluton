import { useState, useCallback, useRef, ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { toast } from 'react-toastify';
import Icon from '../../common/Icon/Icon';
import FileIcon from '../../common/FileIcon/FileIcon';
import Select from '../../common/form/Select/Select';
import ActionModal from '../../common/ActionModal/ActionModal';
import { Backup, BackupMirror } from '../../../@types/backups';
import { useRestoreBackup } from '../../../services/restores';
import { useBrowseSnapshot } from '../../../services/backups';
import { FileItem } from '../../../@types/system';
import { isMobile, formatBytes, timeAgo } from '../../../utils/helpers';
import SnapshotBrowserToolbar from '../../common/SnapshotBrowser/SnapshotBrowserToolbar';
import SnapshotBrowserDirectories from '../../common/SnapshotBrowser/SnapshotBrowserDirectories';
import SnapshotBrowserFileList from '../../common/SnapshotBrowser/SnapshotBrowserFileList';
import SnapshotViewerFile from './SnapshotViewerFile';
import { useSnapshotDatabase } from '../../common/SnapshotBrowser/hooks/useSnapshotDatabase';
import { useSnapshotNavigation } from '../../common/SnapshotBrowser/hooks/useSnapshotNavigation';
import { useSnapshotSort } from '../../common/SnapshotBrowser/hooks/useSnapshotSort';
import classes from '../../common/SnapshotBrowser/SnapshotBrowser.module.scss';

interface SnapshotViewerProps {
   files: FileItem[];
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
   /** Extra elements rendered at the end (e.g. BackupFileLoader modal in Pro). */
   children?: ReactNode;
   primaryStorage?: { id: string; type: string; name: string };
   /** Called when the user selects a different storage mirror. Receives the replicationId (or undefined for primary). */
   onStorageChange?: (replicationId: string | undefined) => void;
}

const isMobileDevice = isMobile();
const GRID_COLUMNS = '1fr 120px minmax(100px, auto) 120px';
const GRID_COLUMNS_SYNC = '1fr 120px minmax(100px, auto)';

const SnapshotViewer = ({
   files,
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
   children,
   primaryStorage,
   onStorageChange,
}: SnapshotViewerProps) => {
   const [search, setSearch] = useState('');
   const [showRestoreModal, setShowRestoreModal] = useState<FileItem | false>(false);
   const [selectedReplicationId, setSelectedReplicationId] = useState<string | undefined>(replicationId);
   const [currentFiles, setCurrentFiles] = useState<FileItem[]>(files);
   const fileListRef = useRef<HTMLDivElement | null>(null);
   const navigate = useNavigate();

   const backupId = backup.id;
   const restoreMutation = useRestoreBackup();
   const browseSnapshotMutation = useBrowseSnapshot();
   const useProgressiveLoading = currentFiles.length > 1000;

   const { db, initError, discoveredDirectories, expandedFolders, setExpandedFolders, addDirectoriesSorted } = useSnapshotDatabase(
      currentFiles,
      backupId,
      useProgressiveLoading,
   );

   const { selectedFolder, handleGoUp, handleDirectoryClick, toggleFolder, isVisible, hasSubdirectories } = useSnapshotNavigation(
      discoveredDirectories,
      expandedFolders,
      setExpandedFolders,
   );

   const { sortField, sortDirection, handleSort } = useSnapshotSort();

   // Handle storage change - re-browse from selected mirror
   const handleStorageChange = useCallback(
      (replicationIdValue?: string) => {
         setSelectedReplicationId(replicationIdValue);
         onStorageChange?.(replicationIdValue);
         if (replicationIdValue) {
            browseSnapshotMutation.mutate(
               { backupId: backup.id, replicationId: replicationIdValue },
               {
                  onSuccess: (data: any) => {
                     if (data?.result) {
                        setCurrentFiles(data.result);
                     }
                  },
               },
            );
         } else {
            setCurrentFiles(files);
         }
      },
      [backup.id, files, browseSnapshotMutation, onStorageChange],
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
         disabled={browseSnapshotMutation.isPending}
      />
   ) : undefined;

   // Directory contents query
   const directoryContentsQuery = useQuery({
      queryKey: ['directoryContents', selectedFolder, sortField, sortDirection, search, backupId],
      queryFn: async () => {
         if (!db || selectedFolder === null) return [];

         const contents = await db.getDirectoryContents(selectedFolder, sortField, sortDirection, search);

         if (useProgressiveLoading) {
            const subdirs = await db.getSubdirectories(selectedFolder);
            if (subdirs.length > 0) {
               addDirectoriesSorted(subdirs);
            }
         }

         if (selectedFolder) {
            return [{ isGoUp: true, path: '..', name: '..', isDirectory: true } as any, ...contents];
         }

         return contents;
      },
      enabled: !!db && selectedFolder !== null,
      staleTime: 30000,
      retry: 1,
   });

   const currentDirectoryFiles = directoryContentsQuery.data || [];
   const isInitializing = !db && !initError;
   const isDirectoryLoading = directoryContentsQuery.isPending;

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
            />
         );
      },
      [currentDirectoryFiles, isSync, gridColumns, handleGoUp, handleDirectoryClick, renderFileActions],
   );

   // Error state
   if (initError) {
      return (
         <div className={classes.snapshotBrowser}>
            <div className={classes.errorState}>
               <Icon type="error" size={24} />
               <p>Failed to initialize database</p>
               <small>{initError}</small>
               <button onClick={() => window.location.reload()}>Reload Page</button>
            </div>
         </div>
      );
   }

   // Loading state
   if (isInitializing) {
      return (
         <div className={classes.snapshotBrowser}>
            <div className={classes.loadingState}>
               <Icon type="loading" size={24} />
               <p>Indexing snapshot data...</p>
               <small>Building efficient database for {files.length.toLocaleString()} files</small>
            </div>
         </div>
      );
   }

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
            isLoading={isDirectoryLoading || isExternalLoading || browseSnapshotMutation.isPending}
            leftContent={toolbarLeftContent || defaultToolbarLeft}
            rightContent={
               <>
                  {storageSelector}
                  {toolbarRightContent}
               </>
            }
         />

         {isExternalLoading || browseSnapshotMutation.isPending ? (
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
                  useProgressiveLoading={useProgressiveLoading}
                  onDirectoryClick={handleDirectoryClick}
                  onToggleFolder={toggleFolder}
                  isVisible={isVisible}
                  hasSubdirectories={hasSubdirectories}
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
                     gridTemplateColumns={gridColumns}
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
      </div>
   );
};

export default SnapshotViewer;
