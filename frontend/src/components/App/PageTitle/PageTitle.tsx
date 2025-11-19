import { useEffect } from 'react';
import { useLocation } from 'react-router';
import { APP_NAME } from '../../../utils/constants';

const PageTitle = ({ title = '' }: { title: string }) => {
   const location = useLocation();

   useEffect(() => {
      // if the provided title is
      document.title = title + (title ? ' | ' : '') + (APP_NAME || 'Pluton');
   }, [location, title]);

   return null;
};

export default PageTitle;
