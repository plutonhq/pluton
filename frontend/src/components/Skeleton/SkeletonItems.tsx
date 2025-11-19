import classes from './SkeletonItems.module.scss';

interface SkeletonItemsProps {
   type?: 'plan' | 'storage' | 'source';
   layout?: 'list' | 'grid';
   count?: number;
}

const SkeletonItems = ({ type = 'plan', layout = 'list', count = 6 }: SkeletonItemsProps) => {
   return (
      <div className={`${classes.skeletonItems} ${layout === 'grid' ? classes.grid : classes.list}`}>
         {Array.from({ length: count ? (layout === 'list' ? 3 : 6) : 6 }).map((_, index) => (
            <div key={index} className={classes.skeletonItem}>
               <div className={classes.leftContent}>
                  <div className={classes.status} />
                  <div className={classes.content}>
                     <div className={classes.title} />
                     <div className={classes.sources} />
                  </div>
               </div>
               <div className={classes.rightContent}>
                  <div />
                  <div />
                  {type === 'plan' && <div />}
                  {type === 'plan' && <div className={classes.history} />}
               </div>
            </div>
         ))}
      </div>
   );
};

export default SkeletonItems;
