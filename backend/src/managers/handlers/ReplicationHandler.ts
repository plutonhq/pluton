import { EventEmitter } from 'events';
import { runResticCommand } from '../../utils/restic/restic';
import { generateResticRepoPath } from '../../utils/restic/helpers';
import { normalizeStorageName } from '../../utils/helpers';
import { processManager } from '../ProcessManager';
import { PruneHandler } from './PruneHandler';
import { ProgressManager } from '../ProgressManager';
import { configService } from '../../services/ConfigService';
import { PlanPrune } from '../../types/plans';
import { BackupMirror } from '../../types/backups';
import { ResolvedReplicationStorage } from '../../types/events';

// restic prints a progress line on each tick even when stuck, so the stall check uses the pack count.
const COPY_STALL_TIMEOUT_MS = 60 * 60 * 1000;
const REPO_COMMAND_TIMEOUT_MS = 2 * 60 * 1000;

export class ReplicationHandler {
	private initializedRepos = new Set<string>();
	private activeMirrors = new Map<string, Set<string>>(); // backupId -> Set<replicationId>

	constructor(
		private emitter: EventEmitter,
		private progressManager: ProgressManager,
		private cancelledBackups: Set<string>
	) {}

	/**
	 * Replicates a snapshot to all configured storage destinations.
	 */
	async replicateSnapshot(
		planId: string,
		backupId: string,
		sourceRepoPath: string,
		sourceEncryption: boolean,
		resolvedStorages: ResolvedReplicationStorage[],
		pruneSettings: PlanPrune,
		concurrent: boolean,
		retryInfo: { attempts: number; maxAttempts: number }
	): Promise<BackupMirror[]> {
		const password = sourceEncryption ? configService.config.ENCRYPTION_KEY : '';

		// Initialize replication progress entries
		const replicationInfos = resolvedStorages.map(s => ({
			replicationId: s.replicationId,
			storageId: s.storageId,
			storageName: s.storageName,
			storageType: s.storageType,
		}));
		await this.progressManager.initializeReplications(planId, backupId, replicationInfos);

		if (concurrent) {
			// Run all replications concurrently
			const results = await Promise.all(
				resolvedStorages.map(storage =>
					this.replicateToStorage(
						planId,
						backupId,
						sourceRepoPath,
						password,
						sourceEncryption,
						storage,
						pruneSettings,
						retryInfo
					)
				)
			);
			return results;
		} else {
			// Run replications sequentially
			const results: BackupMirror[] = [];
			for (let i = 0; i < resolvedStorages.length; i++) {
				if (this.cancelledBackups.has(planId + backupId)) {
					// Mark remaining mirrors as failed
					for (let j = i; j < resolvedStorages.length; j++) {
						results.push({
							replicationId: resolvedStorages[j].replicationId,
							storageId: resolvedStorages[j].storageId,
							storageName: resolvedStorages[j].storageName,
							storagePath: resolvedStorages[j].storagePath,
							storageType: resolvedStorages[j].storageType,
							status: 'failed',
							error: 'Cancelled by user',
						});
					}
					break;
				}
				const result = await this.replicateToStorage(
					planId,
					backupId,
					sourceRepoPath,
					password,
					sourceEncryption,
					resolvedStorages[i],
					pruneSettings,
					retryInfo
				);
				results.push(result);
			}
			return results;
		}
	}

