import { API_URL } from '../utils/constants';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router';

interface LoginCredentials {
   username: string;
   password: string;
}

//VALIDATE USER
export async function validateAuth() {
   const res = await fetch(`${API_URL}/user/validate`, { method: 'GET', credentials: 'include' });
   if (!res.ok) {
      throw new Error('Invalid authentication');
   }
   const appVersion = res.headers.get('x-app-version');
   const serverOS = res.headers.get('x-server-os');

   (window as any).plutonVersion = appVersion || 'unknown';
   (window as any).plutonServerOS = serverOS || 'unknown';

   const data = await res.json();
   return {
      ...data,
      appVersion,
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
   return useMutation({
      mutationFn: loginUser,
      onSuccess: (res) => {
         console.log('res :', res);
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
   return useMutation({
      mutationFn: logoutUser,
      onSuccess: () => {
         navigate('/login');
      },
   });
}
