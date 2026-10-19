import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { rowMenuFocusIndex, rowMenuPosition } from '../src/utils/rowActionMenu.ts';

const require = createRequire(new URL('../package.json', import.meta.url));
const backendRequire = createRequire(new URL('../../backend/package.json', import.meta.url));
const React = require('react');
const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
const compiled = (path: string) => require('sass-embedded').compile(fileURLToPath(new URL(`../src/${path}`, import.meta.url))).css;

test('historical 1200px shell stays centered with original desktop gutter/gap and retained mobile containment', () => {
   assert.match(source('styles/global.scss'), /--container-width: 1200px/);
   const app = compiled('components/App/App/App.module.scss');
   assert.match(app, /justify-content: center/);
   assert.match(app, /padding: 0 20px/);
   assert.match(app, /width: var\(--container-width\)/);
   assert.match(app, /max-width: 100%/);
   assert.match(app, /min-width: 0/);
   assert.match(app, /padding: 0 16px 64px/);
   const content = compiled('components/App/AppContent/AppContent.module.scss');
   assert.match(content, /margin-left: 40px/);
   assert.match(content, /margin-left: 0/);
   assert.match(content, /min-width: 0/);
});

test('one bounded column contract aligns headings/rows and confines narrow scrolling to the table', () => {
   const css = compiled('components/Plan/Backups/Backups.module.scss');
   assert.match(css, /container: backup-rows\s*\/\s*inline-size/);
   assert.match(css, /box-sizing: border-box/);
   assert.match(css, /overflow-x: auto/);
   assert.match(css, /max-width: 100%/);
   assert.match(
      css,
      /grid-template-columns: minmax\(180px, 220px\) minmax\(148px, 156px\) 80px minmax\(90px, 104px\) 124px minmax\(180px, 260px\) 56px/,
   );
   assert.match(css, /grid-template-columns: 160px 148px 80px 90px 124px minmax\(156px, 220px\) 56px/);
   assert.match(css, /grid-template-columns: 160px 148px 80px 90px 124px minmax\(156px, 220px\) 60px/);
   assert.match(css, /padding: 8px/);
   assert.match(css, /justify-content: center/);
   assert.match(css, /@container backup-rows \(max-width: 897px\)/);
   assert.doesNotMatch(css, /width: (900|1560)px/);
   // Only the reserved column space shrinks: full-size targets and symmetric
   // 8px cell padding still fit on desktop, constrained and mobile layouts.
   assert.ok(38 + 16 <= 56);
   assert.ok(44 + 16 <= 60);
});

test('menu hit targets, hover/focus and overlay use canonical Light/Dark tokens, not a clipped row-local absolute popup', () => {
   const css = compiled('components/Plan/Backups/BackupRowMenu.module.scss');
   for (const rule of [
      'width: 38px',
      'height: 38px',
      'width: 44px',
      'height: 44px',
      'position: fixed',
      'max-width: calc(100vw - 16px)',
      'overflow: auto',
   ])
      assert.ok(css.includes(rule), rule);
   for (const token of ['surface-hover', 'content-background-color', 'content-text-color', 'primary-color-foreground', 'line-active-color'])
      assert.ok(css.includes(`var(--${token})`));
   assert.match(css, /:focus-visible/);
   assert.match(css, /:hover:not\(:disabled\)/);
});

test('placement flips the final row upward, clamps the right edge and limits height above mobile navigation', () => {
   const last = rowMenuPosition({ left: 1300, right: 1338, top: 960, bottom: 998 }, { width: 220, height: 190 }, { width: 1366, height: 1050 });
   assert.equal(last.placement, 'top');
   assert.equal(last.top, 764);
   assert.equal(last.left, 1118);
   const mobile = rowMenuPosition(
      { left: 350, right: 394, top: 560, bottom: 604 },
      { width: 240, height: 350 },
      { width: 390, height: 640, bottomInset: 58 },
   );
   assert.equal(mobile.placement, 'top');
   assert.equal(mobile.left, 142);
   assert.ok(mobile.top + Math.min(350, mobile.maxHeight) <= 574);
});

test('menu bounds remain inside all six supported review viewports with short/tall content, first/last/right-edge anchors', () => {
   for (const width of [1366, 1440, 1920, 1024, 768, 390]) {
      const height = 640,
         bottomInset = width <= 768 ? 58 : 0;
      for (const top of [10, 250, 530])
         for (const desiredHeight of [80, 220, 1000]) {
            const menu = { width: Math.min(240, width - 16), height: desiredHeight };
            const result = rowMenuPosition({ left: width - 44, right: width + 2, top, bottom: top + 38 }, menu, { width, height, bottomInset });
            assert.ok(result.left >= 8);
            assert.ok(result.left + menu.width <= width - 8);
            assert.ok(result.top >= 8);
            assert.ok(result.top + Math.min(result.maxHeight, menu.height) <= height - bottomInset - 8);
         }
   }
});

