import { useState, useMemo, useEffect } from 'react';
import Icon from '../../common/Icon/Icon';
import { RestoreFileItem } from '../../../@types/restores';
import { calculateDirectorySizes, formatBytes, formatDateTime, formatNumberToK, isMobile, sortFileItems } from '../../../utils/helpers';
import FileIcon from '../../common/FileIcon/FileIcon';
import classes from './RestoreFileSelector.module.scss';
import { getParentPath, getPathSeparator, normalizePath, splitPath } from '../../../utils/restore';
import { SnapshotBrowserToolbar, SnapshotBrowserDirectories, SnapshotBrowserFileList, SnapshotBrowserGoUpRow } from '../../common/SnapshotBrowser';
import { useSnapshotNavigation } from '../../common/SnapshotBrowser/hooks/useSnapshotNavigation';
import sbClasses from '../../common/SnapshotBrowser/SnapshotBrowser.module.scss';

interface RestoreFileSelectorProps {
   selected: {
      includes: Set<string>;
      excludes: Set<string>;
   };
   backupId: string;
   files: RestoreFileItem[];
   isLoading: boolean;
   errorFetching: string | null;
   showChange?: boolean;
   fileSelectCondition?: (file: RestoreFileItem) => boolean;
   onSelect: (selected: RestoreFileSelectorProps['selected']) => void;
}

const isMobileDevice = isMobile();
const ITEM_HEIGHT = isMobileDevice ? 65 : 45;
const GRID_COLUMNS = '1fr 180px minmax(80px, auto)';

