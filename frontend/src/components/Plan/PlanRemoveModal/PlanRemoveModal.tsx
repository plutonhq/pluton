import { useState } from 'react';
import { toast } from 'react-toastify';
import { useNavigate } from 'react-router';
import ActionModal from '../../common/ActionModal/ActionModal';
import { useDeletePlan } from '../../../services/plans';
import Toggle from '../../common/form/Toggle/Toggle';
import classes from './PlanRemoveModal.module.scss';

interface PlanRemoveModalProps {
   planId: string;
   taskPending: boolean;
   actionInProgress: boolean;
   close: (value?: boolean) => void;
}

const PlanRemoveModal = ({ planId, taskPending, actionInProgress, close }: PlanRemoveModalProps) => {
   const [removeRemoteData, setRemoveRemoteData] = useState(false);

   const navigate = useNavigate();
   const deletePlanMutation = useDeletePlan();

   const removePlan = () => {
      if (actionInProgress) {
         return toast.error('A Backup/Restore Process is in Progress.');
      }
      if (taskPending) {
         return;
      }
      deletePlanMutation.mutate(
         { id: planId, removeRemoteData },
         {
            onError: (error: Error) => {
               console.log('error :', error?.message);
               toast.error(error.message || `Error Removing Plan!`);
            },
            onSuccess: (data: any) => {
               console.log('Success :', data);
               toast.success(`Removed Backup Plan Successfully!`, { autoClose: 5000 });
               navigate('/');
            },
         },
      );
   };

   return (
      <ActionModal
         title="Remove Backup Plan"
         message={
            <div>
               Are you sure you want to remove this Plan? All the Snapshots of this Backup plan will be removed.
               <Toggle
                  fieldValue={removeRemoteData}
                  onUpdate={setRemoveRemoteData}
                  description={`Remove remote backup data from the Remote Storage`}
                  customClasses={classes.removeRemoteToggle}
               />
            </div>
         }
         closeModal={() => !deletePlanMutation.isPending && close(false)}
         width="400px"
         primaryAction={{
            title: 'Yes, Remove Plan',
            type: 'danger',
            icon: 'trash',
            isPending: deletePlanMutation.isPending,
            action: () => removePlan(),
         }}
      />
   );
};

export default PlanRemoveModal;
