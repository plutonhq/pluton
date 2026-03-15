import { useState } from 'react';
import { BackupMirror } from '../../../@types/backups';
import Icon from '../../common/Icon/Icon';
import classes from './MirrorStatusBadge.module.scss';
import MirrorDetails from './MirrorDetails';
import { PlanReplicationSettings } from '../../../@types';

interface MirrorStatusBadgeProps {
   mirrors: BackupMirror[];
   planId: string;
   backupId: string;
   replicationSettings?: PlanReplicationSettings;
}

const MirrorStatusBadge = ({ mirrors, planId, backupId, replicationSettings }: MirrorStatusBadgeProps) => {
   const [showMirrorDetails, setShowMirrorDetails] = useState(false);
   if (!mirrors || mirrors.length === 0) return null;

   const completed = mirrors.filter((m) => m.status === 'completed').length;
   const failed = mirrors.filter((m) => m.status === 'failed').length;
   const inProgress = mirrors.filter((m) => m.status === 'started' || m.status === 'pending').length;
   const total = mirrors.length;

   let badgeClass = classes.badge;
   let label: string;

   if (inProgress > 0) {
      badgeClass += ` ${classes.badgeProgress}`;
      label = 'Replicating...';
   } else if (failed === total) {
      badgeClass += ` ${classes.badgeFailed}`;
      label = 'Replication failed';
   } else if (failed > 0) {
      badgeClass += ` ${classes.badgePartial}`;
      label = `${completed}/${total} mirrors`;
   } else {
      badgeClass += ` ${classes.badgeSuccess}`;
      label = `${total} mirror${total > 1 ? 's' : ''}`;
   }

   return (
      <>
         <span
            className={badgeClass}
            data-tooltip-id="htmlToolTip"
            data-tooltip-place="top"
            data-tooltip-html={`<div>${label}</div>`}
            onClick={() => setShowMirrorDetails(true)}
         >
            <Icon type={'mirrors'} size={13} />
         </span>
         {showMirrorDetails && (
            <MirrorDetails
               mirrors={mirrors}
               planId={planId}
               backupId={backupId}
               replicationSettings={replicationSettings}
               close={() => setShowMirrorDetails(false)}
            />
         )}
      </>
   );
};

export default MirrorStatusBadge;
