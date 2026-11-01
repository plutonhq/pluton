import React, { ReactNode } from 'react';
import Icon from '../../common/Icon/Icon';
import FileIcon from '../../common/FileIcon/FileIcon';
import { formatBytes, formatDateTime, proViewableFileFormats, proViewFileFormatObj, timeAgo } from '../../../utils/helpers';
import { FileItem } from '../../../@types/system';
import { SnapshotIndexRow } from '../../../@types/backups';
import classes from '../../common/SnapshotBrowser/SnapshotBrowser.module.scss';

interface SnapshotViewerFileProps {
   style: React.CSSProperties;
   file: SnapshotIndexRow | { isGoUp: true; path: string; name: string; isDirectory: true };
   isSync?: boolean;
   gridColumns: string;
   onGoUp: () => void;
   onDirectoryClick: (path: string) => void;
   onRestore: (file: FileItem) => void;
   renderFileActions?: (file: FileItem, meta: { fileExtension: string; isDirectory: boolean }) => ReactNode;
   hideRestore?: boolean;
   showUpgradeModal?: () => void;
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
   hideRestore,
   showUpgradeModal,
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

   const typedFile = file as SnapshotIndexRow;
   const fileName = typedFile.name || typedFile.path.split('/').pop() || '';
   const isDirectory = typedFile.isDirectory;
   const fileExtension = fileName.split('.').pop() || '';
   const isPlayable = [...proViewFileFormatObj.audio, ...proViewFileFormatObj.video].includes(fileExtension);

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
         <div className={classes.fileModifiedAt} title={typedFile.modifiedAt ? formatDateTime(typedFile.modifiedAt) : undefined}>
            <i>{typedFile.modifiedAt ? timeAgo(new Date(typedFile.modifiedAt)) : ''}</i>
         </div>
         <div className={classes.fileSize}>
            {!isDirectory ? formatBytes(typedFile.size || 0) : typedFile.dirBytes !== undefined ? formatBytes(typedFile.dirBytes) : ''}
         </div>
         {!isSync && (
            <div className={classes.fileActions}>
               {renderFileActions?.(typedFile, { fileExtension, isDirectory })}
               {!renderFileActions && !isDirectory && proViewableFileFormats.includes(fileExtension) && (
                  <button
                     style={{ opacity: '0.4' }}
                     onClick={(e) => {
                        e.stopPropagation();
                        showUpgradeModal?.();
                     }}
                  >
                     <Icon type={isPlayable ? 'play' : 'eye'} size={16} />
                  </button>
               )}

               {!renderFileActions && (
                  <button
                     style={{ opacity: '0.5' }}
                     onClick={(e) => {
                        e.stopPropagation();
                        showUpgradeModal?.();
                     }}
                  >
                     <Icon type={'download'} size={16} />
                  </button>
               )}
               {!hideRestore && (
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
               )}
            </div>
         )}
      </div>
   );
};

export default SnapshotViewerFile;
