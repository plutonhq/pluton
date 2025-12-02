import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { AppRoutes } from './router';
import { ThemeProvider } from './context/ThemeContext';
import './styles/global.scss';

const queryClient = new QueryClient();

createRoot(document.getElementById('root')!).render(
   <QueryClientProvider client={queryClient}>
      <ThemeProvider>
         <BrowserRouter>
            <AppRoutes />
         </BrowserRouter>
      </ThemeProvider>
      <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-left" />
   </QueryClientProvider>,
);
