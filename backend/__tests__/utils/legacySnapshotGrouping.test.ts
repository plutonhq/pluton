import type { LegacyRepositorySnapshot } from '../../src/types/legacyRepositories';
import {
	discoverLegacyDatasets,
	discoverLegacyWorkloads,
	getLegacySnapshotGroupings,
	parseLegacySnapshotGrouping,
} from '../../src/utils/legacySnapshotGrouping';

function snapshot(id: string, paths: string[]): LegacyRepositorySnapshot {
	return {
		id: id.repeat(64),
		shortId: id.repeat(8),
		time: '2026-01-01T00:00:00.000Z',
		hostname: 'fixture-host',
		tags: [],
		paths,
	};
}

describe('legacy snapshot workload grouping', () => {
	it('parses the generic workload and dataset path shape', () => {
		expect(parseLegacySnapshotGrouping('/data/backup-staging/amandasari/mysql-plain')).toEqual({
			workload: 'amandasari',
			dataset: 'mysql-plain',
		});
	});

	it('leaves unmatched, nested, and unsafe paths ungrouped', () => {
		for (const value of [
			'/var/lib/backups/source/dataset',
			'/data/backup-staging/source/dataset/extra',
			'/data/backup-staging/source/../dataset',
			'/data/backup-staging/source\\dataset',
		]) {
			expect(parseLegacySnapshotGrouping(value)).toBeNull();
		}
	});

	it('discovers unique workloads and constrains datasets by workload', () => {
		const snapshots = [
			snapshot('a', ['/data/backup-staging/workload-a/mysql-plain']),
			snapshot('b', ['/data/backup-staging/workload-a/app-a']),
			snapshot('c', ['/data/backup-staging/workload-b/mysql-plain']),
			snapshot('d', ['/unmatched/path']),
		];

		expect(discoverLegacyWorkloads(snapshots)).toEqual(['workload-a', 'workload-b']);
		expect(discoverLegacyDatasets(snapshots, 'workload-a')).toEqual(['app-a', 'mysql-plain']);
		expect(discoverLegacyDatasets(snapshots, 'workload-b')).toEqual(['mysql-plain']);
		expect(getLegacySnapshotGroupings(snapshots[3])).toEqual([]);
	});
});
