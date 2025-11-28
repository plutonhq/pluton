import { build } from 'esbuild';
import packageJson from '../package.json' with { type: 'json' };
import { readFile } from 'fs/promises';
import { extname, join } from 'path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// Plugin to handle native modules correctly
const nativeNodeModulesPlugin = {
	name: 'native-node-modules',
	setup(build) {
		// If a ".node" file is imported within a module in the "file" namespace, resolve
		// it to an absolute path and put it into the "node-file" virtual namespace.
		build.onResolve({ filter: /\.node$/, namespace: 'file' }, args => ({
			path: require.resolve(args.path, { paths: [args.resolveDir] }),
			namespace: 'node-file',
		}));

		// Files in the "node-file" virtual namespace call "require()" on the
		// path from esbuild of the ".node" file in the output directory.
		build.onLoad({ filter: /.*/, namespace: 'node-file' }, args => ({
			contents: `
          import path from ${JSON.stringify(args.path)}
          try { module.exports = require(path) }
          catch {}
        `,
		}));

		// If a ".node" file is imported within a module in the "node-file" namespace, put
		// it in the "file" namespace where esbuild's default loading behavior will handle
		// it. It is already an absolute path since we resolved it to one above.
		build.onResolve({ filter: /\.node$/, namespace: 'node-file' }, args => ({
			path: args.path,
			namespace: 'file',
		}));

		// Tell esbuild's default loading behavior to use the "file" loader for
		// these ".node" files.
		let opts = build.initialOptions;
		opts.loader = opts.loader || {};
		opts.loader['.node'] = 'file';
	},
};

console.log('--- Starting Pluton Executable Build Process (esbuild) ---');

// 1. Set the environment variables
process.env.NODE_ENV = 'production';
process.env.APP_VERSION = packageJson.version;

console.log(`Setting NODE_ENV=${process.env.NODE_ENV}`);
console.log(`Setting APP_VERSION=${process.env.APP_VERSION}`);

// 2. Run esbuild
try {
	console.log('Running esbuild...');

	// Get dependencies to mark as external
	// We mark all dependencies as external because pkg will handle them
	// or they are native modules that shouldn't be bundled
	const dependencies = Object.keys(packageJson.dependencies || {});

	// Remove better-sqlite3 from external list because we are aliasing it
	const bs3Index = dependencies.indexOf('better-sqlite3');
	if (bs3Index > -1) {
		dependencies.splice(bs3Index, 1);
	}

	// Also remove drizzle-orm from external list so it gets bundled
	// This ensures its require('better-sqlite3') calls are intercepted by our alias
	const drizzleIndex = dependencies.indexOf('drizzle-orm');
	if (drizzleIndex > -1) {
		dependencies.splice(drizzleIndex, 1);
	}

	// Remove nanoid from external list so it gets bundled
	// nanoid is ESM-only and causes issues with pkg
	const nanoidIndex = dependencies.indexOf('nanoid');
	if (nanoidIndex > -1) {
		dependencies.splice(nanoidIndex, 1);
	}

	await build({
		entryPoints: ['src/index.ts'],
		bundle: true,
		platform: 'node',
		target: 'node24',
		outfile: 'dist/pkg-index.cjs', // Different output file for pkg
		format: 'cjs',
		external: dependencies,
		sourcemap: true,
		minify: true,
		keepNames: true,
		logLevel: 'info',
		alias: {
			bindings: join(process.cwd(), 'scripts/bindings-proxy.cjs'),
		},
		plugins: [nativeNodeModulesPlugin],
		// Fix import.meta.url in CJS output using the shim pattern from the example
		define: {
			'import.meta.url': '__import_meta_url',
			'process.env.NODE_ENV': '"production"',
		},
		inject: [join(process.cwd(), 'scripts/esbuild-import-meta-url-shim.js')],
	});

	console.log('✅ esbuild compilation completed!');
} catch (error) {
	console.error('❌ Build failed:', error);
	process.exit(1);
}

console.log('✅ Build completed successfully!');
