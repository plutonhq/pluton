/**
 * Installation Helper Utilities
 *
 * Helper functions to detect installation type, platform capabilities,
 * and environment configuration for the Pluton application.
 */

export type InstallType = 'docker' | 'binary' | 'dev';

/**
 * Check if running as a pkg-packaged binary
 */
export function isBinaryMode(): boolean {
	return !!(process as any).pkg;
}

/**
 * Check if running in Docker container
 */
export function isDockerMode(): boolean {
	return process.env.IS_DOCKER === 'true' || process.env.IS_DOCKER === '1';
}

/**
 * Determines the installation type of the application
 * @returns 'docker' | 'binary' | 'dev'
 */
export function getInstallType(): InstallType {
	if (isDockerMode()) {
		return 'docker';
	}
	if (isBinaryMode()) {
		return 'binary';
	}
	return 'dev';
}

/**
 * Checks if running on a Linux desktop environment (not headless/server)
 * by checking for common display environment variables or the PLUTON_LINUX_DESKTOP flag
 * set by the AppImage installer for systemd service mode.
 */
export function isLinuxDesktop(): boolean {
	if (process.platform !== 'linux') return false;

	// Check for explicit desktop flag (set by AppImage installer for systemd service)
	if (process.env.PLUTON_LINUX_DESKTOP === 'true' || process.env.PLUTON_LINUX_DESKTOP === '1') {
		return true;
	}

	// Check for display server (X11 or Wayland)
	const hasDisplay = !!(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);

	// Check for common desktop environment indicators
	const hasDesktopEnv = !!(
		process.env.XDG_CURRENT_DESKTOP ||
		process.env.DESKTOP_SESSION ||
		process.env.GNOME_DESKTOP_SESSION_ID ||
		process.env.KDE_FULL_SESSION
	);

	return hasDisplay || hasDesktopEnv;
}

/**
 * Check if running on a platform that supports keyring (Windows/macOS/Linux Desktop)
 */
export function isKeyringPlatform(): boolean {
	const platform = process.platform;
	return (
		platform === 'win32' || platform === 'darwin' || (platform === 'linux' && isLinuxDesktop())
	);
}

/**
 * Check if the app requires keyring-based initial setup
 * This is true when: running as binary + on a keyring-supported platform
 */
export function requiresKeyringSetup(): boolean {
	return isBinaryMode() && isKeyringPlatform();
}
