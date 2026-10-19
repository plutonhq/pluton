import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../package.json', import.meta.url));
const backendRequire = createRequire(new URL('../../backend/package.json', import.meta.url));
async function client(name: string) {
   const result = await backendRequire('esbuild').build({
      entryPoints: [fileURLToPath(new URL(`../src/services/${name}.ts`, import.meta.url))], bundle: true, platform: 'node', format: 'cjs', write: false,
      external: ['react', 'react/jsx-runtime'],
      plugins: [{ name: 'client-boundaries', setup(builder: any) {
         builder.onLoad({ filter: /utils[\\/]constants\.ts$/ }, () => ({ contents: 'export const API_URL="https://example.internal/api";', loader: 'js' }));
         builder.onResolve({ filter: /^@tanstack\/react-query$/ }, () => ({ path: 'query', namespace: 'stub' }));
         builder.onResolve({ filter: /^react-toastify$/ }, () => ({ path: 'toast', namespace: 'stub' }));
         builder.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export const useMutation=x=>x;export const useQuery=x=>x;export const useQueryClient=()=>({});export const toast={};', loader: 'js' }));
      } }],
   });
   const module = { exports: {} as any };
   new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, module, module.exports);
   return module.exports;
}
const clients = Object.fromEntries(await Promise.all(['plans', 'backups', 'restores', 'storage', 'databaseRestores', 'legacyRepositories', 'notifications', 'devices', 'recoveryTests'].map(async name => [name, await client(name)])));
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

test('replication retry preserves exact identities, session and rejected/unknown outcomes without automatic retry', async () => {
   const previous = globalThis.fetch;
   let response = json({ success: true, result: 'Replication retry queued' }, 202);
   let calls = 0;
   globalThis.fetch = async (input, init) => {
      calls++;
      const url = new URL(String(input));
      assert.equal(url.pathname, '/api/backups/backup%2F01/action/replication-retry');
      assert.equal(url.searchParams.get('replicationId'), 'replica&01');
      assert.equal(init?.method, 'POST');
      assert.equal(init?.credentials, 'include');
      assert.equal(init?.redirect, 'error');
      return response;
   };
   try {
      const payload = { backupId: 'backup/01', planId: 'plan-01', replicationId: 'replica&01' };
      assert.equal((await clients.backups.retryFailedReplications(payload)).success, true);
      response = json({ success: false, code: 'REPLICATION_RESULT_UNCERTAIN', error: 'Review the replica state.' }, 409);
      await assert.rejects(clients.backups.retryFailedReplications(payload), (error: any) => error.status === 409 && error.code === 'REPLICATION_RESULT_UNCERTAIN');
      response = new Response('<html>gateway</html>', { status: 520, headers: { 'Content-Type': 'text/html' } });
      await assert.rejects(clients.backups.retryFailedReplications(payload), (error: any) => error.outcome === 'unknown' && !error.message.includes('gateway'));
      assert.equal(calls, 3);
      assert.equal(clients.backups.useRetryFailedReplications().retry, false);
   } finally { globalThis.fetch = previous; }
});

test('backup and restore progress GETs encode identities and classify HTML429 without retry', async () => {
   const original = globalThis.fetch;
   let calls = 0;
   let response = json({ events: [], status: 'running' });
   globalThis.fetch = async (input, options) => {
      calls++;
      const url = new URL(String(input));
      assert.match(url.pathname, /\/(backup|restore)s\/operation%2F01\/progress$/);
      assert.equal(url.searchParams.get('planId'), 'plan&01');
      assert.equal(options?.method, 'GET');
      assert.equal(options?.credentials, 'include');
      return response;
   };
   try {
      for (const get of [clients.backups.getBackupProgress, clients.restores.getRestoreProgress]) {
         const payload = { id: 'operation/01', sourceId: 'device-01', sourceType: 'device', planId: 'plan&01' };
         assert.equal((await get(payload)).status, 'running');
         response = new Response('<html>edge</html>', { status: 429, headers: { 'Retry-After': '60' } });
         await assert.rejects(get(payload), (error: any) => error.status === 429 && error.retryAt > Date.now());
         response = json({ events: [], status: 'running' });
      }
      assert.equal(calls, 4);
   } finally { globalThis.fetch = original; }
});

