import { BaseSnapshotManager } from '../../managers/BaseSnapshotManager';
import { BackupStore } from '../../stores/BackupStore';
import { planLogger } from '../../utils/logger';
import { DownloadCompleteEvent, DownloadErrorEvent, DownloadStartEvent } from '../../types/events';

export class DownloadEventListener {
	constructor(
		protected localAgent: BaseSnapshotManager,
		protected backupStore: BackupStore
	) {
		this.registerEventListeners();
	}

	protected registerEventListeners(): void {
		this.localAgent.on('download_start', (event: DownloadStartEvent) =>
			this.onDownloadStart(event)
		);
		this.localAgent.on('download_error', (event: DownloadErrorEvent) =>
			this.onDownloadError(event)
		);
		this.localAgent.on('download_complete', (event: DownloadCompleteEvent) =>
			this.onDownloadComplete(event)
		);

		// this.localAgent.on('download_progress', (event: DownloadProgressEvent) =>
		// 	this.onDownloadProgress(event)
		// );
	}

	private async onDownloadStart(eventPayload: DownloadStartEvent) {
		const { backupId, planId } = eventPayload;
		try {
			console.log('onDownloadStart :', eventPayload);
			const currentTime = Math.floor(new Date().getTime() / 1000);
			await this.backupStore.update(backupId, {
				download: {
					status: 'started',
					started: currentTime,
				},
			});
			planLogger('download', planId, backupId).info(
				`Download generation started for backup ${backupId}`
			);
		} catch (error: any) {
			console.log('[error] onDownloadStart :', error);
			planLogger('download', planId, backupId).error(
				`Failed to handle download generation start for backup ${backupId}: ${error.message}`
			);
		}
	}

	// private async onDownloadProgress(eventPayload: DownloadProgressEvent) {
	//    const { backupId, planId, error } = eventPayload;
	// 	try {
	// 		console.log('onDownloadProgress :', data);
	// 		const progressFile = `${appPaths.getProgressDir()}/download-${data.backupId}-progress.json`;
	// 		await writeFile(progressFile, JSON.stringify(data));
	// 	} catch (error: any) {
	// 		console.log('[onDownloadProgress] error :', error);
	// 	}
	// }

	private async onDownloadError(eventPayload: DownloadErrorEvent) {
		const { backupId, planId, error } = eventPayload;
		try {
			console.log('onDownloadError :', eventPayload);
			const backup = await this.backupStore.getById(backupId);
			await this.backupStore.update(backupId, {
				download: {
					...(backup?.download || {}),
					status: 'failed',
					error: error,
					ended: Math.floor(Date.now() / 1000),
				},
			});

			planLogger('download', planId, backupId).error(
				`Failed to complete download generation for backup ${backupId}. Reason: ${error || 'Unknown'}`
			);
		} catch (error: any) {
			console.log('[error] onDownloadError :', error);
			planLogger('download', planId, backupId).error(
				`Failed to handle download generation error for backup ${backupId}: ${error.message}`
			);
		}
	}

	private async onDownloadComplete(eventPayload: DownloadCompleteEvent) {
		const { backupId, planId, success } = eventPayload;
		try {
			console.log('onDownloadComplete :', eventPayload);

			const backup = await this.backupStore.getById(backupId);
			await this.backupStore.update(backupId, {
				download: {
					...(backup?.download || {}),
					status: 'complete',
					error: '',
					ended: Math.floor(Date.now() / 1000),
				},
			});
			// try {
			// 	const progressFile = `${appPaths.getProgressDir()}/download-${backupId}-progress.json`;
			// 	if (existsSync(progressFile)) {
			// 		await unlink(progressFile);
			// 	}
			// } catch (error) {}

			planLogger('download', planId, backupId).info(
				`Download generation completed for backup ${backupId}`
			);
		} catch (error: any) {
			console.log('[error] onDownloadComplete :', error);
			planLogger('download', planId, backupId).error(
				`Failed to handle download completion for backup ${backupId}. Reason: ${error?.message || 'Unknown'}`
			);
		}
	}
}
