import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { backupStatistics, statisticHelp, latestLogicalSnapshotBytes, planReportedSize } from '../src/utils/backupStatistics.ts';
test('Restic counters are separate real values; deleted files and disk usage are unknown', () => {
   const result = backupStatistics({
      files_new: 1,
      files_changed: 2,
      files_unmodified: 8,
      total_files_processed: 11,
      total_bytes_processed: 10000,
      data_added: 1000,
      data_added_packed: 300,
   });
   assert.deepEqual(result, {
      newFiles: 1,
      modifiedFiles: 2,
      unmodifiedFiles: 8,
      totalFiles: 11,
      logicalBytes: 10000,
      dataAdded: 1000,
      packedAdded: 300,
      deletedFiles: undefined,
      physicalRepositoryBytes: undefined,
   });
   assert.match(statisticHelp.newFiles, /not the number of newly stored/);
   assert.match(statisticHelp.deduplication, /cannot measure/);
});
test('absent/invalid statistics stay unknown, not fabricated zero', () => {
   assert.equal(backupStatistics().newFiles, undefined);
   assert.equal(backupStatistics({ files_new: -1, data_added: Infinity }).dataAdded, undefined);
   assert.equal(backupStatistics({ files_new: 0 }).newFiles, 0);
});
test('plan size uses latest completed snapshot and date strings, not cumulative/maximum repository usage', () => {
   const backups = [
      { status: 'completed', started: '2026-01-01T00:00:00Z', completionStats: { total_bytes_processed: 10000 } },
      { status: 'completed', started: '2026-01-02T00:00:00Z', completionStats: { total_bytes_processed: 5000 } },
      { status: 'failed', started: '2026-01-03T00:00:00Z', completionStats: { total_bytes_processed: 99999 } },
   ];
   const plan = { method: 'backup', sourceType: 'device', sourceId: 'agent-01', backups, stats: { size: 99999 } };
   assert.equal(latestLogicalSnapshotBytes(backups), 5000);
   assert.equal(planReportedSize(plan), 5000);
   assert.equal(planReportedSize({ ...plan, sourceId: 'main' }), 99999);
   assert.equal(latestLogicalSnapshotBytes([]), undefined);
});
test('actual backup details render distinct measured counters and no invented deletion/physical usage', async () => {
   const require = createRequire(new URL('../package.json', import.meta.url));
   const backendRequire = createRequire(new URL('../../backend/package.json', import.meta.url));
   const compiled = await backendRequire('esbuild').build({
      entryPoints: [fileURLToPath(new URL('../src/components/Plan/BackupEvents/BackupStatistics.tsx', import.meta.url))],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      jsx: 'automatic',
      write: false,
      external: ['react', 'react/jsx-runtime'],
      plugins: [
         {
            name: 'resources',
            setup(builder: any) {
               builder.onLoad({ filter: /\.scss$/ }, () => ({ contents: 'export default {};', loader: 'js' }));
            },
         },
      ],
   });
   const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
   Object.defineProperty(globalThis, 'window', { configurable: true, value: { matchMedia: () => ({ matches: false }) } });
   let html: string;
   try {
      const module = { exports: {} as any };
      new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(require, module, module.exports);
      html = require('react-dom/server').renderToStaticMarkup(
         require('react').createElement(module.exports.default, {
            stats: {
               files_new: 1,
               files_changed: 2,
               files_unmodified: 8,
               total_files_processed: 11,
               total_bytes_processed: 10000,
               data_added: 1000,
               data_added_packed: 300,
            },
         }),
      );
   } finally {
      if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
      else Reflect.deleteProperty(globalThis, 'window');
   }
   for (const label of ['Snapshot Size', 'New Files', 'Unmodified Files', 'Data Added', 'Compressed Data Added', 'Not measured'])
      assert(html.includes(label));
   assert(!/Deleted Files<\/dt><dd>0/.test(html));
   assert(!html.includes('Deduplication ratio:'));
});
