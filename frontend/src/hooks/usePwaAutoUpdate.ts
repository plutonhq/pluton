import { useEffect } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

/**
 * This hook handles the PWA auto-update logic in the background.
 * It's completely silent and requires no user interaction.
 */
export function usePwaAutoUpdate() {
   const {
      offlineReady: [offlineReady, setOfflineReady],
      needRefresh: [needRefresh],
      updateServiceWorker,
   } = useRegisterSW();

   useEffect(() => {
      // This effect triggers when a new service worker is ready to take over.
      if (needRefresh) {
         // This immediately tells the new service worker to take control,
         // which will force a hard reload of the page.
         updateServiceWorker(true);
      }

      // This effect triggers when the app's assets are fully cached and ready for offline use.
      // We won't show a toast, but we'll log it for debugging purposes.
      if (offlineReady) {
         console.log('PWA is ready for offline use.');
         // Reset the state to prevent this log from firing on every render.
         setOfflineReady(false);
      }
   }, [needRefresh, offlineReady, setOfflineReady, updateServiceWorker]);

   // This hook doesn't need to return anything as it performs its job in the background.
}
