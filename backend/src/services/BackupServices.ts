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

export class BackupService {
	protected broker: any;

	constructor(
		protected localSnapshotAgent: BaseSnapshotManager,
		protected localPlanAgent: BaseBackupManager,
		protected planStore: PlanStore,
		protected backupStore: BackupStore,
		protected restoreStore: RestoreStore,
		protected storageStore: StorageStore,

		broker: any
	) {
		this.broker = broker;
	}

	getSnapshotStrategy(deviceId: string, method?: string): SnapshotStrategy {
		const isRemote = deviceId !== 'main';
		return isRemote
			? new RemoteSnapshotStrategy(this.broker, deviceId)
			: new LocalSnapshotStrategy(this.localSnapshotAgent);
	}

	getBackupStrategy(deviceId: string): BackupStrategy {
		const isRemote = deviceId !== 'main';
		return isRemote
			? new RemoteBackupStrategy(this.broker, deviceId)
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
			planId: backup.planId as string,
		});

		// If snapshot removal fails, it should not throw an error
		// Because the snapshot might have been removed already by prune process
		console.log('Snapshot Remove Result :', removeResult?.result);
		// if (!removeResult.success) {
		// 	throw new Error(removeResult.result || 'Failed to remove Snapshot');
		// }

		if (removeResult.stats) {
			await this.planStore.update(backup.planId as string, {
				stats: {
					size: removeResult.stats.total_size,
					snapshots: removeResult.stats.snapshots,
				},
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

	async generateBackupDownload(backupId: string): Promise<any> {
		const backup = await this.backupStore.getById(backupId);
		if (!backup) {
			throw new Error('Backup not found');
		}
		const backupDevice = backup.sourceId ? backup.sourceId : 'main';
		const strategy = this.getSnapshotStrategy(backupDevice, backup.method);
		const storageName = await this.getStorageName(backup.storageId as string);
		const downloadResult = await strategy.downloadSnapshot(backup.planId as string, backupId, '', {
			storageName,
			storagePath: backup.storagePath as string,
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
		console.log('cancelBackup :', planId, backupId);
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

		console.log('#### Backup cancelled:', backupId);
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

	async getSnapshotFiles(backupId: string): Promise<SnapShotFile[]> {
		const backup = await this.backupStore.getById(backupId);
		if (!backup) {
			throw new Error('Backup not found');
		}
		const backupDevice = backup.sourceId ? backup.sourceId : 'main';
		const strategy = this.getSnapshotStrategy(backupDevice);
		const storageName = await this.getStorageName(backup.storageId as string);
		const snapshotFilesResult = await strategy.getSnapshotFiles(
			backup.planId as string,
			backup.id as string,
			{
				storageName,
				storagePath: backup.storagePath as string,
				encryption: backup.encryption as boolean,
			}
		);
		if (!snapshotFilesResult.success || !Array.isArray(snapshotFilesResult.result)) {
			throw new Error(
				typeof snapshotFilesResult.result === 'string'
					? snapshotFilesResult.result
					: 'Failed to get Snapshot Files'
			);
		}
		return snapshotFilesResult.result;
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
