import path from 'path';
import os from 'os';
import fs from 'fs';

/**
 * Resolves the path to a bundled binary ('restic', 'rclone' or 'rear').
 * Checks multiple locations in priority order:
 * 1. AppImage: $APPDIR/usr/bin/binaries/{platform}-{arch}/
 * 2. pkg-packaged: {executableDir}/binaries/{platform}-{arch}/
 * 3. Production: {executableDir}/{binaryName}
 * 4. Development: {cwd}/binaries/{platform}-{arch}/
 * 5. Fallback: System PATH
 *
 * @param binaryName The name of the binary ('restic', 'rclone', or 'rear').
 * @returns The absolute path to the executable.
 */
export function getBinaryPath(binaryName: 'restic' | 'rclone' | 'rear'): string {
	const isWindows = os.platform() === 'win32';
	const fileName = isWindows ? `${binaryName}.exe` : binaryName;
	const platformId = `${os.platform()}-${os.arch()}`;

	// Priority 1: Check if running inside an AppImage
	const appDir = process.env.APPDIR;
	if (appDir) {
		const appImageBinaryPath = path.join(appDir, 'usr', 'bin', 'binaries', platformId, fileName);

		if (fs.existsSync(appImageBinaryPath)) {
			return appImageBinaryPath;
		}

		console.warn(
			`[binaryPathResolver] Expected binary at '${appImageBinaryPath}' (AppImage) but not found. Trying fallbacks...`
		);
	}

	// Priority 2: Check if running as a pkg-packaged executable
	if ((process as any).pkg) {
		const execDir = path.dirname(process.execPath);
		const pkgBinaryPath = path.join(execDir, 'binaries', platformId, fileName);

		if (fs.existsSync(pkgBinaryPath)) {
			return pkgBinaryPath;
		}

		console.warn(
			`[binaryPathResolver] Expected binary at '${pkgBinaryPath}' but not found. Trying fallbacks...`
		);
	}

	// Priority 3: Production/installed binary next to executable
	const installDir = path.dirname(process.execPath);
	const productionPath = path.join(installDir, fileName);

	if (fs.existsSync(productionPath)) {
		return productionPath;
	}

	// Priority 4: Development - Look in the project's 'binaries' folder
	const devPath = path.resolve(process.cwd(), 'binaries', platformId, fileName);

	if (fs.existsSync(devPath)) {
		return devPath;
	}

	// Final fallback to system PATH (shouldn't be needed in production)
	// This allows development even without the binaries folder being populated
	console.warn(
		`[binaryPathResolver] Could not find bundled '${fileName}'. Falling back to system PATH.`
	);
	return binaryName;
}
