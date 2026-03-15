import { BaseBackupManager } from '../../managers/BaseBackupManager';
import { BackupStore } from '../../stores/BackupStore';
import { StorageStore } from '../../stores/StorageStore';
import { PlanStore } from '../../stores/PlanStore';
import {
	ReplicationStartEvent,
	ReplicationCompleteEvent,
	ReplicationInitEvent,
	ReplicationRetryEvent,
} from '../../types/events';
import { BackupMirror } from '../../types/backups';
import { ReplicationEventService } from '../events/ReplicationEventService';

/**
 * Listens for replication-related events from the local agent (BaseBackupManager)
 * and delegates handling to ReplicationEventService.
 */
export class ReplicationEventListener {
	protected replicationEventService: ReplicationEventService;

	constructor(
		protected localAgent: BaseBackupManager,
		protected planStore: PlanStore,
		protected backupStore: BackupStore,
		protected storageStore: StorageStore
	) {
		this.replicationEventService = new ReplicationEventService(
			planStore,
			backupStore,
			storageStore,
			localAgent
		);
		this.registerEventListeners();
	}

	protected registerEventListeners(): void {
		this.localAgent.on('replication_init', (event: ReplicationInitEvent) =>
			this.onReplicationInit(event)
		);
		this.localAgent.on('replication_start', (event: ReplicationStartEvent) =>
			this.onReplicationStart(event)
		);
		this.localAgent.on('replication_complete', (event: ReplicationCompleteEvent) =>
			this.onReplicationComplete(event)
		);
		this.localAgent.on(
			'replication_partial_failure',
			(event: { planId: string; backupId: string; mirrors: BackupMirror[] }) =>
				this.onReplicationPartialFailure(event)
		);
		this.localAgent.on('replication_retry', (event: ReplicationRetryEvent) =>
			this.onReplicationRetry(event)
		);
	}

	protected async onReplicationInit(data: ReplicationInitEvent): Promise<void> {
		await this.replicationEventService.onReplicationInit(data);
	}

	protected async onReplicationStart(data: ReplicationStartEvent): Promise<void> {
		await this.replicationEventService.onReplicationStart(data);
	}

	protected async onReplicationComplete(data: ReplicationCompleteEvent): Promise<void> {
		await this.replicationEventService.onReplicationComplete(data);
	}

	protected async onReplicationPartialFailure(data: {
		planId: string;
		backupId: string;
		mirrors: BackupMirror[];
	}): Promise<void> {
		await this.replicationEventService.onReplicationPartialFailure(data);
	}

	protected async onReplicationRetry(data: ReplicationRetryEvent): Promise<void> {
		await this.replicationEventService.onReplicationRetry(data);
	}
}
