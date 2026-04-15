import * as path from 'path';
import * as os from 'os';
import { AppError } from './AppError';

/**
 * Sanitizes and formats a storage path based on the storage type and operating system.
 * @param storagePath The user-provided storage path string.
 * @param storageType The type of storage (e.g., 'local', 's3', 'b2').
 * @param targetOS Optional OS of the target device (e.g., 'linux', 'windows', 'darwin').
 *   When provided, path operations use the target OS conventions instead of the server's OS.
 *   This prevents cross-platform issues such as a Windows server prepending a drive letter
 *   to a Linux absolute path like `/var/home/xxx` → `F:/var/home/xxx`.
 * @returns A sanitized, correctly formatted path string.
 * @throws {AppError} Throws a 400 Bad Request error if the path is invalid or contains malicious sequences.
 */
export function sanitizeStoragePath(
	storagePath: string,
	storageType: string,
	targetOS?: string
): string {
	if (typeof storagePath !== 'string') {
		// Handle cases where the input might not be a string
		return '';
	}

	const trimmedPath = storagePath.trim();

	// Determine path module based on target OS when provided,
	// otherwise fall back to the server's native path module.
	const isTargetWindows = targetOS
		? targetOS === 'windows' || targetOS === 'win32'
		: os.platform() === 'win32';
	const pathModule = isTargetWindows ? path.win32 : path.posix;

	// Normalize the path to resolve segments like '.', '..', and multiple slashes.
	const normalizedPath = pathModule.normalize(trimmedPath);

	// **Security Check:** After normalization, if ".." still exists, it's a sign of a
	if (normalizedPath.includes('..')) {
		throw new AppError(
			400,
			'Invalid Storage Destination path: Directory traversal sequences ("..") are not allowed.'
		);
	}

	if (storageType === 'local') {
		// For local storage, we need a fully qualified absolute path.
		// Check *before* resolve() because resolve() always returns an absolute path
		// by prepending the server's CWD, which mangles paths for remote devices
		// (e.g., a Linux path "home/user" resolved on a Windows server becomes
		// "/JS/apps/.../backend/home/user" instead of "/home/user").
		if (!pathModule.isAbsolute(normalizedPath)) {
			throw new AppError(
				400,
				`Invalid Storage Destination path: An absolute path is required for local storage (e.g., "${isTargetWindows ? 'C:\\' : '/'}home/user/backups").`
			);
		}

		// When targeting a remote OS, use the target path module to avoid
		// the server's OS mangling the path (e.g., adding a Windows drive letter to a Linux path).
		const resolvedPath = pathModule.resolve(normalizedPath);
		return resolvedPath;
	} else {
		// For all remote/cloud storage types (s3, b2, etc.), the path must be relative
		// to the bucket root. A leading slash is invalid for an object key.
		// return normalizedPath.startsWith(path.sep) ? normalizedPath.substring(1) : normalizedPath;

		// For all remote storage types, we want a clean, relative, forward-slash path.
		// 1. Replace all backslashes with forward slashes
		let remotePath = trimmedPath.replace(/\\/g, '/');

		// 2. Remove any leading slashes
		if (remotePath.startsWith('/')) {
			remotePath = remotePath.substring(1);
		}

		// 3. Remove any trailing slashes
		if (remotePath.endsWith('/') && remotePath.length > 1) {
			remotePath = remotePath.slice(0, -1);
		}

		// 4. disallow any remaining ".." segments to prevent directory traversal in remote storage contexts
		if (remotePath.startsWith('..') || remotePath.includes('/../') || remotePath.endsWith('/..')) {
			throw new AppError(400, 'Invalid path: Directory traversal not allowed.');
		}

		return remotePath;
	}
}
