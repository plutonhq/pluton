import path from 'path';
import { constants } from 'fs';
import { chmod, lstat, mkdir, open, realpath, rm, type FileHandle } from 'fs/promises';
import Cryptr from 'cryptr';
import { z } from 'zod';
import { configService } from './ConfigService';
import { LegacyRepositoryStore } from '../stores/LegacyRepositoryStore';
import { LegacyRestoreJobStore } from '../stores/LegacyRestoreJobStore';
import type { LegacyRepository } from '../db/schema/legacyRepositories';
import type { LegacyRestoreJob } from '../db/schema/legacyRestoreJobs';
import { AppError, NotFoundError } from '../utils/AppError';
import { generateUID } from '../utils/helpers';
import { appPaths } from '../utils/AppPaths';
import {
	getLegacySnapshotParent,
	isPathWithin,
	normalizeLegacySnapshotPath,
	resolvePathWithin,
} from '../utils/legacySnapshotPath';
import {
	LegacyRepositoryInspectionError,
	LegacyResticInspectionClient,
	ResticLegacyRepositoryInspector,
} from '../utils/restic/LegacyRepositoryInspector';
import {
	LegacyRepositoryRestoreError,
	LegacyResticRestoreClient,
	ResticLegacyRepositoryRestoreExecutor,
} from '../utils/restic/LegacyRepositoryRestoreExecutor';
import type {
	LegacyRepositoryConnectionStatus,
	LegacyRepositoryPublic,
	LegacyRepositoryRegistration,
	LegacyRepositorySnapshot,
	LegacyRepositorySnapshotPage,
	LegacyRepositorySnapshotPageSize,
	LegacyRepositorySnapshotFilters,
	LegacyRepositoryStats,
	LegacyRestoreJobPublic,
	LegacyRestoreRequest,
	LegacySnapshotDirectory,
	LegacySnapshotEntry,
} from '../types/legacyRepositories';
import {
	discoverLegacyDatasets,
	discoverLegacyWorkloads,
	getLegacySnapshotGroupings,
} from '../utils/legacySnapshotGrouping';

const registrationSchema = z
	.object({
		displayName: z.string().trim().min(1).max(100),
		repositoryPath: z.string().trim().min(1).max(1024),
		password: z.string().min(1).max(4096),
	})
	.strict();

const snapshotPageSizes = [10, 30, 60, 100] as const;
const defaultSnapshotPageSize: LegacyRepositorySnapshotPageSize = 30;

const snapshotFiltersSchema = z
	.object({
		tag: z.string().trim().min(1).max(256).optional(),
		path: z.string().trim().min(1).max(1024).optional(),
		host: z.string().trim().min(1).max(256).optional(),
		workload: z.string().trim().min(1).max(256).optional(),
		dataset: z.string().trim().min(1).max(256).optional(),
		page: z.coerce.number().int().min(1).default(1),
		pageSize: z
			.union([z.literal('all'), z.coerce.number().refine(value => snapshotPageSizes.includes(value as (typeof snapshotPageSizes)[number]))])
			.default(defaultSnapshotPageSize),
	})
	.strict();

const fullSnapshotId = /^[a-fA-F0-9]{64}$/;
const restoreJobId = /^[a-z0-9]{24}$/;
const MAX_RESTORE_PATHS = 20;

const restoreRequestSchema = z
	.object({
		snapshotId: z.string().regex(fullSnapshotId),
		paths: z.array(z.string()).min(1).max(MAX_RESTORE_PATHS),
	})
	.strict();

/**
 * Keeps imported Restic repositories apart from Pluton's managed plans.
 * The only repository interactions available here are through the dedicated
 * inspection and staged-restore clients; there is no backup, retention, managed
 * restore, or lock-cleanup path.
 */
export class LegacyRepositoryService {
	constructor(
		private readonly repositoryStore: LegacyRepositoryStore,
		private readonly inspector: LegacyResticInspectionClient = new ResticLegacyRepositoryInspector(),
		private readonly restoreJobStore?: LegacyRestoreJobStore,
		private readonly restoreExecutor: LegacyResticRestoreClient = new ResticLegacyRepositoryRestoreExecutor(),
		private readonly legacyRestoreRoot?: string
	) {}

