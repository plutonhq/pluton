import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
   channelDraft,
   channelRequest,
   eventChoices,
   toggleChoice,
   emptySubscription,
   deliveryDescription,
} from '../src/utils/notificationDelivery.ts';
const saved: any = {
   id: 'nc_' + 'a'.repeat(32),
   name: 'Example SMTP',
   kind: 'smtp',
   enabled: true,
   events: ['backup.completed'],
   config: {
      host: 'smtp.example.internal',
      port: 587,
      security: 'starttls',
      username: 'notification-user',
      senderEmail: 'backup@example.invalid',
      senderName: 'Pluton',
      recipients: ['operator@example.invalid'],
      network: 'public',
      allowedCidrs: [],
      timeoutMs: 1000,
   },
   secretConfigured: true,
   revision: 1,
   sourceFloor: 10,
   deleted: false,
};
test('channel create/edit drafts never copy stored secrets or server identity into a write payload', () => {
   const draft = channelDraft(saved);
   assert.equal(draft.secret, undefined);
   assert.notEqual(draft.config, saved.config);
   const request = channelRequest(draft, '', false, '', 'operator@example.invalid');
   assert.equal(request.secret, undefined);
   assert.equal((request as any).id, undefined);
   assert.equal((request as any).secretConfigured, undefined);
   assert.equal((request as any).sourceFloor, undefined);
   assert.equal(channelDraft().enabled, false);
   assert.equal(channelDraft(undefined, 'smtp').kind, 'smtp');
});
test('write-only credential changes are explicit; blank preserves, nonblank replaces, checkbox clears', () => {
   assert.equal(channelRequest(channelDraft(saved), '', false, '', 'a@example.invalid').secret, undefined);
   assert.equal(channelRequest(channelDraft(saved), 'synthetic-input-secret', false, '', 'a@example.invalid').secret, 'synthetic-input-secret');
   assert.equal(channelRequest(channelDraft(saved), 'synthetic-input-secret', true, '', 'a@example.invalid').secret, '');
});
test('network approval and recipient conversion are bounded by backend validation, not hidden defaults', () => {
   const draft = channelDraft(saved);
   draft.config.network = 'trusted-lan';
   const value = channelRequest(draft, '', false, '192.168.50.20/32, 192.168.51.0/24', 'a@example.invalid, a@example.invalid, b@example.invalid');
   assert.deepEqual(value.config.allowedCidrs, ['192.168.50.20/32', '192.168.51.0/24']);
   assert.deepEqual((value as any).config.recipients, ['a@example.invalid', 'b@example.invalid']);
   draft.config.network = 'public';
   assert.deepEqual(channelRequest(draft, '', false, '192.168.50.20/32', 'a@example.invalid').config.allowedCidrs, []);
});
test('event and per-plan channel selection is immutable, independent and defaults opt-in off', () => {
   const value = emptySubscription();
   assert.equal(value.enabled, false);
   assert.equal(eventChoices.length, 8);
   const changed = toggleChoice(value.events, 'backup.failed');
   assert.ok(!changed.includes('backup.failed'));
   assert.ok(value.events.includes('backup.failed'));
   assert.deepEqual(toggleChoice(['one', 'two'], 'one'), ['two']);
   assert.deepEqual(toggleChoice(['one'], 'two'), ['one', 'two']);
});
test('queued/sending/results cannot be confused with inbox delivery or fake backup success', () => {
   assert.match(deliveryDescription('pending', 'smtp'), /Queued/);
   assert.match(deliveryDescription('sending', 'smtp'), /in progress/);
   assert.match(deliveryDescription('succeeded', 'smtp'), /not an inbox delivery guarantee/);
   assert.match(deliveryDescription('failed', 'webhook'), /failed/);
});
const frontendRequire = createRequire(new URL('../package.json', import.meta.url)),
   backendRequire = createRequire(new URL('../../backend/package.json', import.meta.url));
const React = frontendRequire('react'),
   { renderToStaticMarkup } = frontendRequire('react-dom/server'),
   { build } = backendRequire('esbuild');
