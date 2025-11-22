const path = require('path');
const fs = require('fs');

module.exports = function (opts) {
  // better-sqlite3 calls it with 'better_sqlite3.node'
  
  // 1. If running in pkg
  if (process.pkg) {
    const execDir = path.dirname(process.execPath);
    // The path we constructed in build-executables.js
    const modulePath = path.join(execDir, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');
    
    try {
      return require(modulePath);
    } catch (e) {
      console.error(`[bindings-proxy] Failed to load native module from ${modulePath}`);
      console.error(`[bindings-proxy] Ensure the node_modules folder is placed next to the executable.`);
      throw e;
    }
  }
  
  // 2. If running locally (e.g. node dist/pkg-index.cjs)
  try {
    // Try to resolve relative to CWD or standard node_modules
    const candidates = [
        path.join(process.cwd(), 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node'),
        path.join(__dirname, '..', 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node'),
        path.join(__dirname, '..', '..', 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node')
    ];
    
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
             return require(candidate);
        }
    }
    
    // Fallback to standard require if possible
    return require('better-sqlite3/build/Release/better_sqlite3.node');
    
  } catch (e) {
    console.error('[bindings-proxy] Could not locate better_sqlite3.node in development mode.');
    throw e;
  }
};
