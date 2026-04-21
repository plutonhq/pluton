import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';

const ENV_FILE_NAME = 'pluton.enc.env';

/**
 * Get the full path to the pluton.enc.env file in the given data directory.
 */
export function getEncEnvFilePath(dataDir: string): string {
	return path.join(dataDir, ENV_FILE_NAME);
}

/**
 * Check whether the pluton.enc.env file exists in the given data directory.
 */
export function encEnvFileExists(dataDir: string): boolean {
	return fs.existsSync(getEncEnvFilePath(dataDir));
}

/**
 * Read the ENCRYPTION_KEY from pluton.enc.env.
 * Returns null if the file doesn't exist, is empty, or can't be parsed.
 */
export function readEncryptionKeyFromEnvFile(dataDir: string): string | null {
	const filePath = getEncEnvFilePath(dataDir);
	try {
		if (!fs.existsSync(filePath)) {
			return null;
		}
		const content = fs.readFileSync(filePath, 'utf-8');
		for (const line of content.split('\n')) {
			const trimmed = line.trim();
			if (trimmed.startsWith('#') || !trimmed) continue;
			const eqIndex = trimmed.indexOf('=');
			if (eqIndex === -1) continue;
			const key = trimmed.slice(0, eqIndex).trim();
			const value = trimmed.slice(eqIndex + 1).trim();
			if ((key === 'ENCRYPTION_KEY' || key === 'PLUTON_ENCRYPTION_KEY') && value.length > 0) {
				return value;
			}
		}
		return null;
	} catch {
		return null;
	}
}

/**
 * Write the ENCRYPTION_KEY to pluton.enc.env with strict file permissions.
 * Creates the file if it doesn't exist; overwrites if it does.
 */
export function writeEncryptionKeyToEnvFile(dataDir: string, encryptionKey: string): void {
	const filePath = getEncEnvFilePath(dataDir);
	const dir = path.dirname(filePath);
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}

	const content = [
		'# Pluton Encryption Key — DO NOT SHARE',
		`# Written on ${new Date().toISOString()}`,
		`ENCRYPTION_KEY=${encryptionKey}`,
		'',
	].join('\n');

	fs.writeFileSync(filePath, content, { mode: 0o600 });
	applyStrictPermissions(filePath);
	console.log(`[envFileHelpers] Encryption key written to ${filePath}`);
}

/**
 * Apply strict OS-level permissions to a sensitive file.
 * - Unix (macOS/Linux): chmod 600 (owner read/write only)
 * - Windows: icacls to remove inheritance, grant SYSTEM + Administrators only
 */
export function applyStrictPermissions(filePath: string): void {
	if (os.platform() === 'win32') {
		applyWindowsAcl(filePath);
	} else {
		try {
			fs.chmodSync(filePath, 0o600);
		} catch (error) {
			console.warn(`[envFileHelpers] Could not set permissions on ${filePath}: ${error}`);
		}
	}
}

/**
 * Apply restrictive NTFS ACL to a file on Windows.
 * Removes inherited permissions, grants full control to SYSTEM, Administrators,
 * and the current user (so the process that created the file can still access it).
 */
function applyWindowsAcl(filePath: string): void {
	try {
		// Remove inherited permissions
		execSync(`icacls "${filePath}" /inheritance:r`, { stdio: 'ignore' });
		// Grant SYSTEM full control
		execSync(`icacls "${filePath}" /grant:r "NT AUTHORITY\\SYSTEM:(F)"`, { stdio: 'ignore' });
		// Grant Administrators full control
		execSync(`icacls "${filePath}" /grant:r "BUILTIN\\Administrators:(F)"`, { stdio: 'ignore' });
		// Grant the current user full control (needed for dev and non-admin service accounts)
		const currentUser = os.userInfo().username;
		execSync(`icacls "${filePath}" /grant:r "${currentUser}:(F)"`, { stdio: 'ignore' });
	} catch (error) {
		console.warn(`[envFileHelpers] Could not apply Windows ACL to ${filePath}: ${error}`);
	}
}

/**
 * Verify that a sensitive file has correct permissions.
 * Logs a warning if permissions are too open. Does not fix them automatically.
 */
export function verifyFilePermissions(filePath: string): boolean {
	if (!fs.existsSync(filePath)) return true; // Nothing to check

	if (os.platform() === 'win32') {
		// On Windows, we trust the ACL applied at creation time.
		// A full ACL audit would require parsing icacls output, which is fragile.
		return true;
	}

	try {
		const stats = fs.statSync(filePath);
		const mode = stats.mode & 0o777;
		if (mode !== 0o600) {
			console.warn(
				`⚠️  [envFileHelpers] ${filePath} has permissions ${mode.toString(8)} (expected 600). ` +
					'This file contains sensitive data and should only be readable by the owner.'
			);
			return false;
		}
		return true;
	} catch {
		return true; // Can't check, don't warn
	}
}
