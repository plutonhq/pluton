import { EventEmitter } from 'events';
import { ReplicationEventListener } from '../../../src/services/listeners/ReplicationEventListener';
import { BaseBackupManager } from '../../../src/managers/BaseBackupManager';
import { PlanStore } from '../../../src/stores/PlanStore';
import { BackupStore } from '../../../src/stores/BackupStore';
import { StorageStore } from '../../../src/stores/StorageStore';
import { ReplicationEventService } from '../../../src/services/events/ReplicationEventService';
import {
	ReplicationStartEvent,
	ReplicationCompleteEvent,
	ReplicationInitEvent,
	ReplicationRetryEvent,
} from '../../../src/types/events';
import { BackupMirror } from '../../../src/types/backups';

// Mock dependencies
jest.mock('../../../src/db/index', () => ({
	db: { select: jest.fn(), insert: jest.fn(), update: jest.fn(), delete: jest.fn() },
}));
jest.mock('../../../src/services/ConfigService', () => ({
	configService: { config: { SECRET: 'test-secret', APIKEY: 'test-key' } },
}));
jest.mock('../../../src/managers/BaseBackupManager');
jest.mock('../../../src/stores/PlanStore');
jest.mock('../../../src/stores/BackupStore');
jest.mock('../../../src/stores/StorageStore');
jest.mock('../../../src/services/events/ReplicationEventService', () => ({
	ReplicationEventService: jest.fn(),
}));
jest.mock('../../../src/utils/AppPaths', () => ({
	appPaths: {
		getProgressDir: jest.fn().mockReturnValue('/mock/progress'),
		getConfigDir: jest.fn().mockReturnValue('/mock/config'),
		getDataDir: jest.fn().mockReturnValue('/mock/data'),
		getLogsDir: jest.fn().mockReturnValue('/mock/logs'),
		getDbDir: jest.fn().mockReturnValue('/mock/db'),
	},
}));
jest.mock('../../../src/utils/logger', () => ({
	planLogger: jest.fn().mockReturnValue({
		info: jest.fn(),
		error: jest.fn(),
		warn: jest.fn(),
	}),
}));

describe('ReplicationEventListener', () => {
	let localAgent: EventEmitter;
	let mockPlanStore: jest.Mocked<PlanStore>;
	let mockBackupStore: jest.Mocked<BackupStore>;
	let mockStorageStore: jest.Mocked<StorageStore>;
	let mockReplicationEventService: jest.Mocked<ReplicationEventService>;
	let listener: ReplicationEventListener;

	beforeEach(() => {
		jest.clearAllMocks();

		localAgent = new EventEmitter();
		mockPlanStore = new PlanStore(null as any) as jest.Mocked<PlanStore>;
		mockBackupStore = new BackupStore(null as any) as jest.Mocked<BackupStore>;
		mockStorageStore = new StorageStore(null as any) as jest.Mocked<StorageStore>;

		mockReplicationEventService = {
			onReplicationInit: jest.fn().mockResolvedValue(undefined),
			onReplicationStart: jest.fn().mockResolvedValue(undefined),
			onReplicationComplete: jest.fn().mockResolvedValue(undefined),
			onReplicationPartialFailure: jest.fn().mockResolvedValue(undefined),
			onReplicationRetry: jest.fn().mockResolvedValue(undefined),
		} as any;

		(ReplicationEventService as jest.Mock).mockImplementation(() => mockReplicationEventService);

		listener = new ReplicationEventListener(
			localAgent as any,
			mockPlanStore,
			mockBackupStore,
			mockStorageStore
		);
	});

	describe('constructor', () => {
		it('should create a ReplicationEventService instance', () => {
			expect(ReplicationEventService).toHaveBeenCalledWith(
				mockPlanStore,
				mockBackupStore,
				mockStorageStore,
				localAgent
			);
		});

		it('should register all replication event listeners on the localAgent', () => {
			expect(localAgent.listenerCount('replication_init')).toBe(1);
			expect(localAgent.listenerCount('replication_start')).toBe(1);
			expect(localAgent.listenerCount('replication_complete')).toBe(1);
			expect(localAgent.listenerCount('replication_partial_failure')).toBe(1);
			expect(localAgent.listenerCount('replication_retry')).toBe(1);
		});
	});

	describe('event delegation', () => {
		it('should delegate replication_init events to ReplicationEventService', async () => {
			const event: ReplicationInitEvent = {
				planId: 'plan-1',
				backupId: 'backup-1',
				replicationStorages: [
					{
						replicationId: 'rep-1',
						storageId: 'storage-1',
						storagePath: '/path1',
						storageType: 'b2',
					},
				],
			};

			localAgent.emit('replication_init', event);

			// Allow async handler to complete
			await new Promise(resolve => setImmediate(resolve));

			expect(mockReplicationEventService.onReplicationInit).toHaveBeenCalledWith(event);
		});

		it('should delegate replication_start events to ReplicationEventService', async () => {
			const event: ReplicationStartEvent = {
				planId: 'plan-1',
				backupId: 'backup-1',
				replicationId: 'rep-1',
				storageId: 'storage-1',
				storageName: 'B2 Storage',
				storagePath: '/path1',
				storageType: 'b2',
			};

			localAgent.emit('replication_start', event);
			await new Promise(resolve => setImmediate(resolve));

			expect(mockReplicationEventService.onReplicationStart).toHaveBeenCalledWith(event);
		});

		it('should delegate replication_complete events to ReplicationEventService', async () => {
			const event: ReplicationCompleteEvent = {
				planId: 'plan-1',
				backupId: 'backup-1',
				replicationId: 'rep-1',
				storageId: 'storage-1',
				storageName: 'B2 Storage',
				storagePath: '/path1',
				storageType: 'b2',
				success: true,
			};

			localAgent.emit('replication_complete', event);
			await new Promise(resolve => setImmediate(resolve));

			expect(mockReplicationEventService.onReplicationComplete).toHaveBeenCalledWith(event);
		});

		it('should delegate replication_partial_failure events to ReplicationEventService', async () => {
			const event = {
				planId: 'plan-1',
				backupId: 'backup-1',
				mirrors: [
					{
						replicationId: 'rep-1',
						storageId: 'storage-1',
						storageName: 'B2 Storage',
						storagePath: '/path1',
						storageType: 'b2',
						status: 'failed' as const,
						error: 'Network error',
					},
				] as BackupMirror[],
			};

			localAgent.emit('replication_partial_failure', event);
			await new Promise(resolve => setImmediate(resolve));

			expect(mockReplicationEventService.onReplicationPartialFailure).toHaveBeenCalledWith(event);
		});

		it('should delegate replication_retry events to ReplicationEventService', async () => {
			const event: ReplicationRetryEvent = {
				planId: 'plan-1',
				backupId: 'backup-1',
				failedReplicationIds: ['rep-1'],
				sourceRepoPath: '/source/repo',
				encryption: true,
				replicationStorages: [
					{
						replicationId: 'rep-1',
						storageId: 'storage-1',
						storagePath: '/path1',
						storageType: 'b2',
					},
				],
				pruneSettings: { keep: 5 },
				concurrent: false,
			};

			localAgent.emit('replication_retry', event);
			await new Promise(resolve => setImmediate(resolve));

			expect(mockReplicationEventService.onReplicationRetry).toHaveBeenCalledWith(event);
		});
	});
});
