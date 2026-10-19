import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../package.json', import.meta.url));
const backendRequire = createRequire(new URL('../../backend/package.json', import.meta.url));
const React = require('react');
const { act } = React;
const { createRoot } = require('react-dom/client');
const { JSDOM } = require('jsdom');
const output = await backendRequire('esbuild').build({
   entryPoints: [fileURLToPath(new URL('../src/components/Plan/PlanRemoveModal/PlanRemoveModal.tsx', import.meta.url))],
   bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', write: false, external: ['react', 'react/jsx-runtime', 'react-dom'],
   plugins: [{ name: 'dialog-boundaries', setup(builder: any) {
      builder.onLoad({ filter: /\.scss$/ }, () => ({ contents: 'export default {};', loader: 'js' }));
      builder.onLoad({ filter: /Icon[\\/]Icon\.tsx$/ }, () => ({ contents: 'export default ()=>null;', loader: 'js' }));
      builder.onLoad({ filter: /services[\\/]plans\.ts$/ }, () => ({ contents: `
         import {useState} from 'react';
         export const useDeletePlan=()=>{
            const [pending,setPending]=useState(false);const [error,setError]=useState(null);
            return {isPending:pending,isError:!!error,error,mutate:(payload,callbacks)=>{
               globalThis.__deleteDialog.submissions.push(payload);setPending(true);setError(null);
               globalThis.__deleteDialog.finish=(error,result)=>{
                  setPending(false);setError(error);
                  error?callbacks.onError(error):callbacks.onSuccess(result);
                  callbacks.onSettled?.(result,error);
               };
            }};
         };`, loader: 'js' }));
      builder.onResolve({ filter: /^react-router$/ }, () => ({ path: 'router', namespace: 'stub' }));
      builder.onResolve({ filter: /^react-toastify$/ }, () => ({ path: 'toast', namespace: 'stub' }));
      builder.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: `
         export const useNavigate=()=>path=>globalThis.__deleteDialog.navigation.push(path);
         export const toast={error:value=>globalThis.__deleteDialog.errors.push(value),success:value=>globalThis.__deleteDialog.success.push(value),warning:value=>globalThis.__deleteDialog.warnings.push(value),info:value=>globalThis.__deleteDialog.warnings.push(value)};`, loader: 'js' }));
   } }],
});
const module = { exports: {} as any };
new Function('require', 'module', 'exports', output.outputFiles[0].text)(require, module, module.exports);
const PlanRemoveModal = module.exports.default;

async function render(props: Record<string, unknown> = {}) {
   const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://example.internal' });
   const previous = Object.fromEntries(['window', 'document', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT', '__deleteDialog'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
   const state: any = { submissions: [], navigation: [], errors: [], success: [], warnings: [], closed: 0 };
   for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true, __deleteDialog: state }))
      Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
   const root = createRoot(dom.window.document.getElementById('root'));
   const options = { planId: 'plan-01', taskPending: false, actionInProgress: false, close: () => state.closed++, ...props };
   await act(async () => root.render(React.createElement(PlanRemoveModal, options)));
   const button = () => [...dom.window.document.querySelectorAll('button')].find((node: any) => node.textContent.includes('Yes, Remove Plan'))! as HTMLButtonElement;
   return { dom, state, button, rerender: async (extra: Record<string, unknown>) => act(async () => root.render(React.createElement(PlanRemoveModal, { ...options, ...extra }))), cleanup: async () => {
      await act(async () => root.unmount());dom.window.close();
      for (const [key, descriptor] of Object.entries(previous)) descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete (globalThis as any)[key];
   } };
}

test('actual confirmation defaults storage removal off, submits selected option, blocks duplicate and pending close/toggle', async () => {
   const view = await render();
   try {
      const checkbox = view.dom.window.document.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
      assert.equal(checkbox.checked, false);
      assert.equal(checkbox.getAttribute('aria-label'), 'Remove backup data from the Storage');
      await act(async () => checkbox.click());
      await act(async () => { view.button().click();view.button().click(); });
      assert.deepEqual(view.state.submissions, [{ id: 'plan-01', removeRemoteData: true }]);
      assert.equal(view.button().disabled, true);
      assert.equal(checkbox.disabled, true);
      assert.equal(view.dom.window.document.querySelector<HTMLButtonElement>('button[aria-label="Close dialog"]')?.disabled, true);
      await act(async () => view.dom.window.dispatchEvent(new view.dom.window.KeyboardEvent('keydown', { key: 'Escape' })));
      assert.equal(view.state.closed, 0);
      await act(async () => view.state.finish(null, { success: true }));
      assert.deepEqual(view.state.navigation, ['/']);
      assert.equal(view.state.success.length, 1);
   } finally { await view.cleanup(); }
});

