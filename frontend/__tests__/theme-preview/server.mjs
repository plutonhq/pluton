// Run from frontend: node __tests__/theme-preview/server.mjs
// No backend is started; all APIs are synthetic and unknown requests fail closed.
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { comlink } from 'vite-plugin-comlink';
import { fileURLToPath } from 'node:url';

// Optional A/B review: Git-extracted historical frontend only, with the same
// synthetic responses. Nothing from the old backend or persisted data is run.
const original = process.argv.includes('--original');
const originalSource = fileURLToPath(new URL('../../../tmp/compact-original/frontend/src/', import.meta.url)).replaceAll('\\', '/');

const server = await createServer({
   configFile: false,
   root: fileURLToPath(new URL('../../', import.meta.url)),
   mode: 'production',
   plugins: [
      react(),
      comlink(),
      {
         name: 'synthetic-theme-preview',
         enforce: 'pre',
         transform(code, id) {
            if (original && id.replaceAll('\\', '/').endsWith('/theme-preview/app.tsx')) {
               for (const entry of ['router', 'context/ThemeContext', 'styles/global.scss']) {
                  code = code.replaceAll(`'../../src/${entry}'`, `'/@fs/${originalSource}${entry}${entry.endsWith('.scss') ? '' : '.tsx'}'`);
               }
               return code;
            }
         },
         resolveId(id) {
            if (id === 'virtual:pwa-register/react') return '\0theme-preview-pwa';
         },
         load(id) {
            if (id === '\0theme-preview-pwa')
               return 'export const useRegisterSW = () => ({ offlineReady: [false, () => {}], needRefresh: [false, () => {}], updateServiceWorker: () => {} });';
         },
         configureServer(vite) {
            vite.middlewares.use('/api', (_request, response) => {
               response.statusCode = 501;
               response.setHeader('Content-Type', 'application/json');
               response.end(JSON.stringify({ success: false, error: 'No live API is available in the synthetic theme preview.' }));
            });
         },
      },
   ],
   resolve: { dedupe: ['react', 'react-dom', 'react-router', '@tanstack/react-query'] },
   server: { host: '127.0.0.1', port: original ? 5189 : 5188, strictPort: true },
});
await server.listen();
console.log(
   `Synthetic ${original ? 'historical' : 'current'} theme preview: http://127.0.0.1:${original ? 5189 : 5188}/__tests__/theme-preview/app.html`,
);
