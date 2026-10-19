import { useQuery } from '@tanstack/react-query';
import { API_URL } from '../utils/constants';
import type { DatabaseRestoreView, RestorePreview, RestoreSelection } from '../@types/databaseRestores';
import { needsRestoreRefresh } from '../utils/databaseRestores';
import { mutationResponse, parseApiResponse } from '../utils/httpResponse';

export async function restoreRequest<T>(route = '', body?: unknown): Promise<T> {
   const options: RequestInit = {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'include',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
   };
   const data = body === undefined
      ? await parseApiResponse<{ result: T }>(await fetch(`${API_URL}/database-restores${route}`, options))
      : await mutationResponse<{ result: T }>(`${API_URL}/database-restores${route}`, options);
   return data.result;
}
export function useRestorePreview(selection: RestoreSelection) {
   return useQuery({
      queryKey: ['databaseRestorePreparation', selection],
      queryFn: () => restoreRequest<RestorePreview>('/preparation', selection),
      retry: false,
      staleTime: 0,
      refetchOnWindowFocus: false,
   });
}
export function useDatabaseRestores(id?: string) {
   return useQuery<DatabaseRestoreView | DatabaseRestoreView[]>({
      queryKey: ['databaseRestores', id],
      queryFn: async () => (id ? restoreRequest<DatabaseRestoreView>(`/${encodeURIComponent(id)}`) : restoreRequest<DatabaseRestoreView[]>()),
      retry: false,
      refetchInterval: (query) => {
         const value = query.state.data;
         return value && (Array.isArray(value) ? value.some(needsRestoreRefresh) : needsRestoreRefresh(value)) ? 5000 : false;
      },
   });
}
