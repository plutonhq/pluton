import { useState } from 'react';
import { BackupMirror } from '../../../@types/backups';
import Icon from '../../common/Icon/Icon';
import classes from './MirrorStatusBadge.module.scss';
import MirrorDetails from './MirrorDetails';
import { PlanReplicationSettings } from '../../../@types';
import { mirrorSummary } from '../../../utils/replication';

interface MirrorStatusBadgeProps {
   mirrors: BackupMirror[];
   planId: string;
   backupId: string;
   replicationSettings?: PlanReplicationSettings;
   managedAgent?: boolean;
}

const MirrorStatusBadge = ({ mirrors, planId, backupId, replicationSettings, managedAgent }: MirrorStatusBadgeProps) => {
   const [showMirrorDetails, setShowMirrorDetails] = useState(false);
   const expected = replicationSettings?.enabled ? replicationSettings.storages.length : mirrors.length;
   if (!mirrors.length && !expected) return null;
   const summary = mirrorSummary(mirrors, expected);

   let badgeClass = classes.badge;
   if (summary.state === 'pending') {
      badgeClass += ` ${classes.badgeProgress}`;
   } else if (summary.state === 'failed') {
      badgeClass += ` ${classes.badgeFailed}`;
   } else {
      badgeClass += ` ${classes.badgeSuccess}`;
   }

   return (
      <>
         <button
            type="button"
            className={badgeClass}
            aria-label={summary.label}
            title={summary.label}
            data-tooltip-id="appTooltip"
            data-tooltip-place="top"
            data-tooltip-content={summary.label}
            onClick={() => setShowMirrorDetails(true)}
         >
            <Icon type={'mirrors'} size={13} />
            {summary.incomplete && <span>Redundancy incomplete</span>}
         </button>
         {showMirrorDetails && (
            <MirrorDetails
               mirrors={mirrors}
               planId={planId}
               backupId={backupId}
               replicationSettings={replicationSettings}
               managedAgent={managedAgent}
               close={() => setShowMirrorDetails(false)}
            />
         )}
      </>
   );
};

export default MirrorStatusBadge;
