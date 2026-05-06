import { EventEmitter } from 'events';
import { getBackupPlanStats } from '../../utils/restic/restic';
import { generateResticRepoPath } from '../../utils/restic/helpers';
import { ProgressManager } from '../ProgressManager';
import { ReplicationHandler } from './ReplicationHandler';
import { BackupMirror } from '../../types/backups';
import { ResolvedReplicationStorage } from '../../types/events';

/**
 * Orchestrates the full replication lifecycle: init handshake, snapshot copy
 * (with automatic retries), stats collection, and failure notifications.
 *
 * Delegates the low-level `restic copy` work to `ReplicationHandler`.
 * Called by `BackupHandler` (Phase 4) and `BaseBackupManager` (manual retry).
 */
export class ReplicationOrchestrator {
	private replicationHandler: ReplicationHandler;

	constructor(
		private emitter: EventEmitter,
		private progressManager: ProgressManager,
		private cancelledBackups: Set<string>
	) {
		this.replicationHandler = new ReplicationHandler(emitter, progressManager, cancelledBackups);
	}

	// ─── Phase 4: called from BackupHandler.execute() ──────────────────

	/**
	 * Runs the full replication phase: init → copy → retry → stats → notify.
	 * Replication failures do NOT propagate — they are caught and logged.
	 */
	async run(planId: string, backupId: string, options: Record<string, any>): Promise<void> {
		const { replication, prune, encryption } = options.settings;
		const sourceRepoPath = generateResticRepoPath(options.storage.name, options.storagePath || '');
		const maxRetries = options.settings.retries || 0;
		const retryDelaySec = options.settings.retryDelay || 30;

		try {
			await this.updateProgress(planId, backupId, 'replication', 'REPLICATION_START', false);

			// Emit replication_init event — ReplicationEventService resolves storage names &
			// creates initial replication entries on the backup record, then emits replication_init_complete.
			this.emitter.emit('replication_init', {
				planId,
				backupId,
				replicationStorages: replication.storages,
			});

			// Wait for the ReplicationEventService to respond with resolved storage names
			const resolvedStorages = await this.waitForReplicationInit(planId, backupId);

			// Run replications with resolved storage data
			let results = await this.replicationHandler.replicateSnapshot(
				planId,
				backupId,
				sourceRepoPath,
				encryption,
				resolvedStorages,
				prune,
				replication.concurrent,
				{ attempts: 0, maxAttempts: maxRetries }
			);

			// Retry failed mirrors up to maxRetries times
			results = await this.retryLoop(planId, backupId, results, resolvedStorages, {
				sourceRepoPath,
				encryption,
				prune,
				concurrent: replication.concurrent,
				maxRetries,
				retryDelaySec,
			});

			// Update progress
			const allSucceeded = results.every(m => m.status === 'completed');
			const allFailed = results.every(m => m.status === 'failed');
			await this.updateProgress(
				planId,
				backupId,
				'replicating',
				allSucceeded ? 'REPLICATION_COMPLETE' : 'REPLICATION_PARTIAL_FAILURE',
				true,
				allFailed ? 'All replications failed' : undefined
			);

			// Collect and emit mirror stats for completed replications
			await this.collectAndEmitMirrorStats(planId, backupId, results, encryption);

			// Trigger replication failure notification if any failed
			if (!allSucceeded) {
				this.emitter.emit('replication_partial_failure', { planId, backupId, mirrors: results });
			}
		} catch (error: any) {
			const errorMsg = error?.message || 'Unknown Error';
			await this.updateProgress(
				planId,
				backupId,
				'replicating',
				'REPLICATION_FAILED',
				true,
				errorMsg
			);
			// Replication failure should NOT fail the backup
			console.warn(
				`[ReplicationOrchestrator]: Replication phase failed for plan: ${planId}. Error: ${errorMsg}`
			);
		}
	}

	// ─── Manual retry: called from BackupHandler.retryFailedReplications() ─

