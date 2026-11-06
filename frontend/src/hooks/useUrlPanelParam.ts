import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';

/** Reads a panel-opening URL param once (e.g. from a Dashboard link) and removes it from the URL. */
export const useUrlPanelParam = (key: string): string | null => {
   const [searchParams, setSearchParams] = useSearchParams();
   const [value] = useState(() => searchParams.get(key));

   useEffect(() => {
      if (value === null) return;
      setSearchParams(
         (params) => {
            params.delete(key);
            return params;
         },
         { replace: true },
      );
   }, []);

   return value;
};
