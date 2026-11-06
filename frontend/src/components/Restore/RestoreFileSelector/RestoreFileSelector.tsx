import { useState } from 'react';
import Icon from '../../common/Icon/Icon';
import { RestoreFileItem } from '../../../@types/restores';
import { formatBytes, formatDateTime, formatNumberToK, isMobile } from '../../../utils/helpers';
import FileIcon from '../../common/FileIcon/FileIcon';
import classes from './RestoreFileSelector.module.scss';
import { splitPath } from '../../../utils/restore';
import { SnapshotBrowserToolbar, SnapshotBrowserDirectories, SnapshotBrowserFileList, SnapshotBrowserGoUpRow } from '../../common/SnapshotBrowser';
import SnapshotIndexProgress from '../../common/SnapshotBrowser/SnapshotIndexProgress';
import sbClasses from '../../common/SnapshotBrowser/SnapshotBrowser.module.scss';
import { RestoreSelection, useInMemoryFileSource, useIndexedFileSource, withRootRule } from './useRestoreFileSource';

export interface RestoreIndexSource {
   backupId: string;
   replicationId?: string;
}

interface RestoreFileSelectorProps {
   selected: {
      includes: Set<string>;
      excludes: Set<string>;
   };
   backupId: string;
   files: RestoreFileItem[];
   /** Reads the snapshot from the server index, so `files` is not used. */
   source?: RestoreIndexSource;
   isLoading: boolean;
   errorFetching: string | null;
   showChange?: boolean;
   fileSelectCondition?: (file: RestoreFileItem) => boolean;
   onSelect: (selected: RestoreFileSelectorProps['selected']) => void;
}

const isMobileDevice = isMobile();
const ITEM_HEIGHT = isMobileDevice ? 65 : 45;
const GRID_COLUMNS = '1fr 180px minmax(80px, auto)';
const ROOT = '/';

const isChildPath = (path: string, parent: string) =>
   parent === ROOT ? path !== ROOT : path.startsWith(parent + '/') || path.startsWith(parent + '\\');

const clearChildRules = (rules: Set<string>, parent: string) => {
   rules.forEach((path) => {
      if (isChildPath(path, parent)) rules.delete(path);
   });
};

// Nearest rule wins, and root is selected unless it is excluded.
const isSelectedByNearestRule = ({ include, exclude }: RestoreSelection, path: string): boolean => {
   for (let current = path; current && current !== ROOT; current = current.slice(0, Math.max(current.lastIndexOf('/'), 0))) {
      if (exclude.has(current)) return false;
      if (include.has(current)) return true;
   }
   return !exclude.has(ROOT);
};

// An index holds selection rules, not rows, so one rule covers a whole folder.
const toggleNearestRule = (selection: RestoreSelection, path: string): RestoreSelection => {
   const wasSelected = isSelectedByNearestRule(selection, path);
   const include = new Set(selection.include);
   const exclude = new Set(selection.exclude);
   for (const rules of [include, exclude]) {
      rules.delete(path);
      clearChildRules(rules, path);
   }
   if (isSelectedByNearestRule({ include, exclude }, path) === wasSelected) {
      (wasSelected ? exclude : include).add(path);
   }
   return { include, exclude };
};