	async register(input: unknown): Promise<LegacyRepositoryPublic> {
		const parsed = registrationSchema.safeParse(input);
		if (!parsed.success) {
			throw new AppError(400, 'A display name, absolute repository path, and repository password are required.');
		}

		const registration = this.validateRegistration(parsed.data);
		await this.inspectRegistration(registration.repositoryPath, registration.password);

		const created = await this.repositoryStore.create({
			id: generateUID(),
			displayName: registration.displayName,
			repositoryPath: registration.repositoryPath,
			backend: 'local',
			encryptedPassword: this.encryptPassword(registration.password),
			isReadOnly: true,
			validationStatus: 'available',
			lastValidatedAt: new Date(),
		});

		if (!created) {
			throw new AppError(500, 'Could not save the legacy repository registration.');
		}

		return this.toPublic(created);
	}

	async getAll(): Promise<LegacyRepositoryPublic[]> {
		const repositories = await this.repositoryStore.getAll();
		return repositories.map(repository => this.toPublic(repository));
	}

	async getById(id: string): Promise<LegacyRepositoryPublic> {
		return this.toPublic(await this.getStoredRepository(id));
	}

	async validate(id: string): Promise<LegacyRepositoryConnectionStatus> {
		const repository = await this.getStoredRepository(id);
		await this.inspectRepository(repository);
		const updated = await this.repositoryStore.updateValidationStatus(id, 'available');
		return {
			validationStatus: updated?.validationStatus || 'available',
			lastValidatedAt: updated?.lastValidatedAt || new Date(),
		};
	}

	async listSnapshots(id: string, filters: unknown = {}): Promise<LegacyRepositorySnapshotPage> {
		const parsedFilters = snapshotFiltersSchema.safeParse(filters);
		if (!parsedFilters.success) {
			throw new AppError(400, 'Snapshot filters must be non-empty text values.');
		}
		const normalizedFilters: LegacyRepositorySnapshotFilters = {
			...parsedFilters.data,
			pageSize:
				parsedFilters.data.pageSize === 'all'
					? 'all'
					: (parsedFilters.data.pageSize as LegacyRepositorySnapshotPageSize),
		};

		const snapshots = await this.inspectRepository(await this.getStoredRepository(id));
		await this.repositoryStore.updateValidationStatus(id, 'available');

		const orderedSnapshots = [...snapshots].sort((left, right) => {
			const leftTime = Date.parse(left.time);
			const rightTime = Date.parse(right.time);
			return (Number.isNaN(rightTime) ? 0 : rightTime) - (Number.isNaN(leftTime) ? 0 : leftTime);
		});
		const advancedFiltered = this.filterSnapshots(orderedSnapshots, normalizedFilters, false);
		const workloads = discoverLegacyWorkloads(advancedFiltered);
		const datasets = discoverLegacyDatasets(advancedFiltered, normalizedFilters.workload);
		const filtered = this.filterSnapshots(advancedFiltered, normalizedFilters, true);
		const total = filtered.length;
		const pageSize = normalizedFilters.pageSize as LegacyRepositorySnapshotPageSize;
		const totalPages = total === 0 ? 0 : pageSize === 'all' ? 1 : Math.ceil(total / pageSize);
		const page = totalPages === 0 ? 1 : Math.min(normalizedFilters.page || 1, totalPages);
		const start = pageSize === 'all' ? 0 : (page - 1) * pageSize;
		const end = pageSize === 'all' ? total : start + pageSize;

		return {
			items: filtered.slice(start, end),
			total,
			page,
			pageSize,
			totalPages,
			workloads,
			datasets,
		};
	}

	async getSnapshot(id: string, snapshotId: string): Promise<LegacyRepositorySnapshot> {
		if (!fullSnapshotId.test(snapshotId)) {
			throw new AppError(400, 'A full snapshot ID is required.');
		}
		const snapshots = await this.listSnapshots(id, { pageSize: 'all' });
		const snapshot = snapshots.items.find(candidate => candidate.id.toLowerCase() === snapshotId.toLowerCase());
		if (!snapshot) {
			throw new NotFoundError('Snapshot not found.');
		}
		return snapshot;
	}

