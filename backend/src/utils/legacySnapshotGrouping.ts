import type { LegacyRepositorySnapshot } from '../types/legacyRepositories';

const LEGACY_WORKLOAD_PREFIX = '/data/backup-staging/';

export type LegacySnapshotGrouping = {
	workload: string;
	dataset: string;
};

/**
 * Extracts the generic workload and dataset segments used by the legacy
 * staging layout. Paths outside that exact two-segment shape are intentionally
 * left ungrouped so they remain available through the ordinary filters.
 */
export function parseLegacySnapshotGrouping(snapshotPath: unknown): LegacySnapshotGrouping | null {
	if (typeof snapshotPath !== 'string' || !snapshotPath.startsWith(LEGACY_WORKLOAD_PREFIX)) return null;

	const segments = snapshotPath.slice(LEGACY_WORKLOAD_PREFIX.length).split('/');
	if (segments.length !== 2 || segments.some(segment => !segment || segment === '.' || segment === '..')) {
		return null;
	}

	if (
		segments.some(segment =>
			segment.includes('\\') ||
			[...segment].some(character => {
				const codePoint = character.codePointAt(0);
				return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
			})
		)
	) {
		return null;
	}

	const [workload, dataset] = segments;
	return { workload, dataset };
}

export function getLegacySnapshotGroupings(snapshot: LegacyRepositorySnapshot): LegacySnapshotGrouping[] {
	const unique = new Map<string, LegacySnapshotGrouping>();
	for (const snapshotPath of snapshot.paths) {
		const grouping = parseLegacySnapshotGrouping(snapshotPath);
		if (grouping) unique.set(`${grouping.workload}\u0000${grouping.dataset}`, grouping);
	}
	return [...unique.values()];
}

export function discoverLegacyWorkloads(snapshots: LegacyRepositorySnapshot[]): string[] {
	return [...new Set(snapshots.flatMap(snapshot => getLegacySnapshotGroupings(snapshot).map(grouping => grouping.workload)))].sort(
		(a, b) => a.localeCompare(b)
	);
}

export function discoverLegacyDatasets(
	snapshots: LegacyRepositorySnapshot[],
	workload?: string
): string[] {
	return [
		...new Set(
			snapshots.flatMap(snapshot =>
				getLegacySnapshotGroupings(snapshot)
					.filter(grouping => !workload || grouping.workload === workload)
					.map(grouping => grouping.dataset)
			)
		),
	].sort((a, b) => a.localeCompare(b));
}
