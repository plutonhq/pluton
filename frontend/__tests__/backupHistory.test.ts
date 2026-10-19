import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
   displayTimeZone,
   readHistoryState,
   writeHistoryState,
   historyApiQuery,
   historyPreset,
   validateHistoryDates,
   formatHistoryDate,
   historyIsoDate,
   historyRange,
} from '../src/utils/backupHistory.ts';

test('history defaults are bounded and malformed URL preference values cannot create unbounded pages', () => {
   assert.deepEqual(readHistoryState(new URLSearchParams(), 'UTC'), { page: 1, pageSize: 10, startDate: '', endDate: '', timeZone: 'UTC' });
   assert.equal(readHistoryState(new URLSearchParams('historyPage=-1&historyPageSize=100&historyTimeZone=Invalid'), 'UTC').pageSize, 10);
   assert.equal(readHistoryState(new URLSearchParams('historyPage=1e10'), 'UTC').page, 1);
   assert.ok(displayTimeZone());
});
test('pagination URLs preserve filters, unrelated dashboard query state and page size across refresh/back', () => {
   const original = new URLSearchParams(
      'pendingbackup=1&historyPage=3&historyPageSize=50&historyStart=2025-12-31&historyEnd=2026-01-01&historyTimeZone=UTC',
   );
   const state = readHistoryState(original);
   assert.equal(state.page, 3);
   const next = writeHistoryState(original, { ...state, page: 4 });
   assert.equal(next.get('pendingbackup'), '1');
   assert.equal(next.get('historyStart'), '2025-12-31');
   assert.equal(readHistoryState(next).pageSize, 50);
   assert.deepEqual(readHistoryState(original), state, 'back navigation restores original state without mutation');
   assert.equal(historyApiQuery(state).get('pageSize'), '50');
   assert.equal(historyApiQuery(state).has('pendingbackup'), false);
});
test('page-size/filter updates reset page 1 and clear dates without discarding selected zone or unrelated state', () => {
   const original = new URLSearchParams('historyPage=4&historyStart=2025-12-31&historyEnd=2026-01-01&pendingbackup=1');
   const state = readHistoryState(original, 'UTC');
   const changed = writeHistoryState(original, { ...state, page: 1, pageSize: 20 });
   assert.equal(changed.get('historyPage'), '1');
   assert.equal(changed.get('historyStart'), '2025-12-31');
   const cleared = writeHistoryState(changed, { ...readHistoryState(changed), page: 1, startDate: '', endDate: '' });
   assert.equal(cleared.has('historyStart'), false);
   assert.equal(cleared.has('historyEnd'), false);
   assert.equal(cleared.get('historyTimeZone'), 'UTC');
   assert.equal(cleared.get('pendingbackup'), '1');
});
test('calendar validation allows exact days, old/cross-year ranges and optional boundaries but rejects impossible dates', () => {
   for (const [start, end] of [
      ['2026-01-01', '2026-01-01'],
      ['1999-12-31', '2000-01-02'],
      ['', '2026-01-01'],
      ['2026-01-01', ''],
      ['', ''],
   ])
      assert.equal(validateHistoryDates(start, end), undefined);
   for (const [start, end] of [
      ['2026-02-30', ''],
      ['2026-1-1', ''],
      ['2026-02-02', '2026-02-01'],
   ])
      assert.ok(validateHistoryDates(start, end));
});
test('Today/Last 7/Last 30 presets use calendar dates in display zone, including midnight and year transitions', () => {
   const now = new Date('2025-12-31T19:00Z');
   assert.deepEqual(historyPreset(1, 'Asia/Jakarta', now), { startDate: '2026-01-01', endDate: '2026-01-01' });
   assert.deepEqual(historyPreset(7, 'Asia/Jakarta', now), { startDate: '2025-12-26', endDate: '2026-01-01' });
   assert.deepEqual(historyPreset(30, 'UTC', now), { startDate: '2025-12-02', endDate: '2025-12-31' });
   assert.match(formatHistoryDate('2025-12-31T19:00Z', 'Asia/Jakarta'), /Jan 1, 2026/);
});
test('range labels distinguish matching backups from snapshot counts and handle empty/last pages', () => {
   assert.equal(historyRange(1, 10, 37), 'Showing 1–10 of 37 matching backups');
   assert.equal(historyRange(4, 10, 37), 'Showing 31–37 of 37 matching backups');
   assert.equal(historyRange(1, 10, 0), 'Showing 0–0 of 0 matching backups');
});

