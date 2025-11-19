import { PropsWithChildren } from 'react';
import classes from './AppContent.module.scss';

const AppContent = ({ children }: PropsWithChildren) => {
   return (
      <div className={classes.appContentWrap}>
         <div className={classes.appContent}>
            <div className={classes.appContentInner}>{children}</div>
         </div>
      </div>
   );
};

export default AppContent;
