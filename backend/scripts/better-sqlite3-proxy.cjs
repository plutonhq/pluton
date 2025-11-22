const path = require('path');

// This proxy allows us to load better-sqlite3 from the filesystem
// instead of bundling it, which is required for pkg to work with
// the native binary placed alongside the executable.

let Database;

// Use a dynamic variable to prevent esbuild from trying to bundle 'better-sqlite3'
// if we were to require it directly (which would cause a circular dependency due to alias)
const pkgName = 'better-sqlite3';

if (process.pkg) {
  // When running as a packaged executable
  // Look for node_modules next to the executable
  const execDir = path.dirname(process.execPath);
  
  // The native module is located at node_modules/better-sqlite3/build/Release/better_sqlite3.node
  // We need to require this specific file because we don't have the full package.json/index.js structure
  // in the distribution folder, just the binary artifact.
  const modulePath = path.join(execDir, 'node_modules', pkgName, 'build', 'Release', 'better_sqlite3.node');
  
  try {
    Database = require(modulePath);
  } catch (error) {
    console.error(`Failed to load external ${pkgName} from ${modulePath}`);
    console.error('Ensure the node_modules folder is placed next to the executable.');
    throw error;
  }
} else {
  // When running in development or as a plain script
  try {
    // Try to load from standard node resolution
    // We use a trick to bypass esbuild's static analysis/aliasing
    const _require = require;
    Database = _require(pkgName);
  } catch (e) {
    // Fallback: try to find it relative to project root if possible
    // This helps if running the bundle from dist/
    try {
        Database = require(path.resolve(process.cwd(), 'node_modules', pkgName));
    } catch (e2) {
        throw e;
    }
  }
}

module.exports = Database;
