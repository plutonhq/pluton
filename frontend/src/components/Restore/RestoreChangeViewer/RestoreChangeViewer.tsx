import { RestoreSlim } from '../../../@types/restores';
import { useGetRestoreStats } from '../../../services/restores';
import Icon from '../../common/Icon/Icon';
import RestoredFileBrowser from '../RestoredFileBrowser/RestoredFileBrowser';
import classes from './RestoreChangeViewer.module.scss';

interface RestoreChangeViewerProps {
   restore: RestoreSlim;
   close: () => void;
}

const RestoreChangeViewer = ({ restore, close }: RestoreChangeViewerProps) => {
   const { data } = useGetRestoreStats(restore.id);
   console.log('Restore Stats :', data?.result?.restoredPaths);
   return (
      <div className={classes.preview}>
         <div className={classes.previewWrapper}>
            <div className={classes.previewHeader}>
               <h3>
                  Restore File Changes{' '}
                  <span className={`label ${restore.status !== 'completed' ? 'error' : 'success'}`}>
                     {restore.status === 'completed' ? 'Successfully Restored' : 'Restoration Failed'}{' '}
                  </span>
               </h3>
               <button className={classes.closePreview} onClick={() => close()}>
                  <Icon type="close" size={24} />
               </button>
            </div>
            <div className={classes.previewBrowser}>
               <RestoredFileBrowser files={data?.result?.restoredPaths || []} stats={restore.taskStats || undefined} />
            </div>
         </div>
      </div>
   );
};

export default RestoreChangeViewer;
