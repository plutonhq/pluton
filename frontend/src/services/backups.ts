import { mutationResponse } from '../utils/httpResponse';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-toastify';
import { API_URL } from '../utils/constants';
import { startNativeBackupDownload } from '../utils/backupDownload';
import { useMemo } from 'react';
import { progressPollingFor, fetchProgress, progressFinished } from '../utils/progressPolling';

const notifiedBackupProgress = new Set<string>();

// Generate Download
export async function generateBackupDownload({ backupId, replicationId }: { backupId: string; planId: string; replicationId?: string }) {
   const url = `${API_URL}/backups/${backupId}/action/download?${replicationId ? `replicationId=${replicationId}` : ''}`;
   const res = await fetch(url, {
      method: 'POST',
      credentials: 'include',
   });
   const data = await res.json();
   if (!data.success) {
      throw new Error(data.error);
   }
   return data;
}

export function useDownloadBackup() {
   const queryClient = useQueryClient();

   return useMutation({
      mutationFn: generateBackupDownload,
      onSuccess: (res, payload) => {
         if (res.result?.streaming === true) startNativeBackupDownload(API_URL, payload.backupId);
         console.log('res :', payload, res);
         queryClient.invalidateQueries({ queryKey: ['plan', payload.planId] });
      },
   });
}

// Get Download
export async function getBackupDownload(id: string) {
   // const header = new Headers({ 'Content-Type': 'application/json', Accept: 'application/json' });
   const res = await fetch(`${API_URL}/backups/${id}/action/download`, {
      method: 'GET',
      credentials: 'include',
      // headers: header,
   });
   // Check if response is ok
   if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error);
   }

   const filename = res.headers.get('content-disposition')?.split('filename=')[1] || `backup-${id}.tar`;

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

export function useGetBackupDownload() {
   return useMutation({
      mutationFn: getBackupDownload,
      onSuccess: (res) => {
         console.log('# Backup Downloaded! :', res);
      },
      onError: (res) => {
         console.log('# Download Failed! :', res);
      },
   });
}

// Cancel Download
export async function cancelBackupDownload({ backupId }: { backupId: string; planId: string }) {
   return mutationResponse<{ success: boolean; message?: string }>(`${API_URL}/backups/${encodeURIComponent(backupId)}/action/download`, {
      method: 'DELETE',
      credentials: 'include',
      // headers: header,
   }, { allowNoContent: true, allowAccepted: false });
}
export function useCancelBackupDownload() {
   const queryClient = useQueryClient();
   return useMutation({
      mutationFn: cancelBackupDownload,
      retry: false,
      onSuccess: (res, payload) => {
         console.log('res :', payload, res);
         queryClient.invalidateQueries({ queryKey: ['plan', payload.planId] });
      },
   });
}

