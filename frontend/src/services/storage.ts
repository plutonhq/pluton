import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { API_URL } from '../utils/constants';

interface NewStoragePayload {
   name: string;
   type: string;
   authType: string;
   credentials: Record<string, string | number | boolean>;
   settings: Record<string, string | number | boolean>;
   tags?: string[];
}
interface UpdateStoragePayload {
   id: string;
   data: {
      // name: string;
      type: string;
      credentials: Record<string, string | number | boolean>;
      settings: Record<string, string | number | boolean>;
      tags?: string[];
   };
}

// Get All Storages
export async function getAvailableStorages() {
   const url = new URL(`${API_URL}/storages/available`);

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

export function useGetAvailableStorages() {
   return useQuery({
      queryKey: ['storageSettings'],
      queryFn: () => getAvailableStorages(),
      refetchOnMount: false,
      retry: false,
   });
}

// Get All Storages
export async function getAllStorages() {
   const url = new URL(`${API_URL}/storages`);

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

export function useGetStorages() {
   return useQuery({
      queryKey: ['storages'],
      queryFn: () => getAllStorages(),
      refetchOnMount: true,
      retry: false,
   });
}

// Get Single Storage
export async function getStorage(id: string) {
   const url = new URL(`${API_URL}/storages/${id}`);

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

export function useGetStorage(id: string) {
   return useQuery({
      queryKey: ['storage', id],
      queryFn: () => getStorage(id),
      refetchOnMount: true,
      retry: false,
   });
}

// Add New Storage
export async function addStorage(newStorage: NewStoragePayload) {
   const header = new Headers({ 'Content-Type': 'application/json', Accept: 'application/json' });
   const res = await fetch(`${API_URL}/storages`, {
      method: 'POST',
      credentials: 'include',
      headers: header,
      body: JSON.stringify(newStorage),
   });
   const data = await res.json();
   if (!data.success) {
      throw new Error(data.error);
   }
   return data;
}

export function useAddStorage() {
   const queryClient = useQueryClient();
   return useMutation({
      mutationFn: addStorage,
      onSuccess: (res) => {
         console.log('# Storage Added! :', res);
         queryClient.invalidateQueries({ queryKey: ['storages'] });
      },
   });
}

// Update Storage
export async function updateStorage(updatedStorage: UpdateStoragePayload) {
   const header = new Headers({ 'Content-Type': 'application/json', Accept: 'application/json' });
   const res = await fetch(`${API_URL}/storages/${updatedStorage.id}`, {
      method: 'PUT',
      credentials: 'include',
      headers: header,
      body: JSON.stringify(updatedStorage.data),
   });
   const data = await res.json();
   if (!data.success) {
      throw new Error(data.error);
   }
   return data;
}

export function useUpdateStorage() {
   const queryClient = useQueryClient();
   return useMutation({
      mutationFn: updateStorage,
      onSuccess: (res) => {
         // TODO: Should Display a Nofitication Bubble.
         console.log('# Storage Updated! :', res);
         queryClient.invalidateQueries({ queryKey: ['storages'] });
      },
   });
}

// Remove Storage
export async function deleteStorage(id: string) {
   const header = new Headers({ 'Content-Type': 'application/json', Accept: 'application/json' });
   const res = await fetch(`${API_URL}/storages/${id}`, {
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

export function useDeleteStorage() {
   const queryClient = useQueryClient();
   return useMutation({
      mutationFn: deleteStorage,
      onSuccess: (res) => {
         // TODO: Should Display a Nofitication Bubble.
         console.log('# Storage Updated! :', res);
         queryClient.invalidateQueries({ queryKey: ['storages'] });
      },
   });
}

// Verify Storage
export async function verifyStorage(id: string) {
   const header = new Headers({ 'Content-Type': 'application/json', Accept: 'application/json' });
   const res = await fetch(`${API_URL}/storages/verify/${id}`, {
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

export function useVerifyStorage() {
   return useMutation({
      mutationFn: verifyStorage,
      onSuccess: (res) => {
         // TODO: Should Display a Nofitication Bubble.
         console.log('# Storage Verfied! :', res);
      },
   });
}
