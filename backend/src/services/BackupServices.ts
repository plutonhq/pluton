import { sql } from 'drizzle-orm';
import { BaseSnapshotManager } from '../managers/BaseSnapshotManager';
import { BackupStore } from '../stores/BackupStore';
import { StorageStore } from '../stores/StorageStore';
import { RestoreStore } from '../stores/RestoreStore';
import { PlanStore } from '../stores/PlanStore';
import {
	SnapshotStrategy,
	RemoteStrategy as RemoteSnapshotStrategy,
	LocalStrategy as LocalSnapshotStrategy,
} from '../strategies/snapshot';
import {
	BackupStrategy,
	RemoteStrategy as RemoteBackupStrategy,
	LocalStrategy as LocalBackupStrategy,
} from '../strategies/backup';
import { BaseBackupManager } from '../managers';
import { jobQueue } from '../jobs/JobQueue';
import { SnapShotFile } from '../types/restic';
import { Backup } from '../db/schema/backups';
import { BackupMirror } from '../types/backups';
import { PlanStats } from '../types/plans';
import { AppError, NotFoundError } from '../utils/AppError';

export class BackupService {
	constructor(
		protected localSnapshotAgent: BaseSnapshotManager,
		protected localPlanAgent: BaseBackupManager,
		protected planStore: PlanStore,
		protected backupStore: BackupStore,
		protected restoreStore: RestoreStore,
		protected storageStore: StorageStore
	) {}

	getSnapshotStrategy(deviceId: string, method?: string): SnapshotStrategy {
		const isRemote = deviceId !== 'main';
		return isRemote
			? new RemoteSnapshotStrategy(deviceId)
			: new LocalSnapshotStrategy(this.localSnapshotAgent);
	}

	getBackupStrategy(deviceId: string): BackupStrategy {
		const isRemote = deviceId !== 'main';
		return isRemote
			? new RemoteBackupStrategy(deviceId)
			: new LocalBackupStrategy(this.localPlanAgent);
	}

	async deleteBackup(backupId: string, removeSnapshot: boolean = false) {
		const backup = await this.backupStore.getById(backupId);
		if (!backup) {
			throw new Error('Backup not found');
		}

		const strategy = this.getSnapshotStrategy(backup.sourceId, backup.method);
		const storageName = await this.getStorageName(backup.storageId as string);
		const removeResult = await strategy.removeSnapshot(backup.planId as string, backupId, {
			storageName,
			storagePath: backup.storagePath || '',
			encryption: backup.encryption || true,
			mirrors: backup.mirrors || [],
		});

		// If snapshot removal fails, it should not throw an error
		// Because the snapshot might have been removed already by prune process

		if (removeResult.stats) {
			const primaryStats = removeResult.stats.primary;
			const mirrorStats = removeResult.stats.mirrors;
			const currentMirrors = (backup.mirrors || []) as BackupMirror[];
			const planStatsUpdate: PlanStats = {
				size: primaryStats?.total_size || 0,
				snapshots: primaryStats?.snapshots || [],
			};
			if (mirrorStats && Object.keys(mirrorStats).length > 0) {
				planStatsUpdate.mirrors = Object.entries(mirrorStats).map(([replicationId, stats]) => {
					const mirror = currentMirrors.find(m => m.replicationId === replicationId);
					return {
						replicationId: mirror?.replicationId || replicationId,
						storageId: mirror?.storageId || '',
						storagePath: mirror?.storagePath || '',
						size: stats.total_size,
						snapshots: stats.snapshots,
					};
				});
			}
			await this.planStore.update(backup.planId as string, {
				stats: planStatsUpdate,
			});
		}

		await this.backupStore.delete(backup.id);

		return removeResult;
	}

