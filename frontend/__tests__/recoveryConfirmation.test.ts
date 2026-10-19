import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
   initialRecoverySelection,
   canConfirmRecovery,
   recoveryConfirmationBody,
   recoveryDestinationStatus,
   recoveryResourceSafety,
} from '../src/utils/recoveryConfirmation.ts';
import type { RecoveryPreparation } from '../src/@types/recoveryTests.ts';
const preview: RecoveryPreparation = {
   planId: 'plan-01',
   planTitle: 'Example plan',
   backupId: 'backup-01',
   repositoryId: 'repo-01',
   snapshotId: 'a'.repeat(64),
   metadataToken: 'b'.repeat(64),
   databases: [
      {
         databaseId: 'db_example',
         engine: 'mariadb',
         database: 'example_db',
         path: '/pluton/database/example.sql',
         bytes: 10,
         sha256: 'c'.repeat(64),
      },
   ],
   policy: { enabled: true, databaseImport: 'required' },
   customTargets: [{ engine: 'mariadb', status: 'configured' }],
   internalTargets: [],
   mysqlWorker: 'unavailable',
   resources: { status: 'unknown', sample: null, observedAt: 0 },
   lifecycle: 'operator-managed',
   workloads: { backup: false, restore: false, recovery: false },
   versionCompatibility: 'not-recorded-in-receipt',
   persistentRestore: { status: 'unavailable', reason: 'bounded-persistent-storage-and-ownership-controller-required' },
};
const healthy: RecoveryPreparation['resources'] = {
   status: 'measured',
   observedAt: 1,
   sample: {
      total: 8192 * 1024 ** 2,
      available: 4096 * 1024 ** 2,
      swapUsed: 0,
      pressure: 0,
      limit: 768 * 1024 ** 2,
      used: 128 * 1024 ** 2,
      cgroupSwap: 0,
      diskAvailable: 10 * 1024 ** 3,
      cpuAvailable: 1,
      operatorTotal: 8192 * 1024 ** 2,
      operatorAvailable: 4096 * 1024 ** 2,
      operatorCpuAvailable: 4,
      operatorDiskAvailable: 10 * 1024 ** 3,
      operatorObservedAt: 1,
   },
};
test('confirmation binds the exact snapshot and metadata without submitting an engine, endpoint, password or automation', () => {
   const selection = initialRecoverySelection(preview);
   assert(!canConfirmRecovery(preview, selection, false));
   assert(canConfirmRecovery(preview, selection, true));
   const body = recoveryConfirmationBody(preview, selection);
   assert.equal(body.snapshotId, preview.snapshotId);
   assert.equal(body.metadataToken, preview.metadataToken);
   assert.equal(body.resourcesAcknowledged, true);
   assert.deepEqual(Object.keys(body).sort(), ['backupId', 'metadataToken', 'resourcesAcknowledged', 'selection', 'snapshotId']);
   assert.equal(body.selection.targetModes.mariadb, 'custom');
   assert(!JSON.stringify(body).includes('engine'));
   assert(!JSON.stringify(body).includes('enabled'));
   selection.targetModes!.mariadb = 'internal';
   assert.equal(preview.policy.targetModes, undefined);
});
test('Oracle Internal requires both the independently enabled worker and automatic target admission', () => {
   const mysql: RecoveryPreparation = {
      ...preview,
      lifecycle: 'automatic',
      resources: healthy,
      mysqlWorker: 'ready',
      databases: [{ ...preview.databases[0], engine: 'mysql' }],
      internalTargets: [{ engine: 'mysql', mode: 'automatic', status: 'ready', admission: { status: 'admitted' } }],
   };
   const selection = { databaseImport: 'required' as const, targetModes: { mysql: 'internal' as const } };
   assert(canConfirmRecovery(mysql, selection, true));
   assert.equal(recoveryConfirmationBody(mysql, selection).selection.targetModes.mysql, 'internal');
   assert(!canConfirmRecovery({ ...mysql, mysqlWorker: 'unavailable' }, selection, true));
   assert(!canConfirmRecovery({ ...mysql, internalTargets: [] }, selection, true));
   assert(
      !canConfirmRecovery(
         { ...mysql, databases: [...mysql.databases, { ...preview.databases[0], engine: 'postgresql' }] },
         { ...selection, targetModes: { ...selection.targetModes, postgresql: 'internal' } },
         true,
      ),
   );
});

