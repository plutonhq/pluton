import { useState, useMemo, useEffect } from 'react';
import Icon from '../../common/Icon/Icon';
import FileIcon from '../../common/FileIcon/FileIcon';
import classes from './RestoredFileBrowser.module.scss';
import { RestoredFileItem, RestoredItemsStats } from '../../../@types/restores';
import { formatBytes, formatNumberToK, isMobile } from '../../../utils/helpers';
import { getParentPath, getPathSeparator, normalizePath, splitPath } from '../../../utils/restore';
import { SnapshotBrowserToolbar, SnapshotBrowserDirectories, SnapshotBrowserFileList, SnapshotBrowserGoUpRow } from '../../common/SnapshotBrowser';
import { useSnapshotNavigation } from '../../common/SnapshotBrowser/hooks/useSnapshotNavigation';
import sbClasses from '../../common/SnapshotBrowser/SnapshotBrowser.module.scss';

interface RestoredFileBrowserProps {
   files: RestoredFileItem[];
   stats?: RestoredItemsStats;
   isPreview?: boolean;
}

const isMobileDevice = isMobile();
const ITEM_HEIGHT = isMobileDevice ? 65 : 45;
const GRID_COLUMNS = '1fr 100px minmax(80px, auto)';

const RestoredFileBrowser = ({ files, stats, isPreview = false }: RestoredFileBrowserProps) => {
   const [search, setSearch] = useState('');
   const [filters, setFilters] = useState({
      unchanged: true,
      restored: true,
      updated: true,
   });

   const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => {
      const allPaths = new Set<string>();
      files.forEach((file) => {
         const separator = getPathSeparator(file.path);
         const parts = splitPath(file.path);
         let currentPath = '';

         parts.forEach((part, index) => {
            currentPath = currentPath ? `${currentPath}${separator}${part}` : part;
            if (index < 3) {
               allPaths.add(currentPath);
            }
         });
      });
      return allPaths;
   });

   const fileSystem = useMemo(() => {
      const system: { [key: string]: RestoredFileItem[] } = {};

      files
         .filter((file) => {
            const matchesSearch = file.path.toLowerCase().includes(search.toLowerCase());
            const matchesFilter = filters[file.action];
            return matchesSearch && matchesFilter;
         })
         .forEach((file) => {
            const dirPath = getParentPath(file.path);
            const normalizedDirPath = normalizePath(dirPath);

            if (normalizedDirPath) {
               if (!system[normalizedDirPath]) {
                  system[normalizedDirPath] = [];
               }
               system[normalizedDirPath].push(file);
            }
         });

      return system;
   }, [files, search, filters]);

   const directories = useMemo(() => {
      const dirs = new Set<string>();
      files.forEach((file) => {
         const dirPath = getParentPath(file.path);
         const separator = getPathSeparator(dirPath);
         const parts = splitPath(dirPath);
         let currentPath = '';

         parts.forEach((part) => {
            currentPath = currentPath ? `${currentPath}${separator}${part}` : part;
            if (currentPath) {
               dirs.add(currentPath);
            }
         });
      });
      return Array.from(dirs);
   }, [files]);

   const { selectedFolder, setSelectedFolder, hasSubdirectories, isVisible, expandParentFolders, toggleFolder } = useSnapshotNavigation(
      directories,
      expandedFolders,
      setExpandedFolders,
      { splitPath, getPathSeparator, hasLeadingSeparator: false },
   );

   useEffect(() => {
      if (directories.length > 0 && selectedFolder === '') {
         setSelectedFolder(directories[0]);
      }
   }, [directories, selectedFolder, setSelectedFolder]);

   const hasUpdatedContent = (dir: string) => {
      return Object.entries(fileSystem).some(([path, dirFiles]) => {
         return path.startsWith(dir) && dirFiles.some((f) => f.action === 'restored' || f.action === 'updated');
      });
   };

   const sortedFiles = useMemo(() => {
      if (!selectedFolder || !fileSystem[selectedFolder]) return [];

      return fileSystem[selectedFolder].sort((a, b) => {
         const normalizedPathA = normalizePath(a.path);
         const normalizedPathB = normalizePath(b.path);
         const isDirectoryA = directories.includes(normalizedPathA);
         const isDirectoryB = directories.includes(normalizedPathB);

         if (isDirectoryA && !isDirectoryB) return -1;
         if (!isDirectoryA && isDirectoryB) return 1;

         const priority = { restored: 0, updated: 1, unchanged: 2 };
         return priority[a.action] - priority[b.action];
      });
   }, [selectedFolder, fileSystem, directories]);

   const showGoUpButton = selectedFolder && getParentPath(selectedFolder) !== selectedFolder && selectedFolder !== '' && selectedFolder !== '/';
   const totalItems = sortedFiles.length + (showGoUpButton ? 1 : 0);

   const FileRow = ({ index, style }: { index: number; style: React.CSSProperties }) => {
      if (showGoUpButton && index === 0) {
         return (
            <SnapshotBrowserGoUpRow
               style={style}
               onGoUp={() => {
                  const parentPath = getParentPath(selectedFolder);
                  const normalizedParentPath = normalizePath(parentPath);
                  if (!normalizedParentPath || normalizedParentPath === '') return;
                  expandParentFolders(normalizedParentPath);
                  setSelectedFolder(normalizedParentPath);
               }}
               gridTemplateColumns={GRID_COLUMNS}
            />
         );
      }

      const fileIndex = showGoUpButton ? index - 1 : index;
      const file = sortedFiles[fileIndex];

      if (!file) return null;

      const parts = splitPath(file.path);
      const fileName = parts[parts.length - 1];
      const normalizedPath = normalizePath(file.path);
      const isDirectory = directories.includes(normalizedPath);
      const hasUpdates = hasUpdatedContent(normalizedPath);
      const fileAction = file.action;
      const isRestored = file.action === 'restored';
      const fileActionLabel = isRestored ? 'New' : file.action;

      return (
         <div
            style={{ ...style, gridTemplateColumns: GRID_COLUMNS }}
            className={`${sbClasses.snapshotFile} ${isDirectory ? sbClasses.fileIsDir : ''}`}
            onClick={() => {
               if (isDirectory) {
                  setSelectedFolder(normalizedPath);
                  expandParentFolders(normalizedPath);
               }
            }}
         >
            <div className={sbClasses.fileName}>
               {isDirectory ? <Icon type={'fm-directory'} size={16} /> : <FileIcon filename={fileName || ''} />}{' '}
               {isRestored && <span className={classes.newFileIndicator} />} {fileName}
               {hasUpdates && <i />}
            </div>
            <div className={`${classes.status} ${classes[fileAction]}`}>
               <i>{fileActionLabel}</i>
            </div>
            <div className={classes.fileSize}>{isDirectory ? '-' : formatBytes(file.size)}</div>
         </div>
      );
   };

   return (
      <div className={sbClasses.snapshotBrowser}>
         <SnapshotBrowserToolbar
            search={search}
            onSearchChange={setSearch}
            leftContent={
               stats && (
                  <div className={sbClasses.stats}>
                     <strong>Summary: </strong> {formatNumberToK(stats.total_files)} Items {' • '}
                     {formatBytes(stats.bytes_restored)}/{formatBytes(stats.total_bytes)}
                  </div>
               )
            }
            rightContent={
               <div className={classes.filters}>
                  {(Object.keys(filters) as Array<keyof typeof filters>).map((action) => (
                     <label key={action}>
                        <input type="checkbox" checked={filters[action]} onChange={(e) => setFilters({ ...filters, [action]: e.target.checked })} />
                        {action === 'restored' ? 'New' : action}
                     </label>
                  ))}
               </div>
            }
         />

         <div className={sbClasses.browserContent}>
            <SnapshotBrowserDirectories
               directories={directories}
               selectedFolder={selectedFolder}
               expandedFolders={expandedFolders}
               onDirectoryClick={(dir) => {
                  setSelectedFolder(dir);
                  expandParentFolders(dir);
               }}
               onToggleFolder={toggleFolder}
               isVisible={isVisible}
               hasSubdirectories={hasSubdirectories}
               renderDirectoryExtra={(dir) => {
                  const hasUpdates = hasUpdatedContent(dir);
                  return hasUpdates ? <span className={classes.notification} /> : null;
               }}
            />

            <div className={sbClasses.content}>
               <SnapshotBrowserFileList
                  files={Array(totalItems)}
                  height={window.innerHeight - (isPreview ? 370 : 250)}
                  itemSize={ITEM_HEIGHT}
                  headerContent={
                     <>
                        <div>Name</div>
                        <div>Status</div>
                        <div>Size</div>
                     </>
                  }
                  renderRow={FileRow}
                  selectedFolder={selectedFolder || null}
                  gridTemplateColumns={GRID_COLUMNS}
               />
            </div>
         </div>
      </div>
   );
};

export default RestoredFileBrowser;
