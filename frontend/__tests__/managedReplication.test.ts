import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { hasPendingMirrors, mirrorSummary, replicationSettingsError } from '../src/utils/replication.ts';
import type { PlanReplicationSettings } from '../src/@types/plans.ts';

const require = createRequire(new URL('../package.json', import.meta.url));
const backendRequire = createRequire(new URL('../../backend/package.json', import.meta.url));
const React = require('react');
const { act } = React;
const { JSDOM } = require('jsdom');
const destination = (index: number) => ({ replicationId: `replica-${index}`, storageId: `storage-${index}`, storageName: `Replica ${index}`, storagePath: `repository-${index}`, storageType: 's3compatible', addedAt: index });
const settings = (count: number): PlanReplicationSettings => ({ enabled: count > 0, concurrent: false, storages: Array.from({ length: count }, (_, index) => destination(index + 1)) });
const primary = { storageId: 'primary-01', storagePath: 'repository-primary' };

test('0/1/2 destinations retain sequential defaults, and more than 2 are refused even when disabled', () => {
   for (const count of [0, 1, 2]) {
      assert.equal(replicationSettingsError(settings(count), primary, true), undefined);
      assert.equal(settings(count).concurrent, false);
   }
   assert.match(replicationSettingsError(settings(3), primary, true)!, /at most two/);
   assert.match(replicationSettingsError({ ...settings(3), enabled: false }, primary, true)!, /at most two/);
});

test('enabled destination setup rejects missing storage/path, duplicates and primary; standard legacy blank paths remain compatible', () => {
   assert.match(replicationSettingsError({ ...settings(0), enabled: true }, primary, true)!, /at least one/);
   const replica = settings(1);
   replica.storages[0].storageId = '';
   assert.match(replicationSettingsError(replica, primary, true)!, /Select a storage/);
   replica.storages[0] = { ...destination(1), storagePath: '' };
   assert.match(replicationSettingsError(replica, primary, true)!, /dedicated repository path/);
   assert.equal(replicationSettingsError(replica, primary, false), undefined);
   replica.storages[0] = { ...destination(1), storageType: 'sftp' };
   assert.match(replicationSettingsError(replica, primary, true)!, /requires S3 or S3-compatible/);
   assert.equal(replicationSettingsError(replica, primary, false), undefined);
   replica.storages[0] = { ...destination(1), ...primary };
   assert.match(replicationSettingsError(replica, primary, true)!, /primary repository/);
   assert.match(replicationSettingsError({ ...settings(2), storages: [destination(1), destination(1)] }, primary, true)!, /different repository path/);
});

test('primary success never implies complete redundancy; missing destination results remain pending', () => {
   const completed = { ...destination(1), status: 'completed' as const };
   assert.equal(mirrorSummary([completed], 1).incomplete, false);
   assert.match(mirrorSummary([completed], 2).label, /pending/);
   assert.equal(mirrorSummary([], 2).incomplete, true);
   const failed = { ...destination(2), status: 'failed' as const };
   assert.deepEqual(mirrorSummary([completed, failed], 2), { state: 'failed', label: 'Redundancy incomplete: 1/2 mirrors complete', incomplete: true });
});

test('replica history refreshes only while a durable copy is pending or running', () => {
   for (const status of ['completed', 'failed'] as const) assert.equal(hasPendingMirrors([{ mirrors: [{ ...destination(1), status }] }]), false);
   for (const status of ['pending', 'started'] as const) assert.equal(hasPendingMirrors([{ mirrors: [{ ...destination(1), status }] }]), true);
   assert.equal(hasPendingMirrors([]), false);
});

