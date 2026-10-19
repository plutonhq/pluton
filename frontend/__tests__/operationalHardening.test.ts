import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
   encodeRestoreSelection,
   selectedRestorePaths,
   restoreSelectionState,
   restoreSelectionSummary,
   toggleRestoreSelection,
} from '../src/utils/restoreSelection.ts';
import { remoteProgressView } from '../src/utils/remoteProgress.ts';
import { databaseImportLabel, recoveryStatusExplanation } from '../src/utils/recoveryTests.ts';
const files = [
   { path: '/srv/app', isDirectory: true, size: 0 },
   { path: '/srv/app/nested', isDirectory: true, size: 0 },
   { path: '/srv/app/empty', isDirectory: true, size: 0 },
   { path: '/srv/app/a', isDirectory: false, size: 3 },
   { path: '/srv/app/nested/b', isDirectory: false, size: 7 },
   { path: '/srv/app-other/c', isDirectory: false, size: 2 },
];
const all = () => ({ includes: new Set<string>(), excludes: new Set<string>() });
test('Select All counts regular files and directories separately, with total and selected entries and bytes', () => {
   assert.deepEqual(restoreSelectionSummary(files, all()), {
      files: 3,
      directories: 3,
      entries: 6,
      totalFiles: 3,
      totalDirectories: 3,
      totalEntries: 6,
      bytes: 12,
      totalBytes: 12,
   });
   const none = encodeRestoreSelection(files, new Set());
   assert.equal(restoreSelectionSummary(files, none).entries, 0);
   assert.equal(restoreSelectionSummary(files, encodeRestoreSelection(files, new Set(files.map((file) => file.path)))).entries, 6);
});
test('symlinks/special nodes are entries, not regular files or regular-file bytes; staged restore allowlist is not widened', () => {
   const counts = restoreSelectionSummary([...files, { path: '/srv/app/link', isDirectory: false, type: 'symlink', size: 100 }], all());
   assert.equal(counts.files, 3);
   assert.equal(counts.bytes, 12);
   assert.equal(counts.entries, 7);
   assert.equal(counts.otherEntries, 1);
});
test('select child after excluding parent; partial parent is not a recursive include; nested toggles are immutable', () => {
   const before = { includes: new Set<string>(), excludes: new Set(['/srv/app']) };
   const child = toggleRestoreSelection(files, before, '/srv/app/nested/b');
   assert.deepEqual([...before.excludes], ['/srv/app']);
   assert.equal(before.includes.size, 0);
   const selected = selectedRestorePaths(files, child);
   assert.ok(selected.has('/srv/app/nested/b'));
   assert.ok(selected.has('/srv/app/nested'));
   assert.ok(!selected.has('/srv/app/a'));
   assert.equal(restoreSelectionState(files, selected, '/srv/app'), 'partial');
   assert.ok(!child.includes.has('/srv/app'));
   const parent = toggleRestoreSelection(files, child, '/srv/app');
   assert.equal(restoreSelectionState(files, selectedRestorePaths(files, parent), '/srv/app'), 'all');
   const unselected = toggleRestoreSelection(files, parent, '/srv/app');
   assert.ok(!selectedRestorePaths(files, unselected).has('/srv/app/nested/b'));
   assert.ok(selectedRestorePaths(files, unselected).has('/srv/app-other/c'));
});
test('selection includes empty directories, respects sibling boundaries and remains global under view search/filter', () => {
   const selection = encodeRestoreSelection(files, new Set(['/srv/app/empty']));
   const counts = restoreSelectionSummary(files, selection);
   assert.equal(counts.files, 0);
   assert.equal(counts.directories, 2);
   const global = toggleRestoreSelection(files, all(), '/srv/app/nested');
   const filteredView = files.filter((file) => file.path.endsWith('/a'));
   assert.equal(filteredView.length, 1);
   assert.equal(restoreSelectionSummary(files, global).files, 2);
   assert.ok(selectedRestorePaths(files, global).has('/srv/app-other/c'));
});
test('unselecting the last leaf cannot accidentally encode ALL; ancestor-only selection is empty', () => {
   const inventory = files.slice(0, 2).concat(files[4]);
   const none = toggleRestoreSelection(inventory, all(), '/srv/app/nested/b');
   assert.equal(restoreSelectionSummary(inventory, none).entries, 0);
   assert.ok(none.excludes.size > 0);
   assert.equal(restoreSelectionSummary(inventory, encodeRestoreSelection(inventory, new Set(['/srv/app']))).entries, 0);
});
test('remote active progress is indeterminate with a real stage, including retry; terminal outcomes stay distinct', () => {
   for (const stage of ['validating-source', 'dumping-database', 'backing-up', 'verifying-snapshot'])
      assert.equal(remoteProgressView({ remote: true, status: 'started', backupStage: stage })?.indeterminate, true);
   assert.equal(remoteProgressView({ remote: true, status: 'queued', attempt: 2 })?.attempt, 2);
   assert.deepEqual(remoteProgressView({ remote: true, status: 'completed', backupStage: 'backing-up' }), {
      indeterminate: false,
      completed: true,
      message: 'Backup complete',
      attempt: 1,
   });
   assert.equal(remoteProgressView({ remote: true, status: 'failed' })?.message, 'Backup failed');
   assert.equal(remoteProgressView({ status: 'started' }), null);
});
test('recovery language distinguishes exact-snapshot checks, warning, failure and unexecuted SQL import', () => {
   assert.match(databaseImportLabel('disabled'), /SQL import NOT TESTED.*Disabled/);
   assert.match(databaseImportLabel('not_configured'), /NOT TESTED/);
   assert.match(databaseImportLabel('passed'), /PASSED.*disposable/);
   assert.match(databaseImportLabel('failed'), /FAILED/);
   assert.match(recoveryStatusExplanation.passed_with_warning, /skipped or cleanup/);
   assert.match(recoveryStatusExplanation.failed, /Backup Complete does not imply/);
});
const frontendRequire = createRequire(new URL('../package.json', import.meta.url)),
   backendRequire = createRequire(new URL('../../backend/package.json', import.meta.url));