test('a malformed old display timestamp never crashes history rendering or fabricates today', () => {
   assert.equal(formatHistoryDate(undefined, 'UTC'), 'Not recorded');
   assert.equal(formatHistoryDate('invalid date', 'UTC'), 'Not recorded');
   assert.equal(historyIsoDate('invalid date'), undefined);
   assert.equal(historyIsoDate(0), '1970-01-01T00:00:00.000Z');
});

const frontendRequire = createRequire(new URL('../package.json', import.meta.url));
const backendRequire = createRequire(new URL('../../backend/package.json', import.meta.url));
const React = frontendRequire('react');
const { renderToStaticMarkup } = frontendRequire('react-dom/server');
async function component(relative: string, mockReact?: unknown, isolateHelpers = false) {
   const result = await backendRequire('esbuild').build({
      entryPoints: [fileURLToPath(new URL(`../src/${relative}`, import.meta.url))],
      bundle: true,
      platform: 'node',
      format: 'cjs',
      jsx: 'automatic',
      write: false,
      external: ['react', 'react/jsx-runtime'],
      plugins: [
         {
            name: 'scss-test',
            setup(builder: any) {
               if (isolateHelpers) builder.onResolve({ filter: /\/utils\/helpers$/ }, (args: any) => ({ path: args.path, external: true }));
               builder.onLoad({ filter: /\.scss$/ }, () => ({ contents: 'export default {};', loader: 'js' }));
            },
         },
      ],
   });
   const module = { exports: {} as any };
   new Function('require', 'module', 'exports', result.outputFiles[0].text)(
      (id: string) =>
         id === 'react' && mockReact
            ? mockReact
            : isolateHelpers && id.endsWith('/utils/helpers')
              ? { formatDateTime: String, formatDuration: String }
              : frontendRequire(id),
      module,
      module.exports,
   );
   return module.exports.default;
}
const Pagination = await component('components/common/Pagination/Pagination.tsx');
const Filters = await component('components/Plan/Backups/BackupHistoryFilters.tsx');
const Health = await component('components/Plan/PlanHistory/PlanHistory.tsx', undefined, true);

