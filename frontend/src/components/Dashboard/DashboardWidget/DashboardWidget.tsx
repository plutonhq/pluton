import Icon from '../../common/Icon/Icon';
import classes from './DashboardWidget.module.scss';

interface DashboardWidgetProps {
   title: string;
   children: React.ReactNode;
   headerRight?: React.ReactNode;
   isLoading?: boolean;
   customClasses?: string;
   icon?: string;
}

const DashboardWidget = ({ title, icon, children, headerRight, isLoading, customClasses = '' }: DashboardWidgetProps) => {
   return (
      <div className={`${classes.widget} ${customClasses}`}>
         <div className={classes.header}>
            <h3 className={classes.title}>
               <Icon type={icon || "trend"} size={16} /> {title}
            </h3>
            {headerRight && <div className={classes.headerRight}>{headerRight}</div>}
         </div>
         <div className={classes.content}>
            {isLoading ? (
               <div className={classes.loading}>
                  <Icon type="loading" size={24} />
               </div>
            ) : (
               children
            )}
         </div>
      </div>
   );
};

export default DashboardWidget;
