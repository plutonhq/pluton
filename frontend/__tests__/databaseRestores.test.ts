import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
   initialRestoreChoice,
   restoreRefusal,
   restoreBody,
   restoreStatus,
   needsRestoreRefresh,
   restoreStage,
} from '../src/utils/databaseRestores.ts';
import type { RestorePreview, DatabaseRestoreView } from '../src/@types/databaseRestores.ts';
const preview: RestorePreview = {
   planId: 'plan-01',
   planTitle: 'Fixture',
   backupId: 'backup-01',
   snapshotId: 'a'.repeat(64),
   repositoryId: 'repo-01',
   metadataToken: 'b'.repeat(64),
   databases: [
      {
         databaseId: 'db_example',
         database: 'example_db',
         engine: 'mariadb',
         path: '/pluton/database/db_example.sql',
         bytes: 8 * 1024 ** 2,
         sha256: 'c'.repeat(64),
      },
   ],
   engines: { mariadb: ['internal', 'custom'], postgresql: ['internal', 'custom'], mysql: [] },
   targets: [],
   retentionSeconds: [3600, 21600, 86400],
   internalPolicy: { maxSqlBytes: 128 * 1024 ** 2, maxRetentionSeconds: 86400 },
   workloadBusy: false,
   warnings: [],
   resources: {
      status: 'measured',
      observedAt: 1,
      sample: {
         cpuAvailable: 1,
         operatorObservedAt: 1,
         operatorTotal: 4096 * 1024 ** 2,
         operatorAvailable: 3000 * 1024 ** 2,
         operatorCpuAvailable: 4,
         operatorDiskAvailable: 10 * 1024 ** 3,
         total: 4096 * 1024 ** 2,
         available: 3000 * 1024 ** 2,
         swapUsed: 0,
         pressure: 0,
         limit: 1536 * 1024 ** 2,
         used: 100 * 1024 ** 2,
         cgroupSwap: 0,
         diskAvailable: 10 * 1024 ** 3,
      },
   },
};
test('automatic lifecycle displays measured stages and requires independent MySQL Internal approval', () => {
   for (const stage of [
      'checking-resources',
      'provisioning-container',
      'starting-database',
      'database-import',
      'database-import-validation',
      'cleaning-up',
      'cleanup-required',
   ])
      assert.notEqual(restoreStage(stage), stage);
   assert.match(restoreStage('ready'), /not imported/);
   const choice = { ...initialRestoreChoice(preview), resources: true, security: true };
   assert.match(restoreRefusal({ ...preview, lifecycle: { available: false } }, choice)!, /operator unavailable/);
   assert.equal(restoreRefusal({ ...preview, lifecycle: { available: true } }, choice), null);
   const mysql = { ...preview, lifecycle: { available: true }, databases: [{ ...preview.databases[0], engine: 'mysql' as const }] };
   assert.match(restoreRefusal(mysql, choice)!, /approved automatic operator/);
});
test('approved MySQL Internal is selectable, with its own budget/headroom and unchanged snapshot identity', () => {
   const mysql: RestorePreview = {
      ...preview,
      databases: [{ ...preview.databases[0], engine: 'mysql' }],
      engines: { ...preview.engines, mysql: ['internal', 'custom'] },
      lifecycle: { available: true },
   };
   const choice = { ...initialRestoreChoice(mysql), resources: true, security: true };
   assert.equal(choice.mode, 'internal');
   assert.equal(restoreRefusal(mysql, choice), null);
   const body = restoreBody(mysql, choice);
   assert.equal(body.databaseId, preview.databases[0].databaseId);
   assert.equal(body.snapshotId, preview.snapshotId);
   assert.equal(body.mode, 'internal');
   assert(!Object.hasOwn(body, 'targetId'));
   assert(!Object.hasOwn(body, 'host'));
   assert(restoreRefusal({ ...mysql, lifecycle: undefined }, choice));
   assert(
      restoreRefusal({ ...mysql, resources: { ...mysql.resources, sample: { ...mysql.resources.sample!, available: 2800 * 1024 ** 2 } } }, choice),
   );
   assert(
      restoreRefusal(
         {
            ...mysql,
            internalPolicy: { ...mysql.internalPolicy, maxSqlBytes: 384 * 1024 ** 2 },
            databases: [{ ...mysql.databases[0], bytes: 128 * 1024 ** 2 + 1 }],
         },
         choice,
      ),
   );
});
test('wizard submits stable snapshot/database IDs, not a guessed engine, SQL, credentials or endpoint', () => {
   const choice = { ...initialRestoreChoice(preview), resources: true, security: true };
   assert.equal(restoreRefusal(preview, choice), null);
   const body = restoreBody(preview, choice);
   assert.equal(body.snapshotId, preview.snapshotId);
   assert.equal(body.databaseId, 'db_example');
   for (const field of ['engine', 'host', 'port', 'password', 'sql', 'ownerToken', 'targetId']) assert(!Object.hasOwn(body, field));
   assert.equal(choice.ttlSeconds, 86400);
   assert(!Object.hasOwn(body, 'policy'));
});
test('acknowledgements cannot bypass resources, root approval, engine or retention limits', () => {
   const choice = { ...initialRestoreChoice(preview), resources: true, security: true };
   for (const changed of [
      { ...preview, resources: { ...preview.resources, sample: null } },
      { ...preview, workloadBusy: true },
      { ...preview, databases: [{ ...preview.databases[0], engine: 'mysql' as const }] },
      { ...preview, databases: [{ ...preview.databases[0], engine: undefined }] },
      { ...preview, internalPolicy: { ...preview.internalPolicy, maxSqlBytes: 1 } },
   ])
      assert(restoreRefusal(changed, choice));
   assert(restoreRefusal(preview, { ...choice, ttlSeconds: 7 * 86400 }));
   assert(restoreRefusal(preview, { ...choice, mode: 'custom', targetId: 'c'.repeat(24) }));
   assert(restoreRefusal(preview, { ...choice, resources: false }));
});
test('queued, expired and uncertain cleanup states are never shown as successful restore/deletion', () => {
   const base = { status: 'queued', errorCode: null, expired: false } as DatabaseRestoreView;
   assert.match(restoreStatus(base), /not imported/);
   assert.match(restoreStatus({ ...base, status: 'cleanup_required' }), /Cleanup Required/);
   assert.match(restoreStatus({ ...base, status: 'active', expired: true }), /access revoked/);
   assert.match(restoreStatus({ ...base, status: 'deleted', errorCode: 'database-import-failed' }), /Failed/);
   assert(needsRestoreRefresh(base));
   assert(!needsRestoreRefresh({ ...base, status: 'deleted' }));
});
test('legacy MySQL defaults to Custom; unapproved Internal remains unavailable', () => {
   const target = {
      id: 'd'.repeat(24),
      engine: 'mysql' as const,
      database: 'example_db',
      mode: 'custom' as const,
      maxSqlBytes: 128 * 1024 ** 2,
      maxRetentionSeconds: 86400,
      quotaBytes: 2 * 1024 ** 3,
   };
   const mysql: RestorePreview = {
      ...preview,
      databases: [{ ...preview.databases[0], engine: 'mysql' }],
      engines: { ...preview.engines, mysql: ['custom'] },
      targets: [target],
   };
   const choice = { ...initialRestoreChoice(mysql), resources: true, security: true };
   assert.equal(choice.mode, 'custom');
   assert.equal(choice.targetId, '');
   assert(restoreRefusal(mysql, choice));
   const selected = { ...choice, targetId: target.id };
   assert.equal(restoreRefusal(mysql, selected), null);
   assert.equal(restoreBody(mysql, selected).targetId, target.id);
   assert.equal(restoreBody(mysql, selected).databaseId, 'db_example');
   assert.match(restoreRefusal(mysql, { ...selected, mode: 'internal' })!, /approved automatic operator/);
   assert.match(restoreRefusal({ ...mysql, engines: { ...mysql.engines, mysql: [] } }, selected)!, /not configured/);
   assert(restoreRefusal({ ...mysql, targets: [{ ...target, engine: 'mariadb' }] }, selected));
   assert(restoreRefusal({ ...mysql, targets: [{ ...target, database: 'another_db' }] }, selected));
   assert(restoreRefusal({ ...mysql, databases: [{ ...mysql.databases[0], bytes: 128 * 1024 ** 2 + 1 }] }, selected));
   for (const field of ['password', 'engine', 'host', 'sql', 'ownerToken']) assert(!Object.hasOwn(restoreBody(mysql, selected), field));
});
test('real wizard and management components render metadata-only controls with explicit operator steps', async () => {
   const require = createRequire(new URL('../../backend/package.json', import.meta.url)),
      frontend = createRequire(new URL('../package.json', import.meta.url));
   const { build } = require('esbuild'),
      React = frontend('react'),
      { renderToStaticMarkup } = frontend('react-dom/server');
   for (const [entry, exportName, props] of [
      [
         'components/Restore/DatabaseRestore/DatabaseRestoreWizard.tsx',
         'DatabaseRestoreForm',
         { preview, pending: false, confirm: () => {}, refresh: () => {} },
      ],
      [
         'routes/DatabaseRestores/DatabaseRestores.tsx',
         'RestoreDetails',
         {
            row: {
               id: 'd'.repeat(24),
               ...preview,
               mode: 'internal',
               engine: 'mariadb',
               logicalDatabase: 'example_db',
               databaseId: 'db_example',
               targetId: 'd'.repeat(24),
               sqlBytes: 10,
               sha256: 'c'.repeat(64),
               status: 'provisioning_required',
               stage: 'operator-provisioning',
               cleanup: 'none',
               createdAt: 1,
               expiresAt: Date.now() + 3600000,
               errorCode: null,
               inspection: null,
            },
            act: () => {},
            pending: false,
         },
      ],
   ] as const) {
      const compiled = await build({
         entryPoints: [fileURLToPath(new URL('../src/' + entry, import.meta.url))],
         bundle: true,
         platform: 'node',
         format: 'cjs',
         jsx: 'automatic',
         write: false,
         packages: 'external',
         loader: { '.scss': 'empty' },
         define: { 'import.meta.env': '{"MODE":"test"}' },
         plugins: [
            {
               name: 'native-render-boundary',
               setup(builder: any) {
                  builder.onLoad({ filter: /utils[\\/]helpers\.ts$/ }, () => ({
                     contents: 'export const formatBytes=bytes=>String(bytes)+" bytes";',
                     loader: 'js',
                  }));
               },
            },
         ],
      });
      const module = { exports: {} as any };
      new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(frontend, module, module.exports);
      const markup = renderToStaticMarkup(React.createElement(module.exports[exportName], props));
      assert(markup.includes(preview.snapshotId));
      assert(!markup.includes('type="password"'));
      assert(!markup.includes('dangerouslySetInnerHTML'));
      assert.match(markup, /operator/);
      assert.match(markup, /SQL/);
      assert(!markup.includes('Restore — Not Available'));
   }
});
test('legacy MySQL wizard and management retain Custom-only mode, validation and safe deletion', async () => {
   const require = createRequire(new URL('../../backend/package.json', import.meta.url)),
      frontend = createRequire(new URL('../package.json', import.meta.url));
   const { build } = require('esbuild'),
      React = frontend('react'),
      { renderToStaticMarkup } = frontend('react-dom/server');
   const mysql = { ...preview, databases: [{ ...preview.databases[0], engine: 'mysql' }], engines: { ...preview.engines, mysql: ['custom'] } };
   for (const [entry, exported, props] of [
      [
         'components/Restore/DatabaseRestore/DatabaseRestoreWizard.tsx',
         'DatabaseRestoreForm',
         { preview: mysql, pending: false, confirm: () => {}, refresh: () => {} },
      ],
      [
         'routes/DatabaseRestores/DatabaseRestores.tsx',
         'RestoreDetails',
         {
            row: {
               ...preview,
               id: 'd'.repeat(24),
               mode: 'custom',
               engine: 'mysql',
               logicalDatabase: 'example_db',
               databaseId: 'db_example',
               database: 'example_db',
               targetId: 'd'.repeat(24),
               sqlBytes: 1024,
               sha256: 'c'.repeat(64),
               status: 'active',
               stage: 'active',
               cleanup: 'none',
               createdAt: 1,
               startedAt: 2,
               completedAt: 3,
               lastValidatedAt: 4,
               expiresAt: Date.now() + 3600000,
               errorCode: null,
               inspection: null,
            },
            act: () => {},
            pending: false,
         },
      ],
   ] as const) {
      const compiled = await build({
         entryPoints: [fileURLToPath(new URL('../src/' + entry, import.meta.url))],
         bundle: true,
         platform: 'node',
         format: 'cjs',
         jsx: 'automatic',
         write: false,
         packages: 'external',
         loader: { '.scss': 'empty' },
         define: { 'import.meta.env': '{"MODE":"test"}' },
         plugins: [
            {
               name: 'format-only',
               setup(builder: any) {
                  builder.onLoad({ filter: /utils[\\/]helpers\.ts$/ }, () => ({
                     contents: 'export const formatBytes=bytes=>String(bytes)+" bytes";',
                     loader: 'js',
                  }));
               },
            },
         ],
      });
      const module = { exports: {} as any };
      new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(frontend, module, module.exports);
      const markup = renderToStaticMarkup(React.createElement(module.exports[exported], props));
      assert.match(markup, /mysql/i);
      assert(markup.includes(preview.snapshotId));
      assert(!markup.includes('type="password"'));
      if (exported === 'DatabaseRestoreForm') {
         assert.match(markup, /<option value="internal" disabled="">Internal — manual operator provisioning/);
         assert.match(markup, /<option value="custom" selected="">/);
         assert.match(markup, /Oracle MySQL worker/);
      } else {
         assert.match(markup, /Import validated:/);
         assert.match(markup, /history record is retained/);
         assert.match(markup, /does not verify application recovery/);
      }
   }
});
