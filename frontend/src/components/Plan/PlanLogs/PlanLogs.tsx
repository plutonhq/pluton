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
   return (
      <SidePanel width="80%" title="Plan Logs" icon={<Icon type={'logs'} size={20} />} close={close}>
         <LogViewer type="plan" id={planId} planMethod={planMethod} />
      </SidePanel>
   );
};

export default PlanLogs;
