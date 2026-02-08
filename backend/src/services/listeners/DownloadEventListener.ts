import { BaseSnapshotManager } from '../../managers/BaseSnapshotManager';
import { BackupStore } from '../../stores/BackupStore';
import { DownloadCompleteEvent, DownloadErrorEvent, DownloadStartEvent } from '../../types/events';
import { DownloadEventService } from '../events/DownloadEventService';

export class DownloadEventListener {
	protected downloadEventService: DownloadEventService;

	constructor(
		protected localAgent: BaseSnapshotManager,
		protected backupStore: BackupStore
	) {
		this.downloadEventService = new DownloadEventService(backupStore, localAgent);
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
		await this.downloadEventService.onDownloadStart(eventPayload);
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
		await this.downloadEventService.onDownloadError(eventPayload);
	}

	private async onDownloadComplete(eventPayload: DownloadCompleteEvent) {
		await this.downloadEventService.onDownloadComplete(eventPayload);
	}
}
