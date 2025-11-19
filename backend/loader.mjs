// Custom ES module loader to resolve extension-less imports
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import { resolve as resolvePath, dirname } from 'path';

export async function resolve(specifier, context, nextResolve) {
	// Only handle relative imports
	if (specifier.startsWith('./') || specifier.startsWith('../')) {
		const parentURL = context.parentURL;

		if (parentURL) {
			const parentPath = fileURLToPath(parentURL);
			const parentDir = dirname(parentPath);
			const resolvedPath = resolvePath(parentDir, specifier);

			// Try adding .js extension
			if (existsSync(resolvedPath + '.js')) {
				return {
					url: new URL('file://' + resolvedPath + '.js').href,
					shortCircuit: true,
				};
			}

			// Try as directory with index.js
			if (existsSync(resolvePath(resolvedPath, 'index.js'))) {
				return {
					url: new URL('file://' + resolvePath(resolvedPath, 'index.js')).href,
					shortCircuit: true,
				};
			}
		}
	}

	// Fall back to default resolution
	return nextResolve(specifier, context);
}
