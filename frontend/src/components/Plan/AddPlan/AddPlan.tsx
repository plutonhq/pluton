import { useState } from 'react';
import { toast } from 'react-toastify';
import { useNavigate } from 'react-router';
import { NewPlanSettings } from '../../../@types/plans';
import { DEFAULT_PLAN_SETTINGS } from '../../../utils/constants';
import { useCreatePlan } from '../../../services/plans';

import PlanForm from '../PlanForm/PlanForm';

type AddPlanProps = {
   isPRO?: boolean;
   close: () => void;
};

const AddPlan = ({ close }: AddPlanProps) => {
   const [newPlan, setNewPlan] = useState<NewPlanSettings>(DEFAULT_PLAN_SETTINGS);

   const createPlanMutation = useCreatePlan();
   const navigate = useNavigate();

   const createBackup = () => {
      console.log('newPlan :', newPlan);

      createPlanMutation.mutate(newPlan, {
         onError: (error: any) => {
            console.log('error :', error);
            toast.error(error.message || `Error Creating New Backup Plan.`);
         },
         onSuccess: (data: any) => {
            console.log('Success :', data);
            toast.success(`New Backup Plan Created!`, { autoClose: 5000 });
            close();
            if (data?.result) {
               const planID = Array.isArray(data.result) ? data.result[0].id : data.result.id;
               if (planID) {
                  navigate(`/plan/${planID}?pendingbackup=1`);
               }
            }
         },
      });
   };

   return (
      <PlanForm
         title="Add New Plan"
         type="add"
         isSubmitting={createPlanMutation.isPending}
         planSettings={newPlan}
         onPlanSettingsChange={setNewPlan}
         onSubmit={createBackup}
         close={close}
      />
   );
};

export default AddPlan;
