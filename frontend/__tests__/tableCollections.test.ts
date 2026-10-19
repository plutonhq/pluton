import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { collectionPage, stableCollectionSort } from '../src/components/common/Table/collection.ts';

const require = createRequire(new URL('../package.json', import.meta.url));
const backendRequire = createRequire(new URL('../../backend/package.json', import.meta.url));
const React = require('react');
const { JSDOM } = require('jsdom');
const { act } = React;

// Real route/controls/hooks are bundled; only network hooks and unrelated row/dialog bodies are replaced.
const routes: Record<string, string> = {
   plans: 'Plans/Plans',
   sources: 'Sources/Sources',
   storages: 'Storages/Storages',
   legacy: 'LegacyRepositories/LegacyRepositories',
};
const modules: Record<string, any> = {};
for (const [name, route] of Object.entries(routes)) {
   const result = await backendRequire('esbuild').build({
      entryPoints: [fileURLToPath(new URL(`../src/routes/${route}.tsx`, import.meta.url))],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      jsx: 'automatic',
      write: false,
      external: ['react', 'react/jsx-runtime', 'react-dom', 'react-router'],
      plugins: [
         {
            name: 'collection-route-fixture',
            setup(builder: any) {
               const load = (filter: RegExp, contents: string) => builder.onLoad({ filter }, () => ({ contents, loader: 'js' }));
               load(/\.scss$/, 'export default {};');
               load(
                  /[\\/]services[\\/](plans|devices|storage|legacyRepositories)\.ts$/,
                  `
            export const useGetPlans = () => globalThis.__tableQuery;
            export const useGetDevices = () => globalThis.__tableQuery;
            export const useGetStorages = () => globalThis.__tableQuery;
            export const useLegacyRepositories = () => globalThis.__tableQuery;
         `,
               );
               load(
                  /[\\/]PageHeader\.tsx$/,
                  `import React from 'react'; export default p => React.createElement('header', {}, p.title, p.rightSection);`,
               );
               load(
                  /[\\/](PlanItem|StorageItem|DeviceItem)\.tsx$/,
                  `import React from 'react'; export default p => {
            const row = p.plan || p.storage || p.device;
            return React.createElement('article', { 'data-row': row.id }, row.title || row.name,
               React.createElement('button', { onClick: () => globalThis.__rowActions.push(row.id) }, 'Inspect ' + row.id));
         };`,
               );
               load(
                  /[\\/]FilterPlans\.tsx$/,
                  `import React from 'react'; export default p => React.createElement('select', {
            'aria-label': 'Backup type', defaultValue: '', onChange: e => p.onUpdate(e.target.value ?
               { devices: [], tags: [], storages: [], methods: [e.target.value] } : null)
         }, React.createElement('option', {value: ''}, 'All'), React.createElement('option', {value: 'backup'}, 'Backup'));
         `,
               );
               load(
                  /[\\/](AddPlan|AddStorage|AgentEnrollment|RegisterLegacyRepository|SkeletonItems|ItemsLayout|Icon)\.tsx$/,
                  'export default () => null;',
               );
               load(/[\\/]ComponentOverrideContext\.tsx$/, 'export const useComponentOverride = (name, fallback) => fallback;');
               load(/[\\/]utils[\\/]index\.ts$/, 'export const getIntervalMinutes = value => Number(value);');
               load(/[\\/]utils[\\/]helpers\.ts$/, 'export const formatDateTime = value => value;');
               load(/[\\/]utils[\\/]backupStatistics\.ts$/, 'export const planReportedSize = row => row.testSize || 0;');
            },
         },
      ],
   });
   const module = { exports: {} };
   new Function('require', 'module', 'exports', result.outputFiles[0].text)(
      (id: string) =>
         id === 'react-router'
            ? { Link: ({ to, children, ...props }: any) => React.createElement('a', { ...props, href: to }, children) }
            : require(id),
      module,
      module.exports,
   );
   modules[name] = (module.exports as any).default;
}

function rows(count: number) {
   return Array.from({ length: count }, (_, index) => ({
      id: `item-${String(index + 1).padStart(2, '0')}`,
      name: `Item ${String(index + 1).padStart(2, '0')}`,
      title: `Item ${String(index + 1).padStart(2, '0')}`,
      tags: [index % 2 ? 'odd' : 'even'],
      method: index % 2 ? 'sync' : 'backup',
      sourceType: 'device',
      storage: { id: 'storage-01' },
      device: { id: 'source-01' },
      settings: { interval: '60' },
      createdAt: '2026-01-01T00:00:00Z',
      displayName: `Repository ${String(index + 1).padStart(2, '0')}`,
      repositoryPath: `/srv/example-${index + 1}`,
      validationStatus: index % 2 ? 'unavailable' : 'available',
      lastValidatedAt: null,
   }));
}

