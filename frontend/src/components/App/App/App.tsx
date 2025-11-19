import { useEffect } from 'react';
import { Outlet } from 'react-router';
import { Tooltip } from 'react-tooltip';
import { Slide, ToastContainer } from 'react-toastify';
import SideNav from '../SideNav/SideNav';
import { API_URL } from '../../../utils/constants';
import AppContent from '../AppContent/AppContent';
import classes from './App.module.scss';
import { useTheme } from '../../../context/ThemeContext';
import { usePwaAutoUpdate } from '../../../hooks/usePwaAutoUpdate';
import { useGetSettings } from '../../../services/settings';

function App() {
   console.log('API_URL :', API_URL);
   const { setTheme, theme } = useTheme();
   const { data: settingsData } = useGetSettings();
   usePwaAutoUpdate();

   useEffect(() => {
      const savedTheme = settingsData?.result?.settings?.theme;

      // If a theme is saved on the backend, ensure our local state matches.
      if (savedTheme && (savedTheme === 'light' || savedTheme === 'dark' || savedTheme === 'auto')) {
         const currentLocalSetting = localStorage.getItem('themeSetting');

         // If the backend setting is different from what's in localStorage, update it.
         if (savedTheme !== currentLocalSetting) {
            console.log('Syncing theme from backend:', savedTheme);
            setTheme(savedTheme); // This will update context and localStorage.
         }
      }
   }, [settingsData, setTheme]);

   return (
      <div className={classes.app}>
         <div className={classes.appContainer}>
            <SideNav />
            <AppContent>
               <Outlet />
            </AppContent>

            <Tooltip id="appTooltip" style={{ padding: '3px 8px', fontSize: '11px' }} />
            <Tooltip id="hintTooltip" style={{ padding: '3px 8px', fontSize: '12px', maxWidth: '250px' }} />
            <Tooltip id="htmlToolTip" className="tooltipBorderd" classNameArrow="tooltipBorderdArrow" style={{ maxWidth: '250px' }} />
            <ToastContainer position="bottom-center" hideProgressBar={true} transition={Slide} theme={theme} autoClose={false} />
         </div>
      </div>
   );
}

export default App;
