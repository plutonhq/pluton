import { PlanPrune } from '../../../@types/plans';
import { usePrunePlan } from '../../../services/plans';
import { planIntervalAgeName } from '../../../utils/plans';
import ActionModal from '../../common/ActionModal/ActionModal';

interface PlanPruneModalProps {
   planId: string;
   method: string;
   prune: PlanPrune;
   snapshotsCount: number;
   taskPending: boolean;
   close: () => void;
}

const PlanPruneModal = ({ planId, method, prune, snapshotsCount, taskPending, close }: PlanPruneModalProps) => {
   const pruneMutation = usePrunePlan();

   const getBackupMessage = () => {
      switch (prune.policy) {
         case 'keepLast':
            return (
               <>
                  Your plan is set to keep the last {prune.snapCount} backups.{' '}
                  {prune.snapCount < snapshotsCount
                     ? `Running prune now will remove ${snapshotsCount - prune.snapCount} older snapshots, freeing up some storage space.`
                     : 'There are no excess snapshots to clean up.'}
               </>
            );
         case 'forgetByAge':
            return (
               <>
                  Your plan is set to remove backups older than {planIntervalAgeName(prune.forgetAge || '3m')}, while always keeping at least{' '}
                  {prune.snapCount || 1} backup{(prune.snapCount || 1) > 1 ? 's' : ''}. This action will remove any backups that exceed the retention
                  policy.
               </>
            );
         case 'custom':
            return (
               <>
                  Your plan uses an advanced retention policy
                  {prune.keepDailySnaps ? `, keeping daily backups for ${prune.keepDailySnaps} days` : ''}
                  {prune.keepWeeklySnaps ? `, weekly backups for ${prune.keepWeeklySnaps} weeks` : ''}
                  {prune.keepMonthlySnaps ? `, monthly backups for ${prune.keepMonthlySnaps} months` : ''}, while always keeping at least{' '}
                  {prune.snapCount || 1} backup{(prune.snapCount || 1) > 1 ? 's' : ''}. This action will remove any backups that exceed the retention
                  policy.
               </>
            );
         case 'disable':
            return <>Pruning is disabled for this plan. No backups will be removed.</>;
         default:
            return (
               <>
                  Your plan is set to maintain {prune.snapCount} recent backups.{' '}
                  {prune.snapCount < snapshotsCount
                     ? `Running prune now will remove ${snapshotsCount - prune.snapCount} older snapshots, freeing up some storage space.`
                     : 'There are no excess snapshots to clean up.'}
               </>
            );
      }
   };

   const canPrune = () => {
      if (prune.policy === 'disable') return false;
      if (prune.policy === 'keepLast' && prune.snapCount >= snapshotsCount) return false;
      return true;
   };

   return (
      <ActionModal
         title={method === 'sync' ? 'Clean Up Old Revisions' : 'Clean Up Old Backups'}
         message={
            <>
               {method === 'sync' ? (
                  <>
                     Your plan is set to maintain{' '}
                     {prune.policy === 'forgetByAge' ? `file revisions newer than ${planIntervalAgeName(prune.forgetAge || '3m')}.` : ''} This action
                     will remove any excess file revisions older than the retention policy.
                  </>
               ) : (
                  getBackupMessage()
               )}
            </>
         }
         closeModal={() => !pruneMutation.isPending && close()}
         width="500px"
         primaryAction={{
            title: method === 'sync' ? 'Yes, Remove Old Revisions' : canPrune() ? 'Yes, Remove Old Backups' : '',
            type: 'default',
            isPending: pruneMutation.isPending,
            action: () =>
               !taskPending &&
               pruneMutation.mutate(planId, {
                  onSuccess: () => {
                     close();
                  },
               }),
         }}
      />
   );
};

export default PlanPruneModal;
