import path from 'path';
import os from 'os';
import fs from 'fs';

/**
 * Resolves the path to a bundled binary ('restic', 'rclone' or 'rear').
 * In a packaged application (SEA), it assumes the installer has placed the binaries
 * alongside the main executable. In development, it points to the local './binaries' folder.
 *
 * @param binaryName The name of the binary ('restic' or 'rclone').
 * @returns The absolute path to the executable.
 */
export function getBinaryPath(binaryName: 'restic' | 'rclone' | 'rear'): string {
	const isWindows = os.platform() === 'win32';
	const fileName = isWindows ? `${binaryName}.exe` : binaryName;

	// In a packaged app, process.execPath is the path to the SEA.
	// We assume the installer placed our binaries in the same directory.
	const installDir = path.dirname(process.execPath);
	const productionPath = path.join(installDir, fileName);

	if (fs.existsSync(productionPath)) {
		return productionPath;
	}

	// Fallback for development: Look in the project's 'binaries' folder.
	const platformId = `${os.platform()}-${os.arch()}`;
	const devPath = path.resolve(process.cwd(), 'binaries', platformId, fileName);

	if (fs.existsSync(devPath)) {
		return devPath;
	}

	// Final fallback to system PATH (shouldn't be needed in production).
	// This allows development even without the binaries folder being populated.
	console.warn(
		`[binaryPathResolver] Could not find bundled '${fileName}'. Falling back to system PATH.`
	);
	return binaryName;
}
