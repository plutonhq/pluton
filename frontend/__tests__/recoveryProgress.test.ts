import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { recoveryProgress, restoreProgress, elapsedSeconds, elapsedLabel } from '../src/utils/recoveryProgress.ts';
import { restoreActionNotice } from '../src/utils/databaseRestores.ts';

const require = createRequire(new URL('../package.json', import.meta.url));
const backend = createRequire(new URL('../../backend/package.json', import.meta.url));
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><button id="trigger">Open</button><div id="root"></div>', { url: 'http://localhost/' });
for (const name of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'Event', 'KeyboardEvent', 'MouseEvent'])
   Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] });
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const React = require('react'),
   { act } = React,
   { createRoot } = require('react-dom/client');
const { QueryClient, QueryClientProvider, notifyManager } = require('@tanstack/react-query');
notifyManager.setScheduler((callback: () => void) => queueMicrotask(callback));
const { MemoryRouter } = require('react-router');
const { build } = backend('esbuild');
after(() => dom.window.close());
const start = 1700000000000;
const snapshot = 'a'.repeat(64);
const preview: any = {
   planId: 'plan-01',
   planTitle: 'Synthetic plan',
   backupId: 'backup-01',
   snapshotId: snapshot,
   repositoryId: 'repo-01',
   metadataToken: 'first-token',
   databases: [
      {
         databaseId: 'db_example',
         engine: 'mariadb',
         database: 'example_db',
         path: '/pluton/database/db_example.sql',
         bytes: 100,
         sha256: 'b'.repeat(64),
      },
   ],
   targets: [],
   engines: { mariadb: ['internal'], postgresql: ['internal'], mysql: [] },
   lifecycle: { available: true },
   retentionSeconds: [3600, 21600, 86400],
   internalPolicy: { maxSqlBytes: 128 * 1024 ** 2, maxRetentionSeconds: 86400 },
   workloadBusy: false,
   warnings: [],
   resources: {
      status: 'measured',
      sample: {
         cpuAvailable: 1,
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
const row: any = {
   ...preview,
   id: 'c'.repeat(24),
   mode: 'internal',
   engine: 'mariadb',
   logicalDatabase: 'example_db',
   databaseId: 'db_example',
   sqlBytes: 100,
   sha256: 'b'.repeat(64),
   status: 'active',
   stage: 'database-import-validation',
   cleanup: 'none',
   createdAt: start,
   startedAt: start + 1000,
   completedAt: start + 10000,
   expiresAt: start + 86400000,
   lastValidatedAt: start + 10000,
   errorCode: null,
   inspection: null,
   expired: false,
   cancelRequested: false,
   lifecycle: { mode: 'automatic', state: 'ready', quotaBytes: 2147483648 },
};

async function component(entry: string) {
   const compiled = await build({
      entryPoints: [fileURLToPath(new URL('../src/' + entry, import.meta.url))],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      jsx: 'automatic',
      write: false,
      packages: 'external',
      define: { 'import.meta.env': '{"MODE":"test"}' },
      plugins: [
         {
            name: 'test-boundaries',
            setup(builder: any) {
               builder.onLoad({ filter: /\.scss$/ }, () => ({
                  contents: 'export default new Proxy({}, {get:(_, key)=>String(key)});',
                  loader: 'js',
               }));
               builder.onLoad({ filter: /utils[\\/]helpers\.ts$/ }, () => ({
                  contents: 'export const formatBytes=n=>String(n)+" bytes";',
                  loader: 'js',
               }));
               builder.onLoad({ filter: /services[\\/]databaseRestores\.ts$/ }, () => ({
                  contents: `
            export const useRestorePreview=()=>globalThis.__restorePreview;
            export const restoreRequest=(route,body)=>globalThis.__restoreRequest(route,body);
            export const useDatabaseRestores=()=>({});`,
                  loader: 'js',
               }));
               builder.onLoad({ filter: /services[\\/]recoveryTests\.ts$/ }, () => ({
                  contents: 'export const useRecoveryPreparation=()=>globalThis.__recoveryPreview;',
                  loader: 'js',
               }));
            },
         },
      ],
   });
   const module = { exports: {} as any };
   new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(require, module, module.exports);
   return module.exports;
}
async function mounted(element: any) {
   const node = document.getElementById('root')!,
      root = createRoot(node);
   const render = async (next: any) => {
      await act(async () => {
         root.render(next);
      });
   };
   await render(element);
   return {
      node,
      render,
      async close() {
         await act(async () => root.unmount());
      },
   };
}

test('authoritative duration is smooth, bounded and honest for missing timestamps, terminal jobs and skew', () => {
   assert.equal(elapsedSeconds(start, undefined, start + 1999), 1);
   assert.equal(elapsedSeconds(start, start + 45000, start + 999999), 45);
   assert.equal(elapsedSeconds('invalid', undefined, start), null);
   assert.equal(elapsedSeconds(start, start - 1, start), null);
   assert.equal(elapsedSeconds(start, undefined, start - 1000), 0);
   assert.equal(elapsedLabel(3661), '1:01:01');
   assert.equal(elapsedLabel(null), 'Not recorded');
});
test('all actual stages stay indeterminate; failures and unverified cleanup never become completion', () => {
   for (const stage of [
      'checking-resources',
      'provisioning-container',
      'starting-database',
      'staged-restore',
      'database-import',
      'database-import-validation',
      'database-cleanup',
      'infrastructure-cleanup',
   ]) {
      assert.deepEqual(recoveryProgress({ status: 'running', stage } as any), {
         label: recoveryProgress({ status: 'running', stage } as any).label,
         busy: true,
         complete: false,
      });
   }
   assert.equal(
      recoveryProgress({ status: 'failed', failureCode: 'internal-cleanup-required', result: { cleanup: { infrastructure: false } } } as any)
         .complete,
      false,
   );
   for (const status of ['failed', 'cancelled']) assert.equal(recoveryProgress({ status } as any).complete, false);
   assert.equal(recoveryProgress({ status: 'passed' } as any).complete, true);
   assert.equal(restoreProgress({ ...row, status: 'cleanup_required' }).complete, false);
   assert.equal(restoreProgress({ ...row, status: 'deleting', cancelRequested: true }).busy, true);
   for (const status of ['active', 'stopped']) {
      assert.equal(restoreProgress({ ...row, status, expired: true }).complete, false);
      assert.equal(restoreProgress({ ...row, status, cancelRequested: true }).busy, true);
   }
   assert.match(restoreProgress({ ...row, status: 'stopped' }).label, /explicit Resume/);
   assert.doesNotMatch(restoreActionNotice('resume', true), /Manual operator/);
   assert.match(restoreActionNotice('resume', false), /Manual operator/);
});
test('real recovery modal retains nodes, focus/scroll, one local clock and no network work over polling and completion', async () => {
   const { default: Result } = await component('components/Plan/RecoveryTesting/RecoveryResult.tsx');
   const realNow = Date.now,
      realSet = window.setInterval,
      realClear = window.clearInterval,
      realFetch = globalThis.fetch;
   let now = start + 10000,
      intervalCount = 0,
      network = 0;
   const timers = new Map<number, () => void>();
   Date.now = () => now;
   window.setInterval = ((callback: () => void) => {
      const id = ++intervalCount;
      timers.set(id, callback);
      return id;
   }) as any;
   window.clearInterval = (id: any) => {
      timers.delete(id);
   };
   globalThis.fetch = (async () => {
      network++;
      throw new Error('Unexpected network work');
   }) as any;
   const trigger = document.getElementById('trigger') as HTMLElement;
   trigger.focus();
   const item: any = {
      id: 'test-01',
      backupId: 'backup-01',
      status: 'running',
      stage: 'provisioning-container',
      createdAt: new Date(start).toISOString(),
      startedAt: new Date(start + 1000).toISOString(),
      warnings: [],
      snapshotId: snapshot,
   };
   let closes = 0;
   const props = () => ({
      test: item,
      pending: false,
      close: () => {
         closes++;
      },
      cancel: () => {},
   });
   const view = await mounted(React.createElement(Result, props()));
   try {
      const dialog = document.querySelector('[role="dialog"]')!,
         scroll = dialog.querySelector('.modalChildren') as HTMLElement;
      const cancel = [...dialog.querySelectorAll('button')].find((b: any) => b.textContent.includes('Cancel Recovery')) as HTMLElement;
      cancel.focus();
      scroll.scrollTop = 177;
      for (const stage of ['snapshot-validation', 'staged-restore', 'database-import', 'database-import-validation', 'infrastructure-cleanup']) {
         item.stage = stage;
         await view.render(React.createElement(Result, props()));
         assert.equal(document.querySelector('[role="dialog"]'), dialog);
         assert.equal(document.activeElement, cancel);
         assert.equal(scroll.scrollTop, 177);
         const progress = dialog.querySelector('progress')!;
         assert(!progress.hasAttribute('value'));
         assert(!progress.hasAttribute('aria-valuenow'));
      }
      assert.equal(intervalCount, 1);
      assert.equal(network, 0);
      // Busy progress must not defer the separate stage live region until completion.
      assert.equal(dialog.querySelector('[role="status"]')!.closest('[aria-busy="true"]'), null);
      const status = dialog.querySelector('[role="status"]')!.textContent;
      now += 1000;
      await act(async () => {
         for (const tick of timers.values()) tick();
      });
      assert.match(dialog.textContent!, /0:11/);
      assert.equal(dialog.querySelector('[role="status"]')!.textContent, status);
      now -= 5000;
      await act(async () => {
         for (const tick of timers.values()) tick();
      });
      assert.match(dialog.textContent!, /0:11/);
      item.status = 'passed';
      item.completedAt = new Date(start + 45000).toISOString();
      item.result = { databases: [], cleanup: { workspace: true, databases: true, infrastructure: true } };
      await view.render(React.createElement(Result, props()));
      assert.equal(document.querySelector('[role="dialog"]'), dialog);
      assert.equal(scroll.scrollTop, 177);
      assert.equal(document.activeElement, dialog);
      assert.equal(timers.size, 0);
      assert.match(dialog.textContent!, /0:45/);
      assert.equal(dialog.querySelector('progress')!.getAttribute('value'), '1');
      const close = dialog.querySelector('button') as HTMLElement;
      close.focus();
      await act(async () => {
         close.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
      });
      assert.equal(document.activeElement, close);
      assert.equal(closes, 0);
   } finally {
      await view.close();
      Date.now = realNow;
      window.setInterval = realSet;
      window.clearInterval = realClear;
      globalThis.fetch = realFetch;
   }
   assert.equal(document.activeElement, trigger);
});
test('real wizard keeps edited fields/acknowledgements on polling, resets approval on changed metadata without remounting, and guards pending close', async () => {
   const { default: Wizard } = await component('components/Restore/DatabaseRestore/DatabaseRestoreWizard.tsx');
   let refreshes = 0,
      closes = 0,
      resolve: any,
      submitted: any;
   const state: any = {
      data: structuredClone(preview),
      isFetching: false,
      error: null,
      dataUpdatedAt: 1,
      refetch: () => {
         refreshes++;
      },
   };
   (globalThis as any).__restorePreview = state;
   (globalThis as any).__restoreRequest = (_route: any, body: any) => {
      submitted = body;
      return new Promise((done) => {
         resolve = done;
      });
   };
   const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } } });
   const element = () =>
      React.createElement(
         QueryClientProvider,
         { client },
         React.createElement(
            MemoryRouter,
            null,
            React.createElement(Wizard, {
               selection: { planId: preview.planId, backupId: preview.backupId, snapshotId: snapshot },
               close: () => closes++,
            }),
         ),
      );
   const view = await mounted(element());
   try {
      const dialog = document.querySelector('[role="dialog"]')!,
         scroll = dialog.querySelector('.modalChildren') as HTMLElement;
      const selects = dialog.querySelectorAll('select'),
         retention = selects[selects.length - 1] as HTMLSelectElement;
      await act(async () => {
         retention.value = '21600';
         retention.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
         for (const input of dialog.querySelectorAll('input[type="checkbox"]')) (input as HTMLElement).click();
      });
      const inputs = [...dialog.querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[];
      const refresh = [...dialog.querySelectorAll('button')].find((b: any) => b.textContent.includes('Refresh verification')) as HTMLButtonElement;
      const warning = dialog.querySelector('[aria-label="Internal database resource safety"]')!;
      assert.equal(warning.getAttribute('data-resource-state'), 'warning');
      refresh.focus();
      scroll.scrollTop = 200;
      state.isFetching = true;
      await view.render(element());
      assert.equal(document.querySelector('[role="dialog"]'), dialog);
      assert.equal(dialog.querySelectorAll('select')[selects.length - 1], retention);
      assert.equal(document.activeElement, refresh);
      assert.equal(scroll.scrollTop, 200);
      assert.equal(dialog.querySelector('[aria-label="Internal database resource safety"]'), warning);
      assert.equal(warning.getAttribute('data-resource-state'), 'checking');
      assert(dialog.querySelector('[aria-label="Request activity"] progress'));
      state.isFetching = false;
      state.dataUpdatedAt++;
      await view.render(element());
      assert.equal(retention.value, '21600');
      assert(inputs.every((input) => input.checked));
      const savedResources = state.data.resources;
      state.data = { ...state.data, resources: { ...savedResources, sample: { ...savedResources.sample, available: 1024 } } };
      await view.render(element());
      assert.equal(warning.getAttribute('data-resource-state'), 'blocked');
      assert((dialog.querySelector('button[aria-describedby]') as HTMLButtonElement).disabled);
      assert.equal(document.activeElement, refresh);
      assert.equal(scroll.scrollTop, 200);
      assert(inputs.every((input) => input.checked));
      state.data = { ...state.data, resources: savedResources };
      state.data = { ...state.data, metadataToken: 'changed-token' };
      await view.render(element());
      assert.equal(document.activeElement, refresh);
      assert.equal(scroll.scrollTop, 200);
      assert(inputs.every((input) => !input.checked));
      const confirm = [...dialog.querySelectorAll('button')].find((b: any) => b.textContent.includes('Confirm persistent')) as HTMLButtonElement;
      assert(confirm.disabled);
      assert.equal(refreshes, 0);
      await act(async () => {
         for (const input of inputs) input.click();
      });
      await act(async () => {
         confirm.click();
      });
      assert.equal(submitted.metadataToken, 'changed-token');
      assert.equal(submitted.ttlSeconds, 21600);
      assert.equal(submitted.databaseId, 'db_example');
      assert(dialog.querySelector('[aria-label="Request activity"] progress'), 'submission immediately shows indeterminate activity');
      assert.match(dialog.querySelector('[aria-label="Request activity"]')!.textContent!, /awaiting server acceptance/);
      const close = dialog.querySelector('[aria-label="Close dialog"]') as HTMLButtonElement;
      assert(close.disabled);
      await act(async () => {
         close.click();
         window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' }));
      });
      assert.equal(closes, 0);
      assert.equal(document.querySelector('[role="dialog"]'), dialog);
      await act(async () => {
         resolve({ id: 'c'.repeat(24) });
      });
      assert.deepEqual(client.getQueryData(['databaseRestores', 'c'.repeat(24)]), { id: 'c'.repeat(24) });
   } finally {
      await view.close();
      client.clear();
      delete (globalThis as any).__restorePreview;
      delete (globalThis as any).__restoreRequest;
   }
});
test('recovery confirmation preserves form/focus through refresh and rejects stale acknowledgement without remounting', async () => {
   const { default: Confirmation } = await component('components/Plan/RecoveryTesting/RecoveryConfirmation.tsx');
   const state: any = {
      data: {
         ...preview,
         lifecycle: 'automatic',
         policy: { databaseImport: 'required', targetModes: { mariadb: 'internal' } },
         workloads: { backup: false, restore: false, recovery: false },
         customTargets: [],
         internalTargets: [{ engine: 'mariadb', mode: 'automatic', status: 'ready', admission: { status: 'admitted' } }],
      },
      isFetching: false,
      error: null,
      refetch() {},
   };
   (globalThis as any).__recoveryPreview = state;
   let closes = 0,
      submissions = 0;
   const element = (pending = false) =>
      React.createElement(Confirmation, {
         planId: preview.planId,
         backupId: preview.backupId,
         snapshotId: snapshot,
         operation: 'test',
         pending,
         close: () => closes++,
         confirm: () => submissions++,
      });
   const view = await mounted(element());
   try {
      const dialog = document.querySelector('[role="dialog"]')!,
         scroll = dialog.querySelector('.modalChildren') as HTMLElement;
      const checks = [...dialog.querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[];
      const approval = checks[checks.length - 1];
      await act(async () => approval.click());
      approval.focus();
      scroll.scrollTop = 180;
      const run = [...dialog.querySelectorAll('button')].find((button: any) => button.textContent.includes('Run Recovery')) as HTMLButtonElement;
      const warning = dialog.querySelector('[aria-label="Internal database resource safety"]')!;
      assert.equal(run.disabled, false);
      state.isFetching = true;
      await view.render(element());
      assert(run.disabled);
      assert.equal(warning.getAttribute('data-resource-state'), 'checking');
      assert.equal(dialog.querySelector('[aria-label="Internal database resource safety"]'), warning);
      state.isFetching = false;
      await view.render(element());
      assert(approval.checked);
      const healthy = state.data.resources;
      state.data.resources = { ...healthy, sample: { ...healthy.sample, available: 1024 } };
      await view.render(element());
      assert(run.disabled);
      assert.equal(warning.getAttribute('data-resource-state'), 'blocked');
      assert.equal(document.activeElement, approval);
      assert.equal(scroll.scrollTop, 180);
      assert(approval.checked);
      state.data.resources = healthy;
      await view.render(element());
      state.data = { ...state.data, metadataToken: 'rechecked-metadata' };
      await view.render(element());
      assert.equal(document.querySelector('[role="dialog"]'), dialog);
      assert.equal(dialog.querySelectorAll('input[type="checkbox"]')[checks.length - 1], approval);
      assert.equal(document.activeElement, approval);
      assert.equal(scroll.scrollTop, 180);
      assert.equal(approval.checked, false);
      assert(run.disabled);
      assert.match(dialog.textContent!, /automatically provisions/);
      await view.render(element(true));
      await act(async () => {
         (dialog.querySelector('[aria-label="Close dialog"]') as HTMLButtonElement).click();
         window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' }));
      });
      assert.equal(closes, 0);
      assert.equal(submissions, 0);
   } finally {
      await view.close();
      delete (globalThis as any).__recoveryPreview;
   }
});

test('retained status polling preserves deletion input/control nodes and distinguishes current host state from historical import stage', async () => {
   const { RestoreDetails } = await component('routes/DatabaseRestores/DatabaseRestores.tsx');
   const changes: any[] = [];
   const actRow = (...args: any[]) => changes.push(args);
   const view = await mounted(React.createElement(RestoreDetails, { row, act: actRow, pending: false }));
   try {
      const input = document.querySelector('[aria-label="Restore ID confirmation"]') as HTMLInputElement;
      input.focus();
      const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!;
      await act(async () => {
         setter.call(input, row.id);
         input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      });
      const control = [...view.node.querySelectorAll('button')].find((b: any) => b.textContent.includes('Request stop'));
      const stopped = { ...row, status: 'stopped', lifecycle: { ...row.lifecycle, state: 'stopped' } };
      for (let i = 0; i < 5; i++) await view.render(React.createElement(RestoreDetails, { row: stopped, act: actRow, pending: false }));
      assert.equal(document.querySelector('[aria-label="Restore ID confirmation"]'), input);
      assert.equal(document.activeElement, input);
      assert.equal(input.value, row.id);
      assert.equal(
         [...view.node.querySelectorAll('button')].find((b: any) => b.textContent.includes('Request resume')),
         control,
      );
      assert.match(view.node.textContent!, /Historical import stage/);
      assert.match(view.node.textContent!, /Current host state: Container stopped/);
      assert.doesNotMatch(view.node.textContent!, /Manual operator action is still required/);
      assert.equal(changes.length, 0);
   } finally {
      await view.close();
   }
});
test('progress does not add query polling or key dialogs by polling timestamps; stable layout is opt-in and motion-aware', () => {
   for (const service of ['databaseRestores', 'recoveryTests'])
      assert.match(fs.readFileSync(new URL(`../src/services/${service}.ts`, import.meta.url), 'utf8'), /5000/);
   for (const file of ['components/Restore/DatabaseRestore/DatabaseRestoreWizard.tsx', 'components/Plan/RecoveryTesting/RecoveryConfirmation.tsx']) {
      const source = fs.readFileSync(new URL('../src/' + file, import.meta.url), 'utf8');
      assert.doesNotMatch(source, /key=\{[^\n]*(?:metadataToken|dataUpdatedAt)/);
      assert.match(source, /stableLayout/);
   }
   const css = fs.readFileSync(new URL('../src/components/common/Modal/Modal.module.scss', import.meta.url), 'utf8');
   assert.match(css, /\.modal\.stableLayout/);
   assert.match(css, /scrollbar-gutter: stable/);
   assert.match(css, /overflow-anchor: none/);
   assert.match(css, /prefers-reduced-motion/);
});

test('request banner distinguishes checking, sending, idle and failure without fake progress or added timers', async () => {
   const { RequestActivity } = await component('components/common/OperationProgress/OperationProgress.tsx');
   const view = await mounted(React.createElement(RequestActivity, { checking: true, submitting: false }));
   try {
      const banner = view.node.querySelector('[aria-label="Request activity"]')!;
      assert.match(banner.textContent!, /Checking snapshot/);
      assert.equal(banner.querySelector('progress')!.hasAttribute('value'), false);
      await view.render(React.createElement(RequestActivity, { checking: false, submitting: true }));
      assert.equal(view.node.querySelector('[aria-label="Request activity"]'), banner);
      assert.match(banner.textContent!, /awaiting server acceptance/);
      await view.render(React.createElement(RequestActivity, { checking: false, submitting: false, failed: true }));
      assert.equal(banner.querySelector('progress'), null);
      assert.match(banner.textContent!, /failed/);
      await view.render(React.createElement(RequestActivity, { checking: false, submitting: false }));
      assert.equal(banner.querySelector('progress'), null);
      assert.match(banner.textContent!, /Blocked is not a background check/);
   } finally { await view.close(); }
});
