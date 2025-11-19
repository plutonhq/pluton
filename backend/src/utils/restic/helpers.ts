import path from 'path';

export function generateResticRepoPath(storageName: string, storagePath: string) {
	return `rclone:${storageName}:${storagePath || ''}`;
}
export function toResticPath(srcPath: string) {
	// Normalize the path to handle mixed separators
	let normalizedPath = path.normalize(srcPath);

	if (!normalizedPath) return srcPath;

	// Replace backslashes with forward slashes
	normalizedPath = normalizedPath.replace(/\\/g, '/');

	// Remove the colon after the drive letter, if present
	normalizedPath = normalizedPath.replace(/^([A-Za-z]):/, '$1');

	// Ensure the path starts with a forward slash
	if (!normalizedPath.startsWith('/')) {
		normalizedPath = '/' + normalizedPath;
	}

	return normalizedPath;
}

export function resticPathToWindows(resticPath: string) {
	// Remove leading slash and split the path
	const parts = resticPath.replace(/^\/+/, '').split('/');

	// If the first part is a drive letter, reconstruct the path
	if (parts.length > 1 && /^[A-Za-z]$/.test(parts[0])) {
		const drive = parts.shift();
		return `${drive}:\\${parts.join('\\')}`;
	}

	// If not a drive letter, return the path as-is with backslashes
	return parts.join('\\');
}