	/**
	 * Replicates a snapshot to a single storage destination.
	 */
	private async replicateToStorage(
		planId: string,
		backupId: string,
		sourceRepoPath: string,
		password: string,
		encryption: boolean,
		storage: ResolvedReplicationStorage,
		pruneSettings: PlanPrune,
		retryInfo: { attempts: number; maxAttempts: number }
	): Promise<BackupMirror> {
		const { replicationId, storageId, storagePath, storageName, storageType } = storage;
		const mirror: BackupMirror = {
			replicationId,
			storageId,
			storageName,
			storagePath,
			status: 'started',
			started: Date.now(),
			storageType: storageType,
		};

		// Track this replication as active
		if (!this.activeMirrors.has(backupId)) {
			this.activeMirrors.set(backupId, new Set());
		}
		this.activeMirrors.get(backupId)!.add(replicationId);
		const destRepoPath = generateResticRepoPath(normalizeStorageName(storageName), storagePath);
		const processKey = `replication-${backupId}-${replicationId}`;

		try {
			// Check for cancellation
			if (this.cancelledBackups.has(planId + backupId)) {
				throw new Error('Cancelled by user');
			}

			// Emit replication start event — ReplicationEventService will update the store
			this.emitter.emit('replication_start', {
				planId,
				backupId,
				replicationId,
				storageId,
				storageName,
				storagePath,
				storageType,
			});

			// Update progress
			await this.progressManager.updateReplicationAction(
				planId,
				backupId,
				replicationId,
				'REPLICATION_START',
				false
			);

			// Step 1: Ensure replication repo is initialized (with chunker params from source)
			try {
				await this.ensureRepoInitialized(
					destRepoPath,
					sourceRepoPath,
					password,
					encryption,
					planId,
					backupId,
					replicationId,
					!!storage.hadSnapshots
				);
			} catch (initError: any) {
				const initMsg = initError?.message || 'Unknown init error';
				await this.progressManager.updateReplicationAction(
					planId,
					backupId,
					replicationId,
					'REPLICATION_INIT_FAILED',
					true,
					initMsg
				);
				throw initError;
			}

			// Check for cancellation
			if (this.cancelledBackups.has(planId + backupId)) {
				throw new Error('Cancelled by user');
			}

			// Step 2: Unlock stale locks (non-fatal)
			await this.progressManager.updateReplicationAction(
				planId,
				backupId,
				replicationId,
				'REPLICATION_UNLOCK_START',
				true
			);
			try {
				const unlockArgs = ['unlock', '-r', destRepoPath];
				if (!encryption) unlockArgs.push('--insecure-no-password');
				await runResticCommand(
					unlockArgs,
					{ RESTIC_PASSWORD: password },
					undefined,
					undefined,
					undefined,
					process => {
						processManager.trackProcess(processKey, process);
					},
					{ timeout: REPO_COMMAND_TIMEOUT_MS }
				);
			} catch (err) {
				// Non-fatal - swallow errors
			}

			await this.progressManager.updateReplicationAction(
				planId,
				backupId,
				replicationId,
				'REPLICATION_COPY_START',
				true
			);

			// A cancel during unlock should cancel the unlock process and the rest
			if (this.cancelledBackups.has(planId + backupId)) {
				throw new Error('Cancelled by user');
			}

			// Step 3: Run restic copy
			const copyArgs = [
				'-r',
				destRepoPath,
				'copy',
				'--from-repo',
				sourceRepoPath,
				'--tag',
				`plan-${planId}`,
				'--tag',
				`backup-${backupId}`,
			];
			if (!encryption) {
				copyArgs.push('--insecure-no-password');
				copyArgs.push('--from-insecure-no-password');
			}

			const copyEnv: Record<string, string> = {
				RESTIC_PASSWORD: password,
				RESTIC_FROM_PASSWORD: password,
				RESTIC_PROGRESS_FPS: String(1 / 60),
			};

			let lastPacksCopied = -1;
			let lastCopyActivity = Date.now();
			let copyStalled = false;
			const copyStallTimer = setInterval(() => {
				if (Date.now() - lastCopyActivity < COPY_STALL_TIMEOUT_MS) return;
				copyStalled = true;
				processManager.killProcess(processKey);
			}, 60_000);

			try {
				await runResticCommand(
					copyArgs,
					copyEnv,
					(data: Buffer) => {
						// restic copy outputs plain text, not JSON.
						// Parse stdout lines to emit synthetic progress events.
						const line = data.toString().trim();
						if (!line) return;

						// Detect pack progress lines like "[12:01] 100.00%  14 / 14 packs copied"
						const packMatch = line.match(
							/\[[\d:]+\]\s+([\d.]+)%\s+(\d+)\s*\/\s*(\d+)\s+packs?\s+copied/
						);
						if (!packMatch || parseInt(packMatch[2]) !== lastPacksCopied) {
							lastCopyActivity = Date.now();
							if (packMatch) lastPacksCopied = parseInt(packMatch[2]);
						}

						// Detect "copy started" lines
						const copyStartMatch = line.match(/copy started/i);
						if (copyStartMatch) {
							this.progressManager
								.updateReplicationResticProgress(planId, backupId, replicationId, line)
								.catch(() => {});
							this.emitter.emit('replication_progress', {
								planId,
								backupId,
								replicationId,
								storageId,
								storagePath,
								data: { message_type: 'status', info: line },
							});
							return;
						}

						if (packMatch) {
							const [, percent, copied, total] = packMatch;
							const progressData = {
								message_type: 'status',
								percent_done: parseFloat(percent) / 100,
								packs_copied: parseInt(copied),
								packs_total: parseInt(total),
							};
							this.progressManager
								.updateReplicationResticProgress(
									planId,
									backupId,
									replicationId,
									JSON.stringify(progressData)
								)
								.catch(() => {});
							this.emitter.emit('replication_progress', {
								planId,
								backupId,
								replicationId,
								storageId,
								storagePath,
								data: progressData,
							});
							return;
						}

						// Detect "snapshot XX saved" lines
						const savedMatch = line.match(/snapshot\s+(\w+)\s+saved/i);
						if (savedMatch) {
							this.progressManager
								.updateReplicationResticProgress(planId, backupId, replicationId, line)
								.catch(() => {});
							this.emitter.emit('replication_progress', {
								planId,
								backupId,
								replicationId,
								storageId,
								storagePath,
								data: {
									message_type: 'status',
									info: `Snapshot ${savedMatch[1]} saved`,
								},
							});
							return;
						}

						// Forward any other output as-is
						this.progressManager
							.updateReplicationResticProgress(planId, backupId, replicationId, line)
							.catch(() => {});
					},
					(_: Buffer) => {
						// console.log('### Restic Copy Error :', data.toString());
					},
					undefined,
					process => {
						processManager.trackProcess(processKey, process);
					}
				);
			} catch (copyError) {
				if (copyStalled) {
					throw new Error(
						`Replication stalled: no packs copied for ${COPY_STALL_TIMEOUT_MS / 60000} minutes`
					);
				}
				throw copyError;
			} finally {
				clearInterval(copyStallTimer);
			}

			// Check for cancellation after copy
			if (this.cancelledBackups.has(planId + backupId)) {
				throw new Error('Cancelled by user');
			}

			// Update progress
			await this.progressManager.updateReplicationAction(
				planId,
				backupId,
				replicationId,
				'REPLICATION_COPY_COMPLETE',
				true
			);

			// Step 4: Prune replication repo (non-fatal)
			try {
				await this.progressManager.updateReplicationAction(
					planId,
					backupId,
					replicationId,
					'REPLICATION_PRUNE_START',
					false
				);
				const pruneHandler = new PruneHandler(this.emitter);
				const pruneOptions = {
					storage: { name: storageName },
					storagePath,
					settings: {
						prune: pruneSettings,
						encryption,
					},
				};
				if (this.cancelledBackups.has(planId + backupId)) {
					throw new Error('Cancelled by user');
				}
				await pruneHandler.prune(planId, pruneOptions, false, process =>
					processManager.trackProcess(processKey, process)
				);
				await this.progressManager.updateReplicationAction(
					planId,
					backupId,
					replicationId,
					'REPLICATION_PRUNE_COMPLETE',
					true
				);
			} catch (pruneErr: any) {
				await this.progressManager.updateReplicationAction(
					planId,
					backupId,
					replicationId,
					'REPLICATION_PRUNE_FAILED',
					true,
					pruneErr.message
				);
			}

			// Mark mirror as completed
			mirror.status = 'completed';
			mirror.ended = Date.now();
			await this.progressManager.updateReplicationAction(
				planId,
				backupId,
				replicationId,
				'REPLICATION_COMPLETE',
				true
			);

			// Emit replication complete event — ReplicationEventService will update the store
			this.emitter.emit('replication_complete', {
				planId,
				backupId,
				replicationId,
				storageId,
				storageName,
				storagePath,
				storageType,
				success: true,
			});

			return mirror;
		} catch (error: any) {
			// The repo is gone: the next run must check it again instead of trusting the cache
			if (error?.code === 10) this.initializedRepos.delete(destRepoPath);
			const errorMessage = error?.message || 'Unknown replication error';
			mirror.status = 'failed';
			mirror.ended = Date.now();
			mirror.error = errorMessage;

			await this.progressManager.updateReplicationAction(
				planId,
				backupId,
				replicationId,
				'REPLICATION_FAILED',
				true,
				errorMessage
			);

			// Emit replication complete event with failure — ReplicationEventService will update the store
			const errorCode = typeof error?.code === 'number' ? error.code : undefined;
			this.emitter.emit('replication_complete', {
				planId,
				backupId,
				replicationId,
				storageId,
				storageName,
				storagePath,
				storageType,
				success: false,
				error: errorMessage,
				...(errorCode !== undefined ? { errorCode } : {}),
			});

			return mirror;
		} finally {
			// Remove from active replications tracking
			this.activeMirrors.get(backupId)?.delete(replicationId);
			if (this.activeMirrors.get(backupId)?.size === 0) {
				this.activeMirrors.delete(backupId);
			}
		}
	}

