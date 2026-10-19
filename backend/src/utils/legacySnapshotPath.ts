import path from 'path';
import { AppError } from './AppError';

const MAX_SNAPSHOT_PATH_LENGTH = 1024;

function invalidSnapshotPath(): AppError {
	return new AppError(400, 'Snapshot path must be a safe relative POSIX path.');
}

function hasControlCharacter(value: string): boolean {
	return [...value].some(character => {
		const codePoint = character.codePointAt(0);
		return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
	});
}

/**
 * Snapshot paths are logical Restic paths, not host filesystem paths. The API
 * accepts a relative form (for example `app-01/application/index.txt`) and
 * turns it into a Restic path only after validation.
 */
export function normalizeLegacySnapshotPath(value: unknown, allowRoot = true): string {
	if (typeof value !== 'string') throw invalidSnapshotPath();
	if (value.length > MAX_SNAPSHOT_PATH_LENGTH || value.includes('\0') || value.includes('\uFFFD')) {
		throw invalidSnapshotPath();
	}
	if (value === '') {
		if (allowRoot) return '';
		throw invalidSnapshotPath();
	}

	// Percent-encoded input is ambiguous after URL decoding. Reject it instead
	// of attempting a second decode that could turn it into traversal.
	if (
		value.includes('%') ||
		value.includes('\\') ||
		value.includes('//') ||
		value.startsWith('/') ||
		path.posix.isAbsolute(value) ||
		/^[A-Za-z]:/.test(value) ||
		hasControlCharacter(value)
	) {
		throw invalidSnapshotPath();
	}

	const parts = value.split('/');
	if (parts.some(part => part === '' || part === '.' || part === '..')) {
		throw invalidSnapshotPath();
	}

	return parts.join('/');
}

export function toResticSnapshotPath(relativePath: string): string {
	const normalized = normalizeLegacySnapshotPath(relativePath);
	return normalized ? `/${normalized}` : '/';
}

export function getLegacySnapshotParent(relativePath: string): string {
	const normalized = normalizeLegacySnapshotPath(relativePath, false);
	const separator = normalized.lastIndexOf('/');
	return separator === -1 ? '' : normalized.slice(0, separator);
}

export function isPathWithin(root: string, candidate: string): boolean {
	const relative = path.relative(path.resolve(root), path.resolve(candidate));
	return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

export function resolvePathWithin(root: string, relativePath: string): string {
	const candidate = path.resolve(root, relativePath);
	if (!isPathWithin(root, candidate)) {
		throw new AppError(400, 'Path is outside the restore workspace.');
	}
	return candidate;
}