test('menu arrows/Home/End wrap only through available actions and safely handle no enabled action', () => {
   assert.equal(rowMenuFocusIndex('ArrowDown', 3, 4), 0);
   assert.equal(rowMenuFocusIndex('ArrowUp', 0, 4), 3);
   assert.equal(rowMenuFocusIndex('ArrowDown', -1, 4), 0);
   assert.equal(rowMenuFocusIndex('Home', 3, 4), 0);
   assert.equal(rowMenuFocusIndex('End', 0, 4), 3);
   assert.equal(rowMenuFocusIndex('Enter', 0, 4), undefined);
   assert.equal(rowMenuFocusIndex('ArrowDown', 0, 0), undefined);
});

const output = await backendRequire('esbuild').build({
   entryPoints: [fileURLToPath(new URL('../src/components/Plan/Backups/BackupRowMenu.tsx', import.meta.url))],
   bundle: true,
   platform: 'node',
   format: 'cjs',
   jsx: 'automatic',
   write: false,
   external: ['react', 'react/jsx-runtime', 'react-dom'],
   plugins: [
      {
         name: 'row-menu-css',
         setup(builder: any) {
            builder.onLoad({ filter: /\.scss$/ }, () => ({ contents: 'export default {};', loader: 'js' }));
            builder.onLoad({ filter: /[\\/]Icon\.tsx$/ }, () => ({ contents: 'export default () => null;', loader: 'js' }));
         },
      },
   ],
});
function fixture() {
   const refs: any[] = [],
      effects: any[] = [],
      changes: boolean[] = [];
   let cursor = 0,
      position: any,
      focus: any;
   const module = { exports: {} as any };
   const mock = {
      ...React,
      useId: () => 'row-menu-test',
      useRef() {
         const index = cursor++;
         return (refs[index] ??= { current: null });
      },
      useState: () => [
         position,
         (next: any) => {
            position = next;
         },
      ],
      useLayoutEffect: (callback: any) => effects.push(callback),
   };
   new Function('require', 'module', 'exports', output.outputFiles[0].text)(
      (id: string) => (id === 'react' ? mock : id === 'react-dom' ? { createPortal: (element: any) => element } : require(id)),
      module,
      module.exports,
   );
   const render = (open = true, backupId = 'example-01', children: any = React.createElement('button', { onClick() {} }, 'Browse')) => {
      cursor = 0;
      effects.length = 0;
      const tree = module.exports.default({ backupId, open, onOpenChange: (value: boolean) => changes.push(value), children });
      const [trigger, menu] = React.Children.toArray(tree.props.children);
      refs[0].current = {
         focus() {
            focus = 'trigger';
         },
      };
      refs[1].current = {
         querySelectorAll() {
            return [0, 1].map((index) => ({
               focus() {
                  focus = index;
               },
            }));
         },
         contains(target: unknown) {
            return target === 'inside';
         },
      };
      return { trigger, menu };
   };
   return { render, refs, effects, changes, focused: () => focus };
}
function withDocument(run: () => void) {
   const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
   Object.defineProperty(globalThis, 'document', { configurable: true, value: { body: {}, activeElement: null } });
   try {
      run();
   } finally {
      if (previous) Object.defineProperty(globalThis, 'document', previous);
      else Reflect.deleteProperty(globalThis, 'document');
   }
}

test('actual trigger is a named native button with 18px vertical artwork, expanded/controls linkage and native Enter/Space activation', () => {
   const f = fixture(),
      { trigger, menu } = f.render(false);
   assert.equal(menu, undefined);
   assert.equal(trigger.type, 'button');
   assert.equal(trigger.props.type, 'button');
   assert.equal(trigger.props['aria-label'], 'Actions for backup-example-01');
   assert.equal(trigger.props['aria-haspopup'], 'menu');
   assert.equal(trigger.props['aria-expanded'], false);
   assert.equal(trigger.props['aria-controls'], undefined);
   assert.equal(trigger.props.children.props.size, 18);
   assert.equal(trigger.props.children.props.type, 'dots-vertical');
   trigger.props.onClick();
   assert.deepEqual(f.changes, [true]);
   withDocument(() => {
      const expanded = f.render();
      assert.equal(expanded.trigger.props['aria-controls'], expanded.menu.props.id);
      assert.equal(expanded.menu.props['aria-labelledby'], expanded.trigger.props.id);
      assert.equal(expanded.menu.props.role, 'menu');
   });
});

