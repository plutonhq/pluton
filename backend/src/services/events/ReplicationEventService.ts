import { BaseBackupManager } from '../../managers/BaseBackupManager';
import { BackupStore } from '../../stores/BackupStore';
import { StorageStore } from '../../stores/StorageStore';
import { PlanStore } from '../../stores/PlanStore';
import { BackupNotification } from '../../notifications/BackupNotification';
import { planLogger } from '../../utils/logger';
import { BackupMirror } from '../../types/backups';
import {
	ReplicationStartEvent,
	ReplicationCompleteEvent,
	ReplicationInitEvent,
	ReplicationRetryEvent,
	ResolvedReplicationStorage,
} from '../../types/events';
import { ReplicationHandler } from '../../managers/handlers/ReplicationHandler';
import { ProgressManager } from '../../managers/ProgressManager';
import { appPaths } from '../../utils/AppPaths';

export class ReplicationEventService {
	protected backupNotification: BackupNotification;

	constructor(
		protected planStore: PlanStore,
		protected backupStore: BackupStore,
		protected storageStore: StorageStore,
		protected localAgent?: BaseBackupManager
	) {
		this.backupNotification = new BackupNotification();
	}

	/**
	 * Resolves storage names and creates initial mirror entries on the backup record.
	 * Emits `replication_init_complete` back to signal BackupHandler to proceed.
	 */
	async onReplicationInit(data: ReplicationInitEvent): Promise<void> {
		try {
			const resolvedStorages: ResolvedReplicationStorage[] = [];

			for (const ms of data.replicationStorages) {
				try {
					const storage = await this.storageStore.getById(ms.storageId);
					resolvedStorages.push({
						replicationId: ms.replicationId,
						storageId: ms.storageId,
						storagePath: ms.storagePath,
						storageName: storage?.name || '',
						storageType: storage?.type || '',
					});
				} catch (error: any) {
					resolvedStorages.push({
						replicationId: ms.replicationId,
						storageId: ms.storageId,
						storagePath: ms.storagePath,
						storageName: '',
						storageType: '',
					});
					planLogger('replication', data.planId, data.backupId).error(
						`Error resolving storage ${ms.storageId}: ${error?.message || 'Unknown Error'}`
					);
				}
			}

			if (data.isRetry) {
				// Retry mode: only reset the specified failed mirrors to 'pending', keep others intact
				for (const s of resolvedStorages) {
					await this.backupStore.updateMirrorStatus(data.backupId, s.replicationId, {
						status: 'pending',
						started: undefined,
						ended: undefined,
						error: undefined,
						storageName: s.storageName,
						storageType: s.storageType,
					});
				}
			} else {
				// Normal mode: create initial replication entries, replacing all mirrors
				const initialMirrors: BackupMirror[] = resolvedStorages.map(s => ({
					replicationId: s.replicationId,
					storageId: s.storageId,
					storageName: s.storageName,
					storagePath: s.storagePath,
					storageType: s.storageType,
					status: 'pending' as const,
				}));

				await this.backupStore.update(data.backupId, { mirrors: initialMirrors } as any);
			}

			// Emit back to BackupHandler with resolved data
			if (this.localAgent) {
				this.localAgent.emit('replication_init_complete', {
					planId: data.planId,
					backupId: data.backupId,
					resolvedStorages,
				});
			}
		} catch (error: any) {
			planLogger('replication', data.planId, data.backupId).error(
				`Error processing replication init event: ${error?.message || 'Unknown Error'}`
			);
		}
	}