const React = frontendRequire('react'),
   { renderToStaticMarkup } = frontendRequire('react-dom/server'),
   { build } = backendRequire('esbuild');
async function compile(relative: string) {
   const output = await build({
      entryPoints: [fileURLToPath(new URL(`../src/${relative}`, import.meta.url))],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      jsx: 'automatic',
      write: false,
      define: { 'import.meta.env': JSON.stringify({ MODE: 'test', VITE_BACKEND_URL: 'https://example.invalid', VITE_APP_NAME: 'Pluton' }) },
      external: ['react', 'react/jsx-runtime'],
      plugins: [
         {
            name: 'safe-ui-stubs',
            setup(builder: any) {
               builder.onLoad({ filter: /services.*restores\.ts$/ }, () => ({ contents: 'export const useRestoreBackup=()=>({});', loader: 'js' }));
               builder.onLoad({ filter: /common[\/]Icon[\/]Icon\.tsx$/ }, () => ({ contents: 'export default ()=>null;', loader: 'js' }));
               builder.onLoad({ filter: /\.scss$/ }, () => ({ contents: 'export default {};', loader: 'js' }));
               builder.onResolve({ filter: /^react-router$/ }, () => ({ path: 'router-stub', namespace: 'stub' }));
               builder.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export const useNavigate=()=>()=>{};', loader: 'js' }));
            },
         },
      ],
   });
   const module = { exports: {} as any };
   new Function('require', 'module', 'exports', output.outputFiles[0].text)(frontendRequire, module, module.exports);
   return module.exports.default;
}
test('confirmation actually renders unambiguous counts; staged-only never-overwrite payload remains unchanged', async () => {
   const Confirm = await compile('components/Restore/RestoreWizard/RestoreConfirmStep.tsx');
   const html = renderToStaticMarkup(
      React.createElement(Confirm, {
         backupId: 'backup-01',
         planId: 'plan-01',
         settings: { type: 'custom', path: 'check', overwrite: 'never', includes: [], excludes: [], delete: false },
         snapshotsStats: { total_files: 3, total_bytes: 12 },
         stats: { files_restored: 3 },
         selectionCounts: restoreSelectionSummary(files, all()),
         method: 'backup',
         stagingOnly: true,
         goBack: () => {},
         close: () => {},
      }),
   );
   assert.match(html, /3 files \+ 3 directories selected \(6 entries; snapshot total: 6 entries\)/);
   assert.match(html, /new internal server staging workspace/);
   assert.ok(!html.includes('3/6 files'));
});