const RestoreFileSelector = ({ selected, files, source: indexSource, isLoading, errorFetching, showChange, onSelect, fileSelectCondition }: RestoreFileSelectorProps) => {
   const indexed = !!indexSource;
   const [search, setSearch] = useState('');
   const [sortField, setSortField] = useState<'name' | 'modifiedAt' | 'size'>('name');
   const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
   const [selectedFiles, setSelectedFiles] = useState<RestoreSelection>(() => ({
      include: new Set(selected.includes),
      exclude: new Set(indexed ? withRootRule(Array.from(selected.includes), Array.from(selected.excludes)) : selected.excludes),
   }));

   const isPathSelected = (path: string): boolean => {
      if (indexed) return isSelectedByNearestRule(selectedFiles, path);

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

   const sourceOptions = { search, sortField, sortDirection, selection: selectedFiles };
   const memorySource = useInMemoryFileSource(files, { ...sourceOptions, isPathSelected, fileSelectCondition });
   const indexSourceData = useIndexedFileSource(indexSource?.backupId ?? '', indexSource?.replicationId, indexed, sourceOptions);
   const source = indexed ? indexSourceData : memorySource;
   const { directories, children, summary } = source;
   const excludedRules = Array.from(selectedFiles.exclude).filter((path) => path !== ROOT);

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
      if (indexed) {
         const next = toggleNearestRule(selectedFiles, path);
         setSelectedFiles(next);
         onSelect({ includes: next.include, excludes: next.exclude });
         return;
      }

      const newSelected = { ...selectedFiles };
      const isCurrentlySelected = isPathSelected(path);

      if (isDirectory) {
         if (isCurrentlySelected) {
            // Deselecting directory
            newSelected.exclude.add(path);
            newSelected.include.delete(path);

            // Remove any child paths from both include and exclude (they inherit exclusion from parent)
            clearChildRules(newSelected.include, path);
            clearChildRules(newSelected.exclude, path);
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
            clearChildRules(newSelected.include, path);
            clearChildRules(newSelected.exclude, path);
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

   const Row = ({ index, style }: { index: number; style: React.CSSProperties }) => {
      const item = children[index];

      // Parent directory navigation
      if (item === null) {
         return <SnapshotBrowserGoUpRow style={style} onGoUp={source.goUp} gridTemplateColumns={GRID_COLUMNS} />;
      }

      const file = item;
      const parts = splitPath(file.path);
      const fileName = parts[parts.length - 1];
      const isDirectory = source.isDirectory(file);
      const isSelected = isPathSelected(file.path);
      const canBeSelected = fileSelectCondition ? fileSelectCondition(file) : true;

      return (
         <div
            style={{ ...style, gridTemplateColumns: GRID_COLUMNS }}
            key={file.path}
            className={`${sbClasses.snapshotFile} ${isDirectory ? sbClasses.fileIsDir : ''} ${showChange && file.changeType === 'modified' ? classes.fileModified : ''} ${showChange && file.changeType === 'removed' ? classes.fileRemoved : ''}`}
            onClick={() => {
               if (isDirectory) source.openFolder(file);
            }}
         >
            <div className={sbClasses.fileName}>
               <button
                  className={`${classes.selectButton} ${isSelected ? classes.selected : ''} ${!canBeSelected ? classes.notSelectable : ''}`}
                  onClick={(e) => {
                     if (!canBeSelected) return;
                     e.stopPropagation();
                     onFileSelect(file.path, isDirectory);
                  }}
                  disabled={!canBeSelected}
               >
                  {canBeSelected ? <Icon type={isSelected ? 'check-circle-filled' : 'check-circle'} size={13} /> : null}
               </button>
               {isDirectory ? (
                  <button type="button" className={sbClasses.fileNameBtn}>
                     <Icon type={'fm-directory'} size={16} /> {fileName}
                  </button>
               ) : (
                  <>
                     <FileIcon filename={fileName || ''} /> {fileName}
                  </>
               )}
            </div>
            <div className={classes.fileModified}>{file.modifiedAt ? formatDateTime(file.modifiedAt) : ''}</div>
            <div className={classes.fileSize}>{formatBytes(source.displaySize(file))}</div>
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
               isLoading={source.isLoadingList}
               leftContent={
                  <div className={sbClasses.stats}>
                     <strong>Summary: </strong>
                     {formatNumberToK(summary.selectedFiles)}/{formatNumberToK(summary.totalFiles)} Items {' • '}
                     {formatBytes(summary.selectedBytes)}/{formatBytes(summary.totalBytes)}
                     {excludedRules.length > 0 && (
                        <div className={classes.excludedStat}>
                           {' • '}
                           <span>
                              Excluded: <i title={excludedRules.join('\n')}>{formatNumberToK(excludedRules.length)} Items</i>
                           </span>
                        </div>
                     )}
                     {source.selectionError === 'selection_too_complex' && (
                        <div className={classes.excludedStat}>
                           {' • '}
                           <span>Select fewer separate items</span>
                        </div>
                     )}
                  </div>
               }
            />

            {source.index && !source.index.ready ? (
               <div className={`${sbClasses.browserContent} ${sbClasses.loadingState}`}>
                  <SnapshotIndexProgress status={source.index.status} error={source.index.error} onRetry={source.index.retry} />
               </div>
            ) : (
               <div className={sbClasses.browserContent}>
                  <SnapshotBrowserDirectories
                     directories={directories}
                     selectedFolder={source.selectedFolder}
                     expandedFolders={source.expandedFolders}
                     onDirectoryClick={source.selectFolder}
                     onToggleFolder={source.toggleFolder}
                     isVisible={source.isVisible}
                     hasSubdirectories={source.hasSubdirectories}
                     renderDirectoryExtra={(dir) => {
                        const originalPath = source.originalPath(dir);
                        const isSelected = isPathSelected(originalPath);
                        return (
                           <button
                              className={`${classes.selectButton} ${isSelected ? classes.selected : ''}`}
                              onClick={(e) => {
                                 e.stopPropagation();
                                 onFileSelect(originalPath, true);
                              }}
                           >
                              <Icon type={isSelected ? 'check-circle-filled' : 'check-circle'} size={13} />
                           </button>
                        );
                     }}
                     {...source.directoryProps}
                  />

                  <div className={`${sbClasses.content} styled__scrollbar`}>
                     <SnapshotBrowserFileList
                        files={children}
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
                        selectedFolder={source.listFolder}
                        isLoading={source.isLoadingList}
                        error={source.listError}
                        gridTemplateColumns={GRID_COLUMNS}
                        emptyMessage="Select a folder from the left to browse it's content"
                        onNearEnd={source.loadMore}
                     />
                     {errorFetching && <div className={classes.error}>Failed to load files. Please try again.</div>}
                  </div>
               </div>
            )}
         </div>
      </div>
   );
};

export default RestoreFileSelector;
