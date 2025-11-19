import { createPortal } from 'react-dom';
import Icon from '../Icon/Icon';
import classes from './SidePanel.module.scss';
import { useEffect, useState } from 'react';

type SidePanelProps = {
   title: string;
   icon: React.ReactNode;
   children: React.ReactNode;
   width?: string;
   withTabs?: boolean;
   footer?: React.ReactNode;
   close: () => void;
};

const SidePanel = ({ close, children, title, icon, footer, width, withTabs }: SidePanelProps) => {
   const [isActive, setIsActive] = useState(false);

   useEffect(() => {
      const body = document.querySelector('body');
      if (body) {
         body.style.overflow = 'hidden';
      }

      // Trigger the animation after component mounts
      setTimeout(() => {
         setIsActive(true);
      }, 10);

      return () => {
         if (body) {
            body.style.overflow = 'auto';
         }
      };
   }, []);

   const handleClose = () => {
      setIsActive(false);
      // Wait for animation to complete before actually closing
      setTimeout(() => {
         close();
      }, 300); // Match this with your CSS transition duration
   };

   return createPortal(
      <div className={classes.sidePanel}>
         <div className={`${classes.wrapper} ${isActive ? classes.active : ''} ${withTabs ? classes.noPadding : ''}`} style={{ width: width }}>
            <div className={classes.header}>
               <h3>
                  {icon && icon} {title}
               </h3>
               <button className={classes.close} onClick={handleClose}>
                  <Icon type="close" size={24} />
               </button>
            </div>
            {!withTabs ? (
               <div className={`${classes.content} styled__scrollbar ${footer ? classes.hasFooter : classes.noFooter}`}>{children}</div>
            ) : (
               <div>{children}</div>
            )}
            {footer && <div className={classes.footer}>{footer}</div>}
         </div>
      </div>,
      document.body,
   );
};

export default SidePanel;
