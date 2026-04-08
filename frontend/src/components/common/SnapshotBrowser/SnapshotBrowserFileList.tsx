import React, { ReactNode } from 'react';
import { FixedSizeList as List } from 'react-window';
import classes from './SnapshotBrowser.module.scss';
import { isMobile } from '../../../utils';

const isMobileDevice = isMobile();
const DEFAULT_ITEM_HEIGHT = isMobileDevice ? 65 : 46;

interface SnapshotBrowserFileListProps {
   files: any[];
   height: number;
   itemSize?: number;
   headerContent: ReactNode;
   renderRow: (props: { index: number; style: React.CSSProperties }) => React.ReactElement | null;
   selectedFolder: string | null;
   emptyMessage?: string;
   isLoading?: boolean;
   gridTemplateColumns?: string;
}

const SnapshotBrowserFileList = ({
   files,
   height,
   itemSize = DEFAULT_ITEM_HEIGHT,
   headerContent,
   renderRow,
   selectedFolder,
   emptyMessage = 'Select a folder from the left to browse its content',
   isLoading,
   gridTemplateColumns,
}: SnapshotBrowserFileListProps) => {
   return (
      <div className={classes.fileList}>
         <div className={classes.header} style={gridTemplateColumns ? { gridTemplateColumns } : undefined}>
            {headerContent}
         </div>

         {selectedFolder !== null && files.length > 0 && (
            <div className={classes.virtualFileList}>
               <List height={height} itemCount={files.length} itemSize={itemSize} width="100%" overscanCount={5}>
                  {renderRow}
               </List>
            </div>
         )}

         {selectedFolder === null && <div className={classes.fileListEmpty}>{emptyMessage}</div>}
         {selectedFolder !== null && !isLoading && files.length === 0 && <div className={classes.fileListEmpty}>This folder is empty</div>}
      </div>
   );
};

export default SnapshotBrowserFileList;