async function component(relative: string) {
   const output = await backendRequire('esbuild').build({
      entryPoints: [fileURLToPath(new URL(`../src/${relative}.tsx`, import.meta.url))],
      bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', write: false,
      external: ['react', 'react/jsx-runtime', 'react-dom'],
      plugins: [{ name: 'replication-ui-boundaries', setup(builder: any) {
         const load = (filter: RegExp, contents: string) => builder.onLoad({ filter }, () => ({ contents, loader: 'js' }));
         load(/\.scss$/, 'export default {};');
         load(/[\\/]utils[\\/]constants\.ts$/, 'export const API_URL="https://example.internal/api";export const APP_NAME="Pluton";export const DEV_MODE=false;');
         load(/[\\/]utils[\\/]index\.ts$/, 'export const formatBytes=value=>String(value);export const formatDuration=value=>String(value);');
         load(/[\\/]Icon\.tsx$/, 'export default ()=>null;');
         load(/[\\/]Modal\.tsx$/, `import React from 'react';export default p=>React.createElement('section',{},p.children);`);
         load(/[\\/]SidePanel\.tsx$/, `import React from 'react';export default p=>React.createElement('section',{},p.children,p.footer);`);
         load(/[\\/]StoragePicker\.tsx$/, `import React from 'react';export default p=>React.createElement('button',{'data-picker':true,'data-device':p.deviceId,'data-required':p.requirePath,'data-allowed':p.allowedStorageTypes?.join(','),disabled:p.disabled,onClick:()=>p.onUpdate({storage:{id:'storage-01',type:'s3compatible',name:'Replica 01'},path:'owned/repository'})},'Select synthetic destination');`);
         load(/[\\/]services[\\/](index|storage)\.ts$/, `
            export const useDeleteReplicationStorage=()=>globalThis.__replication.deleteMutation;
            export const useRetryFailedReplications=()=>globalThis.__replication.retryMutation;
            export const useGetStorage=()=>({data:{success:true,result:globalThis.__replication.storage}});
            export const useUpdateStorage=()=>globalThis.__replication.updateMutation;
            export const startStorageAuthorize=()=>{};export const getStorageAuthorizeStatus=()=>{};export const cancelStorageAuthorize=()=>{};
         `);
         builder.onResolve({ filter: /^react-toastify$/ }, () => ({ path: 'toast', namespace: 'stub' }));
         builder.onResolve({ filter: /^react-router$/ }, () => ({ path: 'router', namespace: 'stub' }));
         builder.onLoad({ filter: /.*/, namespace: 'stub' }, (args: any) => ({ contents: args.path === 'toast'
            ? 'export const toast={error:()=>{},success:()=>{},promise:p=>p};'
            : `import React from 'react';export const Link=p=>React.createElement('a',{href:p.to},p.children);`, loader: 'js' }));
      } }],
   });
   const module = { exports: {} as any };
   const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
   Object.defineProperty(globalThis, 'window', { value: {}, configurable: true });
   try { new Function('require', 'module', 'exports', output.outputFiles[0].text)(require, module, module.exports); }
   finally { previous ? Object.defineProperty(globalThis, 'window', previous) : delete (globalThis as any).window; }
   return module.exports.default;
}
const Settings = await component('components/Plan/PlanSettings/PlanReplicationSettings');
const Details = await component('components/Plan/Mirrors/MirrorDetails');
const Badge = await component('components/Plan/Mirrors/MirrorStatusBadge');
const EditStorage = await component('components/Storage/EditStorage/EditStorage');

async function fixture(Component: any, props: Record<string, unknown>, state: Record<string, unknown> = {}) {
   const dom = new JSDOM('<div id="root"></div>', { url: 'https://example.internal/' });
   const globals = ['window', 'document', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT', '__replication'];
   const previous = globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const);
   const submissions: any[] = [];
   const context = {
      deleteMutation: { isPending: false, reset() {}, mutate: (payload: any) => submissions.push(payload) },
      retryMutation: { isPending: false, mutateAsync: (payload: any) => { submissions.push(payload); return Promise.resolve({ success: true }); } },
      updateMutation: { isPending: false, mutate: (payload: any) => submissions.push(payload) },
      ...state,
   };
   for (const key of globals) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === 'IS_REACT_ACT_ENVIRONMENT' ? true : key === '__replication' ? context : (dom.window as any)[key] });
   const { createRoot } = require('react-dom/client');
   const root = createRoot(dom.window.document.getElementById('root'));
   await act(async () => root.render(React.createElement(Component, props)));
   return { dom, submissions, context, rerender: async () => act(async () => root.render(React.createElement(Component, props))), text: () => dom.window.document.body.textContent || '', button: (text: string) => [...dom.window.document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes(text))!, cleanup: async () => {
      await act(async () => root.unmount());dom.window.close();
      for (const [key, descriptor] of previous) descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete (globalThis as any)[key];
   } };
}

test('actual managed settings use server storage, mandatory path, sequential default and at most two destinations', async () => {
   const view = await fixture(Settings, { replication: settings(2), primaryStorageId: primary.storageId, primaryStoragePath: primary.storagePath, managedAgent: true, deviceId: 'main', maxReplications: 99, onUpdate() {} });
   try {
      assert.equal(view.button('Add Replication Destination'), undefined);
      assert.match(view.text(), /source Agent does not receive replica credentials/);
      assert.match(view.text(), /sequentially by default/);
      assert.equal(view.dom.window.document.querySelectorAll('[data-device="main"][data-required="true"]').length, 2);
      assert.equal(view.dom.window.document.querySelectorAll('[data-allowed="s3,s3compatible"]').length, 2);
      assert.equal(view.dom.window.document.querySelector('input[aria-label="Run replications concurrently"]'), null);
      assert.match(view.text(), /Managed copies are serialized/);
   } finally { await view.cleanup(); }
});