test('occupied retained lifecycle is blocked, not silently checking; refusal diagnostics retain admission reasons', () => {
   const mysql: RecoveryPreparation = {
      ...preview,
      lifecycle: 'automatic',
      resources: healthy,
      mysqlWorker: 'ready',
      databases: [{ ...preview.databases[0], engine: 'mysql' }],
      internalTargets: [{ engine: 'mysql', mode: 'automatic', status: 'running' }],
   };
   const selection = { databaseImport: 'required' as const, targetModes: { mysql: 'internal' as const } };
   assert(!canConfirmRecovery(mysql, selection, true));
   assert.match(recoveryDestinationStatus(mysql, selection, 'mysql'), /Stop retains its slot/);
   assert.equal(recoveryResourceSafety(mysql, selection)[0].state, 'blocked');
   assert.match(recoveryResourceSafety(mysql, selection)[0].message, /reservation/);
   mysql.internalTargets = [{ engine: 'mysql', mode: 'automatic', status: 'ready' }];
   assert(!canConfirmRecovery(mysql, selection, true), 'missing admission must fail closed');
   mysql.internalTargets[0].admission = { status: 'refused', reason: 'operator-sql-budget' };
   assert(!canConfirmRecovery(mysql, selection, true));
   assert.match(recoveryResourceSafety(mysql, selection)[0].message, /SQL exceeds/);
});
test('resource acknowledgement never overrides missing provisioning, unknown admission or a hard refusal', () => {
   const selection = { databaseImport: 'required' as const, targetModes: { mariadb: 'internal' as const } };
   assert(!canConfirmRecovery({ ...preview, workloads: { backup: true, restore: false, recovery: false } }, selection, true));
   for (const target of [
      undefined,
      { engine: 'mariadb', status: 'ready', mode: 'operator-managed' },
      { engine: 'mariadb', status: 'ready', mode: 'operator-managed', admission: { status: 'refused', reason: 'operator-sql-budget' } },
      { engine: 'mariadb', status: 'cleanup_required', mode: 'operator-managed' },
   ]) {
      assert(!canConfirmRecovery({ ...preview, internalTargets: target ? [target as any] : [] }, selection, true));
   }
   assert(
      canConfirmRecovery(
         {
            ...preview,
            resources: healthy,
            internalTargets: [{ engine: 'mariadb', status: 'ready', mode: 'operator-managed', admission: { status: 'admitted' } }],
         },
         selection,
         true,
      ),
   );
});
test('multi-DB is all-required; MySQL is Custom worker only; historical missing engine is never guessed', () => {
   const selection = initialRecoverySelection(preview);
   const mixed = {
      ...preview,
      databases: [
         ...preview.databases,
         { ...preview.databases[0], engine: 'mysql' as const, databaseId: 'db_second', path: '/pluton/database/mysql.sql' },
      ],
   };
   assert(!canConfirmRecovery(mixed, selection, true));
   assert.equal(recoveryDestinationStatus(mixed, selection, 'mysql'), 'Not Configured');
   const configured = { ...mixed, customTargets: [...mixed.customTargets, { engine: 'mysql' as const, status: 'configured' as const }] };
   assert.equal(recoveryDestinationStatus(configured, selection, 'mysql'), 'Worker Unavailable');
   assert(canConfirmRecovery({ ...configured, mysqlWorker: 'ready' }, selection, true));
   assert(!canConfirmRecovery({ ...preview, databases: [{ ...preview.databases[0], engine: undefined }] }, selection, true));
   assert(!canConfirmRecovery(preview, { databaseImport: 'disabled' }, true));
   assert(canConfirmRecovery({ ...preview, policy: { enabled: false, databaseImport: 'disabled' } }, { databaseImport: 'disabled' }, true));
});
const frontendRequire = createRequire(new URL('../package.json', import.meta.url));
const backendRequire = createRequire(new URL('../../backend/package.json', import.meta.url));
async function content(operation: 'test' | 'restore') {
   const { build } = backendRequire('esbuild');
   const result = await build({
      entryPoints: [fileURLToPath(new URL('../src/components/Plan/RecoveryTesting/RecoveryConfirmation.tsx', import.meta.url))],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      jsx: 'automatic',
      write: false,
      external: ['react', 'react/jsx-runtime'],
      plugins: [
         {
            name: 'confirmation-test-boundaries',
            setup(builder: any) {
               builder.onLoad({ filter: /\.scss$/ }, () => ({ contents: 'export default {};', loader: 'js' }));
               builder.onLoad({ filter: /services[\\/]recoveryTests\.ts$/ }, () => ({
                  contents: 'export const useRecoveryPreparation=()=>({});',
                  loader: 'js',
               }));
               builder.onLoad({ filter: /utils[\\/]helpers\.ts$/ }, () => ({
                  contents: 'export const formatBytes=(bytes)=>String(bytes)+" bytes";',
                  loader: 'js',
               }));
               builder.onLoad({ filter: /common[\\/]Modal[\\/]Modal\.tsx$/ }, () => ({ contents: 'export default ()=>null;', loader: 'js' }));
            },
         },
      ],
   });
   const module = { exports: {} as any };
   new Function('require', 'module', 'exports', result.outputFiles[0].text)(frontendRequire, module, module.exports);
   return frontendRequire('react-dom/server').renderToStaticMarkup(
      frontendRequire('react').createElement(module.exports.RecoveryConfirmationContent, {
         preview,
         operation,
         pending: false,
         confirm: () => {
            throw new Error('SSR must never enqueue');
         },
         refresh: () => {},
      }),
   );
}
test('actual confirmation renders read-only engine, unknown capacity, manual lifecycle, all-required and accurate hash/version limitations', async () => {
   const html = await content('test');
   for (const text of [
      'example_db',
      'Engine: mariadb (read-only)',
      'Capacity unknown',
      'not automatic container startup/shutdown',
      'SHA-256',
      'version compatibility is not certified',
      'All recorded databases',
      'This is not a resource override',
   ])
      assert(html.includes(text), text);
   assert(!html.includes('type="password"'));
   assert.match(html, /disabled=""[^>]*>Run Recovery Test/);
});
test('persistent restore scaffold cannot execute, inspect, delete or claim retained data exists', async () => {
   const html = await content('restore');
   for (const text of [
      'Persistent Database Restore: Not Available',
      'No import will run',
      'Custom persistent restore — Not Available',
      '24 hours',
      'Restore Management/inspection/delete are not available',
      'Staged SQL is not a running restored database',
   ])
      assert(html.includes(text), text);
   assert.match(html, /disabled=""[^>]*>Database Restore — Not Available/);
   assert(!html.includes('I understand the additional resource usage'));
});