test('actual destructive clients preserve endpoint, method, credentials, selected IDs and storage toggle', async () => {
   const previous = globalThis.fetch;
   const calls: { path: string; init: RequestInit }[] = [];
   globalThis.fetch = async (input, init) => { calls.push({ path: new URL(String(input)).pathname + new URL(String(input)).search, init: init! }); return json({ success: true, result: { status: 'cleanup_required' } }); };
   try {
      for (const removeRemoteData of [false, true]) await clients.plans.deletePlan({ id: 'plan/01', removeRemoteData });
      await clients.backups.deleteBackup('backup/01');
      await clients.restores.deleteRestore('restore/01');
      await clients.storage.deleteStorage('storage/01');
      await clients.backups.cancelBackupDownload({ backupId: 'backup/01', planId: 'plan-01' });
      for (const removeData of [false, true]) await clients.plans.deleteReplicationStorage({ planID: 'plan/01', storageID: 'storage-02', storagePath: '/example/replica', replicationId: 'replica-02', removeData });
      await clients.legacyRepositories.useDeleteLegacyRepository().mutationFn('repo/01');
      await clients.notifications.useNotificationActions().mutationFn({ type: 'delete', id: 'channel/01' });
      await clients.devices.useRevokeAgentDevice().mutationFn('device/01');
      await clients.devices.useRevokeAgentEnrollment().mutationFn('enrollment/01');
      await clients.databaseRestores.restoreRequest('/restore-01/delete', {});
      await clients.recoveryTests.useRecoveryAction('plan/01').mutationFn({ cancelId: 'test/01' });
      assert.deepEqual(calls.map(c => [c.init.method, c.path]), [
         ['DELETE', '/api/plans/plan%2F01?removeData=false'], ['DELETE', '/api/plans/plan%2F01?removeData=true'],
         ['DELETE', '/api/backups/backup%2F01'], ['DELETE', '/api/restores/restore%2F01'], ['DELETE', '/api/storages/storage%2F01'],
         ['DELETE', '/api/backups/backup%2F01/action/download'],
         ['POST', '/api/plans/plan%2F01/action/delete-replication-storage'], ['POST', '/api/plans/plan%2F01/action/delete-replication-storage'],
         ['DELETE', '/api/legacy-repositories/repo%2F01'], ['DELETE', '/api/notifications/channels/channel%2F01'],
         ['POST', '/api/agent-admin/devices/device%2F01/revoke'], ['POST', '/api/agent-admin/enrollments/enrollment%2F01/revoke'],
         ['POST', '/api/database-restores/restore-01/delete'], ['POST', '/api/recovery-testing/plan%2F01/tests/test%2F01/cancel'],
      ]);
      for (const call of calls) { assert.equal(call.init.credentials, 'include'); assert.equal(call.init.redirect, 'error'); }
      assert.deepEqual(JSON.parse(calls[6].init.body as string), { storageID: 'storage-02', storagePath: '/example/replica', replicationId: 'replica-02', removeData: false });
      assert.equal(JSON.parse(calls[7].init.body as string).removeData, true);
      assert.equal(clients.plans.useDeletePlan().retry, false);
   } finally { globalThis.fetch = previous; }
});

test('actual plan client covers HTML 405, empty success, JSON failures, accepted and transport without replay', async () => {
   const previous = globalThis.fetch;
   let calls = 0;
   let response = new Response('<html>proxy</html>', { status: 405, headers: { 'Content-Type': 'text/html' } });
   globalThis.fetch = async () => { calls++; return response; };
   try {
      await assert.rejects(clients.plans.deletePlan({ id: 'plan-01', removeRemoteData: true }), /HTML.*HTTP 405.*check its status/);
      assert.equal(calls, 1);
      response = new Response(null, { status: 204 });
      assert.equal((await clients.plans.deletePlan({ id: 'plan-01', removeRemoteData: false })).success, true);
      response = json({ success: false, error: 'Plan busy' }, 409);
      await assert.rejects(clients.plans.deletePlan({ id: 'plan-01', removeRemoteData: false }), /Plan busy/);
      response = json({ success: true }, 202);
      await assert.rejects(clients.plans.deletePlan({ id: 'plan-01', removeRemoteData: false }), /accepted.*completion is not confirmed/);
      response = json({ success: true, result: { id: 'restore-01', cleanup: 'pending' } }, 202);
      assert.deepEqual(await clients.databaseRestores.restoreRequest('/restore-01/delete', {}), { id: 'restore-01', cleanup: 'pending' });
      assert.equal(calls, 5);
   } finally { globalThis.fetch = previous; }
});

test('actual plan and backup clients reject retained restore dependency409 without a success result or retry', async () => {
   const previous = globalThis.fetch;
   let count = 0;
   globalThis.fetch = async () => { count++; return json({ success: false, code: 'RETAINED_DATABASE_RESTORE_DEPENDENCY', error: 'Verified database cleanup is required.' }, 409); };
   try {
      for (const call of [() => clients.plans.deletePlan({ id: 'plan-01', removeRemoteData: true }), () => clients.backups.deleteBackup('backup-01')]) {
         await assert.rejects(call(), (error: Error & { status?: number; code?: string }) => {
            assert.equal(error.status, 409);
            assert.equal(error.code, 'RETAINED_DATABASE_RESTORE_DEPENDENCY');
            assert.match(error.message, /Verified database cleanup is required/);
            return true;
         });
      }
      assert.equal(count, 2);
   } finally { globalThis.fetch = previous; }
});
