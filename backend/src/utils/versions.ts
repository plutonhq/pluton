import { execSync } from 'child_process';
import { getBinaryPath } from './binaryPathResolver';

/**
 * Gets the installed Restic version by running 'restic version --json'.
 * Returns 'not_installed' if Restic is not available or parsing fails.
 * @returns Restic version string or 'not_installed'
 * @example
 * getResticVersion(); // '0.15.0' or 'not_installed'
 */
export function getResticVersion(): string {
	try {
		const resticBinary = getBinaryPath('restic');
		const resticOutput = execSync(`${resticBinary} version --json`).toString().trim();
		return resticOutput ? JSON.parse(resticOutput).version : 'not_installed';
	} catch {
		return 'not_installed';
	}
}

/**
 * Gets the installed Rclone version by running 'rclone version'.
 * Returns 'not_installed' if Rclone is not available or parsing fails.
 * @returns Rclone version string or 'not_installed'
 * @example
 * getRcloneVersion(); // '1.63.1' or 'not_installed'
 */
export function getRcloneVersion(): string {
	try {
		const rcloneBinary = getBinaryPath('rclone');
		const rcloneOutput = execSync(`${rcloneBinary} version`).toString().trim();
		const versionMatch = rcloneOutput.match(/rclone v(\d+\.\d+\.\d+)/);
		return versionMatch ? versionMatch[1] : 'not_installed';
	} catch {
		return 'not_installed';
	}
}
