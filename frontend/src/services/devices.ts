import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { API_URL } from '../utils/constants';

// Get System Metrics
export async function getSystemMetrics(id: string) {
   const url = new URL(`${API_URL}/devices/${id}/metrics`);
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

export function useGetSystemMetrics(id: string) {
   return useQuery({
      queryKey: ['device-metrics', id],
      queryFn: () => getSystemMetrics(id),
      refetchOnMount: true,
      refetchOnWindowFocus: false,
      retry: false,
   });
}

// Get All Devices
export async function getAllDevices() {
   const url = new URL(`${API_URL}/devices`);

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

export function useGetDevices() {
   return useQuery({
      queryKey: ['devices'],
      queryFn: () => getAllDevices(),
      refetchOnMount: true,
      retry: false,
   });
}

// Get Single Device
export async function getDevice(id: string, metrics: boolean) {
   const url = new URL(`${API_URL}/devices/${id}?metrics=${metrics ? 'true' : 'false'}`);

   const res = await fetch(url.toString(), {
      method: 'GET',
      credentials: 'include',
   });
   const data = await res.json();
   if (!data.success) {
      const error = new Error(data.error) as Error & { status?: number };
      error.status = res.status;
      throw error;
   }
   return data;
}

export function useGetDevice(id: string, metrics = false) {
   return useQuery({
      queryKey: ['device', id],
      queryFn: () => getDevice(id, metrics),
      refetchOnMount: true,
      refetchOnWindowFocus: false,
      retry: false,
   });
}

// Update Device
export async function updateDevice(updatePayload: { id: string; data: Record<string, any> }) {
   const header = new Headers({ 'Content-Type': 'application/json', Accept: 'application/json' });
   const res = await fetch(`${API_URL}/devices/${updatePayload.id}`, {
      method: 'PUT',
      credentials: 'include',
      headers: header,
      body: JSON.stringify(updatePayload.data),
   });
   const data = await res.json();
   console.log('data :', data);
   if (!data.success) {
      throw new Error(data.error);
   }
   return data;
}

export function useUpdateDevice() {
   const queryClient = useQueryClient();
   return useMutation({
      mutationFn: updateDevice,
      onSuccess: (res) => {
         // TODO: Should Display a Notification Bubble.
         console.log('# Device Updated! :', res);
         queryClient.invalidateQueries({ queryKey: ['devices'] });
      },
   });
}

// Update Dependent
export async function updateDependent(payload: { id: string; dependent: string; newVersion: string }) {
   const header = new Headers({ 'Content-Type': 'application/json', Accept: 'application/json' });
   const res = await fetch(`${API_URL}/devices/${payload.id}/action/update/${payload.dependent}?version=${payload.newVersion}`, {
      method: 'POST',
      credentials: 'include',
      headers: header,
   });
   const data = await res.json();
   console.log('data :', data);
   if (!data.success) {
      throw new Error(data.error);
   }
   return data;
}

export function useUpdateDependent() {
   const queryClient = useQueryClient();
   return useMutation({
      mutationFn: updateDependent,
      onSuccess: (res) => {
         // TODO: Should Display a Notification Bubble.
         console.log('# Device Updated! :', res);
         queryClient.invalidateQueries({ queryKey: ['devices'] });
      },
   });
}

// Browse Directory
export async function browseDir(payload: { deviceId: string; path?: string }) {
   const url = new URL(`${API_URL}/devices/${payload.deviceId}/browse`);
   if (payload.path) {
      url.searchParams.append('path', encodeURIComponent(payload.path));
   }

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

export function useBrowseDir(payload: { deviceId: string; path?: string }) {
   return useQuery({
      queryKey: ['dirPath', payload.deviceId, payload.path],
      queryFn: () => browseDir(payload),
      refetchOnMount: true,
      retry: false,
   });
}
