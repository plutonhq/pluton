import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { router } from './router';
import { ThemeProvider } from './context/ThemeContext';
import './styles/global.scss';

const queryClient = new QueryClient();

function AppWrapper() {
   return (
      <ThemeProvider>
         <RouterProvider router={router} />
      </ThemeProvider>
   );
}

createRoot(document.getElementById('root')!).render(
   <QueryClientProvider client={queryClient}>
      <AppWrapper />
      <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-left" />
   </QueryClientProvider>,
);
