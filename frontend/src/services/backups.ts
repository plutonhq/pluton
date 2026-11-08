import { keepPreviousData, useInfiniteQuery, useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-toastify';
import { API_URL } from '../utils/constants';
import { SnapshotIndexDir, SnapshotIndexRow, SnapshotIndexSelection, SnapshotIndexStatus } from '../@types/backups';

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
         console.log('res :', payload, res);
         queryClient.invalidateQueries({ queryKey: ['plan', payload.planId] });
      },
   });
}

// Get Download
export async function getBackupDownload(id: string) {
   const url = `${API_URL}/backups/${id}/action/download`;
   // HEAD pre-check so errors show a toast instead of a failed browser download
   const res = await fetch(url, { method: 'HEAD', credentials: 'include' });
   if (!res.ok) {
      throw new Error(res.status === 404 ? 'Download file not found. Please generate the download again.' : 'Download Failed!');
   }

   // Native browser download: shows size/progress and does not hold the file in memory
   const link = document.createElement('a');
   link.href = url;
   link.download = `backup-${id}.tar`;
   document.body.appendChild(link);
   link.click();
   link.remove();
}

export function useGetBackupDownload() {
   const queryClient = useQueryClient();
   return useMutation({
      mutationFn: getBackupDownload,
      onSuccess: (res) => {
         console.log('# Backup Downloaded! :', res);
      },
      onError: (error) => {
         console.log('# Download Failed! :', error);
         toast.error(error.message || 'Download Failed!');
         queryClient.invalidateQueries({ queryKey: ['plan'] });
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
export function useGetSnapshotFiles({ enabled = true, ...payload }: { backupId: string; replicationId?: string; enabled?: boolean }) {
   return useQuery({
      queryKey: ['snapshot-files', payload.backupId, payload.replicationId || '', payload],
      queryFn: () => getSnapshotFiles(payload),
      enabled,
      refetchOnMount: true,
      staleTime: 1000 * 60 * 60, // Cache the data for 60 minutes
      retry: false,
   });
}

// Snapshot Index
export const SNAPSHOT_INDEX_PAGE_SIZE = 1000;

type SnapshotIndexTarget = { backupId: string; replicationId?: string };

async function requestSnapshotIndex<T>(
   { backupId, replicationId }: SnapshotIndexTarget,
   path: string,
   params: Record<string, string | number | undefined> = {},
   init: RequestInit = {},
): Promise<T> {
   const query = new URLSearchParams();
   for (const [key, value] of Object.entries({ ...params, replicationId })) {
      if (value !== undefined && value !== '') {
         query.set(key, String(value));
      }
   }
   const res = await fetch(`${API_URL}/backups/${backupId}/index${path}?${query}`, { credentials: 'include', ...init });
   const data = await res.json();
   if (!data.success) {
      throw new Error(data.error);
   }
   return data.result;
}

export function startSnapshotIndex(target: SnapshotIndexTarget) {
   return requestSnapshotIndex<SnapshotIndexStatus>(target, '', {}, { method: 'POST' });
}

export function getSnapshotIndexStatus(target: SnapshotIndexTarget) {
   return requestSnapshotIndex<SnapshotIndexStatus>(target, '/status');
}

export function useSnapshotIndex({ enabled = true, backupId, replicationId }: SnapshotIndexTarget & { enabled?: boolean }) {
   const queryClient = useQueryClient();
   return useQuery({
      queryKey: ['snapshot-index', backupId, replicationId || ''],
      // Only a poll of a running build can use GET. POST starts a build again after a failure.
      queryFn: async ({ queryKey }) => {
         const target = { backupId, replicationId };
         const current = queryClient.getQueryData<SnapshotIndexStatus>(queryKey);
         if (current?.state !== 'building') {
            return startSnapshotIndex(target);
         }
         const status = await getSnapshotIndexStatus(target);
         return status.state === 'none' ? startSnapshotIndex(target) : status;
      },
      enabled,
      retry: false,
      refetchOnWindowFocus: false,
      refetchInterval: (query) => (query.state.data?.state === 'building' ? 3000 : false),
      meta: { background: true },
   });
}

export function getSnapshotEntries(
   target: SnapshotIndexTarget,
   params: { dir: string; sort: string; order: string; offset: number; limit: number; q?: string },
) {
   return requestSnapshotIndex<{ rows: SnapshotIndexRow[]; total: number }>(target, '/entries', params);
}

export function useSnapshotEntries({
   backupId,
   replicationId,
   builtAt,
   dir,
   sort,
   order,
   q,
   enabled = true,
}: SnapshotIndexTarget & { builtAt?: number; dir: string; sort: string; order: string; q?: string; enabled?: boolean }) {
   return useInfiniteQuery({
      queryKey: ['snapshot-index-entries', backupId, replicationId || '', builtAt, dir, sort, order, q],
      queryFn: ({ pageParam }) =>
         getSnapshotEntries({ backupId, replicationId }, { dir, sort, order, q, offset: pageParam, limit: SNAPSHOT_INDEX_PAGE_SIZE }),
      initialPageParam: 0,
      getNextPageParam: (lastPage, pages) => {
         const loaded = pages.reduce((count, page) => count + page.rows.length, 0);
         return lastPage.rows.length > 0 && loaded < lastPage.total ? loaded : undefined;
      },
      enabled,
      retry: false,
      staleTime: Infinity,
      meta: { background: true },
   });
}

export function getSnapshotDirs(target: SnapshotIndexTarget, params: { parent: string; depth?: number; offset: number; limit: number }) {
   return requestSnapshotIndex<{ dirs: SnapshotIndexDir[]; total: number }>(target, '/dirs', params);
}

export function useSnapshotDirs({
   backupId,
   replicationId,
   builtAt,
   pages,
   enabled = true,
}: SnapshotIndexTarget & { builtAt?: number; pages: { parent: string; offset: number }[]; enabled?: boolean }) {
   return useQueries({
      queries: pages.map(({ parent, offset }) => ({
         queryKey: ['snapshot-index-dirs', backupId, replicationId || '', builtAt, parent, offset],
         queryFn: () => getSnapshotDirs({ backupId, replicationId }, { parent, offset, limit: SNAPSHOT_INDEX_PAGE_SIZE }),
         enabled,
         retry: false,
         staleTime: Infinity,
         meta: { background: true },
      })),
      combine: (results) => ({
         data: results.map((result) => result.data),
         error: results.find((result) => result.error)?.error,
         isFetching: results.some((result) => result.isFetching),
      }),
   });
}

export function getSnapshotSelection(target: SnapshotIndexTarget, selection: { includes: string[]; excludes: string[] }) {
   return requestSnapshotIndex<SnapshotIndexSelection>(
      target,
      '/selection',
      {},
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(selection) },
   );
}

export function useSnapshotSelection({
   backupId,
   replicationId,
   builtAt,
   includes,
   excludes,
   enabled = true,
}: SnapshotIndexTarget & { builtAt?: number; includes: string[]; excludes: string[]; enabled?: boolean }) {
   return useQuery({
      queryKey: ['snapshot-index-selection', backupId, replicationId || '', builtAt, includes, excludes],
      queryFn: () => getSnapshotSelection({ backupId, replicationId }, { includes, excludes }),
      enabled,
      retry: false,
      staleTime: Infinity,
      placeholderData: keepPreviousData,
      meta: { background: true },
   });
}

// Retry Failed Replications
export async function retryFailedReplications({ backupId, replicationId }: { backupId: string; planId: string; replicationId: string }) {
   const header = new Headers({ 'Content-Type': 'application/json', Accept: 'application/json' });
   const res = await fetch(`${API_URL}/backups/${backupId}/action/replication-retry?replicationId=${replicationId}`, {
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

export function useRetryFailedReplications() {
   const queryClient = useQueryClient();
   return useMutation({
      mutationFn: retryFailedReplications,
      onSuccess: (res, payload) => {
         console.log('res :', payload, res);
         queryClient.invalidateQueries({ queryKey: ['plan', payload.planId] });
      },
   });
}
