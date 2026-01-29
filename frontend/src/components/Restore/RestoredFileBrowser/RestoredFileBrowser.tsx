import { useState, useMemo, useEffect } from 'react';
import { FixedSizeList as List } from 'react-window';
import Icon from '../../common/Icon/Icon';
import classes from './RestoredFileBrowser.module.scss';
import { RestoredFileItem, RestoredItemsStats } from '../../../@types/restores';
import { formatBytes, formatNumberToK, isMobile } from '../../../utils/helpers';
import { getParentPath, getPathSeparator, normalizePath, splitPath } from '../../../utils/restore';
import FileIcon from '../../common/FileIcon/FileIcon';

interface RestoredFileBrowserProps {
   files: RestoredFileItem[];
   stats?: RestoredItemsStats;
   isPreview?: boolean;
}

const isMobileDevice = isMobile();
const ITEM_HEIGHT = isMobileDevice ? 65 : 45;

const RestoredFileBrowser = ({ files, stats, isPreview = false }: RestoredFileBrowserProps) => {
   const [selectedFolder, setSelectedFolder] = useState<string>('');
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
            // Only expand folders up to 5 levels deep (index < 5)
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
            // Use the normalized path as key
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
      // Derive directories from all files, not filtered fileSystem, to keep tree stable during search
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

   // Set initial selected folder when directories change
   useEffect(() => {
      if (directories.length > 0 && selectedFolder === '') {
         setSelectedFolder(directories[0]);
      }
   }, [directories, selectedFolder]);

   const hasSubdirectories = (dir: string) => {
      const separator = getPathSeparator(dir);
      return directories.some((d) => d !== dir && d.startsWith(dir + separator));
   };

   const hasUpdatedContent = (dir: string) => {
      return Object.entries(fileSystem).some(([path, files]) => {
         return path.startsWith(dir) && files.some((f) => f.action === 'restored' || f.action === 'updated');
      });
   };

   const expandParentDirectories = (dir: string) => {
      const newExpanded = new Set(expandedFolders);
      const separator = getPathSeparator(dir);
      const parts = splitPath(dir);
      let currentPath = '';

      // Expand all parent directories
      parts.forEach((part, index) => {
         currentPath = currentPath ? `${currentPath}${separator}${part}` : part;
         if (index < parts.length - 1) {
            // Don't expand the target directory itself
            newExpanded.add(currentPath);
         }
      });

      setExpandedFolders(newExpanded);
   };

   const toggleFolder = (dir: string) => {
      const newExpanded = new Set(expandedFolders);
      if (expandedFolders.has(dir)) {
         newExpanded.delete(dir);
      } else {
         newExpanded.add(dir);
      }
      setExpandedFolders(newExpanded);
   };

   const isVisible = (dir: string) => {
      const separator = getPathSeparator(dir);
      const parts = splitPath(dir);
      const parentParts = parts.slice(0, -1);
      let parentPath = '';

      // Check if all parent folders are expanded
      return parentParts.every((part) => {
         parentPath = parentPath ? `${parentPath}${separator}${part}` : part;
         return expandedFolders.has(parentPath);
      });
   };

   const sortedFiles = useMemo(() => {
      if (!selectedFolder || !fileSystem[selectedFolder]) return [];

      return fileSystem[selectedFolder].sort((a, b) => {
         const normalizedPathA = normalizePath(a.path);
         const normalizedPathB = normalizePath(b.path);
         const isDirectoryA = directories.includes(normalizedPathA);
         const isDirectoryB = directories.includes(normalizedPathB);

         // First sort by type: directories first, then files
         if (isDirectoryA && !isDirectoryB) return -1;
         if (!isDirectoryA && isDirectoryB) return 1;

         // If both are same type, sort by status priority
         const priority = { restored: 0, updated: 1, unchanged: 2 };
         return priority[a.action] - priority[b.action];
      });
   }, [selectedFolder, fileSystem, directories]);

   const showGoUpButton = selectedFolder && getParentPath(selectedFolder) !== selectedFolder && selectedFolder !== '' && selectedFolder !== '/';
   const totalItems = sortedFiles.length + (showGoUpButton ? 1 : 0);

   const FileRow = ({ index, style }: { index: number; style: React.CSSProperties }) => {
      // If showing go up button and this is the first item
      if (showGoUpButton && index === 0) {
         return (
            <div
               style={style}
               className={`${classes.file} ${classes.fileIsDir} ${classes.goUpButton}`}
               onClick={() => {
                  const parentPath = getParentPath(selectedFolder);
                  const normalizedParentPath = normalizePath(parentPath);
                  console.log('normalizedParentPath :', normalizedParentPath);
                  if (!normalizedParentPath || normalizedParentPath === '') return;
                  expandParentDirectories(normalizedParentPath);
                  setSelectedFolder(normalizedParentPath);
               }}
            >
               <div className={classes.fileName}>...</div>
               <div className={classes.status}></div>
               <div></div>
            </div>
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
      const isRestored = file.action === 'restored' ? true : false;
      const fileActionLabel = isRestored ? 'New' : file.action;

      return (
         <div
            style={style}
            className={`${classes.file} ${isDirectory ? classes.fileIsDir : ''}`}
            onClick={() => {
               if (isDirectory) {
                  setSelectedFolder(normalizedPath);
                  expandParentDirectories(normalizedPath);
               }
            }}
         >
            <div className={classes.fileName}>
               {isDirectory ? <Icon type={isDirectory ? 'fm-directory' : 'fm-file'} size={16} /> : <FileIcon filename={fileName || ''} />}{' '}
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
      <div className={classes.restoredFileBrowser}>
         <div className={classes.toolbar}>
            <div className={classes.toolbarLeft}>
               {stats && (
                  <div className={classes.stats}>
                     <strong>Summary: </strong> {formatNumberToK(stats.total_files)} Items {' • '}
                     {formatBytes(stats.bytes_restored)}/{formatBytes(stats.total_bytes)}
                  </div>
               )}
            </div>
            <div className={classes.toolbarRight}>
               <div className={classes.filters}>
                  {(Object.keys(filters) as Array<keyof typeof filters>).map((action) => (
                     <label key={action}>
                        <input type="checkbox" checked={filters[action]} onChange={(e) => setFilters({ ...filters, [action]: e.target.checked })} />
                        {action === 'restored' ? 'New' : action}
                     </label>
                  ))}
               </div>
               <div className={classes.search}>
                  <Icon type="search" size={16} />
                  <input type="text" placeholder="Search in current Directory..." value={search} onChange={(e) => setSearch(e.target.value)} />
               </div>
            </div>
         </div>

         <div className={classes.browserContent}>
            <div className={`${classes.sidebar} styled__scrollbar`}>
               <div className={classes.sidebarHeader}>Directories</div>
               {directories.map((dir) => {
                  const parts = splitPath(dir);
                  const dirName = parts[parts.length - 1];
                  const depth = parts.length - 1;
                  const isExpanded = expandedFolders.has(dir);
                  const hasUpdates = hasUpdatedContent(dir);
                  const hasChildren = hasSubdirectories(dir);

                  // Only render if parent folders are expanded or if it's a root folder
                  if (depth === 0 || isVisible(dir)) {
                     return (
                        <div
                           key={dir}
                           className={`${classes.directory} ${selectedFolder === dir ? classes.selected : ''} ${hasChildren ? '' : classes.directoryEmpty}`}
                           style={{ paddingLeft: `${depth * 20}px` }}
                           onClick={() => {
                              setSelectedFolder(dir);
                              expandParentDirectories(dir);
                           }}
                        >
                           {hasChildren ? (
                              <button
                                 className={classes.toggleButton}
                                 onClick={(e) => {
                                    e.stopPropagation();
                                    toggleFolder(dir);
                                 }}
                              >
                                 {isExpanded ? '-' : '+'}
                              </button>
                           ) : (
                              <span className={`${classes.togglePlaceholder}`} />
                           )}
                           <span className={classes.dirName}>
                              <Icon type={'fm-directory'} size={14} /> {dirName}
                              {hasUpdates && <span className={classes.notification} />}
                           </span>
                        </div>
                     );
                  }
                  return null;
               })}
            </div>

            <div className={classes.content}>
               <div className={classes.fileList}>
                  <div className={classes.header}>
                     <div>Name</div>
                     <div>Status</div>
                     <div>Size</div>
                  </div>
                  {selectedFolder && totalItems > 0 ? (
                     <List
                        height={window.innerHeight - (isPreview ? 370 : 250)}
                        itemCount={totalItems}
                        itemSize={ITEM_HEIGHT}
                        width="100%"
                        className={`${classes.fileListVirtualized} styled__scrollbar`}
                     >
                        {FileRow}
                     </List>
                  ) : (
                     <div className={classes.fileListEmpty}>Select a folder from the left to browse its content</div>
                  )}
               </div>
            </div>
         </div>
      </div>
   );
};

export default RestoredFileBrowser;
