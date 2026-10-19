import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { experimental_createQueryPersister } from '@tanstack/react-query-persist-client';
import { API_URL } from '../utils/constants';
import { useNavigate } from 'react-router';
import { IntegrationSettings } from '../@types';

// ============== Settings API ==============

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
   if (!data.success) {
      throw new Error(data.error);
   }
   return data;
}

export function useUpdateSettings() {
   const queryClient = useQueryClient();
   return useMutation({
      mutationFn: updateSettings,
      onSuccess: () => {
         queryClient.invalidateQueries({ queryKey: ['settings'] });
         queryClient.invalidateQueries({ queryKey: ['selfBackupStatus'] });
         queryClient.invalidateQueries({ queryKey: ['selfBackupBackups'] });
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

// ============== Pluton Self-Backup API ==============

export interface SelfBackupStatus {
   enabled: boolean;
   storageId: string;
   storageName: string;
   path: string;
   intervalHours: number;
   retention: number;
   notifyOnFailure: boolean;
   lastRunAt?: string;
   lastSuccessAt?: string;
   lastError?: string | null;
   lastBlobName?: string;
   running: boolean;
}

export interface SelfBackupBlob {
   name: string;
   size: number;
   modTime?: string;
}

export async function getSelfBackupStatus(settingsID: string) {
   const res = await fetch(`${API_URL}/settings/${settingsID}/self-backup/status`, {
      method: 'GET',
      credentials: 'include',
   });
   const data = await res.json();
   if (!data.success) {
      throw new Error(data.error);
   }
   return data as { success: boolean; result: SelfBackupStatus };
}

export function useGetSelfBackupStatus(settingsID: string) {
   return useQuery({
      queryKey: ['selfBackupStatus', settingsID],
      queryFn: () => getSelfBackupStatus(settingsID),
      enabled: !!settingsID,
      refetchOnMount: true,
      retry: false,
      refetchInterval: (query) => (query.state.data?.result?.running ? 3000 : false),
   });
}

export async function runSelfBackup(settingsID: string) {
   const res = await fetch(`${API_URL}/settings/${settingsID}/self-backup/run`, {
      method: 'POST',
      credentials: 'include',
   });
   const data = await res.json();
   if (!data.success) {
      throw new Error(data.error);
   }
   return data;
}

export function useRunSelfBackup() {
   const queryClient = useQueryClient();
   return useMutation({
      mutationFn: runSelfBackup,
      onSuccess: () => {
         queryClient.invalidateQueries({ queryKey: ['selfBackupStatus'] });
         queryClient.invalidateQueries({ queryKey: ['selfBackupBackups'] });
      },
   });
}

export async function getSelfBackupBackups(settingsID: string) {
   const res = await fetch(`${API_URL}/settings/${settingsID}/self-backup/backups`, {
      method: 'GET',
      credentials: 'include',
   });
   const data = await res.json();
   if (!data.success) {
      throw new Error(data.error);
   }
   return data as { success: boolean; result: SelfBackupBlob[] };
}

export function useGetSelfBackupBackups(settingsID: string, enabled = true) {
   return useQuery({
      queryKey: ['selfBackupBackups', settingsID],
      queryFn: () => getSelfBackupBackups(settingsID),
      enabled: enabled && !!settingsID,
      refetchOnMount: true,
      retry: false,
   });
}

export async function downloadSelfBackup({ settingsID, blobName }: { settingsID: string; blobName: string }) {
   const res = await fetch(`${API_URL}/settings/${settingsID}/self-backup/backups/${encodeURIComponent(blobName)}/download`, {
      method: 'GET',
      credentials: 'include',
   });
   if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error);
   }

   const filename = res.headers.get('content-disposition')?.split('filename=')[1]?.replace(/"/g, '') || blobName;

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

export function useDownloadSelfBackup() {
   return useMutation({
      mutationFn: downloadSelfBackup,
   });
}

export async function validateIntegration(updatePayload: {
   settingsID: number;
   type: string;
   settings: IntegrationSettings;
   test: Record<string, string | boolean | number>;
}) {
   const header = new Headers({ 'Content-Type': 'application/json', Accept: 'application/json' });
   const res = await fetch(`${API_URL}/settings/integration/validate`, {
      method: 'POST',
      credentials: 'include',
      headers: header,
      body: JSON.stringify(updatePayload),
   });
   const data = await res.json();
   if (!data.success) {
      throw new Error(data.error);
   }
   return data;
}

export function useValidateIntegration() {
   const queryClient = useQueryClient();
   return useMutation({
      mutationFn: validateIntegration,
      onSuccess: () => {
         queryClient.invalidateQueries({ queryKey: ['settings'] });
      },
   });
}

// ============== Setup API ==============

export interface SetupStatus {
   setupPending: boolean;
   isBinary: boolean;
   requiresSetup: boolean;
   /** @deprecated Use requiresSetup instead */
   requiresKeyringSetup: boolean;
   hasEncEnvFile: boolean;
   platform: string;
}

export interface SetupCredentials {
   encryptionKey: string;
   userName: string;
   userPassword: string;
}

// Fetch setup status
export async function getSetupStatus(): Promise<{ success: boolean; data: SetupStatus }> {
   const res = await fetch(`${API_URL}/setup/status`, { method: 'GET' });
   if (!res.ok) {
      throw new Error('Failed to get setup status');
   }
   return res.json();
}

export function useSetupStatus() {
   return useQuery({
      queryKey: ['setupStatus'],
      queryFn: getSetupStatus,
      retry: false,
   });
}

// Complete setup
export async function completeSetup(credentials: SetupCredentials): Promise<{ success: boolean; message?: string; error?: string }> {
   const res = await fetch(`${API_URL}/setup/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credentials),
   });
   return res.json();
}

export function useCompleteSetup() {
   return useMutation({
      mutationFn: completeSetup,
   });
}

// Two-Factor Authentication (2FA) Setup and Verification

export async function setupTwoFactorAuth(id: number) {
   const headers = new Headers({ 'Content-Type': 'application/json', Accept: 'application/json' });
   const res = await fetch(`${API_URL}/settings/${id}/2fa/setup`, {
      method: 'POST',
      headers,
      credentials: 'include',
   });
   // Check if response is ok
   if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error);
   }
   const data = await res.json();
   return data;
}

export function useSetupTwoFactorAuth() {
   return useMutation({
      mutationFn: setupTwoFactorAuth,
   });
}
export async function verifyTwoFactorAuth({ code, id }: { code: string; id: number }) {
   const headers = new Headers({ 'Content-Type': 'application/json', Accept: 'application/json' });
   const res = await fetch(`${API_URL}/settings/${id}/2fa/finalize`, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify({ code }),
   });
   // Check if response is ok
   if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error);
   }
   const data = await res.json();
   return data;
}

export function useVerifyTwoFactorAuth() {
   return useMutation({
      mutationFn: verifyTwoFactorAuth,
   });
}

export async function verifyTwoFactorOTP({ code }: { code: string }) {
   const headers = new Headers({ 'Content-Type': 'application/json', Accept: 'application/json' });
   const res = await fetch(`${API_URL}/user/verify-otp`, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify({ code }),
   });
   // Check if response is ok
   if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error);
   }
   const data = await res.json();
   return data;
}

export function useVerifyTwoFactorOTP() {
   const navigate = useNavigate();
   return useMutation({
      mutationFn: verifyTwoFactorOTP,
      onSuccess: () => {
         navigate('/');
      },
   });
}

// check latest version
export async function checkLatestVersion() {
   const res = await fetch(`${API_URL}/settings/version/latest`, {
      method: 'GET',
      credentials: 'include',
   });
   if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error);
   }
   const data = await res.json();
   return data;
}

const SIX_HOURS = 1000 * 60 * 60 * 6;

const { persisterFn: latestVersionPersister } = experimental_createQueryPersister({
   storage: window.localStorage,
   maxAge: SIX_HOURS,
});

export function useCheckLatestVersion() {
   return useQuery({
      queryKey: ['latestVersion'],
      queryFn: () => checkLatestVersion(),
      persister: latestVersionPersister,
      retry: false,
      staleTime: SIX_HOURS,
      gcTime: SIX_HOURS,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      refetchOnMount: false,
   });
}