	/**
	 * Retries failed replication operations for a specific backup.
	 * Runs synchronously (awaited), so the ReplicationRetryTask properly tracks success/failure.
	 */
	async retryFailedReplications(
		planId: string,
		backupId: string,
		options: Record<string, any>,
		failedReplicationIds: string[]
	): Promise<BackupMirror[]> {
		const { replication, prune, encryption } = options.settings;
		const sourceRepoPath = generateResticRepoPath(options.storage.name, options.storagePath || '');

		// Filter plan storages to only the failed ones
		const failedReplicationStorages = replication.storages.filter((s: any) =>
			failedReplicationIds.includes(s.replicationId)
		);

		// Emit replication_init with isRetry flag — resets only the failed mirrors to 'pending'
		this.emitter.emit('replication_init', {
			planId,
			backupId,
			replicationStorages: failedReplicationStorages,
			isRetry: true,
		});

		// Wait for resolved storage names
		const resolvedStorages = await this.waitForReplicationInit(planId, backupId);

		await this.updateProgress(
			planId,
			backupId,
			'replication',
			'REPLICATION_MANUAL_RETRY_START',
			false
		);

		// Run replications for the failed storages
		const results = await this.replicationHandler.replicateSnapshot(
			planId,
			backupId,
			sourceRepoPath,
			encryption,
			resolvedStorages,
			prune,
			replication.concurrent,
			{ attempts: 0, maxAttempts: 0 }
		);

		const allSucceeded = results.every(m => m.status === 'completed');

		await this.updateProgress(
			planId,
			backupId,
			'replication',
			allSucceeded
				? 'REPLICATION_MANUAL_RETRY_COMPLETE'
				: 'REPLICATION_MANUAL_RETRY_PARTIAL_FAILURE',
			true,
			allSucceeded
				? undefined
				: `${results.filter(m => m.status === 'failed').length} replication(s) still failed`
		);

		// Collect and emit mirror stats for completed replications
		await this.collectAndEmitMirrorStats(planId, backupId, results, encryption);

		if (!allSucceeded) {
			this.emitter.emit('replication_partial_failure', { planId, backupId, mirrors: results });
		}

		return results;
	}

	// ─── Cancellation ──────────────────────────────────────────────────

	/**
	 * Cancels any active replication processes for the given backup.
	 */
	async cancelReplications(backupId: string): Promise<void> {
		await this.replicationHandler.cancelReplications(backupId);
	}

	// ─── Private helpers ───────────────────────────────────────────────

	/**
	 * Automatic retry loop for failed mirrors during the normal replication phase.
	 */
	private async retryLoop(
		planId: string,
		backupId: string,
		results: BackupMirror[],
		resolvedStorages: ResolvedReplicationStorage[],
		ctx: {
			sourceRepoPath: string;
			encryption: boolean;
			prune: any;
			concurrent: boolean;
			maxRetries: number;
			retryDelaySec: number;
		}
	): Promise<BackupMirror[]> {
		let attempt = 0;
		while (attempt < ctx.maxRetries) {
			const failedResults = results.filter(m => m.status === 'failed');
			if (failedResults.length === 0) break;

			// Check for cancellation before retrying
			if (this.cancelledBackups.has(planId + backupId)) break;

			attempt++;
			const failedReplicationIds = new Set(failedResults.map(m => m.replicationId));

			// Notify progress of scheduled retry — write to each failed mirror's events
			for (const replicationId of failedReplicationIds) {
				await this.progressManager.updateReplicationAction(
					planId,
					backupId,
					replicationId,
					`REPLICATION_RETRY_${attempt}_OF_${ctx.maxRetries}_SCHEDULED`,
					false
				);
			}

			// Wait for retryDelay before retrying
			const delayMs = ctx.retryDelaySec * 1000;
			await new Promise(resolve => setTimeout(resolve, delayMs));

			// Check for cancellation after delay
			if (this.cancelledBackups.has(planId + backupId)) break;

			for (const replicationId of failedReplicationIds) {
				await this.progressManager.updateReplicationAction(
					planId,
					backupId,
					replicationId,
					`REPLICATION_RETRY_${attempt}_OF_${ctx.maxRetries}_START`,
					false
				);
			}

			// Filter resolvedStorages to only include the failed ones
			const failedStorages = resolvedStorages.filter(s =>
				failedReplicationIds.has(s.replicationId)
			);

			// Retry only the failed storages (replicateSnapshot re-initializes progress internally)
			const retryResults = await this.replicationHandler.replicateSnapshot(
				planId,
				backupId,
				ctx.sourceRepoPath,
				ctx.encryption,
				failedStorages,
				ctx.prune,
				ctx.concurrent,
				{ attempts: attempt, maxAttempts: ctx.maxRetries }
			);

			// Merge: keep successful results from previous attempts, replace failed with retry results
			const successfulPrevious = results.filter(m => m.status === 'completed');
			const retryResultMap = new Map(retryResults.map(m => [m.replicationId, m]));
			const updatedFailed = failedResults.map(m => retryResultMap.get(m.replicationId) || m);
			results = [...successfulPrevious, ...updatedFailed];
		}

		return results;
	}

