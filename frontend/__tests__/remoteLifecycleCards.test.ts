import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import type { RemoteBackupLifecycle, RemoteDatabaseBackup } from '../src/@types/plans.ts';

const frontendRequire = createRequire(new URL('../package.json', import.meta.url));
const backendRequire = createRequire(new URL('../../backend/package.json', import.meta.url));
const React = frontendRequire('react');
const { renderToStaticMarkup } = frontendRequire('react-dom/server');
const { build } = backendRequire('esbuild');

// Compile the actual editor with existing workspace tooling, without a new test
// dependency or application/server startup. Only CSS is stubbed; React is real.
const compiled = await build({
   entryPoints: [fileURLToPath(new URL('../src/components/Plan/PlanSettings/PlanRemoteLifecycleSettings.tsx', import.meta.url))],
   bundle: true,
   platform: 'node',
   format: 'cjs',
   jsx: 'automatic',
   write: false,
   external: ['react', 'react/jsx-runtime'],
   plugins: [
      {
         name: 'test-css-modules',
         setup(builder: any) {
            builder.onLoad({ filter: /\.scss$/ }, () => ({ contents: 'export default {};', loader: 'js' }));
         },
      },
   ],
});
const componentModule = { exports: {} as any };
new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(frontendRequire, componentModule, componentModule.exports);
const Settings = componentModule.exports.default;

function walk(node: any): any[] {
   if (Array.isArray(node)) return node.flatMap(walk);
   if (!React.isValidElement(node)) return [];
   return [node, ...walk(node.props.children)];
}

function editor(initial?: RemoteBackupLifecycle) {
   let value = initial;
   let tree: any;
   let html = '';
   const updates: RemoteBackupLifecycle[] = [];
   function render() {
      // Calling the editor inside a React render keeps useRef valid and exposes
      // its actual JSX event handlers, rather than reimplementing card actions.
      function Probe() {
         tree = Settings({
            value,
            onUpdate(next: RemoteBackupLifecycle) {
               value = next;
               updates.push(next);
            },
         });
         return tree;
      }
      assert.doesNotThrow(() => {
         html = renderToStaticMarkup(React.createElement(Probe));
      });
      assert.ok(html.includes('Database Backup'));
   }
   const cards = () => walk(tree).filter((node) => node.type === 'section');
   const buttons = (node = tree) => walk(node).filter((item) => item.type === 'button');
   return {
      render,
      cards,
      value: () => value,
      updates,
      html: () => html,
      enable() {
         const toggle = walk(tree).find((node) => node.type === 'input' && node.props.type === 'checkbox');
         toggle.props.onChange({ target: { checked: true } });
         render();
      },
      add() {
         buttons()
            .find((node) => String(node.props.children).includes('+ Add database'))
            .props.onClick();
         render();
      },
      action(index: number, label: string) {
         buttons(cards()[index])
            .find((node) => node.props.children === label)
            .props.onClick();
         render();
      },
   };
}

function withoutRandomUUID(run: () => void) {
   const previous = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
   Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) },
   });
   try {
      assert.equal(typeof globalThis.crypto.randomUUID, 'undefined');
      run();
   } finally {
      if (previous) Object.defineProperty(globalThis, 'crypto', previous);
      else Reflect.deleteProperty(globalThis, 'crypto');
   }
}

const saved: RemoteDatabaseBackup = {
   databaseId: 'db_example_saved',
   engine: 'mariadb',
   host: 'localhost',
   port: 3306,
   tls: 'local',
   database: 'example_db',
   username: 'backup_reader',
   dumpFilename: 'app.sql',
   timeoutSeconds: 60,
   maxDumpBytes: 1024 ** 3,
   includeRoutines: false,
   includeEvents: false,
   passwordConfigured: true,
};

test('Enable database backup from an empty or unset collection renders the first card without randomUUID', () => {
   withoutRandomUUID(() => {
      for (const initial of [undefined, { version: 2 as const, databases: [] }]) {
         const form = editor(initial);
         form.render();
         assert.equal(form.cards().length, 0);
         form.enable();
         assert.equal(form.cards().length, 1);
         assert.match(form.cards()[0].key, /^ui-[a-f0-9]{32}$/);
         assert.equal(form.value()!.databases![0].databaseId, undefined);
      }
   });
});

