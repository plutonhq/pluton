import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { API_URL } from '../utils/constants';

// Get Settings
export async function getSettings() {
   const url = new URL(`${API_URL}/settings`);
   const res = await fetch(url.toString(), {
      method: 'GET',
      credentials: 'include',
   });
   const data = await res.json();
   if (!data.success) {
      throw new Error(data.error);
   }
   return data;
}

export function useGetSettings() {
   return useQuery({
      queryKey: ['settings'],
      queryFn: () => getSettings(),
      refetchOnMount: true,
      retry: false,
      staleTime: 0,
   });
}

export async function updateSettings(updatePayload: { id: string; settings: Record<string, string | boolean | number> }) {
   const header = new Headers({ 'Content-Type': 'application/json', Accept: 'application/json' });
   const res = await fetch(`${API_URL}/settings/${updatePayload.id}`, {
      method: 'PUT',
      credentials: 'include',
      headers: header,
      body: JSON.stringify(updatePayload),
   });
   const data = await res.json();
   console.log('data :', data);
   if (!data.success) {
      throw new Error(data.error);
   }
   return data;
}

export function useUpdateSettings() {
   const queryClient = useQueryClient();
   return useMutation({
      mutationFn: updateSettings,
      onSuccess: (res) => {
         // TODO: Should Display a Notification Bubble.
         console.log('# Settings Updated! :', res);
         queryClient.invalidateQueries({ queryKey: ['settings'] });
      },
   });
}

// Get App Logs
export async function getAppLogs(settingsID: string) {
   const url = new URL(`${API_URL}/settings/${settingsID}/logs`);

   const res = await fetch(url.toString(), {
      method: 'GET',
      credentials: 'include',
   });
   const data = await res.json();
   if (!data.success) {
      throw new Error(data.error);
   }
   return data;
}

export function useGetAppLogs(settingsID: string) {
   return useQuery({
      queryKey: ['appLogs', settingsID],
      queryFn: () => getAppLogs(settingsID),
      refetchOnMount: true,
      retry: false,
   });
}

// Download Plan Logs
export async function downloadAppLogs(settingsID: string) {
   const res = await fetch(`${API_URL}/settings/${settingsID}/logs/download`, {
      method: 'GET',
      credentials: 'include',
      // headers: header,
   });
   // Check if response is ok
   if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error);
   }

   const filename = res.headers.get('content-disposition')?.split('filename=')[1] || `app.log`;

   // Use streams API
   const reader = res.body?.getReader();
   const stream = new ReadableStream({
      async start(controller) {
         while (true) {
            const { done, value } = await reader!.read();
            if (done) break;
            controller.enqueue(value);
         }
         controller.close();
         reader!.releaseLock();
      },
   });

   // Create download from stream
   const blob = await new Response(stream).blob();
   const url = window.URL.createObjectURL(blob);
   const link = document.createElement('a');
   link.href = url;
   link.download = filename;
   document.body.appendChild(link);
   link.click();
   link.remove();
   window.URL.revokeObjectURL(url);
}

export function useGetDownloadAppLogs() {
   return useMutation({
      mutationFn: downloadAppLogs,
      onSuccess: (res) => {
         console.log('# Logs Downloaded! :', res);
      },
      onError: (res) => {
         console.log('# Logs Download Failed! :', res);
      },
   });
}

export async function validateIntegration(updatePayload: {
   settingsID: number;
   type: string;
   settings: Record<string, string | boolean | number>;
   test: Record<string, string | boolean | number>;
}) {
   console.log('updatePayload :', updatePayload);
   const header = new Headers({ 'Content-Type': 'application/json', Accept: 'application/json' });
   const res = await fetch(`${API_URL}/settings/integration/validate`, {
      method: 'POST',
      credentials: 'include',
      headers: header,
      body: JSON.stringify(updatePayload),
   });
   const data = await res.json();
   console.log('data :', data);
   if (!data.success) {
      throw new Error(data.error);
   }
   return data;
}

export function useValidateIntegration() {
   return useMutation({
      mutationFn: validateIntegration,
      onSuccess: (res) => {
         // TODO: Should Display a Notification Bubble.
         console.log('# Settings Updated! :', res);
      },
   });
}
