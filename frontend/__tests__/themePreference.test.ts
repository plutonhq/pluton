import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { persistThemeSetting, readThemeSetting, resolveTheme } from '../src/utils/theme.ts';

test('Light/Dark explicit preferences override the OS and System follows both OS states', () => {
   for (const setting of ['light', 'dark'] as const) {
      assert.equal(resolveTheme(setting, false), setting);
      assert.equal(resolveTheme(setting, true), setting);
   }
   assert.equal(resolveTheme('auto', true), 'dark');
   assert.equal(resolveTheme('auto', false), 'light');
});
test('theme preference persists using one canonical key, retains old installations and tolerates restricted storage', () => {
   const map = new Map([['theme', 'dark']]);
   const storage = {
      getItem: (key: string) => map.get(key) || null,
      setItem: (key: string, value: string) => {
         map.set(key, value);
      },
   };
   assert.equal(readThemeSetting(storage), 'dark');
   persistThemeSetting(storage, 'light');
   assert.equal(map.get('themeSetting'), 'light');
   assert.equal(readThemeSetting(storage), 'light');
   persistThemeSetting(storage, 'auto');
   assert.equal(readThemeSetting(storage), 'auto');
   const blocked = {
      getItem() {
         throw Error('blocked');
      },
      setItem() {
         throw Error('blocked');
      },
   };
   assert.equal(readThemeSetting(blocked), 'auto');
   assert.doesNotThrow(() => persistThemeSetting(blocked, 'dark'));
});
const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const bootstrap = index.match(/<script>([\s\S]*?)<\/script>/)![1];
test('before-paint bootstrap agrees with provider preferences and never applies unvalidated theme values', () => {
   for (const [stored, legacy, dark] of [
      ['light', 'dark', true],
      ['dark', 'light', false],
      ['auto', 'light', true],
      ['invalid', null, false],
      [null, 'dark', false],
   ] as const) {
      let applied = '';
      const storage = { getItem: (key: string) => (key === 'themeSetting' ? stored : legacy) };
      runInNewContext(bootstrap, {
         window: { localStorage: storage, matchMedia: () => ({ matches: dark }) },
         document: {
            documentElement: {
               setAttribute: (_: string, value: string) => {
                  applied = value;
               },
            },
         },
      });
      assert.equal(applied, resolveTheme(readThemeSetting(storage), dark));
   }
});
test('before-paint theme bootstrap survives localStorage getter rejection', () => {
   let applied = '';
   const window = {
      get localStorage() {
         throw new Error('denied');
      },
      matchMedia: () => ({ matches: true }),
   };
   runInNewContext(bootstrap, {
      window,
      document: {
         documentElement: {
            setAttribute: (_: string, value: string) => {
               applied = value;
            },
         },
      },
   });
   assert.equal(applied, 'dark');
});
test('theme changes track OS events only in System mode; date/filter/table/modal surfaces use shared palette and visible focus', () => {
   const provider = readFileSync(new URL('../src/context/ThemeContext.tsx', import.meta.url), 'utf8');
   assert.match(provider, /themeSetting === 'auto'/);
   assert.match(provider, /addEventListener\('change', handleChange\)/);
   assert.match(provider, /removeEventListener\('change', handleChange\)/);
   for (const file of [
      'components/Plan/Backups/BackupHistory.module.scss',
      'components/common/Pagination/Pagination.module.scss',
      'components/common/Modal/Modal.module.scss',
   ]) {
      const css = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
      assert.match(css, /var\(--content-text-color\)/);
      assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i);
   }
   const css = readFileSync(new URL('../src/styles/global.scss', import.meta.url), 'utf8');
   assert.match(css, /input:focus-visible/);
   assert.match(css, /select:focus-visible/);
   const app = readFileSync(new URL('../src/components/App/App/App.tsx', import.meta.url), 'utf8');
   assert.match(
      app,
      /if \(!validThemeSetting\(currentLocalSetting\)\)/,
      'explicit local choices must not be overwritten by a later settings response',
   );
});

test('shared icon-only actions are named and logout is a native keyboard-operable button', () => {
   for (const [file, label] of [
      ['components/Storage/StorageItem/StorageItem.tsx', 'Storage actions for'],
      ['components/Device/DeviceItem/DeviceItem.tsx', 'Source actions for'],
      ['components/Plan/PlanItems/PlanItem.tsx', 'Plan actions for'],
      ['routes/PlanSingle/PlanSingle.tsx', 'More plan actions'],
   ]) {
      const source = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
      assert.ok(source.includes(`aria-label={`) || source.includes(`aria-label="${label}"`));
      assert.ok(source.includes(label));
      assert.ok(source.includes('aria-expanded='));
   }
   const nav = readFileSync(new URL('../src/components/App/SideNav/SideNav.tsx', import.meta.url), 'utf8');
   assert.match(nav, /<button type="button".*aria-label="Logout">/);
   const modal = readFileSync(new URL('../src/components/common/Modal/Modal.tsx', import.meta.url), 'utf8');
   assert.match(modal, /<button type="button".*aria-label="Close dialog">/);
});