	/**
	 * Ensures the replication repository is initialized. Caches init state.
	 */
	private async ensureRepoInitialized(
		repoPath: string,
		sourceRepoPath: string,
		password: string,
		encryption: boolean,
		planId: string,
		backupId: string,
		replicationId: string,
		hadSnapshots = false
	): Promise<void> {
		if (this.initializedRepos.has(repoPath)) {
			return;
		}

		const trackProcess = (process: any) => {
			if (backupId && replicationId) {
				processManager.trackProcess(`replication-${backupId}-${replicationId}`, process);
			}
		};

		try {
			// Check if the repo exists in replication storage
			const checkArgs = ['cat', 'config', '--no-lock', '-r', repoPath];
			if (!encryption) checkArgs.push('--insecure-no-password');
			await runResticCommand(
				checkArgs,
				{ RESTIC_PASSWORD: password },
				undefined,
				undefined,
				undefined,
				trackProcess,
				{ timeout: REPO_COMMAND_TIMEOUT_MS }
			);
			this.initializedRepos.add(repoPath);
		} catch (error: any) {
			if (error.code === 10 && hadSnapshots) {
				const MIRROR_REPO_MISSING_MESSAGE =
					'The mirror repository is missing. It had backups before, so Pluton did not create it again. To start a new repository, remove this mirror from the plan and add it again.';
				const missing: Error & { code?: number } = new Error(MIRROR_REPO_MISSING_MESSAGE);
				missing.code = 10;
				throw missing;
			} else if (error.code === 10) {
				// Repo doesn't exist
				await this.progressManager.updateReplicationAction(
					planId,
					backupId,
					replicationId,
					'REPLICATION_INIT_START',
					false
				);

				//initialize it with chunker params from source for deduplication
				try {
					const initArgs = [
						'-r',
						repoPath,
						'init',
						'--from-repo',
						sourceRepoPath,
						'--copy-chunker-params',
					];
					if (!encryption) {
						initArgs.push('--insecure-no-password');
						initArgs.push('--from-insecure-no-password');
					}
					const initEnv: Record<string, string> = {
						RESTIC_PASSWORD: password,
						RESTIC_FROM_PASSWORD: password,
					};
					await runResticCommand(initArgs, initEnv, undefined, undefined, undefined, trackProcess, {
						timeout: 10 * 60 * 1000,
					});
					this.initializedRepos.add(repoPath);
					await this.progressManager.updateReplicationAction(
						planId,
						backupId,
						replicationId,
						'REPLICATION_INIT_COMPLETE',
						true
					);
				} catch (initError: any) {
					// If init also fails with "already initialized", that's OK
					if (initError.message?.includes('already initialized')) {
						this.initializedRepos.add(repoPath);
					} else {
						throw initError;
					}
				}
			} else if (error.code === 11) {
				// failed to lock repo - likely due to stale lock from previous replication attempt.
				// do not throw we want to attempt to unlock and continue - the copy command will handle any remaining lock issues.
				console.log(
					'Repo is locked, likely from a previous failed replication attempt. Will attempt to unlock and continue.',
					repoPath
				);
			} else {
				throw error;
			}
		}
	}

	/**
	 * Cancel all running replication processes for a backup.
	 * Uses internal tracking of active replications instead of querying the store.
	 */
	async cancelReplications(backupId: string): Promise<void> {
		const replicationIds = this.activeMirrors.get(backupId);
		if (replicationIds) {
			for (const replicationId of replicationIds) {
				try {
					processManager.killProcess(`replication-${backupId}-${replicationId}`);
				} catch (error) {
					// Ignore errors when killing processes
				}
			}
		}
	}
}
