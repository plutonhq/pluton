import { AppError, NotFoundError } from '../utils/AppError';
import { RestoreStore } from '../stores/RestoreStore';
import { RestoreStrategy, RemoteStrategy, LocalStrategy } from '../strategies/restore';
import { PlanStore } from '../stores/PlanStore';
import { BackupStore } from '../stores/BackupStore';
import { StorageStore } from '../stores/StorageStore';
import { BaseRestoreManager } from '../managers/BaseRestoreManager';
import { RestoreConfig, RestoreOptions } from '../types/restores';

/**
 * A class for managing restore operations.
 */
export class RestoreService {
	constructor(
		protected localAgent: BaseRestoreManager,
		protected planStore: PlanStore,
		protected backupStore: BackupStore,
		protected restoreStore: RestoreStore,
		protected storageStore: StorageStore
	) {}

	getRestoreStrategy(deviceId: string, method: string): RestoreStrategy {
		const isRemote = deviceId !== 'main';
		return isRemote ? new RemoteStrategy(deviceId) : new LocalStrategy(this.localAgent);
	}

	async getAllRestores() {
		const restores = await this.restoreStore.getAll();
		return restores;
	}

	async getRestore(restoreId: string) {
		const restore = await this.restoreStore.getById(restoreId);
		if (!restore) {
			throw new NotFoundError('Restore Item not found.');
		}
		return restore;
	}

	async getRestoreStats(restoreId: string) {
		const restore = await this.restoreStore.getById(restoreId);
		if (!restore) {
			throw new NotFoundError('Restore not found');
		}
		const strategy = this.getRestoreStrategy(restore.sourceId, restore.method);
		const statsRes = await strategy.getRestoreStats(restore.planId as string, restoreId);

		return statsRes;
	}

	async deleteRestore(restoreId: string) {
		const restore = await this.restoreStore.getById(restoreId);
		if (!restore) {
			throw new NotFoundError('Restore not found');
		}

		await this.restoreStore.delete(restoreId);
	}

	async dryRestoreBackup(backupId: string, restoreConfig: RestoreConfig) {
		try {
			const backup = await this.backupStore.getById(backupId);
			if (!backup) {
				throw new Error('Backup not found');
			}
			const restorationInProcess = await this.restoreStore.isRestoreRunning(backupId);
			if (restorationInProcess) {
				throw new Error('A Restoration is already in progress for this Plan');
			}
			const backupDevice = backup.sourceId ? backup.sourceId : 'main';
			const strategy = this.getRestoreStrategy(backupDevice, backup.method);
			const storageName = await this.getStorageName(backup.storageId as string);
			const targetPath = restoreConfig.target || '';
			const restoreResult = await strategy.getRestoreSnapshotStats(
				backup.planId as string,
				backup.id,
				{
					storageName,
					planId: backup.planId as string,
					storagePath: backup.storagePath || '',
					encryption: backup.encryption || true,
					overwrite: restoreConfig.overwrite,
					target: targetPath,
					delete: restoreConfig.delete,
					includes: restoreConfig.includes,
					excludes: restoreConfig.excludes,
				}
			);

			if (!restoreResult.success) {
				throw new Error(restoreResult.result || 'Failed to dry restore plan');
			}

			return restoreResult.result;
		} catch (error: any) {
			throw new Error(error?.message || 'Failed to dry restore the backup plan');
		}
	}

	async restoreBackup(backupId: string, restoreConfig: RestoreConfig) {
		try {
			const backup = await this.backupStore.getById(backupId);
			if (!backup) {
				throw new Error('Backup not found');
			}
			const plan = await this.planStore.getById(backup.planId as string);
			if (!plan) {
				throw new Error('Plan not found');
			}
			const restorationInProcess = await this.restoreStore.isRestoreRunning(backupId);
			if (restorationInProcess) {
				throw new Error('A Restoration is already in progress for this Plan');
			}

			const backupDevice = backup.sourceId ? backup.sourceId : 'main';
			const strategy = this.getRestoreStrategy(backupDevice, plan.method);
			const storageName = await this.getStorageName(backup.storageId as string);
			const performanceSettings = plan.settings.performance;

			const restoreResult = await strategy.restoreSnapshot(backup.planId as string, backup.id, {
				planId: backup.planId as string,
				storageName: storageName,
				storagePath: backup.storagePath || '',
				encryption: backup.encryption || true,
				overwrite: restoreConfig.overwrite || 'always',
				target: restoreConfig.target || '',
				includes: restoreConfig.includes || [],
				excludes: restoreConfig.excludes || [],
				delete: restoreConfig.delete || false,
				sources: plan.sourceConfig.includes || [],
				performanceSettings,
			});

			if (!restoreResult.success) {
				throw new Error(restoreResult.result || 'Failed to restore plan');
			}

			return restoreResult.result;
		} catch (error: any) {
			throw new Error(error?.message || 'Failed to Dry restore the backup plan');
		}
	}

	async cancelRestore(restoreId: string) {
		const restore = await this.restoreStore.getById(restoreId);
		if (!restore) {
			throw new NotFoundError('Restore not found');
		}
		const strategy = this.getRestoreStrategy(restore.sourceId as string, restore.method);
		const cancelResult = await strategy.cancelSnapshotRestore(restore.planId as string, restoreId);
		console.log('cancelResult :', cancelResult);
		await this.restoreStore.update(restoreId, {
			status: 'cancelled',
			inProgress: false,
		});

		return cancelResult;
	}

	async getRestoreProgress(restoreId: string) {
		const restore = await this.restoreStore.getById(restoreId);
		if (!restore) {
			throw new NotFoundError('Restore not found');
		}
		const strategy = this.getRestoreStrategy(restore.sourceId as string, restore.method);
		const progressResult = await strategy.getRestoreProgress(restore.planId as string, restoreId);
		if (!progressResult.success) {
			throw new Error((progressResult.result as string) || 'Failed to get Restore Progress');
		}
		return progressResult.result;
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
