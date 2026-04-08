import { ReactNode } from 'react';
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
}: SnapshotBrowserDirectoriesProps) => {
   return (
      <div className={`${classes.sidebar} styled__scrollbar`}>
         <div className={classes.sidebarHeader}>
            <h4>
               Directories ({directories.length}
               {useProgressiveLoading && '+'})
            </h4>
         </div>
         {directories.length === 0 && (
            <div className={classes.noDirectories}>{useProgressiveLoading ? 'Loading directories...' : 'No directories found'}</div>
         )}
         {directories.map((dir) => {
            const parts = splitPathFn(dir);
            const dirName = parts[parts.length - 1] || dir;
            const depth = parts.length - 1;
            const isExpanded = expandedFolders.has(dir);
            const hasChildren = hasSubdirectories(dir);

            if (!isVisible(dir)) return null;

            return (
               <div
                  key={dir}
                  className={`${classes.directory} ${selectedFolder === dir ? classes.selected : ''} ${hasChildren ? '' : classes.directoryEmpty}`}
                  style={{ paddingLeft: `${depth * 20}px` }}
                  onClick={() => onDirectoryClick(dir)}
               >
                  {hasChildren ? (
                     <button
                        className={classes.toggleButton}
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
                  <span className={classes.dirName}>
                     <Icon type={'fm-directory'} size={14} /> {dirName}
                  </span>
                  {renderDirectoryExtra?.(dir)}
               </div>
            );
         })}
      </div>
   );
};

export default SnapshotBrowserDirectories;
