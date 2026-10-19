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
import {
   encodeRestoreSelection,
   selectedRestorePaths,
   restoreSelectionSummary,
   restoreSelectionState,
   toggleRestoreSelection,
} from '../../../utils/restoreSelection';

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

   const restorableFiles = useMemo(() => (fileSelectCondition ? files.filter(fileSelectCondition) : files), [files, fileSelectCondition]);
   const selectedPaths = useMemo(
      () => selectedRestorePaths(restorableFiles, { includes: selectedFiles.include, excludes: selectedFiles.exclude }),
      [restorableFiles, selectedFiles],
   );

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
            const theFile = { ...file };
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
      const counts = restoreSelectionSummary(restorableFiles, { includes: selectedFiles.include, excludes: selectedFiles.exclude });
      return {
         selectedFiles: counts.files,
         selectedDirectories: counts.directories,
         selectedEntries: counts.entries,
         otherEntries: counts.otherEntries || 0,
         totalEntries: counts.totalEntries,
         selectedBytes: counts.bytes,
         totalBytes: counts.totalBytes,
      };
   }, [restorableFiles, selectedFiles]);

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

   const applySelection = (selection: { includes: Set<string>; excludes: Set<string> }) => {
      const effective = fileSelectCondition ? encodeRestoreSelection(files, selectedRestorePaths(restorableFiles, selection)) : selection;
      setSelectedFiles({ include: new Set(effective.includes), exclude: new Set(effective.excludes) });
      onSelect({ includes: new Set(effective.includes), excludes: new Set(effective.excludes) });
   };
   const onFileSelect = (pathname: string, _isDirectory: boolean) =>
      applySelection(toggleRestoreSelection(restorableFiles, { includes: selectedFiles.include, excludes: selectedFiles.exclude }, pathname));

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
      const state = restoreSelectionState(restorableFiles, selectedPaths, file.path);
      const isSelected = state === 'all';
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
                  aria-pressed={state === 'partial' ? 'mixed' : isSelected}
                  title={state === 'partial' ? 'Partially selected; click to select entire subtree' : undefined}
               >
                  {canBeSelected ? (
                     state === 'partial' ? (
                        <span>−</span>
                     ) : (
                        <Icon type={isSelected ? 'check-circle-filled' : 'check-circle'} size={13} />
                     )
                  ) : null}
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
                     {summary.selectedFiles.toLocaleString('en-US')} files + {summary.selectedDirectories.toLocaleString('en-US')} directories
                     selected · {summary.selectedEntries.toLocaleString('en-US')}/{summary.totalEntries.toLocaleString('en-US')} entries {' • '}
                     {formatBytes(summary.selectedBytes)}/{formatBytes(summary.totalBytes)}
                     {summary.otherEntries > 0 && <span> · {summary.otherEntries} other entries (unsupported by remote staged restore)</span>}
                     <button
                        type="button"
                        onClick={() => applySelection(encodeRestoreSelection(restorableFiles, new Set(restorableFiles.map((file) => file.path))))}
                     >
                        Select all entries
                     </button>
                     <button type="button" onClick={() => applySelection(encodeRestoreSelection(restorableFiles, new Set()))}>
                        Clear selection
                     </button>
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
                     const isSelected =
                        restoreSelectionState(
                           restorableFiles,
                           selectedPaths,
                           files.find((f) => f.isDirectory && normalizePath(f.path) === dir)?.path || dir,
                        ) === 'all';
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