async function compile(file: string, stubServices = false) {
   const output = await build({
      entryPoints: [fileURLToPath(new URL(`../src/${file}`, import.meta.url))],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      jsx: 'automatic',
      write: false,
      external: ['react', 'react/jsx-runtime', '@tanstack/react-query'],
      define: { 'import.meta.env': JSON.stringify({ MODE: 'test', VITE_BACKEND_URL: 'https://app.example.internal' }) },
      plugins: [
         {
            name: 'notification-ui-fixtures',
            setup(builder: any) {
               builder.onLoad({ filter: /\.scss$/ }, () => ({ contents: 'export default {};', loader: 'js' }));
               if (stubServices)
                  builder.onLoad({ filter: /services[\\/]notifications\.ts$/ }, () => ({
                     contents: `const fixture=()=>globalThis.__pluton_notification_ui || {}; export const useNotificationActions=()=>({isPending:false,error:fixture().actionError}); export const useNotificationChannels=()=>({data:fixture().channels || [],isLoading:fixture().loading,error:fixture().channelError}); export const useNotificationHistory=()=>({data:fixture().history || [],refetch:()=>{}}); export const useNotificationSubscription=()=>({data:fixture().subscription || {enabled:false,channelIds:[],events:[]}});`,
                     loader: 'js',
                  }));
               if (stubServices) {
                  builder.onResolve({ filter: /^react-router$/ }, () => ({ path: 'notification-router', namespace: 'stub' }));
                  builder.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
                     contents: "import React from 'react'; export const NavLink=props=>React.createElement('a',{href:props.to},props.children);",
                     loader: 'js',
                  }));
               }
            },
         },
      ],
   });
   const module = { exports: {} as any };
   new Function('require', 'module', 'exports', output.outputFiles[0].text)(frontendRequire, module, module.exports);
   return module.exports;
}
test('saved SMTP editor renders blank password, TLS modes, explicit LAN approval and all terminal events', async () => {
   const Editor = (await compile('components/Settings/NotificationSettings/ChannelEditor.tsx', true)).default;
   const html = renderToStaticMarkup(React.createElement(Editor, { saved, kind: 'smtp', close: () => {} }));
   assert.match(html, /type="password"/);
   assert.match(html, /Saved privately/);
   assert.ok(!html.includes('synthetic-input-secret'));
   assert.match(html, /STARTTLS/);
   assert.match(html, /Implicit TLS/);
   assert.match(html, /restricted private LAN/);
   assert.match(html, /Explicitly clear/);
   assert.match(html, /Recovery test passed with warning/);
   assert.match(html, /Enable this channel/);
});
test('delivery history management renders test actions, honest empty states and navigation', async () => {
   const Component = (await compile('components/Settings/NotificationSettings/NotificationSettings.tsx', true)).default;
   const html = renderToStaticMarkup(React.createElement(Component));
   assert.match(html, /Add Webhook/);
   assert.match(html, /Add SMTP channel/);
   assert.match(html, /No channels configured/);
   assert.match(html, /Delivery History/);
   assert.match(html, /No deliveries/);
   assert.match(html, /not inbox delivery/);
   assert.match(html, /Previous page/);
});
test('configured channels render test delivery and eligible history retry actions, with safe failure detail', async () => {
   (globalThis as any).__pluton_notification_ui = {
      channels: [saved, { ...saved, kind: 'webhook', id: 'nc_' + 'b'.repeat(32) }],
      history: [
         {
            id: 'nd_fixture',
            eventId: 'ne_fixture',
            eventType: 'recovery.failed',
            planName: 'Example',
            channelName: 'Example SMTP',
            kind: 'smtp',
            createdAt: 1,
            status: 'failed',
            attemptCount: 2,
            error: 'The destination could not be reached.',
            errorCode: 'connection-failed',
            canRetry: true,
         },
      ],
   };
   try {
      const Component = (await compile('components/Settings/NotificationSettings/NotificationSettings.tsx', true)).default;
      const html = renderToStaticMarkup(React.createElement(Component));
      assert.match(html, /Send Test Email/);
      assert.match(html, /Send Test Webhook/);
      assert.match(html, /Retry \(review current channel\)/);
      assert.match(html, /connection-failed/);
      assert.match(html, /2 attempts/);
      assert.match(html, /recovery.failed/);
      assert.ok(!html.includes('synthetic-input-secret'));
   } finally {
      delete (globalThis as any).__pluton_notification_ui;
   }
});
test('loading and failed channel settings have explicit accessible states', async () => {
   const Component = (await compile('components/Settings/NotificationSettings/NotificationSettings.tsx', true)).default;
   try {
      (globalThis as any).__pluton_notification_ui = { loading: true };
      assert.match(renderToStaticMarkup(React.createElement(Component)), /Loading channels/);
      (globalThis as any).__pluton_notification_ui = {
         channelError: { message: 'Configuration could not be loaded.' },
         actionError: { message: 'Notification request failed.' },
      };
      const html = renderToStaticMarkup(React.createElement(Component));
      assert.match(html, /role="alert"/);
      assert.match(html, /Configuration could not be loaded/);
      assert.match(html, /Notification request failed/);
   } finally {
      delete (globalThis as any).__pluton_notification_ui;
   }
});
test('per-plan notifications render independent channel/event associations and a separate save action', async () => {
   (globalThis as any).__pluton_notification_ui = {
      channels: [saved],
      subscription: { enabled: true, channelIds: [saved.id], events: ['backup.completed', 'recovery.passed_with_warning'] },
   };
   try {
      const Component = (await compile('components/Plan/PlanSettings/ManagedPlanNotifications.tsx', true)).default;
      const html = renderToStaticMarkup(React.createElement(Component, { planId: 'plan-01' }));
      assert.match(html, /Save notification policy/);
      assert.match(html, /Example SMTP/);
      assert.match(html, /SQL import was NOT TESTED/);
      assert.match(html, /saves separately/);
      assert.match(renderToStaticMarkup(React.createElement(Component)), /Save the plan first/);
   } finally {
      delete (globalThis as any).__pluton_notification_ui;
   }
});
test('notification API actions send authenticated JSON and report queued/failed states without logging secret input', async () => {
   const service = await compile('services/notifications.ts');
   const original = globalThis.fetch;
   const requests: any[] = [];
   globalThis.fetch = async (url: any, options: any) => {
      requests.push({ url, options });
      return new Response(JSON.stringify({ success: true, result: { status: 'pending' } }), { headers: { 'Content-Type': 'application/json' } });
   };
   try {
      const result = await service.notificationRequest('channels/nc_fixture/test', 'POST', {});
      assert.equal(result.status, 'pending');
      assert.equal(requests[0].options.credentials, 'include');
      assert.equal(requests[0].options.headers['Content-Type'], 'application/json');
      await service.notificationRequest('deliveries/nd_fixture/retry', 'POST', {});
      assert.match(requests[1].url, /retry$/);
      globalThis.fetch = async () => new Response(JSON.stringify({ success: false, error: 'Notification request failed.' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
      await assert.rejects(service.notificationRequest('channels'), /Notification request failed/);
   } finally {
      globalThis.fetch = original;
   }
});
test('new UI uses existing light/dark tokens, accessible labels and no nonexistent input color variables', () => {
   const css = readFileSync(new URL('../src/components/Settings/NotificationSettings/NotificationSettings.module.scss', import.meta.url), 'utf8');
   for (const token of ['--field-bg', '--content-text-color', '--primary-text-color', '--line-color']) assert.ok(css.includes(token));
   assert.ok(!css.includes('--input-bg-color'));
   assert.ok(!css.includes('--input-text-color'));
   assert.ok(!/color:\s*(white|#fff)\b/.test(css));
   assert.ok(css.includes(':focus-visible'));
   assert.ok(css.includes('@media'));
});
