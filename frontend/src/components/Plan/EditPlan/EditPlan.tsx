import { useState } from 'react';
import { toast } from 'react-toastify';
import { NewPlanSettings, Plan } from '../../../@types/plans';
import { useUpdatePlan } from '../../../services/plans';
import PlanForm from '../PlanForm/PlanForm';

type EditPlanProps = {
   plan: Plan;
   close: () => void;
};

const EditPlan = ({ close, plan }: EditPlanProps) => {
   const [newPlan, setNewPlan] = useState<NewPlanSettings>(() => plan);
   const backingUp = plan.backups.some((s) => s.inProgress);
   const updatePlanMutation = useUpdatePlan();

   const updatePlan = () => {
      if (backingUp) {
         return toast.error(`Can't Update Plan Settings while a Backup is in progress.`);
      }
      console.log('newPlan :', newPlan);

      const allowedFields = ['title', 'description', 'isActive', 'storagePath', 'sourceConfig', 'tags', 'settings'] as const;
      const updatedPlan = Object.fromEntries(Object.entries(newPlan).filter(([key]) => allowedFields.includes(key as any)));

      updatePlanMutation.mutate(
         { id: plan.id, data: updatedPlan },
         {
            onError: (error: any) => {
               console.log('error :', error);
               toast.error(error.message || `Error Updating Backup Plan.`);
            },
            onSuccess: (data: any) => {
               console.log('Success :', data);
               toast.success(`Backup Plan Updated!`, { autoClose: 5000 });
            },
         },
      );
   };

   return (
      <PlanForm
         title="Edit Plan"
         type="edit"
         planSettings={newPlan}
         isSubmitting={updatePlanMutation.isPending}
         storagePath={plan.storagePath}
         storageId={plan.storage.id}
         onPlanSettingsChange={setNewPlan}
         onSubmit={updatePlan}
         close={close}
      />
   );
};

export default EditPlan;