test('uncertain HTTP405 error remains visible and never navigates or claims deleted; fresh manual action can follow', async () => {
   const view = await render();
   try {
      await act(async () => view.button().click());
      assert.equal(view.state.submissions[0].removeRemoteData, false);
      const message = 'Received HTML instead of JSON (HTTP 405). Refresh and check its status before trying again.';
      await act(async () => view.state.finish(new Error(message)));
      assert.equal(view.dom.window.document.querySelector('[role="alert"]')?.textContent, message);
      assert.deepEqual(view.state.navigation, []);
      assert.deepEqual(view.state.success, []);
      assert.equal(view.state.submissions.length, 1);
      assert.equal(view.button().disabled, false);
      // No automatic retry after the failure; the next explicit click is a new action.
      await act(async () => view.button().click());
      assert.equal(view.state.submissions.length, 2);
   } finally { await view.cleanup(); }
});

test('retained restore HTTP409 keeps plan intact and provides an accessible management link without automatic cleanup', async () => {
   const view = await render();
   try {
      await act(async () => view.button().click());
      const error = Object.assign(new Error('Verified database cleanup is required.'), { status: 409, code: 'RETAINED_DATABASE_RESTORE_DEPENDENCY' });
      await act(async () => view.state.finish(error));
      const warning = view.dom.window.document.querySelector('[role="alert"]')!;
      assert.match(warning.textContent || '', /Verified database cleanup is required/);
      assert.match(warning.textContent || '', /complete their verified cleanup/);
      const link = warning.querySelector('a');
      assert.equal(link?.getAttribute('href'), '/database-restores');
      assert.equal(link?.textContent, 'Open Database Restore Management');
      assert.deepEqual(view.state.navigation, []);
      assert.deepEqual(view.state.success, []);
      assert.equal(view.state.submissions.length, 1);
      assert.equal(view.state.closed, 0);
   } finally { await view.cleanup(); }
});

test('unrelated HTTP409 does not suggest database cleanup', async () => {
   const view = await render();
   try {
      await act(async () => view.button().click());
      await act(async () => view.state.finish(Object.assign(new Error('Backup is in progress.'), { status: 409 })));
      assert.equal(view.dom.window.document.querySelector('[role="alert"] a'), null);
      assert.deepEqual(view.state.navigation, []);
      assert.deepEqual(view.state.success, []);
   } finally { await view.cleanup(); }
});

test('remote data retention warning is preserved instead of an unconditional deleted-success toast', async () => {
   const view = await render();
   try {
      await act(async () => view.button().click());
      await act(async () => view.state.finish(null, { success: true, unremovedPaths: [{ storageName: 'Example', storagePath: '/example/retained' }], unremovedReason: 'Manual cleanup required' }));
      assert.equal(view.state.warnings.length, 1);
      assert.equal(view.state.success.length, 0);
      const html = require('react-dom/server').renderToStaticMarkup(view.state.warnings[0]);
      assert.match(html, /Example/);
      assert.match(html, /\/example\/retained/);
      assert.deepEqual(view.state.navigation, ['/']);
   } finally { await view.cleanup(); }
});

test('active backup/restore and existing pending task guard never enqueue deletion', async () => {
   for (const props of [{ taskPending: true }, { actionInProgress: true }]) {
      const view = await render(props);
      try { await act(async () => view.button().click());assert.equal(view.state.submissions.length, 0); }
      finally { await view.cleanup(); }
   }
});

test('typed intentional retention and cleanup failure are not classified by error-message strings', async () => {
   for (const status of ['retained_intentionally', 'cleanup_failed']) {
      const view = await render();
      try {
         await act(async () => view.button().click());
         await act(async () => view.state.finish(null, { success: true,
            storageDisposition: { status, paths: [{ storageName: 'Example', storagePath: '/example/retained' }] },
            unremovedReason: 'ambiguous legacy message',
         }));
         const html = require('react-dom/server').renderToStaticMarkup(view.state.warnings[0]);
         assert.match(html, /Plan Removed/);
         assert.doesNotMatch(html, /ambiguous legacy message/);
         if (status === 'retained_intentionally') {
            assert.match(html, /Repository intentionally retained/);
            assert.match(html, /encrypted recovery credential was archived/);
            assert.doesNotMatch(html, /Storage cleanup failed/);
         } else {
            assert.match(html, /Storage cleanup failed/);
            assert.match(html, /other paths may already have been removed/);
            assert.doesNotMatch(html, /credential was archived/);
         }
      } finally { await view.cleanup(); }
   }
});
