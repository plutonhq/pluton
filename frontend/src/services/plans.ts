import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-toastify';
import { API_URL } from '../utils/constants';
import { NewPlanSettings, Plan } from '../@types/plans';

// Get All Plans
export async function getAllPlans() {
   const url = new URL(`${API_URL}/plans`);

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

export function useGetPlans() {
   return useQuery({
      queryKey: ['plans'],
      queryFn: () => getAllPlans(),
      refetchOnMount: true,
      retry: false,
   });
}

// Get Single Plan
export async function getSinglePlan(id: string) {
   if (!id) {
      throw new Error('ID Not Provided.');
   }
   const url = new URL(`${API_URL}/plans/${id}`);

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

export function useGetPlan(id: string) {
   return useQuery({
      queryKey: ['plan', id],
      queryFn: () => getSinglePlan(id),
      refetchOnMount: true,
      retry: false,
      staleTime: 0,
   });
}

// Get Plan Logs
export async function getPlanLogs(planId: string) {
   const url = new URL(`${API_URL}/plans/${planId}/logs`);

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

export function useGetPlanLogs(planId: string) {
   return useQuery({
      queryKey: ['planLogs', planId],
      queryFn: () => getPlanLogs(planId),
      refetchOnMount: true,
      retry: false,
   });
}

// Download Plan Logs
export async function downloadPlanLogs(id: string) {
   const res = await fetch(`${API_URL}/plans/${id}/logs/download`, {
      method: 'GET',
      credentials: 'include',
      // headers: header,
   });
   // Check if response is ok
   if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error);
   }

   const filename = res.headers.get('content-disposition')?.split('filename=')[1] || `plan-${id}.log`;

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

export function useGetDownloadLogs() {
   return useMutation({
      mutationFn: downloadPlanLogs,
      onSuccess: (res) => {
         console.log('# Logs Downloaded! :', res);
      },
      onError: (res) => {
         console.log('# Logs Download Failed! :', res);
      },
   });
}

// Create New Plan
export async function createPlan(newPlan: NewPlanSettings) {
   const header = new Headers({ 'Content-Type': 'application/json', Accept: 'application/json' });
   console.log('newPlan :', newPlan);
   const res = await fetch(`${API_URL}/plans`, {
      method: 'POST',
      credentials: 'include',
      headers: header,
      body: JSON.stringify(newPlan),
   });
   const data = await res.json();
   if (!data.success) {
      throw new Error(data.error || data.result);
   }
   return data;
}

export function useCreatePlan() {
   const queryClient = useQueryClient();
   return useMutation({
      mutationFn: createPlan,
      onSuccess: (res) => {
         // TODO: Should Display a Notification Bubble.
         console.log('# Plan Created! :', res);
         queryClient.invalidateQueries({ queryKey: ['plans'] });
      },
   });
}

// UpdatePlan
export async function updatePlan(updatePayload: { id: string; data: Partial<Plan> }) {
   const header = new Headers({ 'Content-Type': 'application/json', Accept: 'application/json' });
   console.log('newPlan :', updatePayload);
   const res = await fetch(`${API_URL}/plans/${updatePayload.id}`, {
      method: 'PUT',
      credentials: 'include',
      headers: header,
      body: JSON.stringify({ plan: updatePayload.data }),
   });
   const data = await res.json();
   console.log('data :', data);
   if (!data.success) {
      throw new Error(data.error);
   }
   return data;
}

export function useUpdatePlan() {
   const queryClient = useQueryClient();
   return useMutation({
      mutationFn: updatePlan,
      onSuccess: (res) => {
         // TODO: Should Display a Notification Bubble.
         console.log('# Plan Updated! :', res);
         const planID = res?.result?.id;
         if (planID) {
            queryClient.invalidateQueries({ queryKey: ['plan', planID] });
         }

         queryClient.invalidateQueries({ queryKey: ['plans'] });
      },
   });
}

// Remove Plan
export async function deletePlan({ id, removeRemoteData }: { id: string; removeRemoteData: boolean }) {
   const header = new Headers({ 'Content-Type': 'application/json', Accept: 'application/json' });
   const res = await fetch(`${API_URL}/plans/${id}?removeData=${removeRemoteData}`, {
      method: 'DELETE',
      credentials: 'include',
      headers: header,
   });
   const data = await res.json();
   if (!data.success) {
      throw new Error(data.error);
   }
   return data;
}

export function useDeletePlan() {
   const queryClient = useQueryClient();
   return useMutation({
      mutationFn: deletePlan,
      onSuccess: (res) => {
         console.log('# Plan Removed! :', res);
         queryClient.invalidateQueries({ queryKey: ['plans'] });
      },
   });
}

// Perform Backup
export async function performBackup(id: string) {
   const header = new Headers({ 'Content-Type': 'application/json', Accept: 'application/json' });
   const res = await fetch(`${API_URL}/plans/${id}/action/backup`, {
      method: 'POST',
      credentials: 'include',
      headers: header,
   });
   const data = await res.json();
   if (!data.success) {
      throw new Error(data.error);
   }
   return data;
}

export function usePerformBackup() {
   const queryClient = useQueryClient();
   return useMutation({
      mutationFn: performBackup,
      onSuccess: (res, planId) => {
         console.log('# Backup Started! :', res, planId);
         queryClient.invalidateQueries({ queryKey: ['plan', planId] });
         queryClient.invalidateQueries({ queryKey: ['plans'] });
      },
   });
}

// Pause Backup
export async function pausePlan(id: string) {
   const header = new Headers({ 'Content-Type': 'application/json', Accept: 'application/json' });
   const res = await fetch(`${API_URL}/plans/${id}/action/pause`, {
      method: 'POST',
      credentials: 'include',
      headers: header,
   });
   const data = await res.json();
   if (!data.success) {
      throw new Error(data.error);
   }
   return data;
}

export function usePausePlan() {
   const queryClient = useQueryClient();
   return useMutation({
      mutationFn: pausePlan,
      onSuccess: (res, planId) => {
         console.log('# Backup Paused! :', res, planId);
         queryClient.invalidateQueries({ queryKey: ['plan', planId] });
         queryClient.invalidateQueries({ queryKey: ['plans'] });
      },
   });
}

// Resume Backup
export async function resumePlan(id: string) {
   const header = new Headers({ 'Content-Type': 'application/json', Accept: 'application/json' });
   const res = await fetch(`${API_URL}/plans/${id}/action/resume`, {
      method: 'POST',
      credentials: 'include',
      headers: header,
   });
   const data = await res.json();
   if (!data.success) {
      throw new Error(data.error);
   }
   return data;
}

export function useResumePlan() {
   const queryClient = useQueryClient();
   return useMutation({
      mutationFn: resumePlan,
      onSuccess: (res, planId) => {
         console.log('# Backup Resumed! :', res, planId);
         queryClient.invalidateQueries({ queryKey: ['plan', planId] });
         queryClient.invalidateQueries({ queryKey: ['plans'] });
      },
   });
}

// Prune Backup Plan
export async function prunePlan(id: string) {
   const header = new Headers({ 'Content-Type': 'application/json', Accept: 'application/json' });
   const res = await fetch(`${API_URL}/plans/${id}/action/prune`, {
      method: 'POST',
      credentials: 'include',
      headers: header,
   });
   const data = await res.json();
   if (!data.success) {
      throw new Error(data.error);
   }
   return data;
}

export function usePrunePlan() {
   const queryClient = useQueryClient();
   return useMutation({
      mutationFn: prunePlan,
      onError: (error: Error) => {
         console.log('error :', error?.message);
         toast.error(error.message || `Error Removing Old Backups.`);
      },
      onSuccess: (res, planId) => {
         console.log('# Backup Pruned! :', res, planId);
         queryClient.invalidateQueries({ queryKey: ['plan', planId] });
         toast.success(res?.message || `Removed Old Backups Successfully!`, { autoClose: 5000 });
      },
   });
}

// Unlock Backup Plan
export async function unlockPlan(id: string) {
   const header = new Headers({ 'Content-Type': 'application/json', Accept: 'application/json' });
   const res = await fetch(`${API_URL}/plans/${id}/action/unlock`, {
      method: 'POST',
      credentials: 'include',
      headers: header,
   });
   const data = await res.json();
   if (!data.success) {
      throw new Error(data.error);
   }
   return data;
}

export function useUnlockPlan() {
   const queryClient = useQueryClient();
   return useMutation({
      mutationFn: unlockPlan,
      onError: (error: Error) => {
         console.log('error :', error?.message);
         toast.error(error.message || `Error Removing stale locks.`);
      },
      onSuccess: (res, planId) => {
         console.log('# Backup Pruned! :', res, planId);
         queryClient.invalidateQueries({ queryKey: ['plan', planId] });
         toast.success(`Removed Stale locks Successfully!`, { autoClose: 5000 });
      },
   });
}

// Get Backup Progress
export async function checkActiveBackupsOrRestore(planId: string, type: 'backup' | 'restore' = 'backup') {
   const url = new URL(`${API_URL}/plans/${planId}/checkactive`);
   url.searchParams.append('type', type);

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

export function useCheckActiveBackupsOrRestore() {
   return useMutation({
      // queryKey: ['planActiveBackups-' + planId],
      mutationFn: ({ planId, type }: { planId: string; type: 'backup' | 'restore' }) => checkActiveBackupsOrRestore(planId, type),
      // refetchOnMount: true,
   });
}