	async getStats(id: string): Promise<LegacyRepositoryStats> {
		const repository = await this.getStoredRepository(id);
		try {
			const stats = await this.inspector.getRepositoryStats(
				repository.repositoryPath,
				this.decryptPassword(repository)
			);
			await this.repositoryStore.updateValidationStatus(id, 'available');
			return stats;
		} catch (error) {
			await this.markUnavailable(id);
			throw this.toSafeInspectionError(error);
		}
	}

	async listSnapshotDirectory(
		id: string,
		snapshotId: string,
		snapshotPath: unknown = ''
	): Promise<LegacySnapshotDirectory> {
		this.requireSnapshotId(snapshotId);
		const normalizedPath = normalizeLegacySnapshotPath(snapshotPath);
		const repository = await this.getStoredRepository(id);
		await this.getStoredSnapshot(repository, snapshotId);
		try {
			const result = await this.inspector.listSnapshotDirectory(
				repository.repositoryPath,
				this.decryptPassword(repository),
				snapshotId,
				normalizedPath
			);
			await this.repositoryStore.updateValidationStatus(id, 'available');
			return result;
		} catch (error) {
			if (!(error instanceof LegacyRepositoryInspectionError && error.kind === 'snapshot-path-not-found')) {
				await this.markUnavailable(id);
			}
			throw this.toSafeInspectionError(error);
		}
	}

	async startRestore(id: string, input: unknown): Promise<LegacyRestoreJobPublic> {
		const parsed = restoreRequestSchema.safeParse(input);
		if (!parsed.success) {
			throw new AppError(400, 'A full snapshot ID and one or more safe snapshot paths are required.');
		}
		const selectedPaths = this.normalizeRestorePaths(parsed.data.paths);
		const repository = await this.getStoredRepository(id);
		await this.getStoredSnapshot(repository, parsed.data.snapshotId);
		await this.assertRestoreSourceSeparated(repository.repositoryPath);
		const password = this.decryptPassword(repository);
		await this.validateRestoreSelections(repository, password, parsed.data.snapshotId, selectedPaths);

		const workspace = await this.createRestoreWorkspace();
		const store = this.requireRestoreJobStore();
		let created: LegacyRestoreJob | null;
		try {
			created = await store.create({
				id: workspace.jobId,
				repositoryId: repository.id,
				snapshotId: parsed.data.snapshotId,
				selectedPaths,
				stagingPath: workspace.path,
				status: 'queued',
			});
		} catch {
			await this.removeWorkspace(workspace.path);
			throw new AppError(500, 'Could not create the restore job.');
		}
		if (!created) {
			await this.removeWorkspace(workspace.path);
			throw new AppError(500, 'Could not create the restore job.');
		}

		queueMicrotask(() => {
			void this.runRestore(created.id);
		});
		return this.toPublicRestoreJob(created);
	}

	async getRestoreJob(id: string, jobId: string): Promise<LegacyRestoreJobPublic> {
		await this.getStoredRepository(id);
		return this.toPublicRestoreJob(await this.getRestoreJobForRepository(id, jobId));
	}

	async cancelRestore(id: string, jobId: string): Promise<LegacyRestoreJobPublic> {
		await this.getStoredRepository(id);
		const job = await this.getRestoreJobForRepository(id, jobId);
		if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
			return this.toPublicRestoreJob(job);
		}