async function fixture(name: string, records = rows(23), saved: Record<string, string> = {}) {
   const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
   const globals = ['window', 'document', 'navigator', 'HTMLElement', 'localStorage', 'IS_REACT_ACT_ENVIRONMENT', '__tableQuery', '__rowActions'];
   const previous = globals.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
   for (const key of globals)
      Object.defineProperty(globalThis, key, {
         configurable: true,
         writable: true,
         value:
            key === 'IS_REACT_ACT_ENVIRONMENT'
               ? true
               : key === '__tableQuery'
                 ? { data: { result: records }, isLoading: false, error: null }
                 : key === '__rowActions'
                   ? []
                   : (dom.window as any)[key],
      });
   for (const [key, value] of Object.entries(saved)) localStorage.setItem(key, value);
   // React's input-event feature detection must see the DOM before its first load.
   const { createRoot } = require('react-dom/client');
   const root = createRoot(document.getElementById('root'));
   const render = async () => {
      await act(async () => root.render(React.createElement(modules[name])));
   };
   await render();
   const input = async (element: HTMLInputElement | HTMLSelectElement, value: string) => {
      const prototype = element.tagName === 'SELECT' ? dom.window.HTMLSelectElement.prototype : dom.window.HTMLInputElement.prototype;
      await act(async () => {
         Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value);
         element.dispatchEvent(new dom.window.Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
      });
   };
   return {
      document,
      render,
      input,
      buttons: () => [...document.querySelectorAll('button')],
      click: async (text: string) => {
         await act(async () => ([...document.querySelectorAll('button')].find((b) => b.textContent === text) as HTMLButtonElement).click());
      },
      select: (label: string) => [...document.querySelectorAll('label')].find((el) => el.textContent?.startsWith(label))!.querySelector('select')!,
      search: () => document.querySelector('input[type="search"]')! as HTMLInputElement,
      visible: () => [...document.querySelectorAll('[data-row]')].map((el) => el.getAttribute('data-row')),
      status: () => document.querySelector('[role="status"]')!.textContent,
      async update(records: any[], extra = {}) {
         (globalThis as any).__tableQuery = { data: { result: records }, isLoading: false, error: null, ...extra };
         await render();
      },
      async close() {
         await act(async () => root.unmount());
         dom.window.close();
         for (const [key, descriptor] of previous) {
            if (descriptor) Object.defineProperty(globalThis, key, descriptor);
            else Reflect.deleteProperty(globalThis, key);
         }
      },
   };
}

test('collection ranges clamp empty/deleted pages and stable ties never mutate the supplied rows', () => {
   const data = [
      { id: 'c', name: 'Same' },
      { id: 'a', name: 'Same' },
      { id: 'b', name: 'Same' },
   ];
   assert.deepEqual(
      stableCollectionSort(data, () => 0).map((row) => row.id),
      ['a', 'b', 'c'],
   );
   assert.deepEqual(
      data.map((row) => row.id),
      ['c', 'a', 'b'],
   );
   assert.deepEqual(collectionPage([], 5, 10), { items: [], page: 1, pageSize: 10, total: 0, totalPages: 1, start: 0, end: 0 });
   assert.equal(collectionPage(rows(10), 2, 10).page, 1);
});

test('actual plans route composes stored filters with sort/search and keeps filters through refreshed data', async () => {
   const f = await fixture('plans', rows(23), {
      plans_sort: 'title_desc',
      plans_filter: JSON.stringify({ devices: [], tags: ['even'], storages: [], methods: [] }),
   });
   try {
      assert.equal(f.status(), 'Showing 1–10 of 12 plans');
      assert.equal(f.visible()[0], 'item-23');
      await f.input(f.search(), 'Item 0');
      assert.deepEqual(f.visible(), ['item-09', 'item-07', 'item-05', 'item-03', 'item-01']);
      await f.update([...rows(23)].reverse());
      assert.deepEqual(f.visible(), ['item-09', 'item-07', 'item-05', 'item-03', 'item-01']);
      await f.click('Inspect item-09');
      assert.deepEqual((globalThis as any).__rowActions, ['item-09']);
   } finally {
      await f.close();
   }
});

test('plan method filter intersects search in either order and filtered empty never says no plans exist', async () => {
   const f = await fixture('plans');
   try {
      await f.input(f.search(), 'Item 02');
      await f.input(f.document.querySelector('[aria-label="Backup type"]')!, 'backup');
      assert.equal(f.status(), 'Showing 0–0 of 0 plans');
      assert.match(f.document.body.textContent!, /No plans match the current filters/);
      await f.input(f.search(), 'Item 0');
      assert.deepEqual(f.visible(), ['item-01', 'item-03', 'item-05', 'item-07', 'item-09']);
   } finally {
      await f.close();
   }
});

