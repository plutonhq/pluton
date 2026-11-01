import path from 'path';
import { SnapShotFile } from '../../types/restic';
import { SnapshotIndexEntry } from '../../types/snapshotIndex';

export function generateResticRepoPath(storageName: string, storagePath: string) {
	return `rclone:${storageName}:${storagePath || ''}`;
}
export function toResticPath(srcPath: string) {
	// Normalize the path to handle mixed separators
	let normalizedPath = path.normalize(srcPath);

	if (!normalizedPath) return srcPath;

	// Replace backslashes with forward slashes
	normalizedPath = normalizedPath.replace(/\\/g, '/');

	// Collapse redundant forward slashes (preserve leading // for UNC paths)
	normalizedPath = normalizedPath.replace(/([^/])\/+/g, '$1/');

	// Remove the colon after the drive letter, if present
	normalizedPath = normalizedPath.replace(/^([A-Za-z]):/, '$1');

	// Ensure the path starts with a forward slash
	if (!normalizedPath.startsWith('/')) {
		normalizedPath = '/' + normalizedPath;
	}

	return normalizedPath;
}

/** Restic reads include and exclude values as glob patterns, and these paths are literal. */
export function escapeResticPattern(value: string, platform: NodeJS.Platform = process.platform) {
	// A backslash is an escape in a glob pattern, except on Windows.
	const literal = platform === 'win32' ? value : value.replace(/\\/g, '\\\\');
	return literal.replace(/[[*?]/g, '[$&]');
}

/** A regex here is quadratic on a long run of slashes, and paths can come from an agent. */
export function trimTrailingSlashes(value: string) {
	let end = value.length;
	while (end > 0 && value[end - 1] === '/') {
		end--;
	}
	return value.slice(0, end);
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

export function parseResticMtime(value?: string): number | null {
	const mtime = value ? new Date(value).getTime() : NaN;
	return Number.isNaN(mtime) ? null : mtime;
}

export function parseResticLine(line: string): SnapshotIndexEntry | null {
	const item = JSON.parse(line);
	if (typeof item?.path !== 'string' || !item.path) {
		return null;
	}
	return {
		path: item.path,
		type: item.type ?? '',
		size: item.size || 0,
		mtime: parseResticMtime(item.mtime),
		perm: item.permissions ?? null,
	};
}

/** Turns a whole-list reply into restic lines, so all sources share one parser. */
export function* snapshotFilesToLines(files: SnapShotFile[]): Generator<Buffer> {
	for (let i = 0; i < files.length; i += 1000) {
		const lines = files.slice(i, i + 1000).map(file =>
			JSON.stringify({
				path: file.path,
				type: file.type,
				size: file.size,
				mtime: file.modifiedAt,
				permissions: file.permissions,
			})
		);
		yield Buffer.from(lines.join('\n') + '\n');
	}
}
