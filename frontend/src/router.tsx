import { Routes, Route, Navigate } from 'react-router';
import Plans from './routes/Plans/Plans';
import Login from './routes/Login/Login';
import Setup from './routes/Setup/Setup';
import { useAuth } from './services/users';
import { useSetupStatus } from './services/settings';
import App from './components/App/App/App';
import Settings from './routes/Settings/Settings';
import Storages from './routes/Storages/Storages';
import Sources from './routes/Sources/Sources';
import PlanSingle from './routes/PlanSingle/PlanSingle';
import DeviceSingle from './routes/DeviceSingle/DeviceSingle';
import Footer from './components/App/Footer/Footer';
import NotFoundRoute from './routes/NotFoundRoute/NotFoundRoute';
import Icon from './components/common/Icon/Icon';

function ProtectedLayout() {
   // Check setup status FIRST - this endpoint doesn't require auth
   // and tells us if we're in binary mode and if setup is pending
   const { data: setupStatus, isLoading: setupLoading } = useSetupStatus();
   const { data: authData, isError: authError, isLoading: authLoading } = useAuth();

   // Show loading spinner while checking setup status
   if (setupLoading) {
      return (
         <div className="loadingScreen">
            <Icon size={60} type="loading" />
         </div>
      );
   }

   // If setup status check failed, we can still proceed with auth check
   // (might be a network issue or old backend without setup endpoint)

   // For binary installations with pending setup, redirect to setup page
   // This check happens BEFORE auth check so unauthenticated users can access setup
   if (setupStatus?.data?.isBinary && setupStatus?.data?.setupPending) {
      return <Navigate to="/setup" replace />;
   }

   // Now check auth (setup is either complete or not a binary installation)
   if (authLoading) {
      return (
         <div className="loadingScreen">
            <Icon size={60} type="loading" />
         </div>
      );
   }

   // If auth failed, redirect to login
   if (authError) {
      return <Navigate to="/login" replace />;
   }

   console.log('User data :', authData);

   return (
      <>
         <App />
         <Footer version={authData?.appVersion || ''} />
      </>
   );
}

export function AppRoutes() {
   return (
      <Routes>
         <Route path="/" element={<ProtectedLayout />}>
            <Route index element={<Plans />} />
            <Route path="settings" element={<Settings />} />
            <Route path="storages" element={<Storages />} />
            <Route path="sources" element={<Sources />} />
            <Route path={'device/:id'} element={<DeviceSingle />} />
            <Route path={'plan/:id'} element={<PlanSingle />} />
            <Route path="*" element={<NotFoundRoute />} />
         </Route>
         <Route path="login" element={<Login />} />
         <Route path="setup" element={<Setup />} />
      </Routes>
   );
}
