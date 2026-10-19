import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { API_URL } from '../utils/constants';
import { mutationResponse, parseApiResponse } from '../utils/httpResponse';
import type {
   InternalTargetView,
   RecoveryPolicy,
   RecoveryTarget,
   RecoveryTest,
   RecoveryPreparation,
   RecoverySelection,
} from '../@types/recoveryTests';
async function request<T>(planId: string, route: string, method = 'GET', body?: unknown): Promise<T> {
   const options: RequestInit = {
      method,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
   };
   const url = `${API_URL}/recovery-testing/${encodeURIComponent(planId)}/${route}`;
   const data = method === 'GET'
      ? await parseApiResponse<{ result: T }>(await fetch(url, options))
      : await mutationResponse<{ result: T }>(url, options);
   return data.result;
}
export function useRecoveryTests(planId: string, enabled = true, displayedBackups: string[] = []) {
   const backupIds = [...new Set(displayedBackups)].slice(0, 999).sort();
   return useQuery({
      queryKey: ['recoveryTests', planId, backupIds.join(',')],
      queryFn: () =>
         backupIds.length ? request<RecoveryTest[]>(planId, 'tests/lookup', 'POST', { backupIds }) : request<RecoveryTest[]>(planId, 'tests'),
      enabled: enabled && !!planId,
      retry: false,
      refetchInterval: 5000,
   });
}
export function useRecoveryConfiguration(planId?: string) {
   return useQuery({
      queryKey: ['recoveryConfiguration', planId],
      queryFn: () =>
         request<{
            policy: RecoveryPolicy;
            targets: RecoveryTarget[];
            internalTargets?: InternalTargetView[];
            mysqlWorker?: 'ready' | 'unavailable';
         }>(planId!, 'configuration'),
      enabled: !!planId,
      retry: false,
   });
}
export function useRecoveryAction(planId: string) {
   const queries = useQueryClient();
   return useMutation({
      retry: false,
      mutationFn: ({
         backupId,
         cancelId,
         ...confirmation
      }: {
         backupId?: string;
         cancelId?: string;
         snapshotId?: string;
         metadataToken?: string;
         resourcesAcknowledged?: true;
         selection?: RecoverySelection;
      }) =>
         cancelId
            ? request<RecoveryTest>(planId, `tests/${encodeURIComponent(cancelId)}/cancel`, 'POST')
            : request<RecoveryTest>(planId, 'tests', 'POST', { backupId, ...confirmation }),
      onSuccess: () => queries.invalidateQueries({ queryKey: ['recoveryTests', planId] }),
   });
}
export function useRecoveryPreparation(planId: string, backupId: string, snapshotId: string) {
   return useQuery({
      queryKey: ['recoveryPreparation', planId, backupId, snapshotId],
      queryFn: () => request<RecoveryPreparation>(planId, 'preparation', 'POST', { backupId, snapshotId }),
      retry: false,
      staleTime: 0,
      refetchOnWindowFocus: false,
   });
}
export function useSaveRecoveryPolicy(planId: string) {
   const queries = useQueryClient();
   return useMutation({
      mutationFn: (policy: RecoveryPolicy) => request(planId, 'policy', 'PUT', policy),
      onSuccess: () => queries.invalidateQueries({ queryKey: ['recoveryConfiguration', planId] }),
   });
}
export function useSaveRecoveryTarget(planId: string) {
   const queries = useQueryClient();
   return useMutation({
      mutationFn: (target: Omit<RecoveryTarget, 'passwordConfigured'> & { password?: string }) => request(planId, 'target', 'PUT', target),
      onSuccess: () => queries.invalidateQueries({ queryKey: ['recoveryConfiguration', planId] }),
   });
}
