import { ReactNode } from 'react';
import Icon from '../Icon/Icon';
import classes from './SnapshotBrowser.module.scss';

interface SnapshotBrowserToolbarProps {
   search: string;
   onSearchChange: (value: string) => void;
   isLoading?: boolean;
   leftContent?: ReactNode;
   rightContent?: ReactNode;
}

const SnapshotBrowserToolbar = ({ search, onSearchChange, isLoading, leftContent, rightContent }: SnapshotBrowserToolbarProps) => {
   return (
      <div className={classes.toolbar}>
         <div className={classes.toolbarLeft}>{leftContent}</div>
         <div className={classes.toolbarRight}>
            {rightContent}
            <div className={classes.search}>
               <Icon type="search" size={16} />
               <input type="text" placeholder="Search in current Directory..." value={search} onChange={(e) => onSearchChange(e.target.value)} />
               {isLoading && <Icon type="loading" size={12} />}
            </div>
         </div>
      </div>
   );
};

export default SnapshotBrowserToolbar;