	/**
	 * Collects mirror stats (size + snapshots) for completed replications
	 * and emits events to persist them to the backup record and plan stats.
	 */
	private async collectAndEmitMirrorStats(
		planId: string,
		backupId: string,
		results: BackupMirror[],
		encryption: boolean
	): Promise<void> {
		const completedResults = results.filter(m => m.status === 'completed');
		if (completedResults.length === 0) return;

		try {
			const mirrorStats = await Promise.all(
				completedResults.map(async m => {
					try {
						const stats = await getBackupPlanStats(
							planId,
							m.storageName,
							m.storagePath,
							encryption
						);
						return stats
							? {
									replicationId: m.replicationId,
									storageId: m.storageId,
									storagePath: m.storagePath,
									size: stats.total_size,
									snapshots: stats.snapshots,
								}
							: {
									replicationId: m.replicationId,
									storageId: m.storageId,
									storagePath: m.storagePath,
									size: 0,
									snapshots: [] as string[],
								};
					} catch {
						return {
							replicationId: m.replicationId,
							storageId: m.storageId,
							storagePath: m.storagePath,
							size: 0,
							snapshots: [] as string[],
						};
					}
				})
			);

			// Persist mirror sizes to the backup record
			this.emitter.emit('backup_mirror_sizes_update', {
				backupId,
				mirrorSizes: mirrorStats.map(ms => ({
					replicationId: ms.replicationId,
					storageId: ms.storageId,
					storagePath: ms.storagePath,
					size: ms.size,
				})),
			});

			// Emit stats update with mirrors data for plan stats
			this.emitter.emit('backup_replication_stats_update', {
				planId,
				backupId,
				mirrors: mirrorStats,
			});
		} catch (statsErr) {
			// Non-fatal
		}
	}

	/**
	 * Waits for the ReplicationEventService to resolve storage names and create
	 * initial mirror entries, then returns the resolved storages.
	 */
	private waitForReplicationInit(
		planId: string,
		backupId: string
	): Promise<ResolvedReplicationStorage[]> {
		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.emitter.removeListener('replication_init_complete', onReplicationInitComplete);
				reject(
					new Error(`Timeout: Did not receive replication_init_complete for backup: ${backupId}`)
				);
			}, 30000);

			const onReplicationInitComplete = (data: {
				planId: string;
				backupId: string;
				resolvedStorages: ResolvedReplicationStorage[];
			}) => {
				if (data.backupId === backupId && data.planId === planId) {
					clearTimeout(timeout);
					this.emitter.removeListener('replication_init_complete', onReplicationInitComplete);
					resolve(data.resolvedStorages);
				}
			};

			this.emitter.on('replication_init_complete', onReplicationInitComplete);
		});
	}

	/**
	 * Helper to update backup progress with error handling.
	 */
	private async updateProgress(
		planId: string,
		backupId: string,
		phase: string,
		action: string,
		completed: boolean,
		error?: string
	): Promise<void> {
		try {
			await this.progressManager.updateAction(planId, backupId, phase, action, completed, error);
		} catch (error) {
			console.warn(`Warning: Failed to update progress for ${phase}/${action}: ${error}`);
		}
	}
}
