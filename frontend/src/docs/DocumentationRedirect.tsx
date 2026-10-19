import { useEffect } from 'react';
import { useLocation } from 'react-router';

/** Cross the document boundary to the isolated React 19 docs, not the app's React 18 router. */
export default function DocumentationRedirect() {
   const location = useLocation();
   useEffect(() => {
      const target = location.pathname + location.search + location.hash;
      try {
         // An old service worker must not create an infinite same-URL reload loop.
         if (sessionStorage.getItem('pluton-docs-document-redirect') === target) return;
         sessionStorage.setItem('pluton-docs-document-redirect', target);
         window.location.replace(target);
      } catch {
         /* A direct document link remains available if storage is blocked. */
      }
   }, [location.pathname, location.search, location.hash]);
   return (
      <main>
         <p>Documentation uses a separate static document. Refresh the installed assets if an older service worker is active.</p>
         <a href={location.pathname + location.search + location.hash}>Open Pluton Documentation</a>
      </main>
   );
}