test('actual replica removal defaults to detach/retain and preserved HTTP409 points to database management', async () => {
   const view = await fixture(Settings, { replication: settings(1), primaryStorageId: primary.storageId, deviceId: 'main', isEditing: true, planID: 'plan-01', onUpdate() {} });
   try {
      await act(async () => view.button('Remove').click());
      assert.match(view.text(), /remote repository is retained unless/);
      assert.equal(view.dom.window.document.querySelector<HTMLInputElement>('input[aria-label="Permanently delete this destination\'s owned repository data"]')!.checked, false);
      await act(async () => view.button('Detach and Retain Data').click());
      assert.deepEqual(view.submissions, [{ planID: 'plan-01', storageID: 'storage-1', storagePath: 'repository-1', replicationId: 'replica-1', removeData: false }]);
      (view.context.deleteMutation as any).error = Object.assign(new Error('Verified cleanup is required.'), { status: 409, code: 'RETAINED_DATABASE_RESTORE_DEPENDENCY' });
      await view.rerender();
      assert.equal(view.dom.window.document.querySelector('[role="alert"] a')!.getAttribute('href'), '/database-restores');
      assert.equal(view.submissions.length, 1);
   } finally { await view.cleanup(); }
});

test('managed replica removal offers only detach and never sends physical cleanup', async () => {
   const view = await fixture(Settings, { replication: settings(1), primaryStorageId: primary.storageId, deviceId: 'main', managedAgent: true, isEditing: true, planID: 'plan-01', onUpdate() {} });
   try {
      await act(async () => view.button('Remove').click());
      assert.match(view.text(), /Physical cleanup of managed replicas is unavailable/);
      assert.equal(view.dom.window.document.querySelector('input[aria-label="Permanently delete this destination\'s owned repository data"]'), null);
      await act(async () => view.button('Detach and Retain Data').click());
      assert.equal(view.submissions[0].removeData, false);
   } finally { await view.cleanup(); }
});

test('actual mirror details show independent status, exact snapshots, explicit retry and primary-only recovery limitation', async () => {
   const snapshot = 'a'.repeat(64);
   const mirror = { ...destination(1), status: 'failed', sourceSnapshotId: snapshot, attempts: 2, lastErrorCode: 'replication-copy-failed', error: 'Copy did not finish.' };
   const view = await fixture(Details, { mirrors: [mirror], managedAgent: true, replicationSettings: settings(1), planId: 'plan-01', backupId: 'backup-01', close() {} });
   try {
      assert.match(view.text(), /successful primary backup does not confirm replica protection/);
      assert.match(view.text(), /Direct restore from a mirror is unavailable/);
      assert.match(view.text(), new RegExp(snapshot));
      assert.match(view.text(), /Attempts: 2/);
      assert.match(view.text(), /replication-copy-failed/);
      assert.equal(view.submissions.length, 0);
      await act(async () => view.button('Retry').click());
      assert.deepEqual(view.submissions, [{ backupId: 'backup-01', planId: 'plan-01', replicationId: 'replica-1' }]);
   } finally { await view.cleanup(); }
});

test('actual missing mirror badge warns instead of showing success or hiding the destination', async () => {
   const view = await fixture(Badge, { mirrors: [], replicationSettings: settings(1), planId: 'plan-01', backupId: 'backup-01' });
   try {
      assert.match(view.text(), /Redundancy incomplete/);
      assert.equal(view.dom.window.document.querySelector('button')!.getAttribute('aria-label'), 'Replication pending: 1/1 mirrors incomplete');
   } finally { await view.cleanup(); }
});

test('actual S3 editor retains configured write-only keys without exposing placeholders or requiring reentry', async () => {
   const storage = { id: 'storage-01', name: 'Example S3', type: 's3compatible', storageTypeName: 'S3 compatible', authType: 'client', settings: {}, credentials: {}, credentialsConfigured: ['access_key_id', 'secret_access_key'], tags: [], storageFields: ['access_key_id', 'secret_access_key'].map(value => ({ value, label: value, fieldType: 'password', required: true, authFieldType: 'client', description: '', default: '' })) };
   const view = await fixture(EditStorage, { storage, close() {} }, { storage });
   try {
      assert.match(view.text(), /Leave blank to keep the existing value/);
      assert.equal([...view.dom.window.document.querySelectorAll<HTMLInputElement>('input[type="password"]')].every(input => input.value === ''), true);
      await act(async () => view.button('Update Storage').click());
      assert.equal(view.submissions.length, 1);
      assert.deepEqual(view.submissions[0].data.credentials, {});
   } finally { await view.cleanup(); }
});

test('actual S3 editor still requires missing keys that are not configured', async () => {
   const storage = { id: 'storage-01', name: 'Example S3', type: 's3compatible', storageTypeName: 'S3 compatible', authType: 'client', settings: {}, credentials: {}, credentialsConfigured: [], tags: [], storageFields: [{ value: 'secret_access_key', label: 'Secret key', fieldType: 'password', required: true, authFieldType: 'client', description: '', default: '' }] };
   const view = await fixture(EditStorage, { storage, close() {} }, { storage });
   try {
      await act(async () => view.button('Update Storage').click());
      assert.equal(view.submissions.length, 0);
      assert.match(view.text(), /Required/);
   } finally { await view.cleanup(); }
});
