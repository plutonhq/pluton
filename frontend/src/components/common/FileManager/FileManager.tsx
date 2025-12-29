import { useMemo, useState } from 'react';
import { FixedSizeList as List } from 'react-window';
import Icon from '../Icon/Icon';
import classes from './FileManager.module.scss';
import { useBrowseDir } from '../../../services/devices';
import { formatBytes, formatDateTime, isMobile, sortFileItems } from '../../../utils/helpers';
import FileIcon from '../FileIcon/FileIcon';

type FileManagerProps = {
   deviceId: string;
   onSelect: (path: string) => void;
   selectedPaths?: {
      includes: string[];
      excludes: string[];
   };
   defaultPath?: string;
   selectionType?: 'all' | 'directory' | 'file';
   allowMultiple?: boolean;
};

type FileItem = {
   name: string;
   path: string;
   type: 'directory' | 'file';
   isDirectory: boolean;
   size: number;
   modifiedAt: string;
   owner: string;
   permissions: number;
};

type SortField = 'name' | 'size' | 'modifiedAt' | 'owner' | 'permissions' | null;
type SortOrder = 'asc' | 'desc';
const isMobileDevice = isMobile();
const ITEM_HEIGHT = isMobileDevice ? 68 : 38;

export const FileManager = ({
   deviceId,
   onSelect,
   selectedPaths = { includes: [], excludes: [] },
   defaultPath,
   allowMultiple = true,
   selectionType = 'all',
}: FileManagerProps) => {
   const [currentPath, setCurrentPath] = useState(() => defaultPath || '');
   const [showPathInput, setShowPathInput] = useState(false);
   const [customPath, setCustomPath] = useState('');
   const [sortField, setSortField] = useState<SortField>(null);
   const [sortOrder, setSortOrder] = useState<SortOrder>('asc');

   const { data, isLoading, refetch } = useBrowseDir({ deviceId, path: currentPath });

   const navigateToPath = (path: string) => {
      setCurrentPath(path);
   };

   const navigateUp = () => {
      // If we're at a root drive/mount point, go to drives list
      if (currentPath === defaultPath) {
         return;
      }
      if (!currentPath.includes('/') || currentPath === '/') {
         setCurrentPath('');
         return;
      }

      const parentPath = currentPath.split('/').slice(0, -1).join('/');
      console.log('parentPath :', currentPath, parentPath);
      setCurrentPath(parentPath);
   };

   const handleSort = (field: SortField) => {
      if (sortField === field) {
         setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
      } else {
         setSortField(field);
         setSortOrder('asc');
      }
   };

   const isPathSelected = (path: string) => {
      const isDirectorySelection = selectionType === 'directory' && allowMultiple === false;
      const isIncluded = selectedPaths.includes.includes(path);
      const isExcluded = selectedPaths.excludes.includes(path);
      const isParentIncluded = !isDirectorySelection && selectedPaths.includes.some((p) => path.startsWith(p + '/'));

      if (isExcluded) return false;
      return isIncluded || isParentIncluded;
   };

   const isPathSelectable = (path: string) => {
      const isParentIncluded = selectedPaths.includes.some((p) => path.startsWith(p + '/'));
      return !selectedPaths.includes.some((p) => path.startsWith(p + '/')) || isParentIncluded;
   };

   const sortedItems = useMemo(() => {
      if (!data?.result?.items) return [];
      if (!sortField) return selectionType === 'directory' ? data.result.items.filter((item: FileItem) => item.isDirectory) : data.result.items;
      const filteredItems: FileItem[] =
         selectionType === 'directory' ? data.result.items.filter((item: FileItem) => item.isDirectory) : data.result.items;

      const directories = filteredItems.filter((item) => item.isDirectory);
      const files = filteredItems.filter((item) => !item.isDirectory);
      const sortedDirectories = sortFileItems([...directories], sortField, sortOrder);
      const sortedFiles = sortFileItems([...files], sortField, sortOrder);

      return [...sortedDirectories, ...sortedFiles];
   }, [data, sortField, sortOrder]);

   const getSortIcon = (field: SortField) => {
      if (sortField !== field) return null;
      return sortOrder === 'asc' ? ' ↑' : ' ↓';
   };

   const renderPathBreadcrumbs = () => {
      if (!currentPath) return 'Drives';

      const segments = currentPath.split('/').filter(Boolean);
      return segments.map((segment, index) => {
         const path = segments.slice(0, index + 1).join('/');
         return (
            <span key={path}>
               <button onClick={() => setCurrentPath(path)}>{segment}</button>
               {index < segments.length - 1 && ' > '}
            </span>
         );
      });
   };

   const FileRow = ({ index, style }: { index: number; style: React.CSSProperties }) => {
      const item = sortedItems[index];

      return (
         <div
            style={style}
            className={`${classes.fileRow} ${isPathSelected(item.path) ? classes.selected : ''}`}
            onClick={() => item.isDirectory && navigateToPath(item.path)}
         >
            <div className={classes.fileName}>
               <button
                  onClick={(e) => {
                     e.stopPropagation();
                     if (isPathSelectable(item.path)) {
                        if (!allowMultiple) {
                           onSelect(item.path);
                        } else {
                           onSelect(item.path);
                        }
                     }
                  }}
                  disabled={!isPathSelectable(item.path)}
               >
                  <Icon type={isPathSelected(item.path) ? 'check-circle-filled' : 'check-circle'} />
               </button>
               {item.type != 'file' ? <Icon type={`fm-${item.type}`} size={18} /> : <FileIcon filename={item.name} />}
               <span className={classes.fileNameText} title={item.name}>
                  {item.name}
               </span>
            </div>
            {isMobileDevice ? (
               <div className={classes.mobileFileInfo}>
                  {!item.isDirectory && <div className={classes.fileSize}>{item.size ? formatBytes(item.size) : '-'}</div>}
                  <div className={classes.fileDate}>{item.modifiedAt ? formatDateTime(item.modifiedAt) : '-'}</div>
               </div>
            ) : (
               <>
                  {' '}
                  <div className={classes.fileSize}>{item.size ? formatBytes(item.size) : '-'}</div>
                  <div className={classes.fileDate}>{item.modifiedAt ? formatDateTime(item.modifiedAt) : '-'}</div>
                  <div className={classes.fileOwner}>{item.owner || '-'}</div>
                  <div className={classes.filePerms}>{item.permissions ? item.permissions : '-'}</div>
               </>
            )}
         </div>
      );
   };

   return (
      <div className={classes.fileManager}>
         <div className={classes.navigationBar}>
            <button onClick={navigateUp} disabled={currentPath === ''} title="Move Up">
               <Icon type="arrow-up" size={18} />
            </button>
            <button onClick={() => setCurrentPath('')} disabled={currentPath === ''} title="Home">
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
                           setCurrentPath(customPath);
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
               <div className={classes.fileName} onClick={() => handleSort('name')}>
                  Name {getSortIcon('name')}
               </div>
               <div className={classes.fileSize} onClick={() => handleSort('size')}>
                  Size {getSortIcon('size')}
               </div>
               <div className={classes.fileDate} onClick={() => handleSort('modifiedAt')}>
                  Modified {getSortIcon('modifiedAt')}
               </div>
               <div className={classes.fileOwner} onClick={() => handleSort('owner')}>
                  Owner {getSortIcon('owner')}
               </div>
               <div className={classes.filePerms} onClick={() => handleSort('permissions')}>
                  Permissions {getSortIcon('permissions')}
               </div>
            </div>

            {isLoading ? (
               <div className={classes.loading}>Loading...</div>
            ) : sortedItems.length === 0 ? (
               <div className={classes.empty}>{selectionType === 'directory' ? 'No folders found' : 'No files or folders found'}</div>
            ) : (
               <List
                  height={window.innerHeight - 250}
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
   );
};