test('Add Database creates multiple rendered cards with unique client-only keys and filenames', () => {
   withoutRandomUUID(() => {
      const form = editor({ version: 2, databases: [] });
      form.render();
      form.enable();
      form.add();
      form.add();
      const cards = form.cards();
      assert.equal(cards.length, 3);
      assert.equal(new Set(cards.map((card) => card.key)).size, 3);
      assert.deepEqual(
         form.value()!.databases!.map((db) => db.dumpFilename),
         ['app.sql', 'app-2.sql', 'app-3.sql'],
      );
   });
});

test('Remove database keeps other saved entries and their server IDs unchanged', () => {
   withoutRandomUUID(() => {
      const form = editor({ version: 2, databases: [saved] });
      form.render();
      form.add();
      form.add();
      form.action(1, 'Remove database');
      assert.equal(form.cards().length, 2);
      assert.equal(form.value()!.databases![0], saved);
      assert.equal(form.cards()[0].key, saved.databaseId);
      assert.equal(form.value()!.databases![1].dumpFilename, 'app-3.sql');
   });
});

test('Move up/down reorders whole entries without changing server ID or submitting an unsaved key', () => {
   withoutRandomUUID(() => {
      const form = editor({ version: 2, databases: [saved] });
      form.render();
      form.add();
      const unsaved = form.value()!.databases![1];
      form.action(1, 'Move up');
      assert.deepEqual(form.value()!.databases, [unsaved, saved]);
      assert.equal(form.cards()[1].key, saved.databaseId);
      form.action(0, 'Move down');
      assert.deepEqual(form.value()!.databases, [saved, unsaved]);
      assert.equal(saved.databaseId, 'db_example_saved');
      assert.equal(unsaved.databaseId, undefined);
   });
});

test('temporary React keys never enter submitted lifecycle JSON, including after editing an unsaved card', () => {
   withoutRandomUUID(() => {
      const form = editor({ version: 2, databases: [] });
      form.render();
      form.enable();
      const inputs = walk(form.cards()[0]).filter((node) => node.type === 'input');
      const databaseInput = inputs.find((node) => node.props.autoComplete === 'off' && node.props.value === '');
      databaseInput.props.onChange({ target: { value: 'example_new' } });
      form.render();
      assert.equal(form.value()!.databases![0].database, 'example_new');
      for (const value of form.updates) {
         const payload = JSON.parse(JSON.stringify({ settings: { remoteLifecycle: value } }));
         assert.ok(payload.settings.remoteLifecycle.databases.every((db: object) => !Object.hasOwn(db, 'databaseId')));
         assert.ok(!JSON.stringify(payload).includes('ui-'));
      }
   });
});

test('existing migrated single-DB plan opens with its server ID and write-only saved password unchanged', () => {
   withoutRandomUUID(() => {
      const form = editor({ version: 2, databases: [saved] });
      form.render();
      assert.equal(form.cards().length, 1);
      assert.equal(form.cards()[0].key, 'db_example_saved');
      assert.equal(form.value()!.databases![0], saved);
      assert.ok(form.html().includes('Password saved'));
      const password = walk(form.cards()[0]).find((node) => node.type === 'input' && node.props.type === 'password');
      assert.equal(password.props.value, '');
      assert.equal(form.updates.length, 0);
   });
});

test('legacy single-DB API shape also opens without randomUUID or an invented persisted ID', () => {
   withoutRandomUUID(() => {
      const { databaseId: _serverId, ...legacy } = saved;
      const form = editor({ version: 1, database: legacy });
      form.render();
      assert.equal(form.cards().length, 1);
      assert.match(form.cards()[0].key, /^ui-[a-f0-9]{32}$/);
      assert.equal(form.value()!.database!.databaseId, undefined);
      assert.equal(form.updates.length, 0);
   });
});
