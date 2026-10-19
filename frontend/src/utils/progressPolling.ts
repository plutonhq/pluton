import type { QueryClient } from '@tanstack/react-query';

/** Read-only progress polling. Never shared with mutation/retry clients. */
export class ProgressPollingError extends Error {
   status: number;
   retryAt: number;
   constructor(status: number, retryAt = 0) {
      super(status === 429 ? 'Progress updates are rate limited.' : 'Progress updates are unavailable.');
      this.name = 'ProgressPollingError';
      this.status = status;
      this.retryAt = retryAt;
   }
}

export function retryAfterAt(value: string | null, now = Date.now()): number {
   if (!value) return 0;
   const seconds = /^\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value) : NaN;
   const timestamp = Number.isFinite(seconds) ? now + seconds * 1000 : Date.parse(value);
   return Number.isFinite(timestamp) && timestamp > now ? timestamp : 0;
}

export function progressFinished(data: any): boolean {
   return (
      ['completed', 'failed', 'cancelled'].includes(data?.status) ||
      (Array.isArray(data?.events) && data.events.some((event: any) => event.phase === 'finished' && event.completed === true))
   );
}

export async function fetchProgress(url: string | URL, signal?: AbortSignal): Promise<any> {
   const controller = new AbortController();
   const abort = () => controller.abort();
   if (signal?.aborted) abort();
   signal?.addEventListener('abort', abort, { once: true });
   const timer = setTimeout(abort, 15000);
   try {
      const response = await fetch(url, {
         method: 'GET',
         credentials: 'include',
         cache: 'no-store',
         signal: controller.signal,
         headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new ProgressPollingError(response.status, retryAfterAt(response.headers.get('Retry-After')));
      if (!/\bapplication\/(?:[\w.-]+\+)?json\b/i.test(response.headers.get('Content-Type') || '')) throw new ProgressPollingError(0);
      const data = await response.json();
      if (
         !data ||
         typeof data !== 'object' ||
         Array.isArray(data) ||
         (!Array.isArray(data.events) && !progressFinished(data)) ||
         (data.success === false && !progressFinished(data))
      )
         throw new ProgressPollingError(0);
      return data;
   } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
   }
}

/** One controller per operation; four consecutive failures require explicit user retry. */
export function createProgressPolling(
   fetcher: (signal?: AbortSignal) => Promise<any>,
   now = () => Date.now(),
   visible = () => typeof document === 'undefined' || !document.hidden,
) {
   let failures = 0;
   let notBefore = 0;
   let error: Error | undefined;
   let signature = '';
   let interval = 3000;
   let finished = false;
   const enabled = () => visible() && !finished && failures < 4;
   return {
      enabled,
      resume() {
         if (finished || !visible() || now() < notBefore) return false;
         failures = 0;
         error = undefined;
         return true;
      },
      async queryFn({ signal }: { signal?: AbortSignal } = {}) {
         // Guards also cover focus, reconnect, invalidation and manual refetch during cooldown.
         if (!enabled() || now() < notBefore) throw error || new ProgressPollingError(0);
         try {
            const data = await fetcher(signal);
            const next = JSON.stringify(data);
            interval = next === signature ? Math.min(interval * 2, 12000) : 3000;
            signature = next;
            failures = 0;
            error = undefined;
            notBefore = 0;
            finished = progressFinished(data);
            return data;
         } catch (cause) {
            if (signal?.aborted) throw cause;
            failures++;
            error = cause instanceof ProgressPollingError ? cause : new ProgressPollingError(0);
            const status = error instanceof ProgressPollingError ? error.status : 0;
            if (status >= 400 && status < 500 && status !== 429 && status !== 408) failures = 4;
            notBefore = Math.max(now() + Math.min(5000 * 2 ** (failures - 1), 60000), error instanceof ProgressPollingError ? error.retryAt : 0);
            throw error;
         }
      },
      refetchInterval() {
         if (!enabled()) return false as const;
         return Math.min(2147483647, Math.max(interval, notBefore - now()));
      },
      retry: false as const,
      refetchIntervalInBackground: false,
      refetchOnWindowFocus: true,
      refetchOnReconnect: false,
      refetchOnMount: false,
   };
}

const controllers = new WeakMap<object, Map<string, ReturnType<typeof createProgressPolling>>>();

/** Multiple observers of one query share cooldown/error budget, including across remounts. */
export function progressPollingFor(client: QueryClient, key: readonly string[], fetcher: (signal?: AbortSignal) => Promise<any>) {
   const cache = client.getQueryCache();
   let states = controllers.get(cache);
   if (!states) {
      states = new Map();
      controllers.set(cache, states);
      const ownedStates = states;
      cache.subscribe((event) => {
         if (event.type === 'removed') ownedStates.delete(JSON.stringify(event.query.queryKey));
      });
   }
   const id = JSON.stringify(key);
   let state = states.get(id);
   if (!state) {
      state = createProgressPolling(fetcher);
      states.set(id, state);
   }
   return state;
}
