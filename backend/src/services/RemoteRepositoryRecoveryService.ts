import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import Cryptr from 'cryptr';
import { Writable } from 'stream';
import { BackupStore } from '../stores/BackupStore';
import { PlanStore } from '../stores/PlanStore';
import { RestoreStore } from '../stores/RestoreStore';
import { AgentStore } from '../stores/AgentStore';
import { RemoteManagedRepositoryStore } from '../stores/RemoteManagedRepositoryStore';
import { Restore } from '../db/schema/restores';
import { RestoreConfig, RestoreStats } from '../types/restores';
import { SnapShotFile } from '../types/restic';
import { AppError, NotFoundError } from '../utils/AppError';
import { appPaths } from '../utils/AppPaths';
import {
	isPathWithin,
	normalizeLegacySnapshotPath,
	resolvePathWithin,
} from '../utils/legacySnapshotPath';
import { planLogger } from '../utils/logger';
import {
	fullSnapshotId,
	ManagedRepositoryAccessError,
	ManagedRepositorySession,
	ManagedRepositorySessionProvider,
	ManagedSftpAccess,
	ManagedSftpRepositorySession,
} from '../utils/restic/ManagedSftpRepositorySession';
import { configService } from './ConfigService';
import { RemoteBackupService } from './RemoteBackupService';
import {
	checkRecoveryCancellation,
	recoveryArtifacts,
	RecoveryTestError,
	validateRestoredFiles,
} from '../utils/recoveryValidation';
import type { RecoveryStage } from '../types/recoveryTests';

type RecoveryContext = {
	backupId: string;
	planId: string;
	storageId: string;
	repositoryId: string;
	snapshotId: string;
	sourcePaths: string[];
	access: ManagedSftpAccess;
};
type Selection = { files: SnapShotFile[]; includes: string[]; full: boolean; stats: RestoreStats };

export type ManagedArchiveDownload = {
	fileName: string;
	streamTo: (destination: Writable, signal: AbortSignal, ready: () => void) => Promise<void>;
};

/**
 * Consumes managed Phase 4 metadata; never registers a Legacy repository, uses
 * the backup lifecycle executor, or issues commands to a source agent.
 */
export class RemoteRepositoryRecoveryService {
	private readonly jobs = new Map<string, { controller: AbortController; done: Promise<void> }>();
	private readonly preparing = new Set<string>();

	constructor(
		private readonly repositories: RemoteManagedRepositoryStore,
		private readonly backups: BackupStore,
		private readonly plans: PlanStore,
		private readonly restores: RestoreStore,
		private readonly remoteBackups: Pick<RemoteBackupService, 'getSftpRecoveryOptions'>,
		private readonly agents: Pick<AgentStore, 'getAgentById'>,
		private readonly sessions: ManagedRepositorySessionProvider = new ManagedSftpRepositorySession(),
		private readonly secret = configService.config.SECRET,
		private readonly stagingRoot = path.join(appPaths.getDataDir(), 'managed-remote-restores')
	) {}

	/** Metadata only. Source agent identity is checked in SQLite, never contacted. */
	async testBinding(backupId: string, planId?: string) {
		const context = await this.context(backupId, planId);
		return {
			planId: context.planId,
			backupId,
			repositoryId: context.repositoryId,
			snapshotId: context.snapshotId,
		};
	}

