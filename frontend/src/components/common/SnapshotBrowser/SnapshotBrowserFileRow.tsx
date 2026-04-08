import React, { ReactNode } from 'react';
import Icon from '../Icon/Icon';
import FileIcon from '../FileIcon/FileIcon';
import classes from './SnapshotBrowser.module.scss';

interface SnapshotBrowserFileRowProps {
   style: React.CSSProperties;
   file: { path: string; name?: string; isDirectory?: boolean };
   isDirectory: boolean;
   onClick?: () => void;
   namePrefix?: ReactNode;
   children?: ReactNode;
   gridTemplateColumns?: string;
   className?: string;
}

const SnapshotBrowserFileRow = ({
   style,
   file,
   isDirectory,
   onClick,
   namePrefix,
   children,
   gridTemplateColumns,
   className,
}: SnapshotBrowserFileRowProps) => {
   const fileName = file.name || file.path.split('/').pop() || '';

   return (
      <div
         style={{ ...style, ...(gridTemplateColumns ? { gridTemplateColumns } : {}) }}
         className={`${classes.snapshotFile} ${isDirectory ? classes.fileIsDir : ''} ${className || ''}`}
         onClick={onClick}
      >
         <div className={classes.fileName}>
            {namePrefix}
            {isDirectory ? <Icon type={'fm-directory'} size={16} /> : <FileIcon filename={fileName} />} {fileName}
         </div>
         {children}
      </div>
   );
};

export default SnapshotBrowserFileRow;