		const store = this.requireRestoreJobStore();
		// Stop an already registered child immediately. The durable transition
		// below remains conditional, and the executor's pending-cancellation guard
		// closes the gap before a child process is registered.
		const executorCancellationRequested =
			job.status === 'running' ? this.restoreExecutor.cancel(job.id) : false;
		const cancelled = await store.cancelIfActive(job.id);
		if (cancelled) {
			if (!executorCancellationRequested && (job.status === 'running' || cancelled.startedAt !== null)) {
				this.restoreExecutor.cancel(job.id);
			}
			return this.toPublicRestoreJob(cancelled);
		}
		const latest = await store.getByIdAndRepository(job.id, id);
		if (latest?.status === 'running') {
			this.restoreExecutor.cancel(job.id);
		}
		return this.toPublicRestoreJob(latest || job);
	}

	async openRestoredFile(
		id: string,
		jobId: string,
		restorePath: unknown
	): Promise<{ fileHandle: FileHandle; fileName: string; size: number }> {
		await this.getStoredRepository(id);
		const job = await this.getRestoreJobForRepository(id, jobId);
		if (job.status !== 'completed') {
			throw new AppError(409, 'Files can be downloaded only after the restore job completes.');
		}

		const relativePath = normalizeLegacySnapshotPath(restorePath, false);
		const workspace = await this.assertWorkspace(job);
		const candidate = resolvePathWithin(workspace, relativePath);
		let metadata;
		try {
			metadata = await lstat(candidate);
		} catch {
			throw new NotFoundError('Restored file not found.');
		}
		if (!metadata.isFile() || metadata.isSymbolicLink()) {
			throw new AppError(400, 'Only restored regular files can be downloaded.');
		}

		const workspaceRealPath = await this.safeRealpath(workspace);
		const fileRealPath = await this.safeRealpath(candidate);
		if (!isPathWithin(workspaceRealPath, fileRealPath)) {
			throw new AppError(403, 'Restored file is not safe to download.');
		}

		let fileHandle: FileHandle;
		try {
			const noFollow = process.platform === 'win32' ? 0 : constants.O_NOFOLLOW;
			// Open the canonical path we just verified so a final-path symlink swap
			// cannot redirect the handle between realpath/lstat and open. POSIX also
			// gets O_NOFOLLOW as defense in depth for the remaining parent-path race.
			fileHandle = await open(fileRealPath, constants.O_RDONLY | noFollow);
		} catch {
			throw new NotFoundError('Restored file not found.');
		}
		let openedMetadata;
		try {
			openedMetadata = await fileHandle.stat();
		} catch {
			await fileHandle.close();
			throw new NotFoundError('Restored file not found.');
		}
		if (!openedMetadata.isFile()) {
			await fileHandle.close();
			throw new AppError(400, 'Only restored regular files can be downloaded.');
		}

		return {
			fileHandle,
			fileName: this.sanitizeDownloadFilename(path.basename(relativePath)),
			size: openedMetadata.size,
		};
	}

	async recoverInterruptedRestores(): Promise<void> {
		if (!this.restoreJobStore) return;
		await this.restoreJobStore.markInterruptedAsFailed();
	}

	async deleteRegistration(id: string): Promise<void> {
		await this.getStoredRepository(id);
		const deleted = await this.repositoryStore.delete(id);
		if (!deleted) {
			throw new NotFoundError('Legacy repository not found.');
		}
	}

	private validateRegistration(input: LegacyRepositoryRegistration): LegacyRepositoryRegistration {
		if (input.repositoryPath.includes('\0') || !path.isAbsolute(input.repositoryPath)) {
			throw new AppError(400, 'Repository path must be an absolute local filesystem path.');
		}
		return input;
	}

	private async getStoredRepository(id: string): Promise<LegacyRepository> {
		if (!id || typeof id !== 'string') {
			throw new AppError(400, 'Legacy repository ID is required.');
		}
		const repository = await this.repositoryStore.getById(id);
		if (!repository) {
			throw new NotFoundError('Legacy repository not found.');
		}
		if (repository.backend !== 'local' || repository.isReadOnly !== true) {
			throw new AppError(409, 'This legacy repository is not available for read-only inspection.');
		}
		return repository;
	}

	private requireSnapshotId(snapshotId: string): void {
		if (!fullSnapshotId.test(snapshotId)) {
			throw new AppError(400, 'A full snapshot ID is required.');
		}
	}

	private async getStoredSnapshot(repository: LegacyRepository, snapshotId: string): Promise<LegacyRepositorySnapshot> {
		this.requireSnapshotId(snapshotId);
		const snapshots = await this.inspectRepository(repository);
		const snapshot = snapshots.find(candidate => candidate.id.toLowerCase() === snapshotId.toLowerCase());
		if (!snapshot) {
			throw new NotFoundError('Snapshot not found.');
		}
		return snapshot;
	}

	private normalizeRestorePaths(paths: string[]): string[] {
		const normalized = paths.map(selectedPath => normalizeLegacySnapshotPath(selectedPath, false));
		const unique = [...new Set(normalized)].sort();
		if (unique.length !== normalized.length) {
			throw new AppError(400, 'Each restore path may be selected only once.');
		}
		for (let index = 0; index < unique.length; index += 1) {
			for (let nextIndex = index + 1; nextIndex < unique.length; nextIndex += 1) {
				if (unique[nextIndex].startsWith(`${unique[index]}/`)) {
					throw new AppError(400, 'Do not select a path together with one of its descendants.');
				}
			}
		}
		return unique;
	}

	private async validateRestoreSelections(
		repository: LegacyRepository,
		password: string,
		snapshotId: string,
		selectedPaths: string[]
	): Promise<void> {
		try {
			for (const selectedPath of selectedPaths) {
				const parentPath = getLegacySnapshotParent(selectedPath);
				const directory = await this.inspector.listSnapshotDirectory(
					repository.repositoryPath,
					password,
					snapshotId,
					parentPath
				);
				const entry = directory.entries.find(candidate => candidate.path === selectedPath);
				if (!entry) {
					throw new NotFoundError('Selected snapshot path not found.');
				}
				this.assertRestorableEntry(entry);
			}
			await this.repositoryStore.updateValidationStatus(repository.id, 'available');
		} catch (error) {
			if (error instanceof AppError) throw error;
			await this.markUnavailable(repository.id);
			throw this.toSafeInspectionError(error);
		}
	}

	private assertRestorableEntry(entry: LegacySnapshotEntry): void {
		if (entry.type === 'symlink') {
			throw new AppError(400, 'Symlinks cannot be selected as an individual restore target.');
		}
		if (entry.type !== 'file' && entry.type !== 'directory') {
			throw new AppError(400, 'Only regular files and directories can be restored.');
		}
	}

	private getLegacyRestoreRoot(): string {
		return path.resolve(this.legacyRestoreRoot || appPaths.getLegacyRestoresDir());
	}

	private async assertRestoreSourceSeparated(repositoryPath: string): Promise<string> {
		const stagingRoot = this.getLegacyRestoreRoot();
		const lexicalRepositoryPath = path.resolve(repositoryPath);
		const lexicalStagingRoot = path.resolve(stagingRoot);
		if (this.pathsOverlap(lexicalRepositoryPath, lexicalStagingRoot)) {
			throw new AppError(409, 'The legacy repository path overlaps the restore staging area.');
		}

		try {
			const [repositoryRealPath, stagingRealPath] = await Promise.all([
				realpath(repositoryPath),
				realpath(stagingRoot),
			]);
			if (this.pathsOverlap(repositoryRealPath, stagingRealPath)) {
				throw new AppError(409, 'The legacy repository path overlaps the restore staging area.');
			}
			return repositoryRealPath;
		} catch (error) {
			if (error instanceof AppError) throw error;
			throw new AppError(500, 'Could not verify restore staging separation.');
		}
	}

	private pathsOverlap(left: string, right: string): boolean {
		return path.resolve(left) === path.resolve(right) || isPathWithin(left, right) || isPathWithin(right, left);
	}

	private async createRestoreWorkspace(): Promise<{ jobId: string; path: string }> {
		const root = await this.prepareLegacyRestoreRoot();

		for (let attempt = 0; attempt < 5; attempt += 1) {
			const jobId = generateUID(24);
			const workspacePath = resolvePathWithin(root, `restore-job-${jobId}`);
			try {
				await mkdir(workspacePath, { mode: 0o700 });
				return { jobId, path: workspacePath };
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue;
				throw new AppError(500, 'Could not create an isolated restore workspace.');
			}
		}
		throw new AppError(500, 'Could not allocate an isolated restore workspace.');
	}

	private async prepareLegacyRestoreRoot(): Promise<string> {
		const root = this.getLegacyRestoreRoot();
		try {
			await mkdir(root, { recursive: true, mode: 0o700 });
			const metadata = await lstat(root);
			if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
				throw new Error('Legacy restore root is not a regular directory.');
			}
			await chmod(root, 0o700);
			return root;
		} catch {
			throw new AppError(500, 'Could not prepare the isolated restore staging area.');
		}
	}

	private async removeWorkspace(workspacePath: string): Promise<void> {
		try {
			const root = this.getLegacyRestoreRoot();
			if (!isPathWithin(root, workspacePath)) return;
			await rm(workspacePath, { recursive: true, force: true });
		} catch {
			// A failed cleanup must not hide the primary safe API error.
		}
	}

	private async assertWorkspace(job: LegacyRestoreJob): Promise<string> {
		if (!restoreJobId.test(job.id)) {
			throw new AppError(500, 'Restore workspace is invalid.');
		}
		const root = this.getLegacyRestoreRoot();
		const expectedPath = resolvePathWithin(root, `restore-job-${job.id}`);
		if (path.resolve(job.stagingPath) !== expectedPath) {
			throw new AppError(500, 'Restore workspace is invalid.');
		}
		let rootMetadata;
		let metadata;
		try {
			rootMetadata = await lstat(root);
			metadata = await lstat(expectedPath);
		} catch {
			throw new AppError(500, 'Restore workspace is unavailable.');
		}
		if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
			throw new AppError(500, 'Restore workspace is invalid.');
		}
		if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
			throw new AppError(500, 'Restore workspace is invalid.');
		}
		const rootRealPath = await this.safeRealpath(root);
		const workspaceRealPath = await this.safeRealpath(expectedPath);
		if (!isPathWithin(rootRealPath, workspaceRealPath)) {
			throw new AppError(500, 'Restore workspace is invalid.');
		}
		return expectedPath;
	}

	private async safeRealpath(filePath: string): Promise<string> {
		try {
			return await realpath(filePath);
		} catch {
			throw new NotFoundError('Restored file not found.');
		}
	}

	private async getRestoreJobForRepository(repositoryId: string, jobId: string): Promise<LegacyRestoreJob> {
		if (!restoreJobId.test(jobId)) {
			throw new AppError(400, 'Restore job ID is required.');
		}
		const job = await this.requireRestoreJobStore().getByIdAndRepository(jobId, repositoryId);
		if (!job) {
			throw new NotFoundError('Restore job not found.');
		}
		return job;
	}

	private requireRestoreJobStore(): LegacyRestoreJobStore {
		if (!this.restoreJobStore) {
			throw new AppError(500, 'Restore job storage is unavailable.');
		}
		return this.restoreJobStore;
	}

	private async runRestore(jobId: string): Promise<void> {
		const store = this.requireRestoreJobStore();
		const queuedJob = await store.getById(jobId);
		if (!queuedJob || queuedJob.status !== 'queued') return;

		let job: LegacyRestoreJob;
		try {
			await this.assertWorkspace(queuedJob);
			const repository = await this.getStoredRepository(queuedJob.repositoryId);
			const running = await store.markRunningIfQueued(queuedJob.id);
			if (!running) return;
			job = running;
			const repositoryRealPath = await this.assertRestoreSourceSeparated(repository.repositoryPath);
			const stagingPath = await this.assertWorkspace(job);
			const currentBeforeExecution = await store.getById(job.id);
			if (!currentBeforeExecution || currentBeforeExecution.status !== 'running') return;
			const result = await this.restoreExecutor.restoreSnapshot({
				jobId: job.id,
				repositoryPath: repositoryRealPath,
				password: this.decryptPassword(repository),
				snapshotId: job.snapshotId,
				selectedPaths: job.selectedPaths,
				stagingPath,
			});
			const current = await store.getById(job.id);
			if (!current || current.status === 'cancelled') return;
			await store.completeIfRunning(job.id, {
				restoredFileCount: result.restoredFileCount,
				restoredBytes: result.restoredBytes,
			});
		} catch (error) {
			const current = await store.getById(jobId);
			if (!current || current.status === 'cancelled') return;
			const cancelled = error instanceof LegacyRepositoryRestoreError && error.kind === 'cancelled';
			const finalJob = cancelled
				? await store.cancelIfRunning(jobId)
				: await store.failIfActive(jobId, this.toSafeRestoreError(error));
			if (finalJob && error instanceof LegacyRepositoryRestoreError && error.kind === 'repository-unavailable') {
				await this.markUnavailable(finalJob.repositoryId);
			}
		}
	}

	private toPublicRestoreJob(job: LegacyRestoreJob): LegacyRestoreJobPublic {
		return {
			id: job.id,
			repositoryId: job.repositoryId,
			snapshotId: job.snapshotId,
			selectedPaths: job.selectedPaths,
			status: job.status,
			errorMessage: job.errorMsg,
			restoredFileCount: job.restoredFileCount,
			restoredBytes: job.restoredBytes,
			stagingArea: 'isolated',
			createdAt: job.createdAt,
			startedAt: job.startedAt,
			completedAt: job.completedAt,
			updatedAt: job.updatedAt,
		};
	}

	private sanitizeDownloadFilename(filename: string): string {
		const sanitized = filename.replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(0, 180).trim();
		return sanitized || 'restored-file';
	}

	private async inspectRegistration(repositoryPath: string, password: string): Promise<void> {
		try {
			await this.inspector.listSnapshots(repositoryPath, password);
		} catch (error) {
			throw this.toSafeInspectionError(error);
		}
	}

	private async inspectRepository(repository: LegacyRepository): Promise<LegacyRepositorySnapshot[]> {
		try {
			return await this.inspector.listSnapshots(repository.repositoryPath, this.decryptPassword(repository));
		} catch (error) {
			await this.markUnavailable(repository.id);
			throw this.toSafeInspectionError(error);
		}
	}

	private async markUnavailable(id: string): Promise<void> {
		try {
			await this.repositoryStore.updateValidationStatus(id, 'unavailable');
		} catch {
			// A local status update must not hide the original safe inspection error.
		}
	}

	private filterSnapshots(
		snapshots: LegacyRepositorySnapshot[],
		filters: LegacyRepositorySnapshotFilters,
		includeGrouping: boolean
	): LegacyRepositorySnapshot[] {
		return snapshots.filter(snapshot => {
			if (filters.tag && !snapshot.tags.includes(filters.tag)) return false;
			if (filters.path && !snapshot.paths.includes(filters.path)) return false;
			if (filters.host && snapshot.hostname !== filters.host) return false;
			if (includeGrouping && (filters.workload || filters.dataset)) {
				const groupings = getLegacySnapshotGroupings(snapshot);
				if (
					!groupings.some(
						grouping =>
							(!filters.workload || grouping.workload === filters.workload) &&
							(!filters.dataset || grouping.dataset === filters.dataset)
					)
				) {
					return false;
				}
			}
			return true;
		});
	}

	private encryptPassword(password: string): string {
		const secret = configService.config.SECRET;
		if (!secret) {
			throw new AppError(503, 'Legacy repository credentials are unavailable until Pluton setup is complete.');
		}
		return new Cryptr(secret).encrypt(password);
	}

	private decryptPassword(repository: LegacyRepository): string {
		const secret = configService.config.SECRET;
		if (!secret) {
			throw new AppError(503, 'Legacy repository credentials are unavailable until Pluton setup is complete.');
		}
		try {
			return new Cryptr(secret).decrypt(repository.encryptedPassword);
		} catch {
			throw new AppError(500, 'Legacy repository credentials cannot be accessed.');
		}
	}

	private toPublic(repository: LegacyRepository): LegacyRepositoryPublic {
		const { encryptedPassword: _encryptedPassword, ...publicRepository } = repository;
		return publicRepository;
	}

	private toSafeInspectionError(error: unknown): AppError {
		if (error instanceof AppError) return error;
		if (error instanceof LegacyRepositoryInspectionError) {
			switch (error.kind) {
				case 'wrong-password':
					return new AppError(400, 'Repository credentials could not be verified.');
				case 'repository-unavailable':
					return new AppError(400, 'Repository could not be accessed.');
				case 'timeout':
					return new AppError(504, 'Repository inspection timed out.');
				case 'invalid-output':
					return new AppError(422, 'Repository returned unsupported inspection data.');
				case 'snapshot-path-not-found':
					return new NotFoundError('Snapshot path not found.');
				case 'output-limit':
					return new AppError(422, 'Repository inspection output is too large.');
				case 'forbidden-operation':
					return new AppError(403, 'That repository operation is not allowed.');
				default:
					return new AppError(502, 'Repository inspection failed.');
			}
		}
		return new AppError(502, 'Repository inspection failed.');
	}

	private toSafeRestoreError(error: unknown): string {
		if (error instanceof LegacyRepositoryRestoreError) {
			switch (error.kind) {
				case 'wrong-password':
					return 'Repository credentials could not be verified.';
				case 'repository-unavailable':
					return 'Repository could not be accessed.';
				case 'timeout':
					return 'Restore timed out.';
				case 'output-limit':
					return 'Restore output exceeded the safe limit.';
				default:
					return 'Restore failed.';
			}
		}
		if (error instanceof AppError) {
			return error.statusCode === 404 ? 'Restore workspace is unavailable.' : 'Restore failed.';
		}
		return 'Restore failed.';
	}
}