	/** Bounded read-only metadata preview. The authenticated completion receipt supplies
	 * engine/name/hash; the exact repository snapshot proves paths and sizes. SQL hash
	 * verification is deliberately still mandatory after restore, before any import. */
	async testMetadata(backupId: string, planId: string, snapshotId: string) {
		const context = await this.context(backupId, planId);
		if (context.snapshotId !== snapshotId)
			throw new RecoveryTestError('snapshot-validation', 'snapshot-binding-mismatch');
		const backup = await this.backups.getById(backupId);
		const entries = recoveryArtifacts(backup?.completionStats?.lifecycle);
		return this.sessions.withSession(context.access, async session => {
			const files = await this.boundFiles(context, session);
			for (const entry of entries) {
				const file = files.find(file => file.path === entry.path);
				if (!file || file.type !== 'file' || file.size !== entry.bytes)
					throw new RecoveryTestError(
						'database-artifact-validation',
						'database-metadata-incomplete'
					);
			}
			if (
				files.some(
					file =>
						file.type === 'file' &&
						file.path.startsWith('/pluton/database/') &&
						!entries.some(entry => entry.path === file.path)
				)
			)
				throw new RecoveryTestError('database-artifact-validation', 'database-metadata-incomplete');
			const current = await this.context(backupId, planId);
			const currentBackup = await this.backups.getById(backupId);
			if (
				current.repositoryId !== context.repositoryId ||
				current.snapshotId !== snapshotId ||
				JSON.stringify(recoveryArtifacts(currentBackup?.completionStats?.lifecycle)) !==
					JSON.stringify(entries)
			)
				throw new RecoveryTestError('snapshot-validation', 'snapshot-binding-mismatch');
			return {
				planId,
				backupId,
				repositoryId: context.repositoryId,
				snapshotId,
				databases: entries,
			};
		});
	}

	/** Same allowlisted Phase 4 session/selection/restore, with a caller-owned private workspace. */
	async testRestore(
		binding: { backupId: string; planId: string; repositoryId: string; snapshotId: string },
		target: string,
		signal: AbortSignal,
		stage: (value: RecoveryStage) => void,
		assertWorkspace: () => Promise<void>,
		maxBytes = 1024 ** 4,
		cleanupWarning?: () => void
	) {
		stage('snapshot-validation');
		const context = await this.context(binding.backupId, binding.planId);
		if (context.snapshotId !== binding.snapshotId || context.repositoryId !== binding.repositoryId)
			throw new RecoveryTestError('snapshot-validation', 'snapshot-binding-mismatch');
		stage('repository-access');
		await assertWorkspace(); // before creating any temporary session credentials
		return this.sessions.withSession(
			context.access,
			async session => {
				stage('snapshot-validation');
				const listed = await this.boundFiles(context, session);
				if (listed.some(node => !['file', 'dir'].includes(node.type)))
					throw new RecoveryTestError('snapshot-validation', 'unsupported-snapshot-file');
				const selection = this.select(listed, {
					target: '',
					overwrite: 'never',
					delete: false,
					includes: [],
					excludes: [],
				});
				const snapshot = await session.snapshot(context.snapshotId);
				// Restic paths may record Phase 5 dump files by their agent-private
				// absolute cwd, while the listing exposes /pluton/database/*.sql.
				// For historical rows use only directory sources proven by the exact
				// snapshot listing, never guess that every snapshot path is a source tree.
				const sources = context.sourcePaths.length
					? context.sourcePaths
					: snapshot.paths.filter(value =>
							selection.files.some(node => node.path === value && node.type === 'dir')
						);
				if (
					!sources.length ||
					sources.some(
						source =>
							!source.startsWith('/') ||
							!snapshot.paths.includes(source) ||
							!selection.files.some(node => node.path === source && node.type === 'dir')
					)
				)
					throw new RecoveryTestError('snapshot-validation', 'source-tree-missing');
				if (
					!Number.isSafeInteger(selection.stats.total_bytes) ||
					selection.stats.total_bytes > maxBytes
				)
					throw new RecoveryTestError('staged-restore', 'workspace-size-limit');
				await assertWorkspace();
				const stat = await fs.lstat(target);
				if (!stat.isDirectory() || stat.isSymbolicLink() || (await fs.readdir(target)).length)
					throw new RecoveryTestError('staged-restore', 'unsafe-workspace');
				const disk = await fs.statfs(target);
				if (disk.bavail * disk.bsize < selection.stats.total_bytes + 512 * 1024 ** 2)
					throw new RecoveryTestError('staged-restore', 'insufficient-space');
				stage('staged-restore');
				checkRecoveryCancellation(signal);
				await session.restore(context.snapshotId, [], target);
				await assertWorkspace();
				stage('filesystem-validation');
				const measured = await validateRestoredFiles(selection.files, target, signal);
				await this.boundFiles(context, session); // exact binding remains valid, not latest
				const current = await this.context(binding.backupId, binding.planId);
				if (
					current.snapshotId !== context.snapshotId ||
					current.repositoryId !== context.repositoryId
				)
					throw new RecoveryTestError('snapshot-validation', 'snapshot-binding-mismatch');
				for (const source of sources) {
					const stat = await fs.lstat(
						resolvePathWithin(target, normalizeLegacySnapshotPath(source.slice(1), false))
					);
					if (!stat.isDirectory() || stat.isSymbolicLink())
						throw new RecoveryTestError('filesystem-validation', 'source-tree-missing');
				}
				return {
					...measured,
					sourceTrees: sources.length,
					integrity: 'restic-restore-and-structure' as const,
					databaseArtifactPaths: selection.files
						.filter(node => node.type === 'file' && node.path.startsWith('/pluton/database/'))
						.map(node => node.path),
				};
			},
			signal,
			{ restoreTimeoutMs: 24 * 60 * 60_000, temporaryRoot: path.dirname(target), cleanupWarning }
		);
	}

