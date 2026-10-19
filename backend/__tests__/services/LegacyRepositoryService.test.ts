import path from 'path';
import Cryptr from 'cryptr';

jest.mock('../../src/services/ConfigService', () => ({
	configService: {
		config: {
			SECRET: 'legacy-adapter-test-secret-key',
		},
	},
}));

import { LegacyRepositoryService } from '../../src/services/LegacyRepositoryService';
import type { LegacyRepository } from '../../src/db/schema/legacyRepositories';
import type { LegacyRepositoryStore } from '../../src/stores/LegacyRepositoryStore';
import {
	LegacyRepositoryInspectionError,
	type LegacyResticInspectionClient,
} from '../../src/utils/restic/LegacyRepositoryInspector';
import type { LegacyRepositorySnapshot } from '../../src/types/legacyRepositories';

const repositoryPath = path.resolve(process.cwd(), 'fixtures', 'legacy-restic-repository');
const adapterPassword = 'adapter-test-password';
const encryptionSecret = 'legacy-adapter-test-secret-key';
const snapshots: LegacyRepositorySnapshot[] = [
	{
		id: 'a'.repeat(64),
		shortId: 'aaaaaaaa',
		time: '2026-01-03T00:00:00.000Z',
		hostname: 'host-a',
		tags: ['daily', 'database'],
		paths: ['C:\\fixtures\\source-a'],
	},
	{
		id: 'b'.repeat(64),
		shortId: 'bbbbbbbb',
		time: '2026-01-02T00:00:00.000Z',
		hostname: 'host-b',
		tags: ['weekly'],
		paths: ['C:\\fixtures\\source-b'],
	},
	{
		id: 'c'.repeat(64),
		shortId: 'cccccccc',
		time: '2026-01-01T00:00:00.000Z',
		hostname: 'host-a',
		tags: ['daily'],
		paths: ['C:\\fixtures\\source-c'],
	},
];

function createStoredRepository(overrides: Partial<LegacyRepository> = {}): LegacyRepository {
	return {
		id: 'legacy-fixture',
		displayName: 'Fixture legacy repository',
		repositoryPath,
		backend: 'local',
		encryptedPassword: new Cryptr(encryptionSecret).encrypt(adapterPassword),
		isReadOnly: true,
		validationStatus: 'available',
		lastValidatedAt: new Date('2026-01-01T00:00:00.000Z'),
		createdAt: new Date('2026-01-01T00:00:00.000Z'),
		updatedAt: null,
		...overrides,
	};
}

