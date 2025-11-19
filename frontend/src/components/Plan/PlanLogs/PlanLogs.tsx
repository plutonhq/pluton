import { useGetPlanLogs } from '../../../services/plans';
import Icon from '../../common/Icon/Icon';
import LogViewer from '../../common/LogViewer/LogViewer';
import SidePanel from '../../common/SidePanel/SidePanel';

interface PlanLogsProps {
   planId: string;
   planMethod: string;
   sourceType: string;
   close: () => void;
}

const PlanLogs = ({ planId, planMethod, close }: PlanLogsProps) => {
   const { data: logs, isLoading } = useGetPlanLogs(planId);
   const planLogs = logs?.logs || [];
   console.log('logs :', planLogs);

   return (
      <SidePanel width="80%" title="Plan Logs" icon={<Icon type={'logs'} size={20} />} footer={<></>} close={close}>
         <LogViewer type="plan" planMethod={planMethod} logs={planLogs} planId={planId} isLoading={isLoading} />
      </SidePanel>
   );
};

export default PlanLogs;
