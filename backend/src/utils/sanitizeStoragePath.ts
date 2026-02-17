import * as path from 'path';
import * as os from 'os';
import { AppError } from './AppError';

/**
 * Sanitizes and formats a storage path based on the storage type and operating system.
 * @param storagePath The user-provided storage path string.
 * @param storageType The type of storage (e.g., 'local', 's3', 'b2').
 * @returns A sanitized, correctly formatted path string.
 * @throws {AppError} Throws a 400 Bad Request error if the path is invalid or contains malicious sequences.
 */
export function sanitizeStoragePath(storagePath: string, storageType: string): string {
	if (typeof storagePath !== 'string') {
		// Handle cases where the input might not be a string
		return '';
	}

	const trimmedPath = storagePath.trim();

	// Normalize the path to resolve segments like '.', '..', and multiple slashes.
	const normalizedPath = path.normalize(trimmedPath);

	// **Security Check:** After normalization, if ".." still exists, it's a sign of a
	if (normalizedPath.includes('..')) {
		throw new AppError(400, 'Invalid path: Directory traversal sequences ("..") are not allowed.');
	}

	if (storageType === 'local') {
		// For local storage, we need a fully qualified absolute path.
		const resolvedPath = path.resolve(normalizedPath);

		// On non-Windows systems, we do an extra check to ensure it's a valid absolute path.
		if (os.platform() !== 'win32' && !path.isAbsolute(resolvedPath)) {
			// This case is unlikely after path.resolve, but it's a good defense-in-depth check.
			throw new AppError(
				400,
				'Invalid path: An absolute path is required for local storage on this operating system.'
			);
		}
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
