import React, { ReactNode } from 'react';
import Icon from '../../common/Icon/Icon';
import FileIcon from '../../common/FileIcon/FileIcon';
import { formatBytes, formatDateTime, timeAgo } from '../../../utils/helpers';
import { FileItem } from '../../../@types/system';
import classes from '../../common/SnapshotBrowser/SnapshotBrowser.module.scss';

interface SnapshotViewerFileProps {
   style: React.CSSProperties;
   file: FileItem | { isGoUp: true; path: string; name: string; isDirectory: true };
   isSync?: boolean;
   gridColumns: string;
   onGoUp: () => void;
   onDirectoryClick: (path: string) => void;
   onRestore: (file: FileItem) => void;
   renderFileActions?: (file: FileItem, meta: { fileExtension: string; isDirectory: boolean }) => ReactNode;
}

const SnapshotViewerFile = ({
   style,
   file,
   isSync,
   gridColumns,
   onGoUp,
   onDirectoryClick,
   onRestore,
   renderFileActions,
}: SnapshotViewerFileProps) => {
   if (!file) return null;

   if ('isGoUp' in file && file.isGoUp) {
      return (
         <div
            style={{ ...style, gridTemplateColumns: gridColumns }}
            className={`${classes.snapshotFile} ${classes.fileIsDir} ${classes.goUpButton}`}
            onClick={onGoUp}
         >
            <div className={classes.fileName}>...</div>
            <div></div>
            <div></div>
            {!isSync && <div></div>}
         </div>
      );
   }

   const typedFile = file as FileItem;
   const fileName = typedFile.name || typedFile.path.split('/').pop() || '';
   const isDirectory = typedFile.isDirectory;
   const fileExtension = fileName.split('.').pop() || '';

   return (
      <div
         style={{ ...style, gridTemplateColumns: gridColumns }}
         className={`${classes.snapshotFile} ${isDirectory ? classes.fileIsDir : ''}`}
         onClick={() => {
            if (isDirectory) {
               onDirectoryClick(typedFile.path);
            }
         }}
      >
         <div className={classes.fileName}>
            {isDirectory ? <Icon type={'fm-directory'} size={16} /> : <FileIcon filename={fileName} />} {fileName}
         </div>
         <div className={classes.fileModifiedAt} title={formatDateTime(typedFile.modifiedAt)}>
            <i>{timeAgo(new Date(typedFile.modifiedAt))}</i>
         </div>
         <div className={classes.fileSize}>{!isDirectory ? formatBytes(typedFile.size || 0) : ''}</div>
         {!isSync && (
            <div className={classes.fileActions}>
               {renderFileActions?.(typedFile, { fileExtension, isDirectory })}
               <button
                  data-tooltip-id="htmlToolTip"
                  data-tooltip-place="top"
                  data-tooltip-delay-show={500}
                  data-tooltip-html="Restore"
                  onClick={(e) => {
                     e.stopPropagation();
                     onRestore(typedFile);
                  }}
               >
                  <Icon type={'restore'} size={16} />
               </button>
            </div>
         )}
      </div>
   );
};

export default SnapshotViewerFile;
