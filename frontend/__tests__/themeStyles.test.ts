import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const require = createRequire(new URL('../package.json', import.meta.url));
const sass = require('sass-embedded');
const postcss = require('postcss');
const sourceRoot = new URL('../src/', import.meta.url);
const css = postcss.parse(sass.compile(fileURLToPath(new URL('styles/global.scss', sourceRoot))).css);
const palettes: Record<string, Record<string, string>> = { light: {}, dark: {} };
css.walkRules((rule: any) => {
   const selector = rule.selector.replace(/['"]/g, '');
   if (selector !== ':root' && selector !== '[data-theme=dark]') return;
   rule.walkDecls((decl: any) => {
      if (!decl.prop.startsWith('--')) return;
      palettes[selector === ':root' ? 'light' : 'dark'][decl.prop] = decl.value;
   });
});

function value(theme: string, token: string): string {
   const raw = palettes[theme][token] ?? palettes.light[token];
   assert.ok(raw, `Missing ${theme} token ${token}`);
   const alias = /^var\((--[\w-]+)\)$/.exec(raw);
   return alias ? value(theme, alias[1]) : raw;
}

function luminance(hex: string): number {
   assert.match(hex, /^#[0-9a-f]{3}([0-9a-f]{3})?$/i);
   const expanded =
      hex.length === 4
         ? hex
              .slice(1)
              .split('')
              .map((part) => part + part)
              .join('')
         : hex.slice(1);
   return [0.2126, 0.7152, 0.0722].reduce((sum, weight, index) => {
      const channel = parseInt(expanded.slice(index * 2, index * 2 + 2), 16) / 255;
      return sum + weight * (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
   }, 0);
}

function contrast(theme: string, text: string, background: string): number {
   const a = luminance(value(theme, text));
   const b = luminance(value(theme, background));
   return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

for (const theme of ['light', 'dark']) {
   test(`${theme}: body, muted text, input values, placeholders and accent text remain readable`, () => {
      for (const foreground of [
         '--content-title-color',
         '--content-subtitle-color',
         '--content-text-color',
         '--content-text-color-light',
         '--primary-color-foreground',
      ]) {
         for (const background of ['--background-color', '--content-background-color', '--field-bg', '--primary-color-light']) {
            const ratio = contrast(theme, foreground, background);
            assert.ok(ratio >= 4.5, `${foreground} on ${background}: ${ratio.toFixed(2)}`);
         }
      }
   });

   test(`${theme}: status labels, active states and solid buttons have readable foregrounds`, () => {
      for (const [text, background] of [
         ['--success-text-color', '--success-bg-color'],
         ['--success-text-color', '--success-bg-color-active'],
         ['--warning-text-color', '--warning-bg-color'],
         ['--error-text-color', '--error-bg-color'],
         ['--error-text-color', '--error-bg-color-active'],
         ['--primary-text-color', '--primary-color'],
         ['--error-active-text', '--error-button-color'],
         ['--progress-text', '--progress-fill'],
      ]) {
         const ratio = contrast(theme, text, background);
         assert.ok(ratio >= 4.5, `${text} on ${background}: ${ratio.toFixed(2)}`);
      }
      assert.ok(contrast(theme, '--content-text-color-light', '--line-color') >= 3, 'Disabled text must remain discernible');
      assert.ok(contrast(theme, '--field-line-color', '--field-bg') >= 3, 'Input boundary must remain discernible');
   });
}

function sourceFiles(directory: URL): URL[] {
   return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const location = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
      return entry.isDirectory() ? sourceFiles(location) : /\.(scss|tsx)$/.test(entry.name) ? [location] : [];
   });
}

test('all frontend color variables reference defined canonical tokens, not accidental aliases', () => {
   const sources = sourceFiles(sourceRoot).map((path) => ({ path, text: readFileSync(path, 'utf8') }));
   const defined = new Set(sources.flatMap(({ text }) => [...text.matchAll(/(--[\w-]+)\s*:/g)].map((match) => match[1])));
   for (const { path, text } of sources) {
      for (const match of text.matchAll(/var\((--[\w-]+)/g)) {
         if (match[1] === '--animation-duration') continue; // Locally supplied as a custom property in AnimatedWrapper.
         assert.ok(defined.has(match[1]), `${fileURLToPath(path)}: undefined ${match[1]}`);
      }
   }
});

test('browser controls use the chosen theme, with inherited text, placeholders and visible focus', () => {
   assert.ok(
      css.nodes.some(
         (rule: any) => rule.selector === ':root' && rule.nodes.some((decl: any) => decl.prop === 'color-scheme' && decl.value === 'light'),
      ),
   );
   assert.ok(
      css.nodes.some(
         (rule: any) =>
            rule.selector?.replace(/['"]/g, '') === '[data-theme=dark]' &&
            rule.nodes.some((decl: any) => decl.prop === 'color-scheme' && decl.value === 'dark'),
      ),
   );
   const controls = css.nodes.find((rule: any) => rule.selector === 'button,\ninput,\nselect,\ntextarea');
   assert.ok(controls.nodes.some((decl: any) => decl.prop === 'color' && decl.value === 'inherit'));
   assert.ok(css.toString().includes('input::placeholder'));
   assert.ok(css.toString().includes('button:focus-visible'));
   assert.equal(value('light', '--primary-color'), '#575aff');
   assert.equal(value('dark', '--primary-color'), '#575aff');
});

function compiled(path: string): any {
   return postcss.parse(sass.compile(fileURLToPath(new URL(path, sourceRoot))).css);
}

test('selected dropdown entries keep on-accent text in Dark and are not overwritten by hover', () => {
   const select = compiled('components/common/form/Select/Select.module.scss');
   const selected = select.nodes.find((rule: any) => rule.selector.endsWith('li.selectedItem'));
   assert.ok(selected.nodes.some((decl: any) => decl.prop === 'color' && decl.value === 'var(--primary-text-color)'));
   assert.ok(select.toString().includes(':hover:not(.selectedItem):not(.disabledItem)'));
   assert.ok(compiled('components/common/form/MultiSelect/MultiSelect.module.scss').toString().includes(':hover:not(.selectedItem)'));
});

test('Phase 4 errors and Phase 5 controls use the existing error/field/card palette', () => {
   for (const path of ['components/Device/AgentEnrollment/AgentEnrollment.module.scss', 'components/Device/AgentStatus/AgentStatus.module.scss']) {
      const error = compiled(path).nodes.find((rule: any) => rule.selector === '.error');
      assert.ok(error.nodes.some((decl: any) => decl.prop === 'color' && decl.value === 'var(--error-text-color)'));
   }
   const lifecycle = compiled('components/Plan/PlanSettings/PlanRemoteLifecycleSettings.module.scss').toString();
   assert.ok(lifecycle.includes('background: var(--field-bg)'));
   assert.ok(lifecycle.includes('background: var(--content-background-color)'));
   assert.ok(lifecycle.includes('border: 1px solid var(--field-line-color)'));
});

test('status badges, selected files and toast surfaces no longer bypass the shared palette', () => {
   const global = css.toString();
   assert.ok(global.includes('background-color: var(--success-bg-color)'));
   const selected = compiled('components/common/FileManager/FileManager.module.scss').nodes.find((rule: any) => rule.selector === '.selected');
   assert.ok(selected.nodes.some((decl: any) => decl.prop === 'background' && decl.value === 'var(--primary-color-light)'));
   const toast = css.nodes.find((rule: any) => rule.selector === '.Toastify__toast-theme--light,\n.Toastify__toast-theme--dark');
   assert.ok(toast.nodes.some((decl: any) => decl.prop === 'background' && decl.value === 'var(--content-background-color)'));
});
