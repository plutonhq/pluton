import PageHeader from '../../components/common/PageHeader/PageHeader';
import SuccessRate from '../../components/Dashboard/SuccessRate/SuccessRate';
import MonthlyBackupStats from '../../components/Dashboard/MonthlyBackupStats/MonthlyBackupStats';
import SystemStatus from '../../components/Dashboard/SystemStatus/SystemStatus';
import Inventory from '../../components/Dashboard/Inventory/Inventory';
import StorageUsage from '../../components/Dashboard/StorageUsage/StorageUsage';
import BackupEvents from '../../components/Dashboard/BackupEvents/BackupEvents';
import { useGetDashboardSummary } from '../../services/dashboard';
import { DashboardInventorySource, DashboardSummary } from '../../@types/dashboard';
import classes from './Dashboard.module.scss';

interface DashboardProps {
   availableSources?: DashboardInventorySource[];
}

const Dashboard = ({ availableSources = ['workstations', 'servers'] }: DashboardProps) => {
   const { data, isLoading } = useGetDashboardSummary();
   const summary: DashboardSummary | undefined = data?.result;

   return (
      <div className={classes.dashboard}>
         <PageHeader title="Dashboard" icon="dashboard" />
         <div className={classes.widgets}>
            <div className={classes.column}>
               <SuccessRate stats={summary?.successRate} isLoading={isLoading} />
               <MonthlyBackupStats months={summary?.monthly} isLoading={isLoading} />
               <SystemStatus />
            </div>
            <div className={classes.column}>
               <Inventory inventory={summary?.inventory} isLoading={isLoading} availableSources={availableSources} />
               <StorageUsage usage={summary?.storageUsage} isLoading={isLoading} />
            </div>
            <div className={`${classes.column} ${classes.eventsColumn}`}>
               <BackupEvents />
            </div>
         </div>
      </div>
   );
};

export default Dashboard;
