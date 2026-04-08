import React from 'react';
import classes from './SnapshotBrowser.module.scss';

interface SnapshotBrowserGoUpRowProps {
   style: React.CSSProperties;
   onGoUp: () => void;
   gridTemplateColumns?: string;
}

const SnapshotBrowserGoUpRow = ({ style, onGoUp, gridTemplateColumns }: SnapshotBrowserGoUpRowProps) => {
   return (
      <div
         style={{ ...style, ...(gridTemplateColumns ? { gridTemplateColumns } : {}) }}
         className={`${classes.snapshotFile} ${classes.fileIsDir} ${classes.goUpButton}`}
         onClick={onGoUp}
      >
         <div className={classes.fileName}>...</div>
      </div>
   );
};

export default SnapshotBrowserGoUpRow;
