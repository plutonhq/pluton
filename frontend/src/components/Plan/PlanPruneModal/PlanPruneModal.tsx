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

   return (
      <ActionModal
         title={method === 'sync' ? 'Clean Up Old Revisions' : 'Clean Up Old Backups'}
         message={
            <>
               {method === 'sync' ? (
                  <>
                     Your plan is set to maintain{' '}
                     {prune.policy === 'forgetByAge' ? `file revisions newer than ${planIntervalAgeName(prune.forgetAge || '3m')}.` : ''}{' '}
                     {prune.policy === 'forgetByFileCount' ? `Only keep the last ${prune.snapCount} versions of each file.` : ''} This action will
                     remove any excess file revisions older than the retention policy.
                  </>
               ) : (
                  <>
                     Your plan is set to maintain {prune.snapCount} recent backups(snapshots).{' '}
                     {prune.snapCount < snapshotsCount
                        ? `Running prune now will remove ${' '}
                        ${snapshotsCount - prune.snapCount} older snapshots, freeing up some storage space`
                        : 'There are no excess snapshots to clean up.'}
                  </>
               )}
            </>
         }
         closeModal={() => !pruneMutation.isPending && close()}
         width="500px"
         primaryAction={{
            title: method === 'sync' ? `Yes, Remove Old Revisions` : prune.snapCount < snapshotsCount ? 'Yes, Remove Old Backups' : '',
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