test('compact health strip retains all 90 outcomes and supplies non-color status information', () => {
   const html = renderToStaticMarkup(
      React.createElement(Health, {
         planId: 'plan-01',
         itemsCount: 90,
         history: Array.from({ length: 90 }, (_, index) => ({
            id: `example-${index}`,
            status: index ? 'completed' : 'failed',
            inProgress: false,
            started: Date.now() - 60000,
            ended: Date.now(),
            duration: 60,
            changes: {},
         })),
      }),
   );
   assert.match(html, /role="img"/);
   assert.match(html, /89 completed, 1 failed/);
   assert.equal((html.match(/data-tooltip-id="htmlToolTip"/g) || []).length, 90);
   const css = readFileSync(new URL('../src/components/Plan/PlanHistory/PlanHistory.module.scss', import.meta.url), 'utf8');
   assert.match(css, /grid-template-columns: repeat\(30/);
   assert.doesNotMatch(css, /height: 160px/);
});
test('real pagination markup has accessible bounded size selector and disabled first/last boundaries', () => {
   for (const total of [0, 1, 10, 11, 50, 51, 237]) {
      const html = renderToStaticMarkup(
         React.createElement(Pagination, {
            page: { page: 1, pageSize: 10, total, totalPages: Math.max(1, Math.ceil(total / 10)), hasPrevious: false, hasNext: total > 10 },
            onPage() {},
            onSize() {},
         }),
      );
      assert.match(html, /aria-label="Backup history pagination"/);
      assert.match(html, /disabled="">Previous/);
      assert.equal((html.match(/<option/g) || []).length, 3);
      assert.match(html, /value="50"/);
      assert.equal(html.includes('disabled="">Next'), total <= 10);
   }
});
test('real date filter renders labels, native themed date controls, exact timezone and Apply/Clear/presets', () => {
   const html = renderToStaticMarkup(
      React.createElement(Filters, { state: { page: 1, pageSize: 10, startDate: '', endDate: '', timeZone: 'UTC' }, apply() {} }),
   );
   for (const text of ['Start date', 'End date', 'Today', 'Last 7 days', 'Last 30 days', 'Apply filter', 'Clear', 'Display time zone', 'UTC'])
      assert.ok(html.includes(text));
   assert.equal((html.match(/type="date"/g) || []).length, 2);
});
test('list data is fetched from scoped bounded API and row actions retain the actual returned backup/snapshot IDs', () => {
   const source = (file: string) => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
   assert.match(source('services/plans.ts'), /encodeURIComponent\(id\)\}\/backups\?\$\{historyApiQuery\(state\)\}/);
   const list = source('components/Plan/PlanBackups/PlanBackups.tsx');
   assert.match(list, /backups=\{page.items\}/);
   assert.doesNotMatch(list, /\.slice\(/);
   assert.match(source('components/Plan/PlanStats/PlanStats.tsx'), /plan.backupChart \?\? plan.backups/);
   const rows = source('components/Plan/Backups/Backups.tsx');
   assert.match(rows, /backupId=\{showRestoreModal.id\}/);
   assert.match(rows, /snapshotId: snapshot.completionStats!\.snapshot_id/);
   assert.match(rows, /planId=\{planId\}/);
});

test('real filter events retain a newly chosen page size, reset page 1, validate drafts and clear only dates', async () => {
   const slots: unknown[] = [];
   let cursor = 0;
   const InteractiveFilters = await component('components/Plan/Backups/BackupHistoryFilters.tsx', {
      ...React,
      useState(initial: unknown) {
         const i = cursor++;
         if (slots.length <= i) slots[i] = initial;
         return [
            slots[i],
            (value: unknown) => {
               slots[i] = value;
            },
         ];
      },
      useRef() {
         return { current: null };
      },
   });
   let state = { page: 3, pageSize: 10, startDate: '', endDate: '', timeZone: 'UTC' };
   let applied: any;
   let applyCount = 0;
   const render = () => {
      cursor = 0;
      return InteractiveFilters({
         state,
         apply: (value: unknown) => {
            applyCount++;
            applied = value;
         },
      });
   };
   const walk = (node: any): any[] =>
      !node || typeof node !== 'object' ? [] : [node, ...React.Children.toArray(node.props?.children).flatMap(walk)];
   render();
   state = { ...state, pageSize: 50, page: 1 }; // Size was changed outside the date form.
   let tree = render();
   walk(tree)
      .find((node) => node.type === 'button' && node.props['aria-label'] === 'Last 7 days')
      .props.onClick();
   assert.equal(applyCount, 1, 'one preset click applies once, without submitting the form');
   assert.equal(applied.pageSize, 50, 'preset must not silently revert to the initial 10 rows');
   assert.equal(applied.page, 1);
   tree = render();
   tree.props.onSubmit({ preventDefault() {} });
   assert.equal(applyCount, 2);
   assert.equal(applied.pageSize, 50, 'Apply must preserve the latest page size too');
   const inputs = walk(tree).filter((node) => node.type === 'input');
   inputs[0].props.onChange({ target: { value: '2026-02-02' } });
   tree = render();
   walk(tree)
      .filter((node) => node.type === 'input')[1]
      .props.onChange({ target: { value: '2026-02-01' } });
   tree = render();
   applied = undefined;
   tree.props.onSubmit({ preventDefault() {} });
   assert.equal(applied, undefined);
   assert.equal(applyCount, 2, 'invalid drafts must not send requests');
   assert.ok(walk(render()).some((node) => node.props?.role === 'alert'));
   walk(render())
      .find((node) => node.type === 'button' && node.props.children === 'Clear')
      .props.onClick();
   assert.deepEqual(applied, { ...state, page: 1, startDate: '', endDate: '' });
   assert.equal(applyCount, 3);
});

test('compact presets identify the applied range, not unsubmitted drafts, in both theme-independent markup and custom URLs', () => {
   for (const days of [1, 7, 30, undefined] as const) {
      const dates = days ? historyPreset(days, 'UTC') : { startDate: '2001-01-01', endDate: '2001-01-02' };
      const html = renderToStaticMarkup(
         React.createElement(Filters, {
            state: { page: 2, pageSize: 50, timeZone: 'UTC', ...dates },
            apply() {},
         }),
      );
      const pressed = [...html.matchAll(/<button\b([^>]*)aria-pressed="true"[^>]*>/g)];
      assert.equal(pressed.length, 1);
      assert.ok(pressed[0][1].includes(`aria-label="${days === 1 ? 'Today' : days ? `Last ${days} days` : 'Custom range'}"`));
      assert.ok(html.includes(`Applied: ${dates.startDate} – ${dates.endDate}`));
   }
   const html = renderToStaticMarkup(
      React.createElement(Filters, {
         state: { page: 1, pageSize: 10, timeZone: 'UTC', startDate: '', endDate: '' },
         apply() {},
      }),
   );
   assert.doesNotMatch(html, /aria-pressed="true"/);
   assert.match(html, /All dates/);
});

test('compact toolbar keeps native labels and keyboard order, accessible info disclosure, visible validation and container-based responsive styling', () => {
   const html = renderToStaticMarkup(
      React.createElement(Filters, {
         state: { page: 1, pageSize: 10, timeZone: 'UTC', startDate: '', endDate: '' },
         apply() {},
      }),
   );
   const labels = [...html.matchAll(/<(?:button|input|summary)\b[^>]*aria-label="([^"]+)"/g)].map((match) => match[1]);
   assert.deepEqual(labels, ['Today', 'Last 7 days', 'Last 30 days', 'Custom range', 'Start date', 'End date', 'Date filter help']);
   assert.match(html, /<details[^>]*><summary aria-label="Date filter help"/);
   assert.match(html, /Both selected calendar days are included in UTC/);
   assert.match(html, /finished time, or started time/);
   assert.match(html, /type="submit"/);
   assert.doesNotMatch(html, /tabindex="[1-9]/i);
   const css = readFileSync(new URL('../src/components/Plan/Backups/BackupHistory.module.scss', import.meta.url), 'utf8');
   assert.match(css, /container: backup-history-filter \/ inline-size/);
   assert.match(css, /@container backup-history-filter \(max-width: 1000px\)/);
   assert.match(css, /height: 36px/);
   assert.match(css, /height: 42px/);
   assert.match(css, /:focus-visible/);
   assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i);
});

test('full-width toolbar gives space to fields, not an auto action spacer, and retains discoverable full applied state', () => {
   const html = renderToStaticMarkup(
      React.createElement(Filters, {
         state: { page: 2, pageSize: 50, timeZone: 'UTC', startDate: '2001-12-31', endDate: '2002-01-02' },
         apply() {},
      }),
   );
   assert.match(html, />Applied<\/span>/);
   assert.match(html, /<strong>Applied: 2001-12-31 – 2002-01-02 · UTC<\/strong>/);
   assert.match(html, /role="status"/);
   const css = readFileSync(new URL('../src/components/Plan/Backups/BackupHistory.module.scss', import.meta.url), 'utf8');
   assert.doesNotMatch(css, /margin-left:\s*auto/);
   assert.match(css, /grid-template-columns: max-content minmax\(174px, 1fr\) minmax\(164px, 1fr\) minmax\(140px, 0.9fr\)/);
   assert.match(css, /max-width: 300px/);
   assert.match(css, /max-width: 280px/);
   assert.match(css, /flex: none/);
   assert.match(css, /\.hint\s*\{[^}]*clip-path: inset\(50%\)/s);
});

test('custom dates and zone stay draft-only until Apply; Custom focus and help Escape/blur never submit or alter URL state', async () => {
   const slots: unknown[] = [];
   let cursor = 0;
   let focusCount = 0;
   const InteractiveFilters = await component('components/Plan/Backups/BackupHistoryFilters.tsx', {
      ...React,
      useState(initial: unknown) {
         const i = cursor++;
         if (slots.length <= i) slots[i] = initial;
         return [
            slots[i],
            (value: unknown) => {
               slots[i] = value;
            },
         ];
      },
      useRef() {
         return {
            current: {
               focus() {
                  focusCount++;
               },
            },
         };
      },
   });
   const original = new URLSearchParams('historyPage=3&historyPageSize=50&historyTimeZone=UTC&pendingbackup=1');
   let state = readHistoryState(original);
   const applied: any[] = [];
   const render = () => {
      cursor = 0;
      return InteractiveFilters({ state, apply: (next: unknown) => applied.push(next) });
   };
   const walk = (node: any): any[] =>
      !node || typeof node !== 'object' ? [] : [node, ...React.Children.toArray(node.props?.children).flatMap(walk)];
   const find = (type: string, label?: string) => walk(render()).find((node) => node.type === type && (!label || node.props['aria-label'] === label));
   find('button', 'Custom range').props.onClick();
   assert.equal(focusCount, 1);
   find('input', 'Start date').props.onChange({ target: { value: '2001-12-31' } });
   find('input', 'End date').props.onChange({ target: { value: '2002-01-02' } });
   find('select').props.onChange({ target: { value: 'Asia/Jakarta' } });
   assert.equal(applied.length, 0);
   assert.ok(walk(render()).some((node) => node.type === 'span' && node.props.children === 'Pending'));
   assert.ok(
      walk(render()).some((node) => node.type === 'strong' && node.props.children === 'All dates · UTC'),
      'Info must show applied state, not draft dates/zone',
   );
   assert.ok(walk(render()).some((node) => node.type === 'span' && node.props.children === ' · Unapplied changes'));
   render().props.onSubmit({ preventDefault() {} });
   assert.deepEqual(applied[0], { ...state, page: 1, startDate: '2001-12-31', endDate: '2002-01-02', timeZone: 'Asia/Jakarta' });
   const url = writeHistoryState(original, applied[0]);
   assert.equal(url.get('pendingbackup'), '1');
   assert.equal(url.get('historyPageSize'), '50');
   assert.equal(url.get('historyPage'), '1');
   state = readHistoryState(url);
   const help = find('details');
   const disclosure = {
      open: true,
      contains() {
         return false;
      },
   };
   let stopped = false;
   help.props.onKeyDown({
      key: 'Escape',
      currentTarget: disclosure,
      stopPropagation() {
         stopped = true;
      },
   });
   assert.equal(disclosure.open, false);
   assert.equal(stopped, true);
   disclosure.open = true;
   help.props.onBlur({ currentTarget: disclosure, relatedTarget: null });
   assert.equal(disclosure.open, false);
   assert.equal(applied.length, 1);
   walk(render())
      .find((node) => node.type === 'button' && node.props.children === 'Clear')
      .props.onClick();
   assert.deepEqual(applied[1], { ...state, page: 1, startDate: '', endDate: '' });
   assert.deepEqual(readHistoryState(original), { page: 3, pageSize: 50, timeZone: 'UTC', startDate: '', endDate: '' });
});
