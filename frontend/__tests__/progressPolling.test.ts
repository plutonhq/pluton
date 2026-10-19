import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import {
   createProgressPolling,
   fetchProgress,
   progressFinished,
   ProgressPollingError,
   retryAfterAt,
   progressPollingFor,
} from '../src/utils/progressPolling.ts';

test('polls responsively, slows unchanged progress, resets on real changes', async () => {
   let data = { events: [], bytes: 1 };
   const poll = createProgressPolling(async () => data);
   assert.equal(poll.refetchInterval(), 3000);
   await poll.queryFn();
   await poll.queryFn();
   assert.equal(poll.refetchInterval(), 6000);
   await poll.queryFn();
   assert.equal(poll.refetchInterval(), 12000);
   data = { events: [], bytes: 2 };
   await poll.queryFn();
   assert.equal(poll.refetchInterval(), 3000);
   assert.equal(poll.retry, false);
   assert.equal(poll.refetchIntervalInBackground, false);
});

test('Retry-After parses delta/date, rejects malformed and expired values', () => {
   const now = Date.parse('2026-01-01T00:00:00Z');
   assert.equal(retryAfterAt('60', now), now + 60000);
   assert.equal(retryAfterAt('Thu, 01 Jan 2026 00:02:00 GMT', now), now + 120000);
   for (const value of [null, 'bad', '-1', 'Thu, 01 Jan 2020 00:00:00 GMT']) assert.equal(retryAfterAt(value, now), 0);
});

test('429 cooldown blocks focus/manual/invalidation fetches and honors long Retry-After', async () => {
   let now = 1000;
   let count = 0;
   const poll = createProgressPolling(
      async () => {
         count++;
         if (count === 1) throw new ProgressPollingError(429, 121000);
         return { events: [] };
      },
      () => now,
   );
   await assert.rejects(poll.queryFn(), /rate limited/);
   assert.equal(poll.refetchInterval(), 120000);
   await assert.rejects(poll.queryFn());
   assert.equal(count, 1);
   assert.equal(poll.resume(), false);
   now = 121000;
   await poll.queryFn();
   assert.equal(count, 2);
   assert.equal(poll.refetchInterval(), 3000);
});

test('observers/remounts share an operation budget; query removal releases it and other jobs remain isolated', () => {
   const require = createRequire(new URL('../package.json', import.meta.url));
   const { QueryClient } = require('@tanstack/react-query');
   const client = new QueryClient();
   const fetcher = async () => ({ events: [] });
   const first = progressPollingFor(client, ['progress-backup', 'backup-01'], fetcher);
   assert.equal(progressPollingFor(client, ['progress-backup', 'backup-01'], fetcher), first);
   assert.notEqual(progressPollingFor(client, ['progress-backup', 'backup-02'], fetcher), first);
   assert.notEqual(progressPollingFor(client, ['progress-restore', 'backup-01'], fetcher), first);
   client.setQueryData(['progress-backup', 'backup-01'], { events: [] });
   client.removeQueries({ queryKey: ['progress-backup', 'backup-01'], exact: true });
   assert.notEqual(progressPollingFor(client, ['progress-backup', 'backup-01'], fetcher), first);
   client.clear();
});

test('transient failures back off; four consecutive failures stop all automatic requests', async () => {
   let now = 0;
   let count = 0;
   const poll = createProgressPolling(
      async () => {
         count++;
         throw new Error('never expose native response');
      },
      () => now,
   );
   for (const delay of [5000, 10000, 20000]) {
      await assert.rejects(poll.queryFn(), /Progress updates are unavailable/);
      assert.equal(poll.refetchInterval(), delay);
      now += delay;
   }
   await assert.rejects(poll.queryFn());
   assert.equal(poll.refetchInterval(), false);
   await assert.rejects(poll.queryFn());
   assert.equal(count, 4);
});

test('a successful observation resets consecutive failure budget', async () => {
   let now = 0;
   let fail = true;
   const poll = createProgressPolling(
      async () => {
         if (fail) throw new ProgressPollingError(500);
         return { events: [] };
      },
      () => now,
   );
   await assert.rejects(poll.queryFn());
   now = 5000;
   fail = false;
   await poll.queryFn();
   fail = true;
   await assert.rejects(poll.queryFn());
   assert.equal(poll.refetchInterval(), 5000);
});