	async getBackupDownload(backupId: string): Promise<any> {
		const backup = await this.backupStore.getById(backupId);
		if (!backup) {
			throw new Error('Backup not found');
		}
		const backupDevice = backup.sourceId ? backup.sourceId : 'main';
		const strategy = this.getSnapshotStrategy(backupDevice, backup.method);
		const downloadResult = await strategy.getSnapshotDownload(backup.planId as string, backupId);
		if (!downloadResult.success) {
			throw new Error(
				typeof downloadResult.result === 'string'
					? downloadResult.result
					: 'Failed to get Backup Download'
			);
		}
		return downloadResult.result;
	}

	async generateBackupDownload(backupId: string, replicationId?: string): Promise<any> {
		const backup = await this.backupStore.getById(backupId);
		if (!backup) {
			throw new Error('Backup not found');
		}
		// If replicationId is provided, download from mirror storage
		let effectiveStorageId = backup.storageId as string;
		let effectiveStoragePath = backup.storagePath as string;
		if (replicationId) {
			const mirrors = (backup.mirrors || []) as BackupMirror[];
			const mirror = mirrors.find(m => m.replicationId === replicationId);
			if (mirror) {
				effectiveStorageId = mirror.storageId;
				effectiveStoragePath = mirror.storagePath;
			}
		}
		const backupDevice = backup.sourceId ? backup.sourceId : 'main';
		const strategy = this.getSnapshotStrategy(backupDevice, backup.method);
		const storageName = await this.getStorageName(effectiveStorageId);
		const downloadResult = await strategy.downloadSnapshot(backup.planId as string, backupId, '', {
			storageName,
			storagePath: effectiveStoragePath,
			encryption: backup.encryption || true,
		});
		if (!downloadResult.success) {
			throw new Error(downloadResult.result || 'Failed to generate Download Link');
		}
		return downloadResult.result;
	}

	async cancelBackupDownload(planId: string, backupId: string): Promise<any> {
		const backup = await this.backupStore.getById(backupId);
		if (!backup) {
			throw new Error('Backup not found');
		}
		const backupDevice = backup.sourceId ? backup.sourceId : 'main';
		const strategy = this.getSnapshotStrategy(backupDevice, backup.method);
		const downloadResult = await strategy.cancelSnapshotDownload(planId, backupId);
		if (!downloadResult.success) {
			throw new Error(downloadResult.result || 'Failed to cancel Download');
		}
		await this.backupStore.update(backup.id, {
			download: null,
		});
		return downloadResult.result;
	}

	async cancelBackup(planId: string, backupId: string) {
		const backup = await this.backupStore.getById(backupId);
		if (!backup) {
			throw new Error('Backup not found');
		}
		const backupDevice = backup.sourceId ? backup.sourceId : 'main';
		const strategy = this.getBackupStrategy(backupDevice);
		const cancelResult = strategy.cancelBackup
			? await strategy.cancelBackup(planId, backupId)
			: { success: false, result: '' };

		if (!cancelResult.success) {
			throw new Error(cancelResult.result || 'Failed to cancel backup');
		}

		// Remove the job from the queue, if its a local backup
		if (backupDevice === 'main') {
			jobQueue.remove('Backup', planId);
			jobQueue.remove('RescueBackup', planId); // for Server Rescue jobs
		}

		await this.backupStore.update(backup.id, {
			status: 'cancelled',
			inProgress: false,
			ended: sql`(unixepoch())` as any,
		});

		return cancelResult;
	}

