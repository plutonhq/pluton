import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-toastify';
import { API_URL } from '../utils/constants';

const notifiedRestoreProgress = new Set<string>();

// Get All Restores
export async function getAllRestores() {
   const url = new URL(`${API_URL}/restores`);

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

export function useGetRestores() {
   return useQuery({
      queryKey: ['restores'],
      queryFn: () => getAllRestores(),
      refetchOnMount: true,
      retry: false,
   });
}

// Get Single Restore
export async function getSingleRestore(id: string) {
   if (!id) {
      throw new Error('ID Not Provided.');
   }
   const url = new URL(`${API_URL}/restores/${id}`);

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

export function useGetRestore(id: string) {
   return useQuery({
      queryKey: ['restore', id],
      queryFn: () => getSingleRestore(id),
      refetchOnMount: true,
      retry: false,
      staleTime: 0,
   });
}

// Remove Restore
export async function deleteRestore(id: string) {
   const header = new Headers({ 'Content-Type': 'application/json', Accept: 'application/json' });
   const res = await fetch(`${API_URL}/restores/${id}`, {
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

export function useDeleteRestore() {
   return useMutation({
      mutationFn: deleteRestore,
      onSuccess: (res) => {
         console.log('# Restore Removed! :', res);
      },
   });
}

// Restore Backup
export async function restoreBackup({
   backupId,
   planId,
   target,
   overwrite,
   includes,
   excludes,
   deleteOption,
}: {
   backupId: string;
   planId: string;
   target: string;
   overwrite: string;
   includes?: string[];
   excludes?: string[];
   deleteOption: boolean;
}) {
   const header = new Headers({ 'Content-Type': 'application/json', Accept: 'application/json' });
   const res = await fetch(`${API_URL}/restores/action/restore`, {
      method: 'POST',
      credentials: 'include',
      headers: header,
      body: JSON.stringify({ backupId, planId, target, overwrite, includes, excludes, delete: deleteOption }),
   });
   const data = await res.json();
   if (!data.success) {
      throw new Error(data.error);
   }
   return data;
}

export function useRestoreBackup() {
   const queryClient = useQueryClient();
   return useMutation({
      mutationFn: restoreBackup,
      onSuccess: (res, payload) => {
         console.log('# Backup Restored! :', res, payload);
         queryClient.invalidateQueries({ queryKey: ['plan', payload.planId] });
      },
   });
}

// DRY Restore Backup
export async function getDryRestoreStats({
   backupId,
   planId,
   target,
   overwrite,
   includes,
   excludes,
   deleteOption,
}: {
   backupId: string;
   planId: string;
   target: string;
   overwrite: string;
   includes?: string[];
   excludes?: string[];
   deleteOption?: boolean;
}) {
   const header = new Headers({ 'Content-Type': 'application/json', Accept: 'application/json' });
   const res = await fetch(`${API_URL}/restores/action/dryrestore`, {
      method: 'POST',
      credentials: 'include',
      headers: header,
      body: JSON.stringify({ backupId, planId, target, overwrite, includes, excludes, delete: deleteOption }),
   });
   const data = await res.json();
   if (!data.success) {
      throw new Error(data.error);
   }
   return data;
}

export function useGetDryRestoreStats() {
   return useMutation({
      mutationFn: getDryRestoreStats,
      onSuccess: (res, payload) => {
         console.log('# Backup Restore Stats! :', res, payload);
      },
   });
}

// Get Restore Stats
export async function getRestoreStats(id: string) {
   if (!id) {
      throw new Error('ID Not Provided.');
   }

   const res = await fetch(`${API_URL}/restores/${id}/stats`, {
      method: 'GET',
      credentials: 'include',
   });
   const data = await res.json();
   if (!data.success) {
      throw new Error(data.error);
   }
   return data;
}

export function useGetRestoreStats(id: string) {
   return useQuery({
      queryKey: ['restore-stats', id],
      queryFn: () => getRestoreStats(id),
      refetchOnMount: true,
      retry: false,
      staleTime: 0,
   });
}

// Cancel Restore
export async function cancelRestore({ planId, restoreId }: { planId: string; restoreId: string }) {
   const res = await fetch(`${API_URL}/restores/${restoreId}/action/cancel?planId=${planId}`, {
      method: 'POST',
      credentials: 'include',
      // headers: header,
   });
   // Check if response is ok
   const data = await res.json();
   if (!data.success) {
      throw new Error(data.error);
   }
   return data;
}
export function useCancelRestore() {
   return useMutation({
      mutationFn: cancelRestore,
      onSuccess: (res, payload) => {
         console.log('res :', payload, res);
      },
   });
}

// Get Backup Progress
export async function getRestoreProgress({ id, sourceId, sourceType, planId }: { id: string; sourceId: string; sourceType: string; planId: string }) {
   const url = new URL(`${API_URL}/restores/${id}/progress?sourceId=${sourceId}&sourceType=${sourceType}&planId=${planId}`);

   const res = await fetch(url.toString(), {
      method: 'GET',
      credentials: 'include',
   });
   const data = await res.json();
   return data;
}

export function useGetRestoreProgress(payload: { id: string; sourceId: string; sourceType: string; planId: string }) {
   const queryClient = useQueryClient();
   return useQuery({
      queryKey: ['progress-restore', payload.id],
      queryFn: () => getRestoreProgress(payload),
      refetchOnMount: true,
      retry: false,
      refetchInterval(query) {
         const progressData = query.state?.data;

         // Check if backup is finished by looking for a "finished" phase event
         const isFinished = progressData?.events?.some((event: any) => event.phase === 'finished' && event.completed === true);

         if (isFinished) {
            const planId = progressData?.planId || payload.planId;
            if (!notifiedRestoreProgress.has(payload.id)) {
               notifiedRestoreProgress.add(payload.id);
               if (planId) {
                  console.log('Invalidate Plan and Reload It :', planId);
                  queryClient.invalidateQueries({ queryKey: ['plan', planId] });
               }
               toast.success('Restoration Complete!');
            }
            return false;
         }

         return 1000;
      },
   });
}
export function useGetRestoreProgressOnce(payload: { id: string; sourceId: string; sourceType: string; planId: string }) {
   return useQuery({
      queryKey: ['progress-restore', payload.id],
      queryFn: () => getRestoreProgress(payload),
      refetchOnMount: true,
      retry: false,
   });
}