for (const route of ['sources', 'storages']) {
   test(`actual ${route} route keeps all tags discoverable and composes tag/search across polling`, async () => {
      const f = await fixture(route);
      try {
         const tag = f.select(route === 'sources' ? 'Source tag' : 'Storage tag');
         assert.deepEqual(
            [...tag.options].map((option) => option.value),
            ['', 'even', 'odd'],
         );
         await f.input(tag, 'even');
         await f.input(f.search(), 'ITEM 0');
         assert.deepEqual(f.visible(), ['item-01', 'item-03', 'item-05', 'item-07', 'item-09']);
         await f.update([...rows(23)].reverse());
         assert.deepEqual(f.visible(), ['item-01', 'item-03', 'item-05', 'item-07', 'item-09']);
         assert.deepEqual(
            [...tag.options].map((option) => option.value),
            ['', 'even', 'odd'],
         );
         await f.update(rows(23).filter((row) => row.tags.includes('odd')));
         assert.equal(tag.value, 'even'); // Removing the final matching item must not visually clear an active filter.
         assert.deepEqual(f.visible(), []);
         await f.input(tag, '');
         assert.deepEqual(f.visible(), ['item-02', 'item-04', 'item-06', 'item-08']);
      } finally {
         await f.close();
      }
   });
}

test('actual pagination preserves native focused controls, navigates, resets size/filter and clamps after deletion', async () => {
   const f = await fixture('storages');
   try {
      const nav = f.document.querySelector('nav')!;
      assert.equal(nav.getAttribute('aria-label'), 'storages pagination');
      const next = f.buttons().find((button) => button.textContent === 'Next') as HTMLButtonElement;
      next.focus();
      assert.equal(f.document.activeElement, next);
      assert.equal(next.type, 'button'); // Native button retains standard keyboard activation; no synthetic key interception.
      await f.click('Next');
      assert.equal(f.document.activeElement, next);
      assert.equal(f.visible()[0], 'item-11');
      await f.click('Next');
      assert.equal(f.status(), 'Showing 21–23 of 23 storages');
      await f.update(rows(20)); // Last page deleted externally; same control and current filters remain mounted.
      assert.equal(f.status(), 'Showing 11–20 of 20 storages');
      await f.input(f.select('storages per page'), '25');
      assert.equal(f.status(), 'Showing 1–20 of 20 storages');
      await f.input(f.select('storages per page'), '10');
      await f.click('Next');
      await f.input(f.search(), 'Item 01');
      assert.equal(f.status(), 'Showing 1–1 of 1 storages');
      assert.deepEqual(f.visible(), ['item-01']);
      assert.equal(f.search().closest('label')!.textContent, 'Search storages');
      assert.equal(f.select('storages per page').closest('label')!.textContent, 'storages per page102550');
   } finally {
      await f.close();
   }
});

test('actual legacy registrations route filters status/name/path without changing registration links or readonly notice', async () => {
   const f = await fixture('legacy');
   try {
      await f.input(f.select('Validation status'), 'available');
      await f.input(f.search(), '/srv/example-1');
      assert.equal(f.status(), 'Showing 1–6 of 6 legacy repositories');
      const links = [...f.document.querySelectorAll('a')];
      assert.deepEqual(
         links.map((link) => link.getAttribute('href')),
         ['item-01', 'item-11', 'item-13', 'item-15', 'item-17', 'item-19'].map((id) => `/legacy-repositories/${id}`),
      );
      assert.match(f.document.body.textContent!, /READ ONLY/);
   } finally {
      await f.close();
   }
});

test('actual collections distinguish pending, errors, empty datasets and filtered emptiness', async () => {
   const f = await fixture('storages', []);
   try {
      assert.match(f.document.body.textContent!, /No Storages Found/);
      await f.update([], { isLoading: true });
      assert.equal(f.document.querySelector('nav')!.getAttribute('aria-busy'), 'true');
      assert.equal(f.status(), 'Loading storages…');
      assert.equal((f.buttons().find((button) => button.textContent === 'Next') as HTMLButtonElement).disabled, true);
      await f.update([], { error: new Error('Synthetic unavailable') });
      assert.match(f.document.querySelector('[role="alert"]')!.textContent!, /Synthetic unavailable/);
      assert.doesNotMatch(f.document.body.textContent!, /No Storages Found/);
      assert.equal(f.document.querySelector('nav'), null);
   } finally {
      await f.close();
   }
});
