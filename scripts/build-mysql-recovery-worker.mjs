import { createRequire } from 'node:module';
const require = createRequire(new URL('../backend/package.json', import.meta.url));
const { build } = require('esbuild');
await build({
  entryPoints: ['backend/src/mysql-worker/index.ts'],
  outfile: 'mysql-worker-dist/worker.mjs', bundle: true, platform: 'node',
  format: 'esm', target: 'node24', sourcemap: false,
});
