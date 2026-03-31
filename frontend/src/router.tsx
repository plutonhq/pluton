import { Routes, Route, Navigate } from 'react-router';
import Plans from './routes/Plans/Plans';
import Login from './routes/Login/Login';
import Setup from './routes/Setup/Setup';
import { useAuth } from './services/users';
import App from './components/App/App/App';
import Settings from './routes/Settings/Settings';
import Storages from './routes/Storages/Storages';
import Sources from './routes/Sources/Sources';
import PlanSingle from './routes/PlanSingle/PlanSingle';
import DeviceSingle from './routes/DeviceSingle/DeviceSingle';
import Footer from './components/App/Footer/Footer';
import NotFoundRoute from './routes/NotFoundRoute/NotFoundRoute';
import Icon from './components/common/Icon/Icon';
import { useCheckLatestVersion } from './services';
import { compareVersions } from './utils';

function PublicRoute({ children }: { children: React.ReactNode }) {
   const { data: authData, isLoading: authLoading } = useAuth();

   if (authLoading) {
      return (
         <div className="loadingScreen">
            <Icon size={60} type="loading" />
         </div>
      );
   }

   if (authData) {
      return <Navigate to="/" replace />;
   }

   return <>{children}</>;
}

function ProtectedLayout() {
   const { data: authData, isError: authError, isLoading: authLoading } = useAuth();
   const { data } = useCheckLatestVersion();
   const version = (window as any).plutonVersion || 'unknown';
   const hasNewVersion = data?.result?.latestVersion && version !== 'dev' && compareVersions(version, data.result.latestVersion);

   if (authLoading) {
      return (
         <div className="loadingScreen">
            <Icon size={60} type="loading" />
         </div>
      );
   }

   // Check setup-pending from auth response headers (set by versionMiddleware on all responses)
   const installType = (window as any).plutonInstallType;
   const setupPending = (window as any).plutonSetupPending;
   if (installType === 'binary' && setupPending) {
      return <Navigate to="/setup" replace />;
   }

   // If auth failed, redirect to login
   if (authError) {
      return <Navigate to="/login" replace />;
   }

   console.log('User data :', authData);

   return (
      <>
         <App />
         <Footer version={authData?.appVersion || ''} latestVersion={hasNewVersion ? data?.result?.latestVersion : undefined} />
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
         <Route
            path="login"
            element={
               <PublicRoute>
                  <Login />
               </PublicRoute>
            }
         />
         <Route path="setup" element={<Setup />} />
      </Routes>
   );
}