	/**
	 * Handles replication retry by creating a fresh ReplicationHandler,
	 * resolving storage names, and running the replications.
	 */
	async onReplicationRetry(data: ReplicationRetryEvent): Promise<void> {
		try {
			// Resolve storage names for the failed storages
			const resolvedStorages: ResolvedReplicationStorage[] = [];
			for (const ms of data.replicationStorages) {
				try {
					const storage = await this.storageStore.getById(ms.storageId);
					resolvedStorages.push({
						replicationId: ms.replicationId,
						storageId: ms.storageId,
						storagePath: ms.storagePath,
						storageName: storage?.name || '',
						storageType: storage?.type || '',
					});
				} catch (error: any) {
					resolvedStorages.push({
						replicationId: ms.replicationId,
						storageId: ms.storageId,
						storagePath: ms.storagePath,
						storageName: '',
						storageType: '',
					});
				}
			}

			// Create a fresh ReplicationHandler for the retry
			const progressManager = new ProgressManager(appPaths.getProgressDir());
			await progressManager.initialize();

			const replicationHandler = new ReplicationHandler(
				this.localAgent!,
				progressManager,
				new Set()
			);

			// Update progress to indicate retry is starting
			await progressManager.updateAction(
				data.planId,
				data.backupId,
				'replication',
				'REPLICATION_MANUAL_RETRY_START',
				false
			);

			// Reset the retried mirrors to 'pending' in the DB before starting
			for (const storage of resolvedStorages) {
				await this.backupStore.updateMirrorStatus(data.backupId, storage.replicationId, {
					status: 'pending',
					started: undefined,
					ended: undefined,
					error: undefined,
				});
			}

			const results = await replicationHandler.replicateSnapshot(
				data.planId,
				data.backupId,
				data.sourceRepoPath,
				data.encryption,
				resolvedStorages,
				data.pruneSettings as any,
				data.concurrent,
				{ attempts: 0, maxAttempts: 0 }
			);

			// Explicitly update DB mirrors with final results to avoid event race conditions
			for (const mirror of results) {
				await this.backupStore.updateMirrorStatus(data.backupId, mirror.replicationId, {
					status: mirror.status,
					started: mirror.started,
					ended: mirror.ended,
					error: mirror.error,
				});
			}

			const allSucceeded = results.every(m => m.status === 'completed');
			if (!allSucceeded) {
				if (this.localAgent) {
					this.localAgent.emit('replication_partial_failure', {
						planId: data.planId,
						backupId: data.backupId,
						mirrors: results,
					});
				}
			}

			// Update progress with retry completion status
			await progressManager.updateAction(
				data.planId,
				data.backupId,
				'replication',
				allSucceeded
					? 'REPLICATION_MANUAL_RETRY_COMPLETE'
					: 'REPLICATION_MANUAL_RETRY_PARTIAL_FAILURE',
				true,
				allSucceeded
					? undefined
					: `${results.filter(m => m.status === 'failed').length} replication(s) still failed`
			);

			planLogger('replication', data.planId, data.backupId).info(
				`Replication retry completed. ${results.filter(m => m.status === 'completed').length}/${results.length} succeeded.`
			);
		} catch (error: any) {
			planLogger('replication', data.planId, data.backupId).error(
				`Replication retry failed: ${error?.message || 'Unknown Error'}`
			);
		}
	}

	async onReplicationStart(data: ReplicationStartEvent): Promise<void> {
		try {
			await this.backupStore.updateMirrorStatus(data.backupId, data.replicationId, {
				storageId: data.storageId,
				storageName: data.storageName,
				storagePath: data.storagePath,
				storageType: data.storageType,
				status: 'started',
				started: Date.now(),
			});
			planLogger('replication', data.planId, data.backupId).info(
				`Replication started for storage ${data.storageName} (${data.storageId})`
			);
		} catch (error: any) {
			planLogger('replication', data.planId, data.backupId).error(
				`Error processing replication start event: ${error?.message || 'Unknown Error'}`
			);
		}
	}

	async onReplicationComplete(data: ReplicationCompleteEvent): Promise<void> {
		try {
			await this.backupStore.updateMirrorStatus(data.backupId, data.replicationId, {
				storageId: data.storageId,
				storageName: data.storageName,
				storagePath: data.storagePath,
				storageType: data.storageType,
				status: data.success ? 'completed' : 'failed',
				ended: Date.now(),
				error: data.error,
			});

			if (data.success) {
				planLogger('replication', data.planId, data.backupId).info(
					`Replication completed for storage ${data.storageName} (${data.storageId})`
				);
			} else {
				planLogger('replication', data.planId, data.backupId).error(
					`Replication failed for storage ${data.storageName} (${data.storageId}): ${data.error || 'Unknown Error'}`
				);
			}
		} catch (error: any) {
			planLogger('replication', data.planId, data.backupId).error(
				`Error processing replication complete event: ${error?.message || 'Unknown Error'}`
			);
		}
	}

	async onReplicationPartialFailure(data: {
		planId: string;
		backupId: string;
		mirrors: BackupMirror[];
	}): Promise<void> {
		try {
			const failedMirrors = data.mirrors.filter(m => m.status === 'failed');
			const plan = await this.planStore.getById(data.planId);

			if (plan && plan.settings.notification) {
				const failedStorageNames = failedMirrors.map(m => m.storageName).join(', ');
				await this.backupNotification.send(
					plan,
					'replication_failure' as any,
					{
						id: data.backupId,
						startTime: new Date(),
						error: `Replication failed for storages: ${failedStorageNames}`,
						failedMirrors,
					} as any
				);
			}

			planLogger('replication', data.planId, data.backupId).error(
				`Replication partial failure: ${failedMirrors.length} replication(s) failed`
			);
		} catch (error: any) {
			planLogger('replication', data.planId, data.backupId).error(
				`Error processing replication partial failure: ${error?.message || 'Unknown Error'}`
			);
		}
	}

}
