import PageTitle from '../../App/PageTitle/PageTitle';
import Icon from '../Icon/Icon';
import classes from './PageHeader.module.scss';

interface PageHeaderProps {
   title: string | React.ReactNode;
   pageTitle?: string;
   icon: string;
   stat?: number;
   buttonTitle?: string;
   buttonAction?: Function;
   rightSection?: React.ReactNode;
}

const PageHeader = ({ title, pageTitle, icon, stat, buttonTitle, buttonAction, rightSection }: PageHeaderProps) => {
   return (
      <>
         <PageTitle title={pageTitle ? pageTitle : typeof title === 'string' ? title : ''} />
         <div className={classes.header}>
            <div>
               <h2 className={classes.headerTitle}>
                  {icon && <Icon size={24} type={icon} />} {title && title} {stat && <span>{stat}</span>}
                  {buttonTitle && buttonAction && (
                     <button className={classes.button} onClick={() => buttonAction()}>
                        {buttonTitle}
                     </button>
                  )}
               </h2>
            </div>
            <div className={classes.rightSection}>{rightSection && rightSection}</div>
         </div>
      </>
   );
};

export default PageHeader;
