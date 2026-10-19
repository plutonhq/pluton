import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const frontendRequire = createRequire(new URL('../package.json', import.meta.url));
const backendRequire = createRequire(new URL('../../backend/package.json', import.meta.url));
const React = frontendRequire('react');
const { renderToStaticMarkup } = frontendRequire('react-dom/server');
const { build } = backendRequire('esbuild');
const compiled = await build({
   entryPoints: [fileURLToPath(new URL('../src/components/Plan/PlanSizeChart/PlanSizeChart.tsx', import.meta.url))],
   bundle: true,
   platform: 'node',
   format: 'cjs',
   jsx: 'automatic',
   write: false,
   external: ['react', 'react/jsx-runtime'],
   plugins: [
      {
         name: 'chart-theme-test',
         setup(builder: any) {
            builder.onResolve({ filter: /chart\.js$|react-chartjs-2$|\/utils\/helpers$|\/context\/ThemeContext$|\/Icon\/Icon$/ }, (args: any) => ({
               path: args.path,
               external: true,
            }));
            builder.onLoad({ filter: /\.scss$/ }, () => ({ contents: 'export default {};', loader: 'js' }));
         },
      },
   ],
});
test('remote snapshot chart excludes failed/unknown attempts and uses actual completion counts instead of stale task estimates', () => {
   const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
   const previousComputed = Object.getOwnPropertyDescriptor(globalThis, 'getComputedStyle');
   Object.defineProperty(globalThis, 'document', { configurable: true, value: { documentElement: {} } });
   Object.defineProperty(globalThis, 'getComputedStyle', { configurable: true, value: () => ({ getPropertyValue: () => '#525252' }) });
   let captured: any;
   const chartModule = { exports: {} as any };
   const mockRequire = (id: string) => {
      if (id === 'chart.js') return { Chart: { register() {} } };
      if (id === 'react-chartjs-2')
         return {
            Line: (props: any) => {
               captured = props.data;
               return null;
            },
         };
      if (id.endsWith('/context/ThemeContext')) return { useTheme: () => ({ theme: 'light' }) };
      if (id.endsWith('/utils/helpers')) return { formatBytes: String, formatNumberToK: String };
      if (id.endsWith('/Icon/Icon')) return { default: () => null };
      return frontendRequire(id);
   };
   try {
      new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(mockRequire, chartModule, chartModule.exports);
      renderToStaticMarkup(
         React.createElement(chartModule.exports.default, {
            remoteManaged: true,
            backups: [
               {
                  status: 'completed',
                  started: Date.now() - 2000,
                  totalSize: 999999,
                  totalFiles: 500,
                  completionStats: { total_bytes_processed: 2048, total_files_processed: 12 },
               },
               { status: 'failed', started: Date.now() - 1000, totalSize: 999999, totalFiles: 500 },
               { status: 'started', started: Date.now(), totalSize: 999999, totalFiles: 500 },
            ],
         }),
      );
      assert.deepEqual(captured.datasets[0].data, [2048]);
      assert.deepEqual(captured.datasets[1].data, [12]);
      assert.equal(captured.datasets[0].label, 'Snapshot Size');
      renderToStaticMarkup(
         React.createElement(chartModule.exports.default, {
            remoteManaged: true,
            backups: [{ status: 'completed', started: Date.now(), completionStats: { total_bytes_processed: 2048, total_files_processed: 12 } }],
         }),
      );
      assert.deepEqual(captured.datasets[0].data, [2048], 'one real snapshot must not create a fabricated second point');
      renderToStaticMarkup(
         React.createElement(chartModule.exports.default, {
            isSync: true,
            backups: [{ started: Date.now(), totalSize: 2048, totalFiles: 12 }],
         }),
      );
      assert.equal(captured.datasets[0].label, 'Size', 'sync data is not a Restic snapshot');
   } finally {
      if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
      else Reflect.deleteProperty(globalThis, 'document');
      if (previousComputed) Object.defineProperty(globalThis, 'getComputedStyle', previousComputed);
      else Reflect.deleteProperty(globalThis, 'getComputedStyle');
   }
});

test('actual chart uses the applied app palette, not the OS preference, after Light/Dark changes', () => {
   let theme = 'light';
   let captured: any;
   const palettes: Record<string, Record<string, string>> = {
      light: { '--content-background-color': '#fff', '--content-title-color': '#444', '--content-text-color': '#525252' },
      dark: { '--content-background-color': '#1c1c1c', '--content-title-color': '#e1e1e1', '--content-text-color': '#c0c0c0' },
   };
   const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
   const previousComputedStyle = Object.getOwnPropertyDescriptor(globalThis, 'getComputedStyle');
   const root = {};
   Object.defineProperty(globalThis, 'document', { configurable: true, value: { documentElement: root } });
   Object.defineProperty(globalThis, 'getComputedStyle', {
      configurable: true,
      value: (element: unknown) => {
         assert.equal(element, root);
         return { getPropertyValue: (name: string) => palettes[theme][name] };
      },
   });
   const chartModule = { exports: {} as any };
   const mockRequire = (id: string) => {
      if (id === 'chart.js') return { Chart: { register() {} } };
      if (id === 'react-chartjs-2')
         return {
            Line: (props: any) => {
               captured = props.options.plugins.tooltip;
               return null;
            },
         };
      if (id.endsWith('/context/ThemeContext')) return { useTheme: () => ({ theme }) };
      if (id.endsWith('/utils/helpers')) return { formatBytes: String, formatNumberToK: String, isDarkMode: false };
      if (id.endsWith('/Icon/Icon')) return { default: () => null };
      return frontendRequire(id);
   };
   try {
      new Function('require', 'module', 'exports', compiled.outputFiles[0].text)(mockRequire, chartModule, chartModule.exports);
      for (theme of ['light', 'dark', 'light']) {
         renderToStaticMarkup(
            React.createElement(chartModule.exports.default, { backups: [{ started: Date.now(), totalSize: 2048, totalFiles: 12 }] }),
         );
         assert.equal(captured.backgroundColor, palettes[theme]['--content-background-color']);
         assert.equal(captured.titleColor, palettes[theme]['--content-title-color']);
         assert.equal(captured.bodyColor, palettes[theme]['--content-text-color']);
      }
   } finally {
      if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
      else Reflect.deleteProperty(globalThis, 'document');
      if (previousComputedStyle) Object.defineProperty(globalThis, 'getComputedStyle', previousComputedStyle);
      else Reflect.deleteProperty(globalThis, 'getComputedStyle');
   }
});
