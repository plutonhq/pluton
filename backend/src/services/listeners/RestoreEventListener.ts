import { PlanStore } from '../../stores/PlanStore';
import { BackupStore } from '../../stores/BackupStore';
import { RestoreStore } from '../../stores/RestoreStore';
import { RestoreCompleteEvent, RestoreErrorEvent, RestoreStartEvent } from '../../types/events';
import { RestoreEventService } from '../events/RestoreEventService';
import { BaseRestoreManager } from '../../managers/BaseRestoreManager';

export class RestoreEventListener {
	protected restoreEventService: RestoreEventService;
	constructor(
		protected localAgent: BaseRestoreManager,
		protected planStore: PlanStore,
		protected backupStore: BackupStore,
		protected restoreStore: RestoreStore
	) {
		this.restoreEventService = new RestoreEventService(
			planStore,
			backupStore,
			restoreStore,
			localAgent
		);
		this.registerEventListeners();
	}

	protected registerEventListeners(): void {
		this.localAgent.on('restore_start', (event: RestoreStartEvent) => this.onRestoreStart(event));
		this.localAgent.on('restore_complete', (event: RestoreCompleteEvent) =>
			this.onRestoreComplete(event)
		);
		this.localAgent.on('restore_error', (event: RestoreErrorEvent) => this.onRestoreError(event));
		this.localAgent.on('restore_failed', (event: RestoreErrorEvent) => this.onRestoreFailed(event));
	}

	private async onRestoreStart(data: RestoreStartEvent) {
		console.log('onRestoreStart :', data);
		await this.restoreEventService.onRestoreStart(data);
	}

	private async onRestoreError(eventPayload: RestoreErrorEvent) {
		console.log('onRestoreError :', eventPayload);
		await this.restoreEventService.onRestoreError(eventPayload);
	}

	private async onRestoreFailed(eventPayload: RestoreErrorEvent) {
		console.log('onRestoreFailed :', eventPayload);
		await this.restoreEventService.onRestoreFailed(eventPayload);
	}

	private async onRestoreComplete(eventPayload: RestoreCompleteEvent) {
		console.log('onRestoreComplete :', eventPayload);
		await this.restoreEventService.onRestoreComplete(eventPayload);
	}
}
