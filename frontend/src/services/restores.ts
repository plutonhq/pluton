import { mutationResponse } from '../utils/httpResponse';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-toastify';
import { API_URL } from '../utils/constants';
import { useMemo } from 'react';
import { progressPollingFor, fetchProgress, progressFinished } from '../utils/progressPolling';

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
   return mutationResponse<{ success: boolean; message?: string }>(`${API_URL}/restores/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      credentials: 'include',
      headers: header,
   }, { allowNoContent: true, allowAccepted: false });
}

export function useDeleteRestore() {
   return useMutation({
      mutationFn: deleteRestore,
      retry: false,
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
   storageId,
   replicationId,
   fromStorage,
}: {
   backupId: string;
   planId: string;
   target: string;
   overwrite: string;
   includes?: string[];
   excludes?: string[];
   deleteOption: boolean;
   storageId?: string;
   replicationId?: string;
   fromStorage?: boolean;
}) {
   const header = new Headers({ 'Content-Type': 'application/json', Accept: 'application/json' });
   const res = await fetch(`${API_URL}/restores/action/restore`, {
      method: 'POST',
      credentials: 'include',
      headers: header,
      body: JSON.stringify({ backupId, planId, target, overwrite, includes, excludes, delete: deleteOption, storageId, replicationId, fromStorage }),
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
   storageId,
   replicationId,
}: {
   backupId: string;
   planId: string;
   target: string;
   overwrite: string;
   includes?: string[];
   excludes?: string[];
   deleteOption?: boolean;
   storageId?: string;
   replicationId?: string;
}) {
   const header = new Headers({ 'Content-Type': 'application/json', Accept: 'application/json' });
   const res = await fetch(`${API_URL}/restores/action/dryrestore`, {
      method: 'POST',
      credentials: 'include',
      headers: header,
      body: JSON.stringify({ backupId, planId, target, overwrite, includes, excludes, delete: deleteOption, storageId, replicationId }),
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
export async function getRestoreProgress({ id, sourceId, sourceType, planId }: { id: string; sourceId: string; sourceType: string; planId: string }, signal?: AbortSignal) {
   const url = new URL(`${API_URL}/restores/${encodeURIComponent(id)}/progress`);
   url.search = new URLSearchParams({ sourceId, sourceType, planId }).toString();
   return fetchProgress(url, signal);
}

export function useGetRestoreProgress(payload: { id: string; sourceId: string; sourceType: string; planId: string }) {
   const queryClient = useQueryClient();
   const { id, sourceId, sourceType, planId } = payload;
   const polling = useMemo(() => progressPollingFor(queryClient, ['progress-restore', id], (signal) => getRestoreProgress({ id, sourceId, sourceType, planId }, signal)), [queryClient, id, sourceId, sourceType, planId]);
   const query = useQuery({
      queryKey: ['progress-restore', payload.id],
      ...polling,
      refetchInterval(query) {
         const progressData = query.state?.data;
         const isFinished = progressFinished(progressData);

         if (isFinished) {
            const planId = progressData?.planId || payload.planId;
            if (!notifiedRestoreProgress.has(payload.id)) {
               notifiedRestoreProgress.add(payload.id);
               if (planId) {
                  queryClient.invalidateQueries({ queryKey: ['plan', planId] });
               }
               if (progressData.status === 'cancelled') toast.info('Restoration Cancelled.');
               else if (progressData.status === 'failed' || progressData.success === false) toast.error('Restoration Failed. See the restore record for details.');
               else toast.success('Restoration Complete!');
            }
            return false;
         }

         return polling.refetchInterval();
      },
   });
   return { ...query, retryProgress: () => { if (polling.resume()) void query.refetch(); } };
}
export function useGetRestoreProgressOnce(payload: { id: string; sourceId: string; sourceType: string; planId: string }) {
   return useQuery({
      queryKey: ['progress-restore', payload.id],
      queryFn: () => getRestoreProgress(payload),
      refetchOnMount: true,
      retry: false,
   });
}
