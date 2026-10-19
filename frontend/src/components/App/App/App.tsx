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
import { validThemeSetting } from '../../../utils/theme';

function App() {
   console.log('API_URL :', API_URL);
   const { setTheme, theme } = useTheme();
   const { data: settingsData } = useGetSettings();
   usePwaAutoUpdate();

   useEffect(() => {
      const savedTheme = settingsData?.result?.settings?.theme;

      // Seed an existing installation's preference once. An explicit browser
      // choice (including System) must not be overwritten on refresh/refocus.
      if (savedTheme && (savedTheme === 'light' || savedTheme === 'dark' || savedTheme === 'auto')) {
         let currentLocalSetting;
         try {
            currentLocalSetting = localStorage.getItem('themeSetting') || localStorage.getItem('theme');
         } catch {
            /* Restricted browser storage. */
         }

         if (!validThemeSetting(currentLocalSetting)) {
            setTheme(savedTheme);
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
