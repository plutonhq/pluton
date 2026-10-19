import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { API_URL } from '../utils/constants';
import { mutationResponse, parseApiResponse } from '../utils/httpResponse';
import type {
   LegacyRepository,
   LegacyRepositoryRegistration,
   LegacyRepositorySnapshotPage,
   LegacyRepositorySnapshotFilters,
   LegacyRepositoryStats,
   LegacyRestoreJob,
   LegacyRestoreRequest,
   LegacySnapshotDirectory,
} from '../@types/legacyRepositories';

type ApiResponse<T> = {
   success: boolean;
   result: T;
   error?: string;
   message?: string;
};

async function request<T>(path: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
   const init: RequestInit = {
      credentials: 'include',
      ...options,
   };
   return options.method && options.method !== 'GET'
      ? mutationResponse<ApiResponse<T>>(`${API_URL}/legacy-repositories${path}`, init, { allowNoContent: options.method === 'DELETE', allowAccepted: options.method !== 'DELETE' })
      : parseApiResponse<ApiResponse<T>>(await fetch(`${API_URL}/legacy-repositories${path}`, init));
}

export function getLegacyRepositories() {
   return request<LegacyRepository[]>('');
}

export function useLegacyRepositories() {
   return useQuery({
      queryKey: ['legacy-repositories'],
      queryFn: getLegacyRepositories,
      retry: false,
   });
}

export function getLegacyRepository(id: string) {
   return request<LegacyRepository>(`/${encodeURIComponent(id)}`);
}

export function useLegacyRepository(id?: string) {
   return useQuery({
      queryKey: ['legacy-repositories', id],
      queryFn: () => getLegacyRepository(id as string),
      enabled: Boolean(id),
      retry: false,
   });
}

export function getLegacyRepositorySnapshots(id: string, filters: LegacyRepositorySnapshotFilters = {}) {
   const query = new URLSearchParams();
   if (filters.tag) query.set('tag', filters.tag);
   if (filters.path) query.set('path', filters.path);
   if (filters.host) query.set('host', filters.host);
   if (filters.workload) query.set('workload', filters.workload);
   if (filters.dataset) query.set('dataset', filters.dataset);
   if (filters.page) query.set('page', String(filters.page));
   if (filters.pageSize) query.set('pageSize', String(filters.pageSize));
   const suffix = query.toString();
   return request<LegacyRepositorySnapshotPage>(`/${encodeURIComponent(id)}/snapshots${suffix ? `?${suffix}` : ''}`);
}

export function useLegacyRepositorySnapshots(id?: string, filters: LegacyRepositorySnapshotFilters = {}) {
   return useQuery({
      queryKey: ['legacy-repositories', id, 'snapshots', filters],
      queryFn: () => getLegacyRepositorySnapshots(id as string, filters),
      enabled: Boolean(id),
      retry: false,
   });
}

export function getLegacyRepositoryStats(id: string) {
   return request<LegacyRepositoryStats>(`/${encodeURIComponent(id)}/stats`);
}

export function useLegacyRepositoryStats(id?: string) {
   return useQuery({
      queryKey: ['legacy-repositories', id, 'stats'],
      queryFn: () => getLegacyRepositoryStats(id as string),
      enabled: Boolean(id),
      retry: false,
   });
}

export function getLegacySnapshotDirectory(repositoryId: string, snapshotId: string, snapshotPath = '') {
   const query = new URLSearchParams();
   if (snapshotPath) query.set('path', snapshotPath);
   const suffix = query.toString();
   return request<LegacySnapshotDirectory>(
      `/${encodeURIComponent(repositoryId)}/snapshots/${encodeURIComponent(snapshotId)}/tree${suffix ? `?${suffix}` : ''}`
   );
}

export function useLegacySnapshotDirectory(repositoryId?: string, snapshotId?: string, snapshotPath = '') {
   return useQuery({
      queryKey: ['legacy-repositories', repositoryId, 'snapshots', snapshotId, 'tree', snapshotPath],
      queryFn: () => getLegacySnapshotDirectory(repositoryId as string, snapshotId as string, snapshotPath),
      enabled: Boolean(repositoryId && snapshotId),
      retry: false,
   });
}

export type LegacyRestorePayload = {
   repositoryId: string;
   request: LegacyRestoreRequest;
};

export function createLegacyRestore({ repositoryId, request: restoreRequest }: LegacyRestorePayload) {
   return request<LegacyRestoreJob>(`/${encodeURIComponent(repositoryId)}/restores`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(restoreRequest),
   });
}

