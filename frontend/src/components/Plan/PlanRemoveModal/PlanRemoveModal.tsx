import { useRef, useState } from 'react';
import { toast } from 'react-toastify';
import { useNavigate } from 'react-router';
import ActionModal from '../../common/ActionModal/ActionModal';
import DeleteDependencyNotice from '../../common/ActionModal/DeleteDependencyNotice';
import UnremovedPathsNotice from './UnremovedPathsNotice';
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
   const submitting = useRef(false);

   const navigate = useNavigate();
   const deletePlanMutation = useDeletePlan();

   const removePlan = () => {
      if (submitting.current || deletePlanMutation.isPending) return;
      if (actionInProgress) {
         return toast.error('A Backup/Restore Process is in Progress.');
      }
      if (taskPending) {
         return;
      }
      submitting.current = true;
      deletePlanMutation.mutate(
         { id: planId, removeRemoteData },
         {
            onSettled: () => { submitting.current = false; },
            onError: (error: Error) => {
               console.log('error :', error?.message);
               toast.error(error.message || `Error Removing Plan!`);
            },
            onSuccess: (data) => {
               const disposition = data.storageDisposition;
               const paths = disposition?.paths || data.unremovedPaths || [];
               if (paths.length) {
                  const notify = disposition?.status === 'retained_intentionally' ? toast.info : toast.warning;
                  notify(<UnremovedPathsNotice paths={paths} reason={data.unremovedReason} disposition={disposition?.status} />, {
                     autoClose: false,
                     closeOnClick: false,
                     style: { minWidth: '360px' },
                  });
               } else if (disposition?.status === 'retained_by_request') {
                  toast.info('Plan removed. Storage data was retained as requested.');
               } else {
                  toast.success(`Removed Backup Plan Successfully!`, { autoClose: 5000 });
               }
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
               Remove this plan and its history from Pluton? Backup data in storage is retained unless you select the option below. Remote managed
               repositories are retained for manual cleanup.
               <Toggle
                  fieldValue={removeRemoteData}
                  onUpdate={setRemoveRemoteData}
                  disabled={deletePlanMutation.isPending}
                  description="Remove backup data from the Storage"
                  customClasses={classes.removeRemoteToggle}
               />
            </div>
         }
         closeModal={() => !deletePlanMutation.isPending && close(false)}
         width="400px"
         errorMessage={deletePlanMutation.isError ? <DeleteDependencyNotice error={deletePlanMutation.error} /> : undefined}
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
