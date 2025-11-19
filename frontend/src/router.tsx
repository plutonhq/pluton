import { createBrowserRouter, createRoutesFromElements, Route, Navigate } from 'react-router';
import Plans from './routes/Plans/Plans';
import Login from './routes/Login/Login';
import { useAuth } from './services/users';
import App from './components/App/App/App';
import Settings from './routes/Settings/Settings';
import Storages from './routes/Storages/Storages';
import Sources from './routes/Sources/Sources';
import PlanSingle from './routes/PlanSingle/PlanSingle';
import DeviceSingle from './routes/DeviceSingle/DeviceSingle';
import Footer from './components/App/Footer/Footer';
import NotFoundRoute from './routes/NotFoundRoute/NotFoundRoute';

function ProtectedLayout() {
   const { data, isError } = useAuth();
   console.log('User data :', data);
   // if (isLoading)
   //    return (
   //       <div className="loadingScreen">
   //          <Icon size={60} type="loading" />{' '}
   //       </div>
   //    );
   if (isError) return <Navigate to="/login" replace />;

   return (
      <>
         <App />
         <Footer version={data?.appVersion} />
      </>
   );
}

export const router = createBrowserRouter(
   createRoutesFromElements(
      <>
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
      </>,
   ),
);