	/** Persistent DB restore stages ONLY the selected receipt-proven SQL file.
	 * No source-agent call, full filesystem restore, or repository mutation. */
	async databaseRestoreArtifact(
		binding: {backupId:string;planId:string;repositoryId:string;snapshotId:string;databaseId:string;sha256:string},
		target: string, signal: AbortSignal, assertWorkspace: () => Promise<void>
	) {
		const metadata=await this.testMetadata(binding.backupId,binding.planId,binding.snapshotId);
		const entry=metadata.databases.find(value=>value.databaseId===binding.databaseId);
		if(!entry || entry.sha256!==binding.sha256 || metadata.repositoryId!==binding.repositoryId ||
			/[*?[\]\\]/.test(entry.path))
			throw new RecoveryTestError('snapshot-validation','snapshot-binding-mismatch');
		const context=await this.context(binding.backupId,binding.planId);
		return this.sessions.withSession(context.access,async session=>{
			await assertWorkspace();
			const files=await this.boundFiles(context,session);
			const selected=files.find(file=>file.path===entry.path && file.type==='file' && file.size===entry.bytes);
			if(!selected) throw new RecoveryTestError('snapshot-validation','snapshot-binding-mismatch');
			const stat=await fs.lstat(target),disk=await fs.statfs(target);
			if(!stat.isDirectory() || stat.isSymbolicLink() || (await fs.readdir(target)).length)
				throw new RecoveryTestError('staged-restore','unsafe-workspace');
			if(disk.bavail*disk.bsize<entry.bytes+512*1024**2)
				throw new RecoveryTestError('staged-restore','insufficient-space');
			checkRecoveryCancellation(signal);
			await session.restore(binding.snapshotId,[entry.path],target);
			await assertWorkspace();
			await validateRestoredFiles([selected],target,signal);
			await this.boundFiles(context,session);
			const current=await this.testMetadata(binding.backupId,binding.planId,binding.snapshotId);
			if(JSON.stringify(current)!==JSON.stringify(metadata))
				throw new RecoveryTestError('snapshot-validation','snapshot-binding-mismatch');
			return entry;
		},signal,{restoreTimeoutMs:60*60_000,temporaryRoot:path.dirname(target)});
	}

	async browse(backupId: string, replicationId?: string): Promise<SnapShotFile[]> {
		if (replicationId)
			throw new AppError(400, 'Remote recovery supports only the original managed repository.');
		const context = await this.context(backupId);
		return this.sessions.withSession(context.access, session => this.boundFiles(context, session));
	}