	async getBackupProgress(backupId: string): Promise<any> {
		const backup = await this.backupStore.getById(backupId);
		if (!backup) {
			throw new Error('Backup not found');
		}
		const backupDevice = backup.sourceId ? backup.sourceId : 'main';
		const strategy = this.getBackupStrategy(backupDevice);
		const progressResult = strategy.getBackupProgress
			? await strategy.getBackupProgress(backup.planId as string, backupId)
			: { success: false, result: '' };
		if (!progressResult.success) {
			throw new Error(progressResult.result || 'Failed to get Backup Progress');
		}
		return progressResult.result;
	}
	async getSnapshotFiles(backupId: string, replicationId?: string): Promise<SnapShotFile[]> {
		const backup = await this.backupStore.getById(backupId);
		if (!backup) {
			throw new Error('Backup not found');
		}
		const backupDevice = backup.sourceId ? backup.sourceId : 'main';
		const backupMethod = backup.method;

		// If replicationId is provided, browse from mirror storage
		let effectiveStorageId = backup.storageId as string;
		let effectiveStoragePath = backup.storagePath as string;
		if (replicationId) {
			//if replicationId is passed, its a replication storage ID, so find the storage path and name from the backup's mirrors
			if (backup.mirrors && backup.mirrors.length > 0) {
				const planReplicationStorage = backup.mirrors.find(s => s.replicationId === replicationId);
				if (!planReplicationStorage) {
					throw new NotFoundError('Replication Storage not found in Plan settings');
				}
			}
			const mirrors = (backup.mirrors || []) as BackupMirror[];
			const mirror = mirrors.find(m => m.replicationId === replicationId);
			if (mirror) {
				effectiveStorageId = mirror.storageId;
				effectiveStoragePath = mirror.storagePath;
			}
		}
		const storageName = await this.getStorageName(effectiveStorageId);
		const strategy = this.getSnapshotStrategy(backupDevice, backupMethod);
		const browseRes = await strategy.getSnapshotFiles(backup.planId as string, backup.id, {
			storagePath: effectiveStoragePath || '',
			storageName: storageName,
			encryption: backup.encryption || false,
			skipCache: !!replicationId,
		});
		if (!browseRes.success || !browseRes.result || typeof browseRes.result === 'string') {
			throw new AppError(
				500,
				typeof browseRes.result === 'string' ? browseRes.result : 'Browse snapshot failed'
			);
		}
		return browseRes.result;
	}

	async updateBackup(backupId: string, data: Partial<Backup>): Promise<any> {
		const backup = await this.backupStore.getById(backupId);
		if (!backup) {
			throw new Error('Backup not found');
		}
		const title = data.title?.trim() || '';
		const description = data.description?.trim() || '';
		const updatedBackup = await this.backupStore.update(backupId, { title, description });
		return updatedBackup;
	}

	async retryFailedReplications(backupId: string, replicationId?: string): Promise<string> {
		const backup = await this.backupStore.getById(backupId);
		if (!backup) {
			throw new Error('Backup not found');
		}

		const currentMirrors = (backup.mirrors || []) as BackupMirror[];
		const failedMirrors = currentMirrors.filter(m => m.status === 'failed');
		if (failedMirrors.length === 0) {
			throw new Error('No failed replications to retry');
		}

		// Reset failed mirrors to 'pending'
		const updatedMirrors = replicationId
			? currentMirrors.map(m =>
					m.replicationId === replicationId
						? { ...m, status: 'pending' as const, error: undefined }
						: m
				)
			: currentMirrors.map(m =>
					m.status === 'failed' ? { ...m, status: 'pending' as const, error: undefined } : m
				);
		await this.backupStore.update(backupId, { mirrors: updatedMirrors } as any);

		// Queue a replication retry job
		const failedReplicationIds = updatedMirrors
			.filter(m => m.status === 'pending')
			.map(m => m.replicationId);
		const backupDevice = backup.sourceId ? backup.sourceId : 'main';
		const strategy = this.getSnapshotStrategy(backupDevice);

		const retryResult = await strategy.retryFailedReplication(
			backup.planId as string,
			backupId,
			failedReplicationIds
		);

		if (!retryResult.success) {
			throw new Error(retryResult.result || 'Failed to retry failed replications');
		}

		return retryResult.result;
	}

	async getStorageName(storageId: string): Promise<string> {
		let storageName = '';
		if (storageId !== 'local') {
			try {
				const storage = await this.storageStore.getById(storageId);
				if (storage?.name) {
					storageName = storage.name;
				}
			} catch (error: any) {
				return storageName;
			}
		} else {
			storageName = 'local';
		}

		return storageName;
	}
}