test('hidden tabs do not issue requests and can resume when visible', async () => {
   let visible = false;
   let count = 0;
   const poll = createProgressPolling(
      async () => {
         count++;
         return { events: [] };
      },
      Date.now,
      () => visible,
   );
   assert.equal(poll.refetchInterval(), false);
   await assert.rejects(poll.queryFn());
   assert.equal(count, 0);
   visible = true;
   await poll.queryFn();
   assert.equal(count, 1);
});

for (const data of [{ status: 'completed' }, { status: 'failed' }, { status: 'cancelled' }, { events: [{ phase: 'finished', completed: true }] }]) {
   test(`terminal progress stops polling: ${JSON.stringify(data)}`, async () => {
      const poll = createProgressPolling(async () => data);
      await poll.queryFn();
      assert.equal(poll.refetchInterval(), false);
      assert.equal(progressFinished(data), true);
   });
}

test('401/403/404 stop, rather than repeatedly polling permanent failures', async () => {
   for (const status of [401, 403, 404]) {
      const poll = createProgressPolling(async () => {
         throw new ProgressPollingError(status);
      });
      await assert.rejects(poll.queryFn());
      assert.equal(poll.refetchInterval(), false);
   }
});

test('HTTP status is checked before parsing HTML; no raw response is exposed', async () => {
   const original = globalThis.fetch;
   try {
      globalThis.fetch = async () => new Response('<html>sensitive diagnostic</html>', { status: 429, headers: { 'Retry-After': '60' } });
      const before = Date.now();
      await assert.rejects(
         fetchProgress('https://example.internal/api/progress'),
         (error: ProgressPollingError) => error.status === 429 && error.retryAt >= before + 60000 && !error.message.includes('sensitive'),
      );
      globalThis.fetch = async () => new Response('<html>login</html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
      await assert.rejects(fetchProgress('https://example.internal/api/progress'), /unavailable/);
      globalThis.fetch = async () =>
         new Response(JSON.stringify({ success: false, error: 'private diagnostic' }), { headers: { 'Content-Type': 'application/json' } });
      await assert.rejects(fetchProgress('https://example.internal/api/progress'), /unavailable/);
   } finally {
      globalThis.fetch = original;
   }
});

test('unmount cancellation does not consume the transient failure budget', async () => {
   const controller = new AbortController();
   const poll = createProgressPolling(async () => {
      controller.abort();
      throw new Error('aborted');
   });
   await assert.rejects(poll.queryFn({ signal: controller.signal }));
   assert.equal(poll.refetchInterval(), 3000);
});

test('real TanStack observer cannot bypass cooldown via invalidation/focus and stops at terminal data', async () => {
   const require = createRequire(new URL('../package.json', import.meta.url));
   const { QueryClient, QueryObserver, focusManager } = require('@tanstack/react-query');
   let now = 0;
   let count = 0;
   let status = 'running';
   const poll = createProgressPolling(
      async () => {
         count++;
         if (count === 1) throw new ProgressPollingError(429, 60000);
         return { events: [], status };
      },
      () => now,
      () => true,
   );
   const client = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } });
   client.mount();
   const observer = new QueryObserver(client, { queryKey: ['synthetic-progress'], ...poll });
   const unsubscribe = observer.subscribe(() => {});
   try {
      await observer.refetch();
      assert.equal(count, 1);
      await client.invalidateQueries({ queryKey: ['synthetic-progress'] });
      focusManager.setFocused(false);
      focusManager.setFocused(true);
      await observer.refetch();
      assert.equal(count, 1);
      now = 60000;
      await observer.refetch();
      assert.equal(count, 2);
      status = 'completed';
      await observer.refetch();
      assert.equal(count, 3);
      await client.invalidateQueries({ queryKey: ['synthetic-progress'] });
      assert.equal(count, 3);
      assert.equal(poll.refetchInterval(), false);
   } finally {
      unsubscribe();
      client.unmount();
      client.clear();
      focusManager.setFocused(undefined);
   }
});
