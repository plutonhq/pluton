import path from 'path';
import os from 'os';
import { lstat, mkdtemp, mkdir, rm, symlink, writeFile } from 'fs/promises';
import Cryptr from 'cryptr';

jest.mock('../../src/services/ConfigService', () => ({
	configService: {
		config: {
			SECRET: 'legacy-restore-test-secret-key',
		},
	},
}));

import { LegacyRepositoryService } from '../../src/services/LegacyRepositoryService';
import type { LegacyRepository } from '../../src/db/schema/legacyRepositories';
import type { LegacyRestoreJob } from '../../src/db/schema/legacyRestoreJobs';
import type { LegacyRepositoryStore } from '../../src/stores/LegacyRepositoryStore';
import type { LegacyRestoreJobStore } from '../../src/stores/LegacyRestoreJobStore';
import type { LegacyResticInspectionClient } from '../../src/utils/restic/LegacyRepositoryInspector';
import {
	LegacyRepositoryRestoreError,
	type LegacyResticRestoreClient,
} from '../../src/utils/restic/LegacyRepositoryRestoreExecutor';

const repositoryId = 'legacy-fixture';
const snapshotId = 'a'.repeat(64);
const password = 'adapter-test-password';
const encryptionSecret = 'legacy-restore-test-secret-key';

const entriesByDirectory = {
	'': [
		{
			name: 'app-01',
			path: 'app-01',
			type: 'directory' as const,
			size: null,
			modifiedAt: null,
			permissions: 'drwxr-xr-x',
			isSymlink: false,
		},
	],
	'app-01': [
		{
			name: 'application',
			path: 'app-01/application',
			type: 'directory' as const,
			size: null,
			modifiedAt: null,
			permissions: 'drwxr-xr-x',
			isSymlink: false,
		},
	],
	'app-01/application': [
		{
			name: 'config',
			path: 'app-01/application/config',
			type: 'directory' as const,
			size: null,
			modifiedAt: null,
			permissions: 'drwxr-xr-x',
			isSymlink: false,
		},
		{
			name: 'index.txt',
			path: 'app-01/application/index.txt',
			type: 'file' as const,
			size: 5,
			modifiedAt: '2026-01-02T00:00:00.000Z',
			permissions: '-rw-r--r--',
			isSymlink: false,
		},
		{
			name: 'link',
			path: 'app-01/application/link',
			type: 'symlink' as const,
			size: null,
			modifiedAt: null,
			permissions: 'Lrwxrwxrwx',
			isSymlink: true,
		},
	],
};

function createStoredRepository(repositoryPath = '/fixtures/legacy-restic-repository'): LegacyRepository {
	return {
		id: repositoryId,
		displayName: 'Fixture legacy repository',
		repositoryPath,
		backend: 'local',
		encryptedPassword: new Cryptr(encryptionSecret).encrypt(password),
		isReadOnly: true,
		validationStatus: 'available',
		lastValidatedAt: new Date('2026-01-01T00:00:00.000Z'),
		createdAt: new Date('2026-01-01T00:00:00.000Z'),
		updatedAt: null,
	};
}

async function waitFor(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		if (predicate()) return;
		await new Promise(resolve => setTimeout(resolve, 5));
	}
	throw new Error('Timed out waiting for asynchronous restore job.');
}

