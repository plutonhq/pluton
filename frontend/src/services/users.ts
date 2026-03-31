import { API_URL } from '../utils/constants';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';

interface LoginCredentials {
   username: string;
   password: string;
}

export type InstallType = 'docker' | 'binary' | 'server' | 'dev';

//VALIDATE USER
export async function validateAuth() {
   const res = await fetch(`${API_URL}/user/validate`, { method: 'GET', credentials: 'include' });

   // Read headers before checking status - middleware sets these on all responses
   const appVersion = res.headers.get('x-app-version');
   const serverOS = res.headers.get('x-server-os');
   const installType = (res.headers.get('x-install-type') || 'dev') as InstallType;
   const setupPending = res.headers.get('x-setup-pending') === '1';

   (window as any).plutonVersion = appVersion || 'unknown';
   (window as any).plutonServerOS = serverOS || 'unknown';
   (window as any).plutonInstallType = installType;
   (window as any).plutonSetupPending = setupPending;

   if (!res.ok) {
      throw new Error('Invalid authentication');
   }

   const data = await res.json();
   return {
      ...data,
      appVersion,
      installType,
      setupPending,
   };
}

export function useAuth() {
   return useQuery({
      queryKey: ['auth'],
      queryFn: validateAuth,
      refetchOnMount: true,
      retry: false,
   });
}

// LOGIN USER
export async function loginUser(credentials: LoginCredentials) {
   const header = new Headers({ 'Content-Type': 'application/json', Accept: 'application/json' });
   const res = await fetch(`${API_URL}/user/login`, {
      method: 'POST',
      credentials: 'include',
      headers: header,
      body: JSON.stringify(credentials),
   });
   const data = await res.json();
   if (!data.success) {
      throw new Error(data.error);
   }
   return data;
}

// Add this new hook
export function useLogin() {
   const navigate = useNavigate();
   const queryClient = useQueryClient();
   return useMutation({
      mutationFn: loginUser,
      onSuccess: (res) => {
         queryClient.removeQueries({ queryKey: ['auth'] });
         if (res.totpRequired) {
            navigate('/login/verify-otp');
         } else {
            navigate('/');
         }
      },
   });
}

// LOGOUT USER
export async function logoutUser() {
   const res = await fetch(`${API_URL}/user/logout`, {
      method: 'POST',
      credentials: 'include',
   });
   const data = await res.json();
   if (!data.success) {
      throw new Error(data.error);
   }
   return data;
}

export function useLogout() {
   const navigate = useNavigate();
   const queryClient = useQueryClient();
   return useMutation({
      mutationFn: logoutUser,
      onSuccess: () => {
         queryClient.removeQueries({ queryKey: ['auth'] });
         navigate('/login');
      },
   });
}
