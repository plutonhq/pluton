import { BaseBackupManager } from '../../managers/BaseBackupManager';
import { BackupStore } from '../../stores/BackupStore';
import { PlanStore } from '../../stores/PlanStore';
import { appPaths } from '../../utils/AppPaths';
import { jobProcessor } from '../../jobs/JobProcessor';
import {
	BackupStartEvent,
	BackupCompleteEvent,
	BackupErrorEvent,
	PruneEndEvent,
	BackupStatUpdateEvent,
	BackupReplicationStatUpdateEvent,
	BackupReplicationMirrorSizeUpdateEvent,
} from '../../types/events';
import { BackupEventService } from '../events/BackupEventService';

/**
 * Listens for events from the local agent (BaseBackupManager) and updates
 * the main application's database state accordingly.
 */
export class BackupEventListener {
	protected backupEventService: BackupEventService;
	protected progressDir = appPaths.getProgressDir();

	constructor(
		protected localAgent: BaseBackupManager,
		protected planStore: PlanStore,
		protected backupStore: BackupStore
	) {
		this.backupEventService = new BackupEventService(planStore, backupStore, localAgent);
		this.registerEventListeners();
	}

	/**
	 * Registers event listeners for backup-related events emitted by the local agent.
	 */
	protected registerEventListeners(): void {
		this.localAgent.on('backup_start', (event: BackupStartEvent) => this.onBackupStart(event));
		this.localAgent.on('backup_complete', (event: BackupCompleteEvent) =>
			this.onBackupComplete(event)
		);
		this.localAgent.on('backup_error', (event: BackupErrorEvent) => this.onBackupError(event));
		// this.localAgent.on('backup_progress', (event: BackupProgressEvent) =>
		// 	this.onBackupProgress(event)
		// );
		jobProcessor.on(
			'backup_failed',
			(event: { planId: string; backupId: string; error: string }) => {
				this.onBackupFailure(event);
			}
		);
		this.localAgent.on('backup_stats_update', (event: BackupStatUpdateEvent) =>
			this.onBackupStatsUpdate(event)
		);
		this.localAgent.on(
			'backup_replication_stats_update',
			(event: BackupReplicationStatUpdateEvent) => this.onReplicationStatsUpdate(event)
		);
		this.localAgent.on(
			'backup_mirror_sizes_update',
			(event: BackupReplicationMirrorSizeUpdateEvent) => this.onMirrorSizesUpdate(event)
		);
		this.localAgent.on('pruneEnd', (event: PruneEndEvent) => this.onPruneEnd(event));
	}

	protected async onBackupStart(data: BackupStartEvent): Promise<void> {
		await this.backupEventService.onBackupStart(data);
	}

	protected async onBackupComplete(data: BackupCompleteEvent): Promise<void> {
		await this.backupEventService.onBackupComplete(data);
	}

	protected async onBackupError(data: BackupErrorEvent): Promise<void> {
		await this.backupEventService.onBackupError(data);
	}

	protected async onBackupFailure(data: {
		planId: string;
		backupId: string;
		error: string;
	}): Promise<void> {
		await this.backupEventService.onBackupFailure(data);
	}

	// protected async onBackupProgress(data: BackupProgressEvent) {
	// 	console.log('onBackupProgress :', data);
	// 	try {
	// 		const progressFile = `${this.progressDir}/backup-${data.backupId}-progress.json`;
	// 		await writeFile(progressFile, JSON.stringify(data));
	// 	} catch (error: any) {}
	// }

	protected async onBackupStatsUpdate(data: BackupStatUpdateEvent) {
		console.log('[BackupEventListener] onBackupStatsUpdate :', data);
		await this.backupEventService.onBackupStatsUpdate(data);
	}

	protected async onReplicationStatsUpdate(data: BackupReplicationStatUpdateEvent): Promise<void> {
		await this.backupEventService.onReplicationStatsUpdate(data);
	}

	protected async onMirrorSizesUpdate(data: BackupReplicationMirrorSizeUpdateEvent): Promise<void> {
		try {
			for (const { replicationId, size } of data.mirrorSizes) {
				await this.backupStore.updateMirrorStatus(data.backupId, replicationId, { size });
			}
		} catch (error: any) {
			console.warn(`Failed to update mirror sizes for backup ${data.backupId}: ${error?.message}`);
		}
	}

	protected async onPruneEnd(data: PruneEndEvent): Promise<void> {
		await this.backupEventService.onPruneEnd(data);
	}

	/**
	 * Called after a job has permanently failed. Implemented in the PRO version.
	 * @param planId - The ID of the plan that failed.
	 * @param backupId - The ID of the backup that failed.
	 * @param error - The error that caused the failure.

	 * @protected
	 */
	protected async afterPermanentFailure(
		planId: string,
		backupId: string,
		error: string
	): Promise<void> {}
}