describe('LegacyRepositoryService staged restore jobs', () => {
	let workspaceRoot: string;
	let repositoryRoot: string;
	let jobs: Map<string, LegacyRestoreJob>;
	let repositoryStore: {
		getById: jest.Mock;
		updateValidationStatus: jest.Mock;
	};
	let jobStore: {
		getById: jest.Mock;
		getByIdAndRepository: jest.Mock;
		create: jest.Mock;
		update: jest.Mock;
		markInterruptedAsFailed: jest.Mock;
	};
	let inspector: jest.Mocked<LegacyResticInspectionClient>;
	let executor: jest.Mocked<LegacyResticRestoreClient>;
	let service: LegacyRepositoryService;

	beforeEach(async () => {
		workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'pluton-legacy-restore-'));
		repositoryRoot = await mkdtemp(path.join(os.tmpdir(), 'pluton-legacy-repository-'));
		jobs = new Map();
		repositoryStore = {
			getById: jest.fn().mockResolvedValue(createStoredRepository(repositoryRoot)),
			updateValidationStatus: jest.fn().mockResolvedValue(createStoredRepository(repositoryRoot)),
		};
		jobStore = {
			getById: jest.fn(async (id: string) => jobs.get(id) || null),
			getByIdAndRepository: jest.fn(async (id: string, requestedRepositoryId: string) => {
				const job = jobs.get(id);
				return job?.repositoryId === requestedRepositoryId ? job : null;
			}),
			create: jest.fn(async data => {
				const job: LegacyRestoreJob = {
					id: data.id,
					repositoryId: data.repositoryId,
					snapshotId: data.snapshotId,
					selectedPaths: data.selectedPaths,
					stagingPath: data.stagingPath,
					status: data.status || 'queued',
					errorMsg: data.errorMsg || null,
					restoredFileCount: data.restoredFileCount || null,
					restoredBytes: data.restoredBytes || null,
					createdAt: new Date(),
					startedAt: null,
					completedAt: null,
					updatedAt: null,
				};
				jobs.set(job.id, job);
				return job;
			}),
			markRunningIfQueued: jest.fn(async (id: string) => {
				const current = jobs.get(id);
				if (!current || current.status !== 'queued') return null;
				const updated = { ...current, status: 'running' as const, startedAt: new Date(), errorMsg: null, updatedAt: new Date() };
				jobs.set(id, updated);
				return updated;
			}),
			cancelIfActive: jest.fn(async (id: string) => {
				const current = jobs.get(id);
				if (!current || (current.status !== 'queued' && current.status !== 'running')) return null;
				const updated = { ...current, status: 'cancelled' as const, completedAt: new Date(), errorMsg: null, updatedAt: new Date() };
				jobs.set(id, updated);
				return updated;
			}),
			completeIfRunning: jest.fn(async (id: string, result: Pick<LegacyRestoreJob, 'restoredFileCount' | 'restoredBytes'>) => {
				const current = jobs.get(id);
				if (!current || current.status !== 'running') return null;
				const updated = { ...current, status: 'completed' as const, completedAt: new Date(), ...result, updatedAt: new Date() };
				jobs.set(id, updated);
				return updated;
			}),
			failIfActive: jest.fn(async (id: string, errorMsg: string) => {
				const current = jobs.get(id);
				if (!current || (current.status !== 'queued' && current.status !== 'running')) return null;
				const updated = { ...current, status: 'failed' as const, completedAt: new Date(), errorMsg, updatedAt: new Date() };
				jobs.set(id, updated);
				return updated;
			}),
			cancelIfRunning: jest.fn(async (id: string) => {
				const current = jobs.get(id);
				if (!current || current.status !== 'running') return null;
				const updated = { ...current, status: 'cancelled' as const, completedAt: new Date(), errorMsg: null, updatedAt: new Date() };
				jobs.set(id, updated);
				return updated;
			}),
			markInterruptedAsFailed: jest.fn(),
		};
		inspector = {
			listSnapshots: jest.fn().mockResolvedValue([
				{
					id: snapshotId,
					shortId: snapshotId.slice(0, 8),
					time: '2026-01-02T00:00:00.000Z',
					hostname: 'fixture-host',
					tags: [],
					paths: ['/app-01'],
				},
			]),
			getRepositoryStats: jest.fn(),
			listSnapshotDirectory: jest.fn(async (_repositoryPath, _password, _snapshotId, directoryPath) => ({
				path: directoryPath,
				entries: entriesByDirectory[directoryPath as keyof typeof entriesByDirectory] || [],
			})),
		};
		executor = {
			restoreSnapshot: jest.fn().mockResolvedValue({ restoredFileCount: 3, restoredBytes: 512 }),
			cancel: jest.fn().mockReturnValue(true),
		};
		service = new LegacyRepositoryService(
			repositoryStore as unknown as LegacyRepositoryStore,
			inspector,
			jobStore as unknown as LegacyRestoreJobStore,
			executor,
			workspaceRoot
		);
	});

	afterEach(async () => {
		await rm(workspaceRoot, { recursive: true, force: true });
		await rm(repositoryRoot, { recursive: true, force: true });
	});

	it('browses a nested directory without restoring the snapshot', async () => {
		await expect(service.listSnapshotDirectory(repositoryId, snapshotId, 'app-01/application')).resolves.toEqual(
			expect.objectContaining({
				path: 'app-01/application',
				entries: expect.arrayContaining([expect.objectContaining({ path: 'app-01/application/index.txt' })]),
			})
		);
		expect(executor.restoreSnapshot).not.toHaveBeenCalled();
	});

	it('starts a selected-file restore in an isolated workspace and does not expose its absolute path', async () => {
		const response = await service.startRestore(repositoryId, {
			snapshotId,
			paths: ['app-01/application/index.txt'],
		});

		expect(response.status).toBe('queued');
		expect(JSON.stringify(response)).not.toContain(workspaceRoot);
		await waitFor(() => executor.restoreSnapshot.mock.calls.length === 1);
		await waitFor(() => jobs.get(response.id)?.status === 'completed');

		const request = executor.restoreSnapshot.mock.calls[0][0];
		expect(request.selectedPaths).toEqual(['app-01/application/index.txt']);
		expect(request.stagingPath).toMatch(new RegExp(`^${workspaceRoot.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}`));
		expect((await lstat(request.stagingPath)).isDirectory()).toBe(true);
		expect(jobs.get(response.id)).toEqual(
			expect.objectContaining({ status: 'completed', restoredFileCount: 3, restoredBytes: 512 })
		);
	});

	it('runs concurrent jobs in distinct staging workspaces', async () => {
		const pending: Array<(value: { restoredFileCount: number; restoredBytes: number }) => void> = [];
		executor.restoreSnapshot.mockImplementation(
			() =>
				new Promise(resolve => {
					pending.push(resolve);
				})
		);

		const first = await service.startRestore(repositoryId, { snapshotId, paths: ['app-01/application/index.txt'] });
		const second = await service.startRestore(repositoryId, { snapshotId, paths: ['app-01/application/config'] });
		await waitFor(() => executor.restoreSnapshot.mock.calls.length === 2);

		const [firstRequest, secondRequest] = executor.restoreSnapshot.mock.calls.map(call => call[0]);
		expect(firstRequest.stagingPath).not.toBe(secondRequest.stagingPath);
		expect(firstRequest.stagingPath).toContain(first.id);
		expect(secondRequest.stagingPath).toContain(second.id);
		await expect(mkdir(path.join(firstRequest.stagingPath, 'nested'))).resolves.toBeUndefined();
		await expect(mkdir(path.join(secondRequest.stagingPath, 'nested'))).resolves.toBeUndefined();

		pending.forEach(resolve => resolve({ restoredFileCount: 1, restoredBytes: 1 }));
		await waitFor(() => jobs.get(first.id)?.status === 'completed' && jobs.get(second.id)?.status === 'completed');
	});

	it('rejects missing, unsafe, and symlink restore selections before spawning Restic', async () => {
		await expect(
			service.startRestore(repositoryId, { snapshotId, paths: ['app-01/application/missing.txt'] })
		).rejects.toMatchObject({ statusCode: 404 });
		await expect(
			service.startRestore(repositoryId, { snapshotId, paths: ['../outside.txt'] })
		).rejects.toMatchObject({ statusCode: 400 });
		await expect(service.startRestore(repositoryId, { snapshotId, paths: ['app-01/application/link'] })).rejects.toMatchObject({
			statusCode: 400,
		});
		expect(executor.restoreSnapshot).not.toHaveBeenCalled();
	});

	it('rejects a repository path that overlaps the staging root', async () => {
		repositoryStore.getById.mockResolvedValue({
			...createStoredRepository(),
			repositoryPath: workspaceRoot,
		});

		await expect(
			service.startRestore(repositoryId, { snapshotId, paths: ['app-01/application/index.txt'] })
		).rejects.toMatchObject({ statusCode: 409 });
		expect(executor.restoreSnapshot).not.toHaveBeenCalled();
	});

	it('records a sanitized failed restore and supports cancellation', async () => {
		executor.restoreSnapshot.mockRejectedValue(new LegacyRepositoryRestoreError('execution-failed'));
		const failed = await service.startRestore(repositoryId, { snapshotId, paths: ['app-01/application/index.txt'] });
		await waitFor(() => jobs.get(failed.id)?.status === 'failed');
		expect(jobs.get(failed.id)).toEqual(expect.objectContaining({ errorMsg: 'Restore failed.' }));
		expect(JSON.stringify(jobs.get(failed.id))).not.toContain(password);

		let rejectRestore: (error: Error) => void = () => undefined;
		executor.restoreSnapshot.mockImplementation(
			() =>
				new Promise((_resolve, reject) => {
					rejectRestore = reject;
				})
		);
		const cancelled = await service.startRestore(repositoryId, { snapshotId, paths: ['app-01/application/config'] });
		await waitFor(() => jobs.get(cancelled.id)?.status === 'running');
		await service.cancelRestore(repositoryId, cancelled.id);
		expect(executor.cancel).toHaveBeenCalledWith(cancelled.id);
		rejectRestore(new LegacyRepositoryRestoreError('cancelled'));
		await waitFor(() => jobs.get(cancelled.id)?.status === 'cancelled');
		expect(jobs.get(cancelled.id)).toEqual(expect.objectContaining({ status: 'cancelled' }));

		executor.restoreSnapshot.mockImplementation(
			() =>
				new Promise(() => {
					// Keep this second job running while cancellation is recorded.
				})
		);
		executor.cancel.mockReturnValue(false);
		const notYetTracked = await service.startRestore(repositoryId, { snapshotId, paths: ['app-01/application/index.txt'] });
		await waitFor(() => jobs.get(notYetTracked.id)?.status === 'running');
		await expect(service.cancelRestore(repositoryId, notYetTracked.id)).resolves.toEqual(
			expect.objectContaining({ status: 'cancelled' })
		);
	});

	it('does not launch a restore when queued cancellation wins the state transition', async () => {
		(jobStore.markRunningIfQueued as jest.Mock).mockImplementationOnce(async () => {
			const activeJob = [...jobs.values()].find(job => job.status === 'queued');
			if (!activeJob) return null;
			await jobStore.cancelIfActive(activeJob.id);
			return null;
		});

		const cancelled = await service.startRestore(repositoryId, {
			snapshotId,
			paths: ['app-01/application/index.txt'],
		});
		await waitFor(() => jobs.get(cancelled.id)?.status === 'cancelled');

		expect(executor.restoreSnapshot).not.toHaveBeenCalled();
	});

	it('does not overwrite cancellation when restore completion races the state transition', async () => {
		(jobStore.completeIfRunning as jest.Mock).mockImplementationOnce(async (id: string) => {
			await jobStore.cancelIfActive(id);
			return null;
		});

		const cancelled = await service.startRestore(repositoryId, {
			snapshotId,
			paths: ['app-01/application/index.txt'],
		});
		await waitFor(() => jobs.get(cancelled.id)?.status === 'cancelled');

		expect(jobs.get(cancelled.id)).toEqual(expect.objectContaining({ status: 'cancelled' }));
	});

	it('refuses a symlinked staging root before Restic can run', async () => {
		if (process.platform === 'win32') return;
		const linkedRoot = `${workspaceRoot}-link`;
		await symlink(workspaceRoot, linkedRoot);
		const linkedService = new LegacyRepositoryService(
			repositoryStore as unknown as LegacyRepositoryStore,
			inspector,
			jobStore as unknown as LegacyRestoreJobStore,
			executor,
			linkedRoot
		);

		try {
			await expect(
				linkedService.startRestore(repositoryId, { snapshotId, paths: ['app-01/application/index.txt'] })
			).rejects.toMatchObject({ statusCode: 500 });
			expect(executor.restoreSnapshot).not.toHaveBeenCalled();
		} finally {
			await rm(linkedRoot, { force: true });
		}
	});

	it('refuses a staging root that becomes a symlink before file access', async () => {
		if (process.platform === 'win32') return;
		const replacementRoot = await mkdtemp(path.join(os.tmpdir(), 'pluton-legacy-replacement-'));
		const jobId = 'd'.repeat(24);
		const replacementWorkspace = path.join(replacementRoot, `restore-job-${jobId}`);
		await mkdir(path.join(replacementWorkspace, 'app-01'), { recursive: true });
		await writeFile(path.join(replacementWorkspace, 'app-01', 'index.txt'), 'outside-root');
		jobs.set(jobId, {
			id: jobId,
			repositoryId,
			snapshotId,
			selectedPaths: ['app-01/index.txt'],
			stagingPath: path.join(workspaceRoot, `restore-job-${jobId}`),
			status: 'completed',
			errorMsg: null,
			restoredFileCount: 1,
			restoredBytes: 12,
			createdAt: new Date(),
			startedAt: new Date(),
			completedAt: new Date(),
			updatedAt: new Date(),
		});

		await rm(workspaceRoot, { recursive: true, force: true });
		await symlink(replacementRoot, workspaceRoot);
		try {
			await expect(service.openRestoredFile(repositoryId, jobId, 'app-01/index.txt')).rejects.toMatchObject({ statusCode: 500 });
		} finally {
			await rm(workspaceRoot, { force: true });
			await rm(replacementRoot, { recursive: true, force: true });
		}
	});

	it('downloads only a regular file in the matching completed job workspace', async () => {
		const jobId = 'b'.repeat(24);
		const stagingPath = path.join(workspaceRoot, `restore-job-${jobId}`);
		await mkdir(path.join(stagingPath, 'app-01', 'application'), { recursive: true });
		await writeFile(path.join(stagingPath, 'app-01', 'application', 'index.txt'), 'fixture');
		jobs.set(jobId, {
			id: jobId,
			repositoryId,
			snapshotId,
			selectedPaths: ['app-01/application/index.txt'],
			stagingPath,
			status: 'completed',
			errorMsg: null,
			restoredFileCount: 1,
			restoredBytes: 7,
			createdAt: new Date(),
			startedAt: new Date(),
			completedAt: new Date(),
			updatedAt: new Date(),
		});

		const download = await service.openRestoredFile(repositoryId, jobId, 'app-01/application/index.txt');
		expect(download.fileName).toBe('index.txt');
		expect(download.size).toBe(7);
		await download.fileHandle.close();
		await expect(service.openRestoredFile(repositoryId, jobId, '../outside.txt')).rejects.toMatchObject({ statusCode: 400 });

		if (process.platform !== 'win32') {
			await symlink(path.join(os.tmpdir(), 'outside-file'), path.join(stagingPath, 'app-01', 'application', 'link.txt'));
			await expect(service.openRestoredFile(repositoryId, jobId, 'app-01/application/link.txt')).rejects.toMatchObject({
				statusCode: 400,
			});
		}
		await expect(service.openRestoredFile(repositoryId, 'c'.repeat(24), 'app-01/application/index.txt')).rejects.toMatchObject({
			statusCode: 404,
		});
	});
});