const RestoreFileSelector = ({ selected, files, isLoading, errorFetching, showChange, onSelect, fileSelectCondition }: RestoreFileSelectorProps) => {
   const [search, setSearch] = useState('');
   const [sortField, setSortField] = useState<'name' | 'modifiedAt' | 'size'>('name');
   const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
   const [selectedFiles, setSelectedFiles] = useState<{ include: Set<string>; exclude: Set<string> }>(() => ({
      include: new Set(selected.includes),
      exclude: new Set(selected.excludes),
   }));

   console.log('[RestoreFileSelector] files :', files);

   const getAllChildPaths = (dirPath: string): string[] => {
      const allPaths: string[] = [];

      files.forEach((file) => {
         // Use original paths, not normalized
         if (file.path.startsWith(dirPath + '/') || file.path.startsWith(dirPath + '\\')) {
            allPaths.push(file.path);
         }
      });

      return allPaths;
   };

   const isPathSelected = (path: string): boolean => {
      // If path is explicitly excluded, it's not selected
      if (selectedFiles.exclude.has(path)) {
         return false;
      }

      // Check if any parent directory is excluded
      const hasExcludedParent = Array.from(selectedFiles.exclude).some(
         (excludedPath) => path.startsWith(excludedPath + '/') || path.startsWith(excludedPath + '\\'),
      );

      if (hasExcludedParent) {
         return false;
      }

      // If nothing is in includes (default state), everything is selected
      if (selectedFiles.include.size === 0) {
         return true;
      }

      // If path is explicitly included, it's selected
      if (selectedFiles.include.has(path)) {
         return true;
      }

      // Check if any parent is included and this path is not excluded
      const hasIncludedParent = Array.from(selectedFiles.include).some(
         (includedPath) => path.startsWith(includedPath + '/') || path.startsWith(includedPath + '\\'),
      );

      return hasIncludedParent;
   };

   const getEffectiveParentInclude = (path: string): string | null => {
      return (
         Array.from(selectedFiles.include).find((includedPath) => path.startsWith(includedPath + '/') || path.startsWith(includedPath + '\\')) || null
      );
   };

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
      const system: { [key: string]: RestoreFileItem[] } = {};
      const dirSizes = calculateDirectorySizes(files);
      files
         .filter((file) => {
            const matchesSearch = file.path.toLowerCase().includes(search.toLowerCase());
            return matchesSearch;
         })
         .forEach((file) => {
            let theFile = file;
            const dirPath = getParentPath(theFile.path);
            // Use the normalized path as key, but handle root directory
            const normalizedDirPath = normalizePath(dirPath) || '/'; // Use '/' for root

            if (theFile.isDirectory) {
               theFile.size = dirSizes[theFile.path] || 0;
            }

            if (!system[normalizedDirPath]) {
               system[normalizedDirPath] = [];
            }
            system[normalizedDirPath].push(theFile);
         });

      return system;
   }, [files, search]);

   console.log('fileSystem :', fileSystem);

   const directories = useMemo(() => {
      const dirs = files.filter((file) => file.isDirectory).map((file) => normalizePath(file.path));

      // Sort directories by their path to ensure proper hierarchical order
      const sortedDirs = dirs.sort((a, b) => {
         const aParts = splitPath(a);
         const bParts = splitPath(b);
         const minLength = Math.min(aParts.length, bParts.length);

         for (let i = 0; i < minLength; i++) {
            const comparison = aParts[i].localeCompare(bParts[i]);
            if (comparison !== 0) {
               return comparison;
            }
         }
         return aParts.length - bParts.length;
      });

      return sortedDirs;
   }, [files]);

   const { selectedFolder, setSelectedFolder, hasSubdirectories, isVisible, expandParentFolders, toggleFolder } = useSnapshotNavigation(
      directories,
      expandedFolders,
      setExpandedFolders,
      { splitPath, getPathSeparator, hasLeadingSeparator: false },
   );

   // Set the first directory as selected by default
   useEffect(() => {
      if (directories.length > 0 && selectedFolder === '') {
         setSelectedFolder(directories[0]);
      }
   }, [directories, selectedFolder, setSelectedFolder]);

   const summary = useMemo(() => {
      let selectedFilesCount = 0;
      let selectedBytes = 0;

      const restorableFiles = fileSelectCondition ? files.filter((file) => fileSelectCondition(file)) : files;

      restorableFiles.forEach((file) => {
         if (isPathSelected(file.path)) {
            selectedFilesCount++;
            if (!file.isDirectory) {
               selectedBytes += file.size;
            }
         }
      });

      return {
         selectedFiles: selectedFilesCount,
         totalFiles: restorableFiles.length,
         selectedBytes,
         totalBytes: restorableFiles.reduce((acc, file) => acc + (!file.isDirectory ? file.size : 0), 0),
      };
   }, [files, selectedFiles]);

   const handleSort = (field: 'name' | 'modifiedAt' | 'size') => {
      if (sortField === field) {
         // Toggle direction if clicking the same field
         setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
      } else {
         // Set new field and default to ascending
         setSortField(field);
         setSortDirection('asc');
      }
   };

   const onFileSelect = (path: string, isDirectory: boolean) => {
      const newSelected = { ...selectedFiles };
      const isCurrentlySelected = isPathSelected(path);

      if (isDirectory) {
         const childPaths = getAllChildPaths(path);

         if (isCurrentlySelected) {
            // Deselecting directory
            newSelected.exclude.add(path);
            newSelected.include.delete(path);

            // Remove any child paths from both include and exclude (they inherit exclusion from parent)
            childPaths.forEach((childPath) => {
               newSelected.include.delete(childPath);
               newSelected.exclude.delete(childPath);
            });
         } else {
            // Selecting directory
            newSelected.exclude.delete(path);

            // If we have explicit includes, we need to add this to include
            if (newSelected.include.size > 0) {
               // Check if parent is already included
               const parentInclude = getEffectiveParentInclude(path);
               if (!parentInclude) {
                  newSelected.include.add(path);
               }
            }

            // Remove any child paths from both include and exclude (they inherit from parent)
            childPaths.forEach((childPath) => {
               newSelected.include.delete(childPath);
               newSelected.exclude.delete(childPath);
            });
         }
      } else {
         // File selection
         if (isCurrentlySelected) {
            // Deselecting file
            newSelected.exclude.add(path);
            newSelected.include.delete(path);
         } else {
            // Selecting file - always allow this
            newSelected.exclude.delete(path);

            // If we have explicit includes OR if parent is excluded, we need to add this to include
            if (newSelected.include.size > 0) {
               const parentInclude = getEffectiveParentInclude(path);
               if (!parentInclude) {
                  newSelected.include.add(path);
               }
            } else {
               // Check if any parent is excluded - if so, we need to start using includes
               const hasExcludedParent = Array.from(newSelected.exclude).some(
                  (excludedPath) => path.startsWith(excludedPath + '/') || path.startsWith(excludedPath + '\\'),
               );
               if (hasExcludedParent) {
                  newSelected.include.add(path);
               }
            }
         }
      }

      setSelectedFiles({
         include: new Set(newSelected.include),
         exclude: new Set(newSelected.exclude),
      });

      onSelect({
         includes: newSelected.include,
         excludes: newSelected.exclude,
      });
   };

   const getDirectChildren = (parentPath: string) => {
      let children = [];

      if (!parentPath && fileSystem['']) {
         children = fileSystem[''];
      } else {
         children = fileSystem[parentPath] || [];
      }
      const directories = children.filter((item) => item.isDirectory);
      const files = children.filter((item) => !item.isDirectory);
      return [
         ...(sortFileItems(directories, sortField, sortDirection) as RestoreFileItem[]),
         ...(sortFileItems(files, sortField, sortDirection) as RestoreFileItem[]),
      ];
   };

   const directChildren = useMemo(() => {
      if (!selectedFolder) return [];

      const children = getDirectChildren(selectedFolder);
      const hasParent = getParentPath(selectedFolder) !== selectedFolder;

      // Add parent navigation item if needed
      return hasParent ? [null, ...children] : children;
   }, [selectedFolder, fileSystem, sortField, sortDirection]);

   const Row = ({ index, style }: { index: number; style: React.CSSProperties }) => {
      const item = directChildren[index];

      // Parent directory navigation
      if (item === null) {
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

      const file = item;
      const parts = splitPath(file.path);
      const fileName = parts[parts.length - 1];
      const normalizedPath = normalizePath(file.path);
      const isDirectory = directories.includes(normalizedPath);
      const isSelected = isPathSelected(file.path);
      const canBeSelected = fileSelectCondition ? fileSelectCondition(file) : true;

      return (
         <div
            style={{ ...style, gridTemplateColumns: GRID_COLUMNS }}
            key={file.path}
            className={`${sbClasses.snapshotFile} ${isDirectory ? sbClasses.fileIsDir : ''} ${showChange && file.changeType === 'modified' ? classes.fileModified : ''} ${showChange && file.changeType === 'removed' ? classes.fileRemoved : ''}`}
            onClick={() => {
               if (isDirectory) {
                  expandParentFolders(normalizedPath);
                  setSelectedFolder(normalizedPath);
               }
            }}
         >
            <div className={sbClasses.fileName}>
               <button
                  className={`${classes.selectButton} ${isSelected ? classes.selected : ''} ${!canBeSelected ? classes.notSelectable : ''}`}
                  onClick={(e) => {
                     if (!canBeSelected) return;
                     e.stopPropagation();
                     onFileSelect(file.path, false);
                  }}
                  disabled={!canBeSelected}
               >
                  {canBeSelected ? <Icon type={isSelected ? 'check-circle-filled' : 'check-circle'} size={13} /> : null}
               </button>
               {isDirectory ? <Icon type={isDirectory ? 'fm-directory' : 'fm-file'} size={16} /> : <FileIcon filename={fileName || ''} />} {fileName}
            </div>
            <div className={classes.fileModified}>{formatDateTime(file.modifiedAt)}</div>
            <div className={classes.fileSize}>{formatBytes(file.size || 0)}</div>
         </div>
      );
   };

   return (
      <div className={classes.restoreFileSelector}>
         {isLoading && (
            <div className={classes.loader}>
               <Icon type="loading" size={24} /> Loading Snapshot Content..
            </div>
         )}
         <div className={sbClasses.snapshotBrowser}>
            <SnapshotBrowserToolbar
               search={search}
               onSearchChange={setSearch}
               leftContent={
                  <div className={sbClasses.stats}>
                     <strong>Summary: </strong>
                     {formatNumberToK(summary.selectedFiles)}/{formatNumberToK(summary.totalFiles)} Items {' • '}
                     {formatBytes(summary.selectedBytes)}/{formatBytes(summary.totalBytes)}
                     {selectedFiles.exclude.size > 0 && (
                        <div className={classes.excludedStat}>
                           {' • '}
                           <span>
                              Excluded:{' '}
                              <i title={Array.from(selectedFiles.exclude).join('\n')}>{formatNumberToK(selectedFiles.exclude.size)} Items</i>
                           </span>
                        </div>
                     )}
                  </div>
               }
            />

            <div className={sbClasses.browserContent}>
               <SnapshotBrowserDirectories
                  directories={directories}
                  selectedFolder={selectedFolder}
                  expandedFolders={expandedFolders}
                  onDirectoryClick={(dir) => setSelectedFolder(dir)}
                  onToggleFolder={toggleFolder}
                  isVisible={isVisible}
                  hasSubdirectories={hasSubdirectories}
                  renderDirectoryExtra={(dir) => {
                     const isSelected = isPathSelected(files.find((f) => f.isDirectory && normalizePath(f.path) === dir)?.path || dir);
                     return (
                        <button
                           className={`${classes.selectButton} ${isSelected ? classes.selected : ''}`}
                           onClick={(e) => {
                              e.stopPropagation();
                              const originalPath = files.find((f) => f.isDirectory && normalizePath(f.path) === dir)?.path || dir;
                              onFileSelect(originalPath, true);
                           }}
                        >
                           <Icon type={isSelected ? 'check-circle-filled' : 'check-circle'} size={13} />
                        </button>
                     );
                  }}
               />

               <div className={`${sbClasses.content} styled__scrollbar`}>
                  <SnapshotBrowserFileList
                     files={directChildren}
                     height={window.innerHeight - 370}
                     itemSize={ITEM_HEIGHT}
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
                        </>
                     }
                     renderRow={Row}
                     selectedFolder={selectedFolder || null}
                     gridTemplateColumns={GRID_COLUMNS}
                     emptyMessage="Select a folder from the left to browse it's content"
                  />
                  {errorFetching && <div className={classes.error}>Failed to load files. Please try again.</div>}
               </div>
            </div>
         </div>
      </div>
   );
};

export default RestoreFileSelector;
