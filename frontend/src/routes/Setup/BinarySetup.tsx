import { Navigate } from 'react-router';
import { Footer, Icon } from '../../components';
import { useSetupStatus } from '../../services/settings';

/**
 * Component that checks setup status for binary installations
 * This is a separate component so useSetupStatus is only called when needed
 */
const BinarySetup = ({ children, appVersion }: { children: React.ReactNode; appVersion: string }) => {
   const { data: setupStatus, isLoading: setupLoading } = useSetupStatus();

   if (setupLoading) {
      return (
         <div className="loadingScreen">
            <Icon size={60} type="loading" />
         </div>
      );
   }

   // If setup is pending, redirect to setup page
   if (setupStatus?.data?.setupPending) {
      return <Navigate to="/setup" replace />;
   }

   return (
      <>
         {children}
         <Footer version={appVersion} />
      </>
   );
};

export default BinarySetup;