test('actual menu preserves action callbacks, disabled permissions and selected backup identity across new pages', () =>
   withDocument(() => {
      const f = fixture(),
         executed: string[] = [];
      for (const id of ['example-page-1', 'example-page-2']) {
         const { menu } = f.render(true, id, [
            React.createElement('button', { key: 'browse', onClick: () => executed.push(id) }, 'Browse'),
            React.createElement('button', { key: 'disabled', disabled: true }, 'Restore'),
         ]);
         const children = React.Children.toArray(menu.props.children);
         assert.equal(children[0].props.role, 'menuitem');
         assert.equal(children[0].props.tabIndex, -1);
         assert.equal(children[1].props.disabled, true);
         children[0].props.onClick();
      }
      assert.deepEqual(executed, ['example-page-1', 'example-page-2']);
      const parent = source('components/Plan/PlanBackups/PlanBackups.tsx');
      assert.match(parent, /key=\{`\$\{page.page\}\/\$\{page.pageSize\}/);
      assert.match(parent, /backups=\{page.items\}/);
      const rows = source('components/Plan/Backups/Backups.tsx');
      assert.match(rows, /backupId=\{id\}/);
      assert.match(rows, /open=\{showSnapOptions === id\}/);
      assert.match(rows, /backupRowActions\(snapshot, isSync, isRemoteManaged\)/);
      assert.match(rows, /snapshotId: snapshot.completionStats!\.snapshot_id/);
   }));

test('actual menu Escape restores trigger focus, Tab closes without trapping, and blur outside dismisses', () =>
   withDocument(() => {
      const f = fixture(),
         { menu } = f.render();
      let prevented = 0,
         stopped = 0;
      const key = (value: string) =>
         menu.props.onKeyDown({
            key: value,
            preventDefault() {
               prevented++;
            },
            stopPropagation() {
               stopped++;
            },
         });
      key('Escape');
      assert.equal(f.focused(), 'trigger');
      assert.equal(prevented, 1);
      assert.equal(stopped, 1);
      key('Tab');
      assert.equal(prevented, 1, 'native tab order must not be trapped');
      menu.props.onBlur({ currentTarget: f.refs[1].current, relatedTarget: 'inside' });
      assert.deepEqual(f.changes, [false, false]);
      menu.props.onBlur({ currentTarget: f.refs[1].current, relatedTarget: null });
      assert.deepEqual(f.changes, [false, false, false]);
      key('ArrowDown');
      assert.equal(f.focused(), 0);
   }));

test('open overlay updates on table scroll/resize, dismisses outside/offscreen, and removes listeners/observers on unmount', () =>
   withDocument(() => {
      const originals = ['window', 'ResizeObserver', 'requestAnimationFrame', 'cancelAnimationFrame'].map(
         (name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const,
      );
      const listeners = new Map<string, any>();
      let disconnected = 0,
         observed = 0;
      const events = {
         addEventListener: (name: string, fn: any) => listeners.set(name, fn),
         removeEventListener: (name: string) => listeners.delete(name),
      };
      Object.assign(globalThis.document, events, { documentElement: { clientWidth: 1366 } });
      Object.defineProperty(globalThis, 'window', {
         configurable: true,
         value: { ...events, innerWidth: 1366, innerHeight: 1050, matchMedia: () => ({ matches: false }) },
      });
      Object.defineProperty(globalThis, 'ResizeObserver', {
         configurable: true,
         value: class {
            observe() {
               observed++;
            }
            disconnect() {
               disconnected++;
            }
         },
      });
      Object.defineProperty(globalThis, 'requestAnimationFrame', {
         configurable: true,
         value: (fn: () => void) => {
            fn();
            return 1;
         },
      });
      Object.defineProperty(globalThis, 'cancelAnimationFrame', { configurable: true, value: () => {} });
      try {
         const f = fixture();
         f.render();
         let top = 900;
         Object.assign(f.refs[0].current, {
            getBoundingClientRect: () => ({ left: 1250, right: 1288, top, bottom: top + 38 }),
            closest: () => ({ getBoundingClientRect: () => ({ left: 200, right: 1300 }) }),
            contains: (target: any) => target === 'trigger',
         });
         Object.assign(f.refs[1].current, { getBoundingClientRect: () => ({ width: 220 }), scrollHeight: 200 });
         const cleanup = f.effects[0]();
         assert.equal(observed, 2);
         assert.deepEqual([...listeners.keys()], ['resize', 'scroll', 'pointerdown']);
         listeners.get('pointerdown')({ target: 'inside' });
         assert.equal(f.changes.length, 0);
         listeners.get('pointerdown')({ target: 'outside' });
         assert.deepEqual(f.changes, [false]);
         top = -100;
         listeners.get('scroll')();
         assert.deepEqual(f.changes, [false, false]);
         cleanup();
         assert.equal(disconnected, 1);
         assert.equal(listeners.size, 0);
      } finally {
         for (const [name, descriptor] of originals)
            if (descriptor) Object.defineProperty(globalThis, name, descriptor);
            else Reflect.deleteProperty(globalThis, name);
      }
   }));
