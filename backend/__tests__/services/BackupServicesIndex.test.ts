jest.mock('../../src/db', () => ({ db: {} }));
jest.mock('../../src/services/ConfigService', () => ({
	configService: { config: { ENCRYPTION_KEY: 'e' } },
}));
jest.mock('../../src/jobs/JobQueue', () => ({ jobQueue: { add: jest.fn(), remove: jest.fn() } }));
jest.mock('../../src/services/SnapshotIndexService', () => ({
	snapshotIndexService: {
		start: jest.fn(),
		status: jest.fn(),
		clear: jest.fn(),
		openIndexFile: jest.fn(),
	},
}));
jest.mock('../../src/utils/snapshotIndex/SnapshotIndexReader', () => ({
	listIndexEntries: jest.fn(),
	listIndexDirs: jest.fn(),
	resolveIndexSelection: jest.fn(),
}));

import { BackupService } from '../../src/services/BackupServices';
import { snapshotIndexService } from '../../src/services/SnapshotIndexService';
import { listIndexEntries } from '../../src/utils/snapshotIndex/SnapshotIndexReader';

const index = snapshotIndexService as jest.Mocked<typeof snapshotIndexService>;

const backup = {
	id: 'b1',
	planId: 'p1',
	sourceId: 'device-1',
	method: 'backup',
	storageId: 'primary-id',
	storagePath: 'primary-path',
	encryption: true,
	mirrors: [{ replicationId: 'r1', storageId: 'mirror-id', storagePath: 'mirror-path' }],
};

describe('BackupService snapshot index', () => {
	let service: BackupService;
	let backupStore: any;
	let strategy: any;

	beforeEach(() => {
		jest.clearAllMocks();
		backupStore = { getById: jest.fn().mockResolvedValue(backup), delete: jest.fn() };
		const storageStore = {
			getById: jest.fn(async (id: string) => ({ name: `${id}-name` })),
		};
		const planStore = { update: jest.fn() };
		service = new BackupService(
			{} as any,
			{} as any,
			planStore as any,
			backupStore,
			{} as any,
			storageStore as any
		);
		strategy = {
			listSnapshotFiles: jest.fn().mockResolvedValue({ success: true, result: { buildId: 'x' } }),
			removeSnapshot: jest.fn().mockResolvedValue({ success: true, result: {} }),
		};
		jest.spyOn(service, 'getSnapshotStrategy').mockReturnValue(strategy);
	});

	it('runs the list on the primary storage', async () => {
		await service.startSnapshotIndex('b1');
		const options = index.start.mock.calls[0][0];
		expect(options).toMatchObject({ backupId: 'b1', sourceId: 'device-1' });
		await expect(options.run('build-1')).resolves.toEqual({ buildId: 'x' });
		expect(strategy.listSnapshotFiles).toHaveBeenCalledWith('p1', 'b1', {
			storageName: 'primary-id-name',
			storagePath: 'primary-path',
			encryption: true,
			buildId: 'build-1',
			skipCache: false,
		});
	});

	it('runs the list on a mirror', async () => {
		await service.startSnapshotIndex('b1', 'r1');
		await index.start.mock.calls[0][0].run('build-1');
		expect(strategy.listSnapshotFiles).toHaveBeenCalledWith('p1', 'b1', {
			storageName: 'mirror-id-name',
			storagePath: 'mirror-path',
			encryption: true,
			buildId: 'build-1',
			skipCache: true,
		});
	});

	it('gives a 404 for an unknown mirror, never the primary storage', async () => {
		await expect(service.startSnapshotIndex('b1', 'nope')).rejects.toMatchObject({
			statusCode: 404,
		});
		await expect(service.getSnapshotIndexStatus('b1', 'nope')).rejects.toMatchObject({
			statusCode: 404,
		});
		await expect(service.getSnapshotIndexEntries('b1', 'nope', {})).rejects.toMatchObject({
			statusCode: 404,
		});
		expect(index.start).not.toHaveBeenCalled();
		expect(listIndexEntries).not.toHaveBeenCalled();
	});

	it('gives a 404 for an unknown backup', async () => {
		backupStore.getById.mockResolvedValue(null);
		await expect(service.startSnapshotIndex('b1')).rejects.toMatchObject({ statusCode: 404 });
	});

	it('reports unsupported backups', async () => {
		jest.spyOn(service as any, 'supportsSnapshotIndex').mockReturnValue(false);
		await expect(service.startSnapshotIndex('b1')).resolves.toEqual({ state: 'unsupported' });
		await expect(service.getSnapshotIndexStatus('b1')).resolves.toEqual({ state: 'unsupported' });
		expect(index.start).not.toHaveBeenCalled();
	});

	it('fails the run when the source refuses', async () => {
		strategy.listSnapshotFiles.mockResolvedValue({ success: false, result: 'refused' });
		await service.startSnapshotIndex('b1');
		await expect(index.start.mock.calls[0][0].run('build-1')).rejects.toThrow('refused');
	});

	it('reads from the file of the storage', async () => {
		index.openIndexFile.mockReturnValue('index-file');
		await service.getSnapshotIndexEntries('b1', 'r1', { dir: '/a' });
		expect(index.openIndexFile).toHaveBeenCalledWith('b1', 'r1');
		expect(listIndexEntries).toHaveBeenCalledWith('index-file', { dir: '/a' });
	});

	it('clears the index with the backup', async () => {
		await service.deleteBackup('b1');
		expect(index.clear).toHaveBeenCalledWith('b1');
	});
});
