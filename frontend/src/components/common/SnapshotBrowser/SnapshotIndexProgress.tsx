import Icon from '../Icon/Icon';
import { SnapshotIndexStatus } from '../../../@types/backups';
import classes from './SnapshotBrowser.module.scss';

interface SnapshotIndexProgressProps {
   status?: SnapshotIndexStatus;
   error?: Error | null;
   onRetry: () => void;
   /** What the build lists. The default is `snapshot`. */
   subject?: string;
}

const stageLabels = (subject: string) => ({
   queued: `Preparing ${subject} data...`,
   listing: `Reading the ${subject} file list...`,
   transferring: `Receiving the ${subject} file list...`,
   indexing: `Indexing ${subject} data...`,
});

const FAILURE_TITLES: Record<string, string> = {
   agent_update_required: 'Update the agent to browse this snapshot',
   agent_offline: 'The device is offline',
   snapshot_not_found: 'The snapshot was not found in this storage',
   disk_full: 'The server does not have enough disk space',
};

const SnapshotIndexProgress = ({ status, error, onRetry, subject = 'snapshot' }: SnapshotIndexProgressProps) => {
   if (status?.state === 'unsupported') {
      return (
         <div className={classes.errorState}>
            <Icon type="error" size={24} />
            <p>This snapshot cannot be browsed</p>
         </div>
      );
   }

   if (error || status?.state === 'failed') {
      const failed = status?.state === 'failed' ? status : undefined;
      const title = (failed && FAILURE_TITLES[failed.code]) || 'Failed to index this snapshot';
      const message = failed ? failed.error : error?.message;
      return (
         <div className={classes.errorState}>
            <Icon type="error" size={24} />
            <p>{title}</p>
            {message !== title && <small>{message}</small>}
            <button onClick={onRetry}>Try Again</button>
         </div>
      );
   }

   const building = status?.state === 'building' ? status : undefined;
   return (
      <div className={classes.loadingState}>
         <Icon type="loading" size={24} />
         <p>{stageLabels(subject)[building?.stage ?? 'queued']}</p>
         {!!building?.entries && (
            <small>
               {building.entries.toLocaleString()}
               {building.total ? ` of ${building.total.toLocaleString()}` : ''} entries
            </small>
         )}
      </div>
   );
};

export default SnapshotIndexProgress;