	/** Existing POST Download interaction: validate, but never materialize an archive. */
	async prepareDownload(backupId: string, replicationId?: string, signal?: AbortSignal) {
		if (replicationId)
			throw new AppError(400, 'Remote downloads support only the original managed repository.');
		const context = await this.context(backupId);
		await this.sessions.withSession(
			context.access,
			async session => {
				this.assertArchiveFiles(await this.boundFiles(context, session));
			},
			signal
		);
		return { streaming: true };
	}

	async download(backupId: string): Promise<ManagedArchiveDownload> {
		const context = await this.context(backupId);
		const safeId = context.backupId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80) || 'snapshot';
		return {
			fileName: `backup-${safeId}.tar`,
			streamTo: async (destination, signal, ready) => {
				let stage = 'repository-read';
				try {
					await this.sessions.withSession(
						context.access,
						async session => {
							this.assertArchiveFiles(await this.boundFiles(context, session));
							if (signal.aborted) throw new ManagedRepositoryAccessError('cancelled');
							stage = 'archive-stream';
							ready(); // headers are set only after exact snapshot/binding validation
							await session.archive(context.snapshotId, destination);
						},
						signal
					);
				} catch (error) {
					const safe =
						error instanceof AppError
							? error
							: new ManagedRepositoryAccessError('execution-failed');
					planLogger('download', context.planId, context.backupId).warn(
						{
							event: 'remote_download_failed',
							stage,
							code: signal.aborted
								? 'cancelled'
								: safe instanceof ManagedRepositoryAccessError
									? safe.code
									: 'validation-failed',
						},
						'Remote download failed.'
					);
					throw safe;
				}
			},
		};
	}

	private assertArchiveFiles(files: SnapShotFile[]) {
		if (files.some(file => !['file', 'dir'].includes(file.type) || file.path.includes(':')))
			throw new AppError(
				400,
				'Managed snapshot downloads support safe regular files and directories only.'
			);
	}

	async preview(backupId: string, config: RestoreConfig, planId?: string) {
		this.validateConfig(config);
		const context = await this.context(backupId, planId);
		return this.sessions.withSession(context.access, async session => {
			const selection = this.select(await this.boundFiles(context, session), config);
			return {
				stats: selection.stats,
				files: selection.files.map(file => ({ ...file, action: 'restored' })),
			};
		});
	}

	async restore(backupId: string, config: RestoreConfig, planId?: string): Promise<string> {
		this.validateConfig(config);
		if (this.preparing.has(backupId))
			throw new AppError(409, 'A staged restoration is already in progress.');
		this.preparing.add(backupId);
		let workspace: string | undefined;
		try {
			if (await this.restores.isRestoreRunning(backupId))
				throw new AppError(409, 'A restoration is already in progress.');
			const context = await this.context(backupId, planId);
			const selection = await this.sessions.withSession(context.access, async session =>
				this.select(await this.boundFiles(context, session), config)
			);
			const id = crypto.randomBytes(12).toString('hex');
			workspace = await this.createWorkspace(id);
			const filesRoot = path.join(workspace, 'files');
			await fs.mkdir(filesRoot, { mode: 0o700 });
			const target = config.target ? resolvePathWithin(filesRoot, config.target) : filesRoot;
			await fs.mkdir(target, { recursive: true, mode: 0o700 });
			await this.assertWorkspace(id, workspace);
			if (!isPathWithin(await fs.realpath(workspace), await fs.realpath(target)))
				throw new AppError(400, 'Invalid staging destination.');
			const row = await this.restores.create({
				id,
				backupId,
				planId: context.planId,
				storageId: context.storageId,
				// This restore executes on the server, so existing startup recovery
				// correctly fails interrupted jobs, not source-agent work.
				sourceId: 'main',
				sourceType: 'device',
				method: 'backup',
				status: 'started',
				inProgress: true,
				taskStats: { ...selection.stats, files_restored: 0, bytes_restored: 0 },
				config: {
					target,
					overwrite: 'never',
					includes: config.includes || [],
					excludes: config.excludes || [],
					delete: false,
					stagingOnly: true,
					snapshotId: context.snapshotId,
				},
			});
			if (!row) throw new AppError(500, 'Could not persist the staged restoration.');
			const controller = new AbortController();
			const done = this.runRestore(id, workspace, target, context, selection, controller.signal);
			this.jobs.set(id, { controller, done });
			void done
				.finally(() => this.jobs.delete(id))
				.catch(() => {
					planLogger('restore', context.planId, context.backupId).warn(
						{
							event: 'remote_staged_restore_persistence_failed',
							restoreId: id,
							code: 'result-persistence-failed',
						},
						'Staged restore status could not be persisted.'
					);
				});
			workspace = undefined; // the running job now owns cleanup
			return id;
		} catch (error) {
			if (workspace)
				await this.removeWorkspace(path.basename(workspace).slice('restore-'.length), workspace);
			if (error instanceof AppError) throw error;
			throw new AppError(500, 'Could not prepare the internal staged restoration.');
		} finally {
			this.preparing.delete(backupId);
		}
	}

	async cancel(row: Restore) {
		const job = this.jobs.get(row.id);
		if (job) {
			job.controller.abort();
			await job.done;
		} else if (row.inProgress)
			await this.restores.update(row.id, { status: 'cancelled', inProgress: false });
		return { success: true, result: 'Staged restore stopped.' };
	}

	progress(row: Restore) {
		return {
			planId: row.planId,
			backupId: row.backupId,
			restoreId: row.id,
			events: [
				{
					phase: row.inProgress ? 'restore' : 'finished',
					completed: !row.inProgress,
					timestamp: new Date().toISOString(),
					action: row.inProgress
						? 'RESTORE_OPERATION_START'
						: row.status === 'completed'
							? 'TASK_COMPLETED'
							: row.status === 'cancelled'
								? 'TASK_CANCELLED'
								: 'TASK_FAILED',
					message:
						row.errorMsg ||
						(row.inProgress
							? 'Restoring into internal server staging.'
							: 'Staged restoration finished.'),
					resticData: {
						...row.taskStats,
						message_type: row.status === 'completed' ? 'summary' : 'status',
						percent_done: row.status === 'completed' ? 1 : 0,
					},
					progress: {
						totalFilesProcessed: row.taskStats?.total_files || 0,
						filesProcessed: row.taskStats?.files_restored || 0,
						totalBytesProcessed: row.taskStats?.total_bytes || 0,
						bytesProcessed: row.taskStats?.bytes_restored || 0,
					},
				},
			],
			status: row.status,
			success: row.status === 'completed',
		};
	}

	async stats(row: Restore) {
		if (row.status !== 'completed')
			return { success: false, result: 'Staged restore results are not available.' };
		const workspace = this.workspacePath(row.id);
		await this.assertWorkspace(row.id, workspace);
		try {
			const file = path.join(workspace, 'stats.json');
			const stat = await fs.lstat(file);
			if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32 * 1024 * 1024)
				throw new Error('invalid artifact');
			return { success: true, result: JSON.parse(await fs.readFile(file, 'utf8')) };
		} catch {
			throw new AppError(404, 'Staged restore results are unavailable.');
		}
	}

	private async context(backupId: string, expectedPlanId?: string): Promise<RecoveryContext> {
		const backup = await this.backups.getById(backupId);
		if (!backup || !backup.planId) throw new NotFoundError('Backup not found.');
		if (expectedPlanId !== undefined && expectedPlanId !== backup.planId)
			throw new AppError(400, 'Backup does not belong to the requested plan.');
		if (
			!RemoteBackupService.isRemoteFilesystemPlan(backup) ||
			backup.method !== 'backup' ||
			backup.status !== 'completed' ||
			backup.inProgress ||
			backup.success === false
		) {
			throw new AppError(400, 'Only completed remote filesystem backups can be recovered.');
		}
		const plan = await this.plans.getById(backup.planId);
		const repository = await this.repositories.getByPlanId(backup.planId);
		const agent = repository ? await this.agents.getAgentById(repository.agentId) : null;
		if (
			!plan ||
			!repository ||
			!repository.initializedAt ||
			repository.planId !== plan.id ||
			!agent ||
			agent.deviceId !== backup.sourceId ||
			plan.sourceId !== backup.sourceId ||
			plan.sourceType !== backup.sourceType ||
			plan.method !== 'backup' ||
			repository.storageId !== backup.storageId ||
			plan.storageId !== backup.storageId ||
			repository.storagePath !== backup.storagePath ||
			plan.storagePath !== backup.storagePath
		) {
			throw new AppError(409, 'The managed repository binding is unavailable or has changed.');
		}
		const snapshotId = backup.completionStats?.snapshot_id;
		if (!fullSnapshotId.safeParse(snapshotId).success)
			throw new AppError(409, 'This backup has no complete, unambiguous snapshot ID.');
		let password: string;
		let options: Record<string, string>;
		try {
			password = new Cryptr(this.secret).decrypt(repository.encryptedPassword);
			options = await this.remoteBackups.getSftpRecoveryOptions(repository.storageId);
		} catch {
			throw new ManagedRepositoryAccessError('credentials-unavailable');
		}
		return {
			backupId,
			planId: plan.id,
			storageId: repository.storageId,
			repositoryId: repository.id,
			snapshotId: snapshotId!,
			sourcePaths: backup.completionStats?.sourcePaths || backup.sourceConfig?.includes || [],
			access: { options, password, repositoryPath: repository.storagePath },
		};
	}

	private async boundFiles(
		context: RecoveryContext,
		session: ManagedRepositorySession
	): Promise<SnapShotFile[]> {
		const snapshot = await session.snapshot(context.snapshotId);
		if (
			snapshot.id !== context.snapshotId ||
			!snapshot.tags.includes(`pluton-plan-${context.planId}`) ||
			!snapshot.tags.includes(`pluton-backup-${context.backupId}`)
		) {
			throw new AppError(409, 'Snapshot does not belong to this backup and managed repository.');
		}
		const files = await session.files(context.snapshotId);
		const seen = new Set<string>();
		return files.map(node => {
			if (!node.path.startsWith('/'))
				throw new AppError(400, 'Snapshot contains an unsafe logical path.');
			const relative = normalizeLegacySnapshotPath(node.path.slice(1), false);
			if (seen.has(relative)) throw new AppError(409, 'Snapshot contains ambiguous file paths.');
			seen.add(relative);
			return {
				name: path.posix.basename(node.path),
				path: `/${relative}`,
				srcPath: `/${relative}`,
				type: node.type,
				isDirectory: node.type === 'dir',
				size: node.size,
				modifiedAt: node.mtime,
				owner: '',
				permissions: String(node.mode || ''),
				isAvailable: true,
			};
		});
	}

	private validateConfig(config: RestoreConfig) {
		if (
			config.delete ||
			config.replicationId ||
			config.storageId ||
			config.fromStorage ||
			(config.overwrite !== undefined && config.overwrite !== 'never')
		) {
			throw new AppError(
				400,
				'Remote recovery is staging-only, without overwrite, deletion or alternate storage.'
			);
		}
		if (config.target !== undefined && config.target !== '') {
			const relative = normalizeLegacySnapshotPath(config.target, false);
			if (relative.includes(':'))
				throw new AppError(400, 'Staging subfolder must be a safe relative path.');
		}
		for (const paths of [config.includes || [], config.excludes || []]) {
			if (!Array.isArray(paths) || paths.length > 1024)
				throw new AppError(400, 'Invalid snapshot selection.');
			for (const file of paths) {
				if (typeof file !== 'string' || !file.startsWith('/'))
					throw new AppError(400, 'Select exact absolute snapshot paths.');
				normalizeLegacySnapshotPath(file.slice(1), false);
				if (/[*?[\]]/.test(file))
					throw new AppError(400, 'Wildcard selections are not supported for staged recovery.');
			}
		}
	}

	private select(files: SnapShotFile[], config: RestoreConfig): Selection {
		const includes = config.includes || [];
		const excludes = config.excludes || [];
		for (const selected of [...includes, ...excludes]) {
			if (!files.some(file => file.path === selected))
				throw new AppError(404, 'Selected snapshot path was not found.');
		}
		const contains = (selection: string, file: string) =>
			selection === file || file.startsWith(`${selection}/`);
		const selected = files.filter(
			file =>
				(!includes.length || includes.some(include => contains(include, file.path))) &&
				!excludes.some(exclude => contains(exclude, file.path))
		);
		// Restore materializes ancestors of a selected leaf; count them as directories,
		// never as regular files and never include a partial parent as a recursive filter.
		for (const directory of files.filter(file => file.type === 'dir')) {
			if (
				!selected.includes(directory) &&
				selected.some(file => contains(directory.path, file.path))
			)
				selected.push(directory);
		}
		// Do not create device nodes or symlink-mediated writes in server staging.
		if (selected.some(file => !['file', 'dir'].includes(file.type) || file.path.includes(':'))) {
			throw new AppError(400, 'Staged recovery supports regular files and directories only.');
		}
		const full = !includes.length && !excludes.length;
		const regularFiles = selected.filter(file => file.type === 'file');
		if (!selected.length) throw new AppError(400, 'No entries were selected for staged recovery.');
		if (!full && (regularFiles.length > 1024 || selected.some(file => /[*?[\]]/.test(file.path)))) {
			throw new AppError(
				400,
				'The granular selection is too large or contains wildcard filenames.'
			);
		}
		const bytes = regularFiles.reduce((sum, file) => sum + file.size, 0);
		const completeSubtrees = selected.filter(
			file =>
				file.type === 'dir' &&
				files.every(child => !contains(file.path, child.path) || selected.includes(child))
		);
		const selectedIncludes = [...completeSubtrees, ...regularFiles]
			.filter(
				file =>
					!completeSubtrees.some(parent => parent !== file && contains(parent.path, file.path))
			)
			.map(file => file.path);
		if (!full && !selectedIncludes.length)
			throw new AppError(
				400,
				'No safely restorable entries were selected. A non-empty directory cannot be restored as metadata only.'
			);
		if (!full && selectedIncludes.length > 1024)
			throw new AppError(400, 'The granular selection is too large.');
		return {
			files: selected,
			includes: full ? [] : selectedIncludes,
			full,
			stats: {
				total_files: regularFiles.length,
				files_restored: regularFiles.length,
				total_bytes: bytes,
				bytes_restored: bytes,
			},
		};
	}

	private workspacePath(id: string) {
		if (!/^[a-f0-9]{24}$/.test(id)) throw new AppError(400, 'Invalid staged restore ID.');
		return resolvePathWithin(this.stagingRoot, `restore-${id}`);
	}

	private async createWorkspace(id: string): Promise<string> {
		await fs.mkdir(this.stagingRoot, { recursive: true, mode: 0o700 });
		const root = await fs.lstat(this.stagingRoot);
		if (!root.isDirectory() || root.isSymbolicLink())
			throw new AppError(400, 'Internal staging root is unsafe.');
		await fs.chmod(this.stagingRoot, 0o700);
		const workspace = this.workspacePath(id);
		await fs.mkdir(workspace, { mode: 0o700 });
		return workspace;
	}

	private async assertWorkspace(id: string, workspace: string) {
		if (path.resolve(workspace) !== this.workspacePath(id))
			throw new AppError(400, 'Invalid restore workspace.');
		const root = await fs.lstat(this.stagingRoot);
		const stage = await fs.lstat(workspace);
		if (
			!root.isDirectory() ||
			root.isSymbolicLink() ||
			!stage.isDirectory() ||
			stage.isSymbolicLink() ||
			!isPathWithin(await fs.realpath(this.stagingRoot), await fs.realpath(workspace))
		) {
			throw new AppError(400, 'Internal staging workspace is unsafe.');
		}
	}

	private async removeWorkspace(id: string, workspace: string) {
		await this.assertWorkspace(id, workspace);
		await fs.rm(workspace, { recursive: true, force: true });
	}

	private async runRestore(
		id: string,
		workspace: string,
		target: string,
		context: RecoveryContext,
		selection: Selection,
		signal: AbortSignal
	) {
		let stage = 'repository-read';
		try {
			await this.sessions.withSession(
				context.access,
				async session => {
					// Reverify immutable ID/tags before execution; never fall back to latest.
					await this.boundFiles(context, session);
					await this.assertWorkspace(id, workspace);
					const targetStat = await fs.lstat(target);
					if (
						!targetStat.isDirectory() ||
						targetStat.isSymbolicLink() ||
						!isPathWithin(await fs.realpath(workspace), await fs.realpath(target))
					)
						throw new AppError(400, 'Invalid staging destination.');
					stage = 'staged-restore';
					return session.restore(context.snapshotId, selection.includes, target);
				},
				signal
			);
			if (signal.aborted) throw new ManagedRepositoryAccessError('cancelled');
			stage = 'staged-file-validation';
			// Restic 0.19.1 files_restored counts directory nodes too. Measure the
			// selected regular files actually written, not that mixed node count.
			const realTarget = await fs.realpath(target);
			let filesRestored = 0;
			let bytesRestored = 0;
			for (const file of selection.files.filter(file => file.type === 'file')) {
				const restoredPath = resolvePathWithin(target, file.path.slice(1));
				const stat = await fs.lstat(restoredPath);
				if (
					!stat.isFile() ||
					stat.isSymbolicLink() ||
					stat.size !== file.size ||
					!isPathWithin(realTarget, await fs.realpath(restoredPath))
				)
					throw new AppError(500, 'Staged file validation failed.');
				filesRestored++;
				bytesRestored += stat.size;
			}
			if (signal.aborted) throw new ManagedRepositoryAccessError('cancelled');
			stage = 'result-persistence';
			const stats = {
				...selection.stats,
				files_restored: filesRestored,
				bytes_restored: bytesRestored,
			};
			await fs.writeFile(
				path.join(workspace, 'stats.json'),
				JSON.stringify({
					planId: context.planId,
					backupId: context.backupId,
					restoreId: id,
					stats,
					restoredPaths: selection.files.map(file => ({
						path: file.path,
						size: file.size,
						isDirectory: file.isDirectory,
						action: 'restored',
					})),
				}),
				{ flag: 'wx', mode: 0o600 }
			);
			await this.restores.update(id, { status: 'completed', inProgress: false, taskStats: stats });
		} catch (error) {
			const code = signal.aborted
				? 'cancelled'
				: error instanceof ManagedRepositoryAccessError
					? error.code
					: 'staged-restore-failed';
			planLogger('restore', context.planId, context.backupId).warn(
				{ event: 'remote_staged_restore_failed', restoreId: id, stage, code },
				'Remote staged restore failed.'
			);
			try {
				await this.removeWorkspace(id, workspace);
			} catch {
				planLogger('restore', context.planId, context.backupId).warn(
					{ event: 'remote_staged_restore_cleanup_failed', restoreId: id, code: 'cleanup-failed' },
					'Staging cleanup failed.'
				);
			}
			await this.restores.update(id, {
				status: signal.aborted ? 'cancelled' : 'failed',
				inProgress: false,
				errorMsg: `Internal staged restore failed (${code}).`,
			});
		}
	}
}
