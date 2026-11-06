import { ReactNode, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { FixedSizeList as List } from 'react-window';
import Icon from '../../common/Icon/Icon';
import FileIcon from '../../common/FileIcon/FileIcon';
import { useBrowseStorage } from '../../../services/storage';
import { formatBytes, formatDateTime, isMobile, sortFileItems } from '../../../utils/helpers';
import { FileItem } from '../../../@types/system';
import classes from './StorageFileBrowser.module.scss';

export interface StorageFileBrowserProps {
   title: string;
   storageId: string;
   storageType?: string;
   /** Where the browser opens. Ignored when `rootPath` is set. */
   defaultPath?: string;
   /** Lowest path the user can reach. Navigation never goes above it. */
   rootPath?: string;
   /** Per-file controls, shown on row hover. Core passes none, so core is read-only. */
   renderFileActions?: (item: FileItem) => ReactNode;
   close: () => void;
}

type SortField = 'name' | 'size' | 'modifiedAt' | null;
type SortOrder = 'asc' | 'desc';
const isMobileDevice = isMobile();
const ITEM_HEIGHT = isMobileDevice ? 68 : 38;

const StorageFileBrowser = ({ title, storageId, storageType, defaultPath, rootPath, renderFileActions, close }: StorageFileBrowserProps) => {
   const homePath = rootPath ?? '';
   const [currentPath, setCurrentPath] = useState(() => rootPath ?? defaultPath ?? '');
   const [showPathInput, setShowPathInput] = useState(false);
   const [customPath, setCustomPath] = useState('');
   const [sortField, setSortField] = useState<SortField>(null);
   const [sortOrder, setSortOrder] = useState<SortOrder>('asc');

   const { data, isLoading, error, refetch } = useBrowseStorage({ storageId, path: currentPath });

   const isInsideRoot = (path: string) => !rootPath || path === rootPath || path.startsWith(rootPath + '/');

   const navigateToPath = (path: string) => {
      setCurrentPath(isInsideRoot(path) ? path : homePath);
   };

   const navigateUp = () => {
      if (currentPath === homePath) return;
      if (!currentPath.includes('/')) {
         setCurrentPath(homePath);
         return;
      }
      const parentPath = currentPath.split('/').slice(0, -1).join('/');
      setCurrentPath(isInsideRoot(parentPath) ? parentPath : homePath);
   };

   const handleSort = (field: SortField) => {
      if (sortField === field) {
         setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
      } else {
         setSortField(field);
         setSortOrder('asc');
      }
   };

   const sortedItems: FileItem[] = useMemo(() => {
      const items: FileItem[] = data?.result?.items || [];
      if (!sortField) return items;

      const directories = items.filter((item) => item.isDirectory);
      const files = items.filter((item) => !item.isDirectory);
      return [...sortFileItems([...directories], sortField, sortOrder), ...sortFileItems([...files], sortField, sortOrder)];
   }, [data, sortField, sortOrder]);

   const getSortIcon = (field: SortField) => {
      if (sortField !== field) return null;
      return sortOrder === 'asc' ? ' ↑' : ' ↓';
   };

   const renderPathBreadcrumbs = () => {
      if (!currentPath) return 'Storage Root';

      const allSegments = currentPath.split('/').filter(Boolean);
      // Nothing above the jail root is reachable, so those segments are not shown.
      const rootDepth = rootPath ? rootPath.split('/').filter(Boolean).length : 0;
      const segments = allSegments.slice(rootDepth === 0 ? 0 : rootDepth - 1);
      const offset = allSegments.length - segments.length;

      return segments.map((segment, index) => {
         const path = allSegments.slice(0, offset + index + 1).join('/');
         return (
            <span key={path}>
               <button onClick={() => navigateToPath(path)}>{segment}</button>
               {index < segments.length - 1 && ' > '}
            </span>
         );
      });
   };

   const FileRow = ({ index, style }: { index: number; style: React.CSSProperties }) => {
      const item = sortedItems[index];

      return (
         <div style={style} className={classes.fileRow} onClick={() => item.isDirectory && navigateToPath(item.path)}>
            <div className={classes.fileName}>
               {item.isDirectory ? <Icon type={`fm-${item.type}`} size={18} /> : <FileIcon filename={item.name} />}
               {item.isDirectory ? (
                  <button type="button" className={classes.fileNameText} title={item.name}>
                     {item.name}
                  </button>
               ) : (
                  <span className={classes.fileNameText} title={item.name}>
                     {item.name}
                  </span>
               )}
               {renderFileActions && <div className={classes.fileActions}>{renderFileActions(item)}</div>}
            </div>
            {isMobileDevice ? (
               <div className={classes.mobileFileInfo}>
                  {!item.isDirectory && <div className={classes.fileSize}>{item.size ? formatBytes(item.size) : '-'}</div>}
                  <div className={classes.fileDate}>{item.modifiedAt ? formatDateTime(item.modifiedAt) : '-'}</div>
               </div>
            ) : (
               <>
                  <div className={classes.fileSize}>{item.size ? formatBytes(item.size) : '-'}</div>
                  <div className={classes.fileDate}>{item.modifiedAt ? formatDateTime(item.modifiedAt) : '-'}</div>
               </>
            )}
         </div>
      );
   };

   const closeOnBGClick = (e: React.SyntheticEvent) => {
      e.stopPropagation();
      e.nativeEvent.stopImmediatePropagation();
      if (e.target === e.currentTarget) {
         close();
      }
   };

   return createPortal(
      <div className={classes.browserModal} onClick={closeOnBGClick}>
         <div className={classes.browserModalInner}>
            <div className={classes.browserHeader}>
               <h4 title={title}>
                  {storageType && <img src={`/providers/${storageType}.png`} />}
                  {title}
               </h4>
               <button onClick={() => close()}>
                  <Icon type="close" size={20} />
               </button>
            </div>

            <div className={classes.navigationBar}>
               <button onClick={navigateUp} disabled={currentPath === homePath} title="Move Up">
                  <Icon type="arrow-up" size={18} />
               </button>
               <button onClick={() => setCurrentPath(homePath)} disabled={currentPath === homePath} title="Home">
                  <Icon type="home" size={18} />
               </button>
               <button onClick={() => refetch()} title="Refresh">
                  <Icon type="reload" size={18} />
               </button>
               <div
                  className={classes.currentPath}
                  onClick={() => {
                     setCustomPath(currentPath);
                     setShowPathInput(true);
                  }}
               >
                  {showPathInput ? (
                     <input
                        value={customPath}
                        onChange={(e) => setCustomPath(e.target.value)}
                        onKeyDown={(e) => {
                           if (e.key === 'Enter') {
                              navigateToPath(customPath);
                              setShowPathInput(false);
                           }
                        }}
                        onBlur={() => setShowPathInput(false)}
                        autoFocus
                     />
                  ) : (
                     renderPathBreadcrumbs()
                  )}
               </div>
            </div>

            <div className={classes.fileListContainer}>
               <div className={classes.fileHeader}>
                  <div onClick={() => handleSort('name')}>Name {getSortIcon('name')}</div>
                  <div onClick={() => handleSort('size')}>Size {getSortIcon('size')}</div>
                  <div onClick={() => handleSort('modifiedAt')}>Modified {getSortIcon('modifiedAt')}</div>
               </div>

               {isLoading ? (
                  <div className={classes.message}>Loading...</div>
               ) : error ? (
                  <div className={classes.message}>{(error as Error)?.message || 'Failed to read this storage.'}</div>
               ) : sortedItems.length === 0 ? (
                  <div className={classes.message}>No files or folders found</div>
               ) : (
                  <List
                     height={window.innerHeight - 320}
                     itemCount={sortedItems.length}
                     itemSize={ITEM_HEIGHT}
                     width="100%"
                     className={`${classes.fileList} styled__scrollbar`}
                  >
                     {FileRow}
                  </List>
               )}
            </div>
         </div>
      </div>,
      document.body,
   );
};

export default StorageFileBrowser;
