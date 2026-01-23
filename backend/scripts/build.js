import { execSync } from 'child_process';
import { readdir, readFile, writeFile } from 'fs/promises';
import { join, extname } from 'path';
import { minify } from 'terser';
// Read version from root package.json (monorepo source of truth)
import rootPackageJson from '../../package.json' with { type: 'json' };

console.log('--- Starting Pluton Build Process ---');

// 1. Set the environment variables
process.env.NODE_ENV = 'production';
process.env.APP_VERSION = rootPackageJson.version;

console.log(`Setting NODE_ENV=${process.env.NODE_ENV}`);
console.log(`Setting APP_VERSION=${process.env.APP_VERSION}`);

// 2. Run the TypeScript compiler
try {
	console.log('Running TypeScript compiler (tsc)...');
	// We use execSync here because this is a build script.
	// The 'inherit' option pipes the output directly to your console.
	execSync('tsc -p tsconfig.json', { stdio: 'inherit' });
	console.log('✅ TypeScript compilation completed!');
} catch (error) {
	console.error('❌ Build failed.');
	// The error from tsc will already be printed because of 'inherit'.
	process.exit(1); // Exit with an error code
}

// 3. Remove console.logs from production build
async function removeConsoleLogs(dir) {
	try {
		const entries = await readdir(dir, { withFileTypes: true });

		for (const entry of entries) {
			const fullPath = join(dir, entry.name);

			if (entry.isDirectory()) {
				await removeConsoleLogs(fullPath);
			} else if (entry.isFile() && extname(entry.name) === '.js') {
				const code = await readFile(fullPath, 'utf-8');
				const result = await minify(code, {
					module: true, // Enable ES module support
					compress: {
						drop_console: true, // Remove console.* statements
						pure_funcs: ['console.log', 'console.debug', 'console.warn'],
					},
					mangle: false, // Keep variable names readable
					format: {
						comments: false, // Remove comments
					},
				});

				if (result.code) {
					await writeFile(fullPath, result.code, 'utf-8');
				}
			}
		}
	} catch (error) {
		console.error('Error processing files:', error);
		throw error;
	}
}

try {
	console.log('Removing console logs from production build...');
	await removeConsoleLogs('./dist');
	console.log('✅ Console logs removed successfully!');
	console.log('✅ Build completed successfully!');
} catch (error) {
	console.error('❌ Failed to remove console logs:', error);
	process.exit(1);
}
