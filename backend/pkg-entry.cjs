// Entry point for pkg to bootstrap ESM application
// This CJS wrapper is needed to avoid ESM resolution issues in pkg on Windows
const path = require('path');
const { pathToFileURL } = require('url');

(async () => {
  try {
    // Resolve the path to the ESM entry point
    // In pkg snapshot, __dirname points to the virtual directory containing this file
    // We need to use a relative path that works within the snapshot filesystem
    // The error suggests it wants a file URL, but pkg's virtual FS is tricky with ESM
    
    // Try importing using a relative path first (standard for pkg)
    // This often works better than absolute paths in the virtual FS
    await import('./dist/index.js');
  } catch (err) {
    console.error('Failed to start application:', err);
    console.error(err.stack);
    process.exit(1);
  }
})();
