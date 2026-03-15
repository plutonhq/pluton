import { toast } from 'react-toastify';
import { Backup, PlanReplicationSettings } from '../../../@types';
import { useRetryFailedReplications } from '../../../services';
import { formatBytes, formatDuration } from '../../../utils';
import Icon from '../../common/Icon/Icon';
import Modal from '../../common/Modal/Modal';
import classes from './MirrorDetails.module.scss';

interface MirrorDetailsProps {
   mirrors: Backup['mirrors'];
   replicationSettings?: PlanReplicationSettings;
   backupId: string;
   backupTitle?: string;
   planId: string;
   close: () => void;
}

const MirrorDetails = ({ mirrors = [], backupId, backupTitle, planId, close }: MirrorDetailsProps) => {
   const retryReplicationsMutation = useRetryFailedReplications();

   const retryReplication = (backupId: string, replicationId: string) => {
      toast.promise(retryReplicationsMutation.mutateAsync({ backupId, planId, replicationId }), {
         pending: 'Retrying failed replication...',
         success: 'Replication retry queued!',
         error: {
            render({ data }: any) {
               return `Failed to retry replication. ${data?.message || 'Unknown Error.'}`;
            },
         },
      });
   };

   return (
      <Modal title={`Mirrors for ${backupTitle ? backupTitle : 'backup-' + backupId}`} closeModal={close} width="560px">
         <div>
            <div className={classes.mirrorList}>
               {mirrors && mirrors.length > 0 ? (
                  mirrors.map((mirror, index) => {
                     const duration = mirror.ended && mirror.started ? formatDuration((mirror.ended - mirror.started) / 1000) : 'N/A';
                     const mirrorSize = mirror.size ? formatBytes(mirror.size) : '';
                     const label =
                        mirror.status === 'completed'
                           ? 'Completed'
                           : mirror.status === 'failed'
                             ? 'Failed'
                             : mirror.status === 'started'
                               ? 'In Progress'
                               : 'Pending';
                     const iconType =
                        mirror.status === 'completed'
                           ? 'check'
                           : mirror.status === 'failed'
                             ? 'error'
                             : mirror.status === 'started'
                               ? 'loading'
                               : 'clock';
                     return (
                        <div key={index} className={classes.mirrorItem}>
                           <div className={classes.mirrorItemContent}>
                              <div className={classes.mirrorItemLabel}>
                                 <img src={`/providers/${mirror.storageType}.png`} /> {mirror.storageName}{' '}
                                 {mirror.status === 'completed' && (
                                    <>
                                       {mirrorSize && (
                                          <i>
                                             <Icon type="disk" size={12} /> {mirrorSize}
                                          </i>
                                       )}{' '}
                                       <i>
                                          <Icon type="clock" size={12} /> {duration}
                                       </i>
                                    </>
                                 )}
                              </div>
                              <div className={`${classes.mirrorItemStatus} ${classes[mirror.status]}`}>
                                 {mirror.status === 'failed' && (
                                    <button
                                       className={classes.retryButton}
                                       onClick={() => !retryReplicationsMutation.isPending && retryReplication(backupId, mirror.replicationId)}
                                    >
                                       <Icon type={'reload'} size={14} /> Retry
                                    </button>
                                 )}{' '}
                                 <Icon type={iconType} size={12} /> {label}
                              </div>
                           </div>
                           {mirror.error && <div className={classes.mirrorItemError}>{mirror.error}</div>}
                        </div>
                     );
                  })
               ) : (
                  <div>No mirrors available.</div>
               )}
            </div>
         </div>
      </Modal>
   );
};

export default MirrorDetails;