export function useCreateLegacyRestore() {
   const queryClient = useQueryClient();
   return useMutation({
      mutationFn: createLegacyRestore,
      onSuccess: async (_result, payload) => {
         await queryClient.invalidateQueries({ queryKey: ['legacy-repositories', payload.repositoryId, 'restores'] });
      },
   });
}

export function getLegacyRestoreJob(repositoryId: string, jobId: string) {
   return request<LegacyRestoreJob>(`/${encodeURIComponent(repositoryId)}/restores/${encodeURIComponent(jobId)}`);
}

export function useLegacyRestoreJob(repositoryId?: string, jobId?: string) {
   return useQuery({
      queryKey: ['legacy-repositories', repositoryId, 'restores', jobId],
      queryFn: () => getLegacyRestoreJob(repositoryId as string, jobId as string),
      enabled: Boolean(repositoryId && jobId),
      retry: false,
      refetchInterval: query => {
         const status = query.state.data?.result.status;
         return status === 'queued' || status === 'running' ? 2000 : false;
      },
   });
}

export type LegacyRestoreJobPayload = {
   repositoryId: string;
   jobId: string;
};

export function cancelLegacyRestore({ repositoryId, jobId }: LegacyRestoreJobPayload) {
   return request<LegacyRestoreJob>(`/${encodeURIComponent(repositoryId)}/restores/${encodeURIComponent(jobId)}/cancel`, {
      method: 'POST',
      headers: { Accept: 'application/json' },
   });
}

export function useCancelLegacyRestore() {
   const queryClient = useQueryClient();
   return useMutation({
      mutationFn: cancelLegacyRestore,
      onSuccess: async (_result, payload) => {
         await queryClient.invalidateQueries({ queryKey: ['legacy-repositories', payload.repositoryId, 'restores', payload.jobId] });
      },
   });
}

export async function downloadLegacyRestoredFile({ repositoryId, jobId, path }: LegacyRestoreJobPayload & { path: string }): Promise<void> {
   const query = new URLSearchParams({ path });
   const response = await fetch(
      `${API_URL}/legacy-repositories/${encodeURIComponent(repositoryId)}/restores/${encodeURIComponent(jobId)}/files?${query.toString()}`,
      { credentials: 'include' }
   );
   if (!response.ok) {
      const error = (await response.json().catch(() => null)) as Partial<ApiResponse<unknown>> | null;
      throw new Error(error?.error || 'Could not download the restored file.');
   }

   const contentDisposition = response.headers.get('content-disposition') || '';
   const encodedFileName = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
   const quotedFileName = contentDisposition.match(/filename="([^"]+)"/i)?.[1];
   let fileName = `restored-${path.split('/').pop() || 'file'}`;
   try {
      fileName = encodedFileName ? decodeURIComponent(encodedFileName) : quotedFileName || fileName;
   } catch {
      fileName = quotedFileName || fileName;
   }

   const blob = await response.blob();
   const downloadUrl = window.URL.createObjectURL(blob);
   const anchor = document.createElement('a');
   anchor.href = downloadUrl;
   anchor.download = fileName;
   document.body.appendChild(anchor);
   anchor.click();
   anchor.remove();
   window.URL.revokeObjectURL(downloadUrl);
}

export function useDownloadLegacyRestoredFile() {
   return useMutation({ mutationFn: downloadLegacyRestoredFile });
}

export function useRegisterLegacyRepository() {
   const queryClient = useQueryClient();
   return useMutation({
      mutationFn: (registration: LegacyRepositoryRegistration) =>
         request<LegacyRepository>('', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(registration),
         }),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ['legacy-repositories'] }),
   });
}

export function useValidateLegacyRepository() {
   const queryClient = useQueryClient();
   return useMutation({
      mutationFn: (id: string) =>
         request<{ validationStatus: LegacyRepository['validationStatus']; lastValidatedAt: string }>(
            `/${encodeURIComponent(id)}/validate`,
            { method: 'POST', headers: { Accept: 'application/json' } }
         ),
      onSuccess: async (_result, id) => {
         await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['legacy-repositories'] }),
            queryClient.invalidateQueries({ queryKey: ['legacy-repositories', id] }),
         ]);
      },
   });
}

export function useDeleteLegacyRepository() {
   const queryClient = useQueryClient();
   return useMutation({
      retry: false,
      mutationFn: (id: string) =>
         request<void>(`/${encodeURIComponent(id)}`, {
            method: 'DELETE',
            headers: { Accept: 'application/json' },
         }),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ['legacy-repositories'] }),
   });
}
