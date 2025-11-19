import { useUnlockPlan } from '../../../services/plans';
import ActionModal from '../../common/ActionModal/ActionModal';

interface PlanUnlockModalProps {
   planId: string;
   taskPending: boolean;
   close: () => void;
}

const PlanUnlockModal = ({ planId, taskPending, close }: PlanUnlockModalProps) => {
   const unlockMutation = useUnlockPlan();
   return (
      <ActionModal
         title="Unlock Stale Locks"
         message={<>Remove unused locks left by failed backups. This helps if a backup is stuck and you want to start a new one.</>}
         closeModal={() => !unlockMutation.isPending && close()}
         width="500px"
         primaryAction={{
            title: 'Yes, Unlock',
            type: 'default',
            isPending: unlockMutation.isPending,
            action: () =>
               !taskPending &&
               unlockMutation.mutate(planId, {
                  onSuccess: () => {
                     close();
                  },
               }),
         }}
      />
   );
};

export default PlanUnlockModal;
