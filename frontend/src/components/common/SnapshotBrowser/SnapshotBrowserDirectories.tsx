import { Fragment, ReactNode } from 'react';
import Icon from '../Icon/Icon';
import classes from './SnapshotBrowser.module.scss';

interface SnapshotBrowserDirectoriesProps {
   directories: string[];
   selectedFolder: string;
   expandedFolders: Set<string>;
   useProgressiveLoading?: boolean;
   onDirectoryClick: (path: string) => void;
   onToggleFolder: (dir: string) => void;
   isVisible: (dir: string) => boolean;
   hasSubdirectories: (dir: string) => boolean;
   renderDirectoryExtra?: (dir: string) => ReactNode;
   /** Custom function to split a path into parts. Defaults to splitting by / and \ */
   splitPath?: (path: string) => string[];
   /** Count for the header when the list holds only part of the directories. */
   totalDirectories?: number;
   emptyMessage?: string;
   /** Maps a directory to the parents that show a load-more row after it. */
   loadMoreAfter?: Map<string, string[]>;
   onLoadMore?: (parent: string) => void;
   isLoadingMore?: boolean;
}

const defaultSplitPath = (path: string) => path.split(/[/\\]/).filter(Boolean);

const SnapshotBrowserDirectories = ({
   directories,
   selectedFolder,
   expandedFolders,
   useProgressiveLoading,
   onDirectoryClick,
   onToggleFolder,
   isVisible,
   hasSubdirectories,
   renderDirectoryExtra,
   splitPath: splitPathFn = defaultSplitPath,
   totalDirectories,
   emptyMessage,
   loadMoreAfter,
   onLoadMore,
   isLoadingMore,
}: SnapshotBrowserDirectoriesProps) => {
   return (
      <div className={`${classes.sidebar} styled__scrollbar`}>
         <div className={classes.sidebarHeader}>
            <h4>
               Directories ({totalDirectories ?? directories.length}
               {totalDirectories === undefined && useProgressiveLoading && '+'})
            </h4>
         </div>
         {directories.length === 0 && (
            <div className={classes.noDirectories}>
               {emptyMessage || (useProgressiveLoading ? 'Loading directories...' : 'No directories found')}
            </div>
         )}
         {directories.map((dir) => {
            const parts = splitPathFn(dir);
            const dirName = parts[parts.length - 1] || dir;
            const depth = parts.length - 1;
            const isExpanded = expandedFolders.has(dir);
            const hasChildren = hasSubdirectories(dir);

            if (!isVisible(dir)) return null;

            return (
               <Fragment key={dir}>
                  <div
                     className={`${classes.directory} ${selectedFolder === dir ? classes.selected : ''} ${hasChildren ? '' : classes.directoryEmpty}`}
                     style={{ paddingLeft: `${depth * 20}px` }}
                     onClick={() => onDirectoryClick(dir)}
                  >
                     {hasChildren ? (
                        <button
                           className={classes.toggleButton}
                           aria-expanded={isExpanded}
                           onClick={(e) => {
                              e.stopPropagation();
                              onToggleFolder(dir);
                           }}
                        >
                           {isExpanded ? '-' : '+'}
                        </button>
                     ) : (
                        <span className={classes.togglePlaceholder} />
                     )}
                     <button type="button" className={classes.dirNameBtn}>
                        <span className={classes.dirName}>
                           <Icon type={'fm-directory'} size={14} /> {dirName}
                        </span>
                     </button>
                     {renderDirectoryExtra?.(dir)}
                  </div>
                  {loadMoreAfter?.get(dir)?.map((parent) => (
                     <button
                        key={parent}
                        className={classes.loadMoreDirectories}
                        style={{ paddingLeft: `${splitPathFn(parent).length * 20 + 16}px` }}
                        disabled={isLoadingMore}
                        onClick={() => onLoadMore?.(parent)}
                     >
                        Load more folders
                     </button>
                  ))}
               </Fragment>
            );
         })}
      </div>
   );
};

export default SnapshotBrowserDirectories;