describe('LegacyRepositoryService', () => {
	let store: {
		getAll: jest.Mock;
		getById: jest.Mock;
		create: jest.Mock;
		updateValidationStatus: jest.Mock;
		delete: jest.Mock;
	};
	let inspector: jest.Mocked<LegacyResticInspectionClient>;
	let service: LegacyRepositoryService;

	beforeEach(() => {
		store = {
			getAll: jest.fn(),
			getById: jest.fn(),
			create: jest.fn(),
			updateValidationStatus: jest.fn(),
			delete: jest.fn(),
		};
		inspector = {
			listSnapshots: jest.fn(),
			getRepositoryStats: jest.fn(),
			listSnapshotDirectory: jest.fn(),
		};
		service = new LegacyRepositoryService(store as unknown as LegacyRepositoryStore, inspector);
	});

	it('registers a validated local repository as read-only without returning its password', async () => {
		inspector.listSnapshots.mockResolvedValue(snapshots);
		store.create.mockImplementation(async data =>
			createStoredRepository({
				...data,
				createdAt: new Date('2026-01-03T00:00:00.000Z'),
				updatedAt: null,
			})
		);

		const result = await service.register({
			displayName: 'Imported fixture',
			repositoryPath,
			password: adapterPassword,
		});

		expect(inspector.listSnapshots).toHaveBeenCalledWith(repositoryPath, adapterPassword);
		expect(store.create).toHaveBeenCalledWith(
			expect.objectContaining({ backend: 'local', isReadOnly: true, validationStatus: 'available' })
		);
		const saved = store.create.mock.calls[0][0];
		expect(saved.encryptedPassword).not.toContain(adapterPassword);
		expect(result).toEqual(expect.objectContaining({ backend: 'local', isReadOnly: true }));
		expect(JSON.stringify(result)).not.toContain(adapterPassword);
		expect(result).not.toHaveProperty('encryptedPassword');
	});

	it('rejects a non-absolute repository path before inspection', async () => {
		await expect(
			service.register({
				displayName: 'Invalid fixture',
				repositoryPath: 'relative/legacy-repository',
				password: adapterPassword,
			})
		).rejects.toMatchObject({ statusCode: 400 });
		expect(inspector.listSnapshots).not.toHaveBeenCalled();
		expect(store.create).not.toHaveBeenCalled();
	});

	it('returns a safe validation error for incorrect credentials', async () => {
		inspector.listSnapshots.mockRejectedValue(new LegacyRepositoryInspectionError('wrong-password'));

		await expect(
			service.register({ displayName: 'Fixture legacy', repositoryPath, password: adapterPassword })
		).rejects.toMatchObject({
			statusCode: 400,
			message: 'Repository credentials could not be verified.',
		});
		await service
			.register({ displayName: 'Fixture legacy', repositoryPath, password: adapterPassword })
			.catch(error => expect((error as Error).message).not.toContain(adapterPassword));
	});

	it('lists and filters multiple workloads locally by tag, path, and host', async () => {
		store.getById.mockResolvedValue(createStoredRepository());
		store.updateValidationStatus.mockResolvedValue(createStoredRepository());
		inspector.listSnapshots.mockResolvedValue(snapshots);

		await expect(service.listSnapshots('legacy-fixture', { tag: 'daily' })).resolves.toEqual(
			expect.objectContaining({
				items: expect.arrayContaining([
					expect.objectContaining({ id: 'a'.repeat(64) }),
					expect.objectContaining({ id: 'c'.repeat(64) }),
				]),
				total: 2,
			})
		);
		await expect(service.listSnapshots('legacy-fixture', { host: 'host-b' })).resolves.toEqual(
			expect.objectContaining({
				items: [expect.objectContaining({ id: 'b'.repeat(64) })],
				total: 1,
			})
		);
		await expect(
			service.listSnapshots('legacy-fixture', { path: 'C:\\fixtures\\source-c' })
		).resolves.toEqual(expect.objectContaining({ items: [expect.objectContaining({ id: 'c'.repeat(64) })], total: 1 }));
		expect(inspector.listSnapshots).toHaveBeenCalledWith(repositoryPath, expect.any(String));
	});

	it('paginates in newest-first order with the supported page sizes and All', async () => {
		store.getById.mockResolvedValue(createStoredRepository());
		store.updateValidationStatus.mockResolvedValue(createStoredRepository());
		const generated = Array.from({ length: 105 }, (_, index) => ({
			id: index.toString(16).padStart(64, '0'),
			shortId: index.toString(16).padStart(8, '0'),
			time: new Date(Date.UTC(2026, 0, 1, 0, 0, 105 - index)).toISOString(),
			hostname: index % 2 === 0 ? 'host-a' : 'host-b',
			tags: [index % 2 === 0 ? 'daily' : 'weekly'],
			paths: [
				index % 10 === 0
					? `/unmatched/source-${index}`
					: `/data/backup-staging/workload-${index % 3}/dataset-${index % 4}`,
			],
			parent: undefined,
		}));
		inspector.listSnapshots.mockResolvedValue([...generated].reverse());

		const firstPage = await service.listSnapshots('legacy-fixture');
		expect(firstPage).toEqual(expect.objectContaining({ page: 1, pageSize: 30, total: 105, totalPages: 4 }));
		expect(firstPage.items).toHaveLength(30);
		expect(firstPage.items[0].id).toBe(generated[0].id);
		expect((await service.listSnapshots('legacy-fixture', { page: 2 })).items[0].id).toBe(generated[30].id);
		expect((await service.listSnapshots('legacy-fixture', { page: 4 })).items.at(-1)?.id).toBe(generated[104].id);

		for (const size of [10, 30, 60, 100] as const) {
			const result = await service.listSnapshots('legacy-fixture', { pageSize: size });
			expect(result.pageSize).toBe(size);
			expect(result.items).toHaveLength(Math.min(size, generated.length));
			expect(result.totalPages).toBe(Math.ceil(generated.length / size));
		}

		const all = await service.listSnapshots('legacy-fixture', { pageSize: 'all', page: 3 });
		expect(all).toEqual(expect.objectContaining({ page: 1, pageSize: 'all', total: 105, totalPages: 1 }));
		expect(all.items).toHaveLength(105);
	});

	it('discovers and filters workloads/datasets while composing with advanced filters', async () => {
		store.getById.mockResolvedValue(createStoredRepository());
		store.updateValidationStatus.mockResolvedValue(createStoredRepository());
		const workloadSnapshots = [
			{ ...snapshots[0], paths: ['/data/backup-staging/workload-a/mysql-plain'], tags: ['daily'], hostname: 'host-a' },
			{ ...snapshots[1], paths: ['/data/backup-staging/workload-a/app-a'], tags: ['weekly'], hostname: 'host-a' },
			{ ...snapshots[2], paths: ['/data/backup-staging/workload-b/mysql-plain'], tags: ['daily'], hostname: 'host-b' },
			{ ...snapshots[0], id: 'd'.repeat(64), shortId: 'dddddddd', paths: ['/data/backup-staging/workload-b/app-b'], tags: ['daily'], hostname: 'host-b' },
			{ ...snapshots[0], id: 'e'.repeat(64), shortId: 'eeeeeeee', paths: ['/unmatched/legacy/path'], tags: ['daily'], hostname: 'host-a' },
			{
				...snapshots[0],
				id: 'f'.repeat(64),
				shortId: 'ffffffff',
				paths: [
					'/data/backup-staging/workload-a/mysql-plain',
					'/data/backup-staging/workload-b/app-b',
				],
				tags: ['daily'],
				hostname: 'host-a',
			},
		];
		inspector.listSnapshots.mockResolvedValue(workloadSnapshots);

		const discovered = await service.listSnapshots('legacy-fixture');
		expect(discovered.workloads).toEqual(['workload-a', 'workload-b']);
		expect(discovered.datasets).toEqual(['app-a', 'app-b', 'mysql-plain']);
		expect((await service.listSnapshots('legacy-fixture', { workload: 'workload-a' })).datasets).toEqual(['app-a', 'mysql-plain']);
		expect((await service.listSnapshots('legacy-fixture', { workload: 'workload-a', dataset: 'app-a' })).items).toEqual([
			expect.objectContaining({ id: 'b'.repeat(64) }),
		]);
		expect(
			(
				await service.listSnapshots('legacy-fixture', {
					workload: 'workload-b',
					tag: 'daily',
					host: 'host-b',
					path: '/data/backup-staging/workload-b/app-b',
				})
			).items
		).toEqual([expect.objectContaining({ id: 'd'.repeat(64) })]);
		expect((await service.listSnapshots('legacy-fixture', { workload: 'workload-a', dataset: 'app-b' })).items).toEqual([]);
		expect((await service.listSnapshots('legacy-fixture', { path: '/unmatched/legacy/path' })).items).toEqual([
			expect.objectContaining({ id: 'e'.repeat(64) }),
		]);
	});

	it('only deletes the local registration and never inspects or changes the repository', async () => {
		store.getById.mockResolvedValue(createStoredRepository());
		store.delete.mockResolvedValue(true);

		await expect(service.deleteRegistration('legacy-fixture')).resolves.toBeUndefined();
		expect(store.delete).toHaveBeenCalledWith('legacy-fixture');
		expect(inspector.listSnapshots).not.toHaveBeenCalled();
		expect(inspector.getRepositoryStats).not.toHaveBeenCalled();
	});

	it('rejects caller-supplied mode changes and refuses stored non-read-only records', async () => {
		await expect(
			service.register({
				displayName: 'Unsafe fixture',
				repositoryPath,
				password: adapterPassword,
				isReadOnly: false,
			})
		).rejects.toMatchObject({ statusCode: 400 });
		expect(inspector.listSnapshots).not.toHaveBeenCalled();

		store.getById.mockResolvedValue(createStoredRepository({ isReadOnly: false }));
		await expect(service.listSnapshots('legacy-fixture')).rejects.toMatchObject({ statusCode: 409 });
		expect(inspector.listSnapshots).not.toHaveBeenCalled();
	});
});
