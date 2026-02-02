import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-toastify';
import { API_URL } from '../utils/constants';

const notifiedBackupProgress = new Set<string>();

// Generate Download
export async function generateBackupDownload({ backupId }: { backupId: string; planId: string }) {
   // const header = new Headers({ 'Content-Type': 'application/json', Accept: 'application/json' });
   const res = await fetch(`${API_URL}/backups/${backupId}/action/download`, {
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

export function useDownloadBackup() {
   const queryClient = useQueryClient();

   return useMutation({
      mutationFn: generateBackupDownload,
      onSuccess: (res, payload) => {
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
   const res = await fetch(`${API_URL}/backups/${backupId}/action/download`, {
      method: 'DELETE',
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
export function useCancelBackupDownload() {
   const queryClient = useQueryClient();
   return useMutation({
      mutationFn: cancelBackupDownload,
      onSuccess: (res, payload) => {
         console.log('res :', payload, res);
         queryClient.invalidateQueries({ queryKey: ['plan', payload.planId] });
      },
   });
}

// Remove Backup
export async function deleteBackup(id: string) {
   const header = new Headers({ 'Content-Type': 'application/json', Accept: 'application/json' });
   const res = await fetch(`${API_URL}/backups/${id}`, {
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

export function useDeleteBackup() {
   return useMutation({
      mutationFn: deleteBackup,
      onSuccess: (res) => {
         console.log('# Backup Removed! :', res);
      },
   });
}

// Get Backup Progress
export async function getBackupProgress({ id, sourceId, sourceType, planId }: { id: string; sourceId: string; sourceType: string; planId: string }) {
   const url = new URL(`${API_URL}/backups/${id}/progress?sourceId=${sourceId}&sourceType=${sourceType}&planId=${planId}`);

   const res = await fetch(url.toString(), {
      method: 'GET',
      credentials: 'include',
   });
   const data = await res.json();
   return data;
}

export function useGetBackupProgress(payload: { id: string; sourceId: string; sourceType: string; planId: string }) {
   const queryClient = useQueryClient();
   return useQuery({
      queryKey: ['progress-backup', payload.id],
      queryFn: () => getBackupProgress(payload),
      refetchOnMount: true,
      retry: false,
      refetchInterval(query) {
         // Only refetch if the browser tab is active
         // if (document.hidden) return false;

         // console.log('query :', query.state?.data);
         const progressData = query.state?.data;

         // Check if backup is finished by looking for a "finished" phase event
         const isFinished = progressData?.events?.some((event: any) => event.phase === 'finished' && event.completed === true);

         if (isFinished) {
            const planId = progressData?.planId || payload.planId;
            if (!notifiedBackupProgress.has(payload.id)) {
               notifiedBackupProgress.add(payload.id);
               if (planId) {
                  console.log('Invalidate Plan and Reload It :', planId);
                  queryClient.invalidateQueries({ queryKey: ['plan', planId] });
               }
               toast.success('Process Complete!');
            }
            return false;
         }

         return 1000;
      },
   });
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
export async function getSnapshotFiles({ backupId }: { backupId: string }) {
   const res = await fetch(`${API_URL}/backups/${backupId}/files`, {
      method: 'GET',
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
export function useGetSnapshotFiles(payload: { backupId: string }) {
   return useQuery({
      queryKey: ['snapshot-files', payload.backupId],
      queryFn: () => getSnapshotFiles(payload),
      refetchOnMount: true,
      staleTime: 1000 * 60 * 60, // Cache the data for 60 minutes
      retry: false,
   });
}
