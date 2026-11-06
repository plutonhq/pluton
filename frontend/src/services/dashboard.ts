import { useQuery } from '@tanstack/react-query';
import { API_URL } from '../utils/constants';
import { DashboardEvent, DashboardEventType, DashboardSummary, DashboardSystem } from '../@types/dashboard';

// Get Dashboard Summary
export async function getDashboardSummary(months = 6): Promise<{ success: boolean; result: DashboardSummary }> {
   const url = new URL(`${API_URL}/dashboard/summary`);
   url.searchParams.append('months', String(months));

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

export function useGetDashboardSummary(months = 6) {
   return useQuery({
      queryKey: ['dashboard-summary', months],
      queryFn: () => getDashboardSummary(months),
      refetchOnMount: true,
      retry: false,
   });
}

// Get Dashboard System Status
export async function getDashboardSystem(): Promise<{ success: boolean; result: DashboardSystem }> {
   const url = new URL(`${API_URL}/dashboard/system`);

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

export function useGetDashboardSystem() {
   return useQuery({
      queryKey: ['dashboard-system'],
      queryFn: () => getDashboardSystem(),
      refetchOnMount: true,
      retry: false,
      refetchInterval: 15000,
   });
}

// Get Dashboard Events
export async function getDashboardEvents(
   type: DashboardEventType | 'all' = 'all',
   limit = 50,
): Promise<{ success: boolean; result: DashboardEvent[] }> {
   const url = new URL(`${API_URL}/dashboard/events`);
   url.searchParams.append('type', type);
   url.searchParams.append('limit', String(limit));

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

export function useGetDashboardEvents(type: DashboardEventType | 'all' = 'all') {
   return useQuery({
      queryKey: ['dashboard-events', type],
      queryFn: () => getDashboardEvents(type),
      refetchOnMount: true,
      retry: false,
   });
}