// Remove Backup
export async function deleteBackup(id: string) {
   const header = new Headers({ 'Content-Type': 'application/json', Accept: 'application/json' });
   return mutationResponse<{ success: boolean; message?: string }>(`${API_URL}/backups/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      credentials: 'include',
      headers: header,
   }, { allowNoContent: true, allowAccepted: false });
}

export function useDeleteBackup() {
   return useMutation({
      mutationFn: deleteBackup,
      retry: false,
      onSuccess: (res) => {
         console.log('# Backup Removed! :', res);
      },
   });
}

// Get Backup Progress
export async function getBackupProgress({ id, sourceId, sourceType, planId }: { id: string; sourceId: string; sourceType: string; planId: string }, signal?: AbortSignal) {
   const url = new URL(`${API_URL}/backups/${encodeURIComponent(id)}/progress`);
   url.search = new URLSearchParams({ sourceId, sourceType, planId }).toString();
   return fetchProgress(url, signal);
}

export function useGetBackupProgress(payload: { id: string; sourceId: string; sourceType: string; planId: string }) {
   const queryClient = useQueryClient();
   const { id, sourceId, sourceType, planId } = payload;
   const polling = useMemo(() => progressPollingFor(queryClient, ['progress-backup', id], (signal) => getBackupProgress({ id, sourceId, sourceType, planId }, signal)), [queryClient, id, sourceId, sourceType, planId]);
   const query = useQuery({
      queryKey: ['progress-backup', payload.id],
      ...polling,
      refetchInterval(query) {
         const progressData = query.state?.data;
         const isFinished = progressFinished(progressData);

         if (isFinished) {
            const planId = progressData?.planId || payload.planId;
            if (!notifiedBackupProgress.has(payload.id)) {
               notifiedBackupProgress.add(payload.id);
               if (planId) {
                  queryClient.invalidateQueries({ queryKey: ['plan', planId] });
               }
               if (progressData?.status === 'cancelled') toast.info('Backup cancelled.');
               else if (progressData?.status === 'failed' || progressData?.success === false) toast.error('Backup failed. Review the backup details.');
               else toast.success('Process Complete!');
            }
            return false;
         }

         return polling.refetchInterval();
      },
   });
   return { ...query, retryProgress: () => { if (polling.resume()) void query.refetch(); } };
}

export function useGetBackupProgressOnce(payload: { id: string; sourceId: string; sourceType: string; planId: string }) {
   return useQuery({
      queryKey: ['progress-backup', payload.id],
      queryFn: () => getBackupProgress(payload),
      refetchOnMount: true,
      retry: false,
   });
}

// Cancel Backup
export async function cancelBackup({ planId, backupId }: { planId: string; backupId: string }) {
   const res = await fetch(`${API_URL}/backups/${backupId}/action/cancel?planId=${planId}`, {
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
export function useCancelBackup() {
   return useMutation({
      mutationFn: cancelBackup,
      onSuccess: (res, payload) => {
         console.log('res :', payload, res);
      },
   });
}

// Update Backup Title and Description
export async function updateBackup({ backupId, updatePayload }: { backupId: string; updatePayload: { title?: string; description?: string } }) {
   console.log('updatePayload :', updatePayload);
   const header = new Headers({ 'Content-Type': 'application/json', Accept: 'application/json' });
   const res = await fetch(`${API_URL}/backups/${backupId}`, {
      method: 'POST',
      credentials: 'include',
      body: JSON.stringify(updatePayload),
      headers: header,
   });
   // Check if response is ok
   const data = await res.json();
   if (!data.success) {
      throw new Error(data.error);
   }
   return data;
}
export function useUpdateBackup() {
   return useMutation({
      mutationFn: updateBackup,
      onSuccess: (res, payload) => {
         console.log('res :', payload, res);
      },
   });
}

// Get Snapshot Files
export async function getSnapshotFiles({ backupId, replicationId }: { backupId: string; replicationId?: string }) {
   const url = replicationId ? `${API_URL}/backups/${backupId}/files?replicationId=${replicationId}` : `${API_URL}/backups/${backupId}/files`;
   const res = await fetch(url, {
      method: 'GET',
      credentials: 'include',
   });
   const data = await res.json();
   if (!data.success) {
      throw new Error(data.error);
   }
   return data;
}
export function useGetSnapshotFiles(payload: { backupId: string }) {
   return useQuery({
      queryKey: ['snapshot-files', payload.backupId],
      queryFn: () => getSnapshotFiles(payload),
      refetchOnMount: true,
      staleTime: 1000 * 60 * 60, // Cache the data for 60 minutes
      retry: false,
   });
}

// Get Snapshot Files (Mutation)
// To be used for manual refresh or when triggered from an action,
// since it bypasses the cache and directly calls the API
export function useBrowseSnapshot() {
   return useMutation({
      mutationFn: getSnapshotFiles,
      onSuccess: (res, payload) => {
         console.log('res :', payload, res);
      },
   });
}

// Retry Failed Replications
export async function retryFailedReplications({ backupId, replicationId }: { backupId: string; planId: string; replicationId: string }) {
   const header = new Headers({ 'Content-Type': 'application/json', Accept: 'application/json' });
   const url = new URL(`${API_URL}/backups/${encodeURIComponent(backupId)}/action/replication-retry`);
   url.searchParams.set('replicationId', replicationId);
   return mutationResponse<{ success: boolean; result?: string }>(url, {
      method: 'POST',
      credentials: 'include',
      headers: header,
   });
}

export function useRetryFailedReplications() {
   const queryClient = useQueryClient();
   return useMutation({
      mutationFn: retryFailedReplications,
      retry: false,
      onSuccess: (_res, payload) => {
         queryClient.invalidateQueries({ queryKey: ['plan', payload.planId] });
      },
   });
}
