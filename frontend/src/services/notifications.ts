import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { API_URL } from '../utils/constants';
import type { Channel, ChannelInput, Delivery, Subscription } from '../utils/notificationDelivery';
import { mutationResponse, parseApiResponse } from '../utils/httpResponse';
export async function notificationRequest<T>(route: string, method = 'GET', body?: unknown): Promise<T> {
   const options: RequestInit = {
      method,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
   };
   const data = method === 'GET'
      ? await parseApiResponse<{ result: T }>(await fetch(`${API_URL}/notifications/${route}`, options))
      : await mutationResponse<{ result: T }>(`${API_URL}/notifications/${route}`, options, { allowNoContent: method === 'DELETE', allowAccepted: method !== 'DELETE' });
   return data.result;
}
export function useNotificationChannels() {
   return useQuery({ queryKey: ['notificationChannels'], queryFn: () => notificationRequest<Channel[]>('channels'), retry: false });
}
export function useNotificationHistory(page: number) {
   return useQuery({
      queryKey: ['notificationHistory', page],
      queryFn: () => notificationRequest<Delivery[]>(`deliveries?page=${page}`),
      retry: false,
      refetchInterval: (query) => (query.state.data?.some((row) => ['pending', 'sending'].includes(row.status)) ? 5000 : false),
   });
}
export function useNotificationSubscription(planId?: string) {
   return useQuery({
      queryKey: ['notificationSubscription', planId],
      queryFn: () => notificationRequest<Subscription>(`plans/${encodeURIComponent(planId!)}`),
      enabled: !!planId,
      retry: false,
   });
}
export function useNotificationActions() {
   const queries = useQueryClient();
   return useMutation({
      retry: false,
      mutationFn: async (
         action:
            | { type: 'save'; id?: string; value: ChannelInput }
            | { type: 'delete' | 'test' | 'retry'; id: string }
            | { type: 'subscription'; id: string; value: Subscription },
      ) => {
         if (action.type === 'save')
            return notificationRequest<Channel>(
               `channels${action.id ? `/${encodeURIComponent(action.id)}` : ''}`,
               action.id ? 'PUT' : 'POST',
               action.value,
            );
         if (action.type === 'subscription') return notificationRequest<Subscription>(`plans/${encodeURIComponent(action.id)}`, 'PUT', action.value);
         if (action.type === 'delete') return notificationRequest(`channels/${encodeURIComponent(action.id)}`, 'DELETE');
         return notificationRequest<Delivery>(
            action.type === 'test' ? `channels/${encodeURIComponent(action.id)}/test` : `deliveries/${encodeURIComponent(action.id)}/retry`,
            'POST',
            {},
         );
      },
      onSuccess: () => {
         queries.invalidateQueries({ queryKey: ['notificationChannels'] });
         queries.invalidateQueries({ queryKey: ['notificationHistory'] });
         queries.invalidateQueries({ queryKey: ['notificationSubscription'] });
      },
   });
}
