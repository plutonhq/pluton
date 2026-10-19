import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { canTestRecovery, recoveryActive, recoveryForBackup, recoveryStatusLabel } from '../src/utils/recoveryTests.ts';
import type { RecoveryTest } from '../src/@types/recoveryTests.ts';
const snapshot = 'a'.repeat(64),
   newerSnapshot = 'b'.repeat(64);
const old = {
   id: 'test-01',
   planId: 'plan-01',
   backupId: 'backup-01',
   snapshotId: snapshot,
   status: 'passed',
   trigger: 'manual',
   createdAt: '2026-01-01',
   completedAt: '2026-01-01',
   warnings: [],
} as RecoveryTest;
test('new backup cannot inherit an older Recovery Passed, including a reused backup ID with a changed snapshot', () => {
   assert.equal(recoveryForBackup([old], 'backup-02', newerSnapshot), undefined);
   assert.equal(recoveryForBackup([old], 'backup-01', newerSnapshot), undefined);
   assert.equal(recoveryForBackup([old], 'backup-01', snapshot), old);
   for (const value of [undefined, 'latest', 'a'.repeat(8)]) assert.equal(recoveryForBackup([old], 'backup-01', value), undefined);
});
test('only completed full-snapshot backups can run recovery; status/cancel actions are separate from Restore', () => {
   assert.equal(canTestRecovery({ status: 'completed', completionStats: { snapshot_id: snapshot } }), true);
   for (const backup of [
      { status: 'failed', completionStats: { snapshot_id: snapshot } },
      { status: 'completed', inProgress: true, completionStats: { snapshot_id: snapshot } },
      { status: 'completed', completionStats: null },
   ])
      assert.equal(canTestRecovery(backup), false);
   assert.equal(recoveryActive({ ...old, status: 'running' }), true);
   assert.equal(recoveryActive(old), false);
   assert.equal(recoveryStatusLabel.passed_with_warning, 'Passed with warning');
});
const frontendRequire = createRequire(new URL('../package.json', import.meta.url));
const backendRequire = createRequire(new URL('../../backend/package.json', import.meta.url));
const React = frontendRequire('react'),
   { renderToStaticMarkup } = frontendRequire('react-dom/server'),
   { build } = backendRequire('esbuild');
async function compile(name: string, tests: RecoveryTest[] = []) {
   const compiled = await build({
      entryPoints: [fileURLToPath(new URL(`../src/components/Plan/RecoveryTesting/${name}.tsx`, import.meta.url))],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      jsx: 'automatic',
      write: false,
      external: ['react', 'react/jsx-runtime'],
      plugins: [
         {
            name: 'recovery-test-ui-stubs',
            setup(builder: any) {
               builder.onLoad({ filter: /services[\\/]recoveryTests\.ts$/ }, () => ({
                  contents: `export const useRecoveryTests=()=>({data:${JSON.stringify(tests)}}); export const useRecoveryConfiguration=()=>({data:{policy:{enabled:false,databaseImport:'disabled'},targets:[]}}); export const useSaveRecoveryPolicy=()=>({}); export const useSaveRecoveryTarget=()=>({});`,
                  loader: 'js',
               }));
               builder.onLoad({ filter: /common[\\/]Modal[\\/]Modal\.tsx$/ }, () => ({
                  contents: 'import React from "react";export default ({children})=>React.createElement("section",{},children);',
                  loader: 'js',
               }));
               builder.onLoad({ filter: /\.scss$/ }, () => ({ contents: 'export default {};', loader: 'js' }));
            },
         },
      ],
   });
   const module = { exports: {} as any };
   // Shared browser helpers read matchMedia at module load. Supply only that
   // browser primitive; actual React rendering and recovery components are real.
   new Function('require', 'module', 'exports', 'window', compiled.outputFiles[0].text)(frontendRequire, module, module.exports, {
      matchMedia: () => ({ matches: false }),
   });
   return module.exports.default;
}
test('dashboard explicitly binds latest backup and latest tested snapshot rather than showing a stale pass', async () => {
   const Summary = await compile('RecoverySummary', [old]);
   const html = renderToStaticMarkup(
      React.createElement(Summary, {
         plan: {
            id: 'plan-01',
            method: 'backup',
            sourceType: 'device',
            sourceId: 'app-01',
            backups: [{ id: 'backup-02', status: 'completed', started: '2026-01-02', completionStats: { snapshot_id: newerSnapshot } }],
         },
      }),
   );
   assert.match(html, /Recovery for this backup: Not tested/);
   assert.match(html, /Latest Recovery Test: test-01 · Passed · backup-backup-01/);
   assert.ok(html.includes(snapshot));
});
test('result renders every DB, exact snapshot, explicit partial validation, safe failure and cleanup detail without credentials', async () => {
   const Result = await compile('RecoveryResult');
   const html = renderToStaticMarkup(
      React.createElement(Result, {
         test: {
            ...old,
            status: 'passed_with_warning',
            warnings: [{ stage: 'database-import', code: 'import-disabled' }],
            result: {
               filesystem: { files: 2, bytes: 20, sourceTrees: 1, integrity: 'restic-restore-and-structure' },
               databases: [
                  {
                     databaseId: 'db_app',
                     engine: 'mariadb',
                     database: 'example_db',
                     path: '/pluton/database/app.sql',
                     sha256: newerSnapshot,
                     bytes: 10,
                     artifactValidation: 'passed',
                     importValidation: 'disabled',
                  },
               ],
               cleanup: { workspace: true, databases: true },
            },
         },
         close: () => {},
         cancel: () => {},
         pending: false,
      }),
   );
   for (const text of [
      snapshot,
      'Passed with warning',
      'db_app',
      'Artifact integrity: PASSED',
      'SQL import NOT TESTED (Disabled)',
      'Workspace: Complete',
      'not application semantic checks',
   ])
      assert.ok(html.includes(text));
   assert.ok(!html.includes('password'));
});
test('settings label recovery infrastructure, separate credentials and required vs disabled policy explicitly', async () => {
   const Settings = await compile('RecoverySettings');
   const html = renderToStaticMarkup(React.createElement(Settings, { planId: 'plan-01' }));
   for (const text of [
      'After every successful backup',
      'Required — all databases must import',
      'separate from backup credentials',
      'not production',
      'mariadb recovery-only target',
      'mysql recovery-only target',
      'postgresql recovery-only target',
   ])
      assert.ok(html.includes(text));
});
