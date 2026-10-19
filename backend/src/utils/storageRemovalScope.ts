import path from 'path';
import { AppError } from './AppError';

export type StorageRemovalReference = {
	storageId: string | null;
	storagePath: string;
	planId: string | null;
	replicationId?: string;
	kind: 'primary' | 'replica' | 'legacy' | 'retained';
};

function normalized(value: string): string {
	const slash = value.replace(/\\/g, '/');
	const normalized = path.posix.normalize(slash).replace(/\/$/, '');
	return /^[a-z]:/i.test(normalized) ? normalized.toLowerCase() : normalized;
}

/** Guard whole-directory purge; it must never be used as snapshot-level forget. */
export function assertStorageRemovalScope(
	target: { storageId: string; storagePath: string; local: boolean },
	references: StorageRemovalReference[],
	selected: { planId: string; kind: 'plan' | 'replica'; replicationId?: string }
): void {
	if (selected.kind === 'replica' && !selected.replicationId)
		throw new AppError(409, 'Replication identity is missing. Retain the storage data.');
	const candidate = normalized(target.storagePath);
	if (
		!candidate ||
		candidate === '.' ||
		candidate === '/' ||
		/^[a-z]:$/i.test(candidate) ||
		target.storagePath.replace(/\\/g, '/').split('/').includes('..') ||
		Array.from(target.storagePath).some(character => character.charCodeAt(0) < 32)
	)
		throw new AppError(409, 'Storage root deletion is not permitted. Retain the storage data.');
	for (const reference of references) {
		if (
			reference.planId === selected.planId &&
			(selected.kind === 'plan' ||
				(reference.kind === 'replica' && reference.replicationId === selected.replicationId))
		)
			continue;
		if (reference.storageId !== target.storageId && !(target.local && reference.kind === 'legacy'))
			continue;
		const other = normalized(reference.storagePath);
		if (
			!other ||
			other === '.' ||
			candidate === other ||
			candidate.startsWith(other + '/') ||
			other.startsWith(candidate + '/')
		)
			throw new AppError(
				409,
				'Storage data overlaps another retained resource. Retain the storage data.'
			);
	}
}
