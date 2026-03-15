process.env.APP_TITLE = 'Pluton Test';
process.env.SECRET = 'a-super-secret-key-for-testing-123';
process.env.ENCRYPTION_KEY = 'an-encryption-key-for-testing-456';
process.env.APIKEY = 'an-api-key-for-testing-and-so-on-789';
process.env.USER_NAME = 'testUser';
process.env.USER_PASSWORD = 'testPassword';

import { ReplicationEventService } from '../../src/services/events/ReplicationEventService';
import { PlanStore } from '../../src/stores/PlanStore';
import { BackupStore } from '../../src/stores/BackupStore';
import { StorageStore } from '../../src/stores/StorageStore';
import { BaseBackupManager } from '../../src/managers/BaseBackupManager';
import { BackupNotification } from '../../src/notifications/BackupNotification';
import {
	ReplicationInitEvent,
	ReplicationStartEvent,
	ReplicationCompleteEvent,
} from '../../src/types/events';

jest.mock('../../src/db/index', () => ({
	db: { select: jest.fn(), insert: jest.fn(), update: jest.fn(), delete: jest.fn() },
}));
jest.mock('../../src/services/ConfigService', () => ({
	configService: {
		config: {
			SECRET: 'test-secret',
			APIKEY: 'test-key',
			ENCRYPTION_KEY: 'test-encryption-key',
		},
	},
}));
jest.mock('../../src/stores/PlanStore');
jest.mock('../../src/stores/BackupStore');
jest.mock('../../src/stores/StorageStore');
jest.mock('../../src/managers/BaseBackupManager');
jest.mock('../../src/notifications/BackupNotification');
jest.mock('../../src/managers/handlers/ReplicationHandler');
jest.mock('../../src/managers/ProgressManager', () => ({
	ProgressManager: jest.fn().mockImplementation(() => ({
		initialize: jest.fn().mockResolvedValue(undefined),
		initializeReplications: jest.fn().mockResolvedValue(undefined),
		updateAction: jest.fn().mockResolvedValue(undefined),
		updateReplicationAction: jest.fn().mockResolvedValue(undefined),
		updateReplicationResticProgress: jest.fn().mockResolvedValue(undefined),
	})),
}));
jest.mock('../../src/utils/AppPaths', () => ({
	appPaths: {
		getProgressDir: jest.fn().mockReturnValue('/mock/progress'),
		getDataDir: jest.fn().mockReturnValue('/mock/data'),
		getLogsDir: jest.fn().mockReturnValue('/mock/logs'),
	},
}));
jest.mock('../../src/utils/logger', () => ({
	planLogger: jest.fn().mockReturnValue({
		info: jest.fn(),
		error: jest.fn(),
		warn: jest.fn(),
	}),
}));

describe('ReplicationEventService', () => {
	let service: ReplicationEventService;
	let mockPlanStore: jest.Mocked<PlanStore>;
	let mockBackupStore: jest.Mocked<BackupStore>;
	let mockStorageStore: jest.Mocked<StorageStore>;
	let mockLocalAgent: jest.Mocked<BaseBackupManager>;
	let mockBackupNotification: jest.Mocked<BackupNotification>;

	const planId = 'plan-1';
	const backupId = 'backup-1';

	beforeEach(() => {
		jest.clearAllMocks();

		mockPlanStore = new PlanStore(null as any) as jest.Mocked<PlanStore>;
		mockBackupStore = new BackupStore(null as any) as jest.Mocked<BackupStore>;
		mockStorageStore = new StorageStore(null as any) as jest.Mocked<StorageStore>;
		mockLocalAgent = new BaseBackupManager() as jest.Mocked<BaseBackupManager>;
		mockLocalAgent.emit = jest.fn();

		mockBackupNotification = { send: jest.fn().mockResolvedValue(undefined) } as any;
		(BackupNotification as jest.Mock).mockImplementation(() => mockBackupNotification);

		service = new ReplicationEventService(
			mockPlanStore,
			mockBackupStore,
			mockStorageStore,
			mockLocalAgent
		);
	});

	describe('onReplicationInit', () => {
		const initEvent: ReplicationInitEvent = {
			planId,
			backupId,
			replicationStorages: [
				{
					replicationId: 'rep-1',
					storageId: 'storage-1',
					storagePath: '/path1',
					storageType: 'b2',
				},
				{
					replicationId: 'rep-2',
					storageId: 'storage-2',
					storagePath: '/path2',
					storageType: 's3',
				},
			],
		};

		it('should resolve storage names from StorageStore', async () => {
			mockStorageStore.getById
				.mockResolvedValueOnce({ name: 'B2 Storage', type: 'b2' } as any)
				.mockResolvedValueOnce({ name: 'S3 Storage', type: 's3' } as any);
			mockBackupStore.update.mockResolvedValue(null);

			await service.onReplicationInit(initEvent);

			expect(mockStorageStore.getById).toHaveBeenCalledWith('storage-1');
			expect(mockStorageStore.getById).toHaveBeenCalledWith('storage-2');
		});

		it('should create initial mirror entries on the backup record', async () => {
			mockStorageStore.getById
				.mockResolvedValueOnce({ name: 'B2 Storage', type: 'b2' } as any)
				.mockResolvedValueOnce({ name: 'S3 Storage', type: 's3' } as any);
			mockBackupStore.update.mockResolvedValue(null);

			await service.onReplicationInit(initEvent);

			expect(mockBackupStore.update).toHaveBeenCalledWith(backupId, {
				mirrors: [
					expect.objectContaining({
						replicationId: 'rep-1',
						storageId: 'storage-1',
						storageName: 'B2 Storage',
						storagePath: '/path1',
						storageType: 'b2',
						status: 'pending',
					}),
					expect.objectContaining({
						replicationId: 'rep-2',
						storageId: 'storage-2',
						storageName: 'S3 Storage',
						storagePath: '/path2',
						storageType: 's3',
						status: 'pending',
					}),
				],
			});
		});

		it('should emit replication_init_complete with resolved storages', async () => {
			mockStorageStore.getById.mockResolvedValue({ name: 'Storage', type: 'b2' } as any);
			mockBackupStore.update.mockResolvedValue(null);

			await service.onReplicationInit(initEvent);

			expect(mockLocalAgent.emit).toHaveBeenCalledWith('replication_init_complete', {
				planId,
				backupId,
				resolvedStorages: expect.arrayContaining([
					expect.objectContaining({ replicationId: 'rep-1', storageName: 'Storage' }),
					expect.objectContaining({ replicationId: 'rep-2', storageName: 'Storage' }),
				]),
			});
		});

		it('should handle storage lookup failures gracefully', async () => {
			mockStorageStore.getById.mockRejectedValue(new Error('DB error'));
			mockBackupStore.update.mockResolvedValue(null);

			await service.onReplicationInit(initEvent);

			// Should still emit with empty names
			expect(mockLocalAgent.emit).toHaveBeenCalledWith(
				'replication_init_complete',
				expect.objectContaining({
					resolvedStorages: expect.arrayContaining([expect.objectContaining({ storageName: '' })]),
				})
			);
		});

		it('should use updateMirrorStatus in retry mode instead of replacing all mirrors', async () => {
			const retryEvent: ReplicationInitEvent = {
				...initEvent,
				isRetry: true,
			};

			mockStorageStore.getById.mockResolvedValue({ name: 'Storage', type: 'b2' } as any);
			mockBackupStore.updateMirrorStatus.mockResolvedValue(null);

			await service.onReplicationInit(retryEvent);

			expect(mockBackupStore.update).not.toHaveBeenCalled();
			expect(mockBackupStore.updateMirrorStatus).toHaveBeenCalledTimes(2);
			expect(mockBackupStore.updateMirrorStatus).toHaveBeenCalledWith(
				backupId,
				'rep-1',
				expect.objectContaining({ status: 'pending' })
			);
		});
	});

	describe('onReplicationStart', () => {
		const startEvent: ReplicationStartEvent = {
			planId,
			backupId,
			replicationId: 'rep-1',
			storageId: 'storage-1',
			storageName: 'B2 Storage',
			storagePath: '/path1',
			storageType: 'b2',
		};

		it('should update mirror status to started', async () => {
			mockBackupStore.updateMirrorStatus.mockResolvedValue(null);

			await service.onReplicationStart(startEvent);

			expect(mockBackupStore.updateMirrorStatus).toHaveBeenCalledWith(
				backupId,
				'rep-1',
				expect.objectContaining({
					status: 'started',
					storageId: 'storage-1',
					storageName: 'B2 Storage',
					started: expect.any(Number),
				})
			);
		});

		it('should not throw on DB errors', async () => {
			mockBackupStore.updateMirrorStatus.mockRejectedValue(new Error('DB error'));
			await expect(service.onReplicationStart(startEvent)).resolves.not.toThrow();
		});
	});

	describe('onReplicationComplete', () => {
		it('should update mirror status to completed on success', async () => {
			const completeEvent: ReplicationCompleteEvent = {
				planId,
				backupId,
				replicationId: 'rep-1',
				storageId: 'storage-1',
				storageName: 'B2 Storage',
				storagePath: '/path1',
				storageType: 'b2',
				success: true,
			};

			mockBackupStore.updateMirrorStatus.mockResolvedValue(null);

			await service.onReplicationComplete(completeEvent);

			expect(mockBackupStore.updateMirrorStatus).toHaveBeenCalledWith(
				backupId,
				'rep-1',
				expect.objectContaining({
					status: 'completed',
					ended: expect.any(Number),
				})
			);
		});

		it('should update mirror status to failed on failure', async () => {
			const completeEvent: ReplicationCompleteEvent = {
				planId,
				backupId,
				replicationId: 'rep-1',
				storageId: 'storage-1',
				storageName: 'B2 Storage',
				storagePath: '/path1',
				storageType: 'b2',
				success: false,
				error: 'Copy failed',
			};

			mockBackupStore.updateMirrorStatus.mockResolvedValue(null);

			await service.onReplicationComplete(completeEvent);

			expect(mockBackupStore.updateMirrorStatus).toHaveBeenCalledWith(
				backupId,
				'rep-1',
				expect.objectContaining({
					status: 'failed',
					error: 'Copy failed',
				})
			);
		});

		it('should not throw on DB errors', async () => {
			mockBackupStore.updateMirrorStatus.mockRejectedValue(new Error('DB error'));
			await expect(
				service.onReplicationComplete({
					planId,
					backupId,
					replicationId: 'rep-1',
					storageId: 'storage-1',
					storageName: 'B2 Storage',
					storagePath: '/path1',
					storageType: 'b2',
					success: true,
				})
			).resolves.not.toThrow();
		});
	});

	describe('onReplicationPartialFailure', () => {
		it('should send notification when plan has notifications enabled', async () => {
			const mockPlan = {
				id: planId,
				title: 'Test Plan',
				settings: { notification: true },
			};
			mockPlanStore.getById.mockResolvedValue(mockPlan as any);

			await service.onReplicationPartialFailure({
				planId,
				backupId,
				mirrors: [
					{
						replicationId: 'rep-1',
						storageId: 'storage-1',
						storageName: 'B2 Storage',
						storagePath: '/path1',
						storageType: 'b2',
						status: 'failed',
						error: 'Network error',
					},
				],
			});

			expect(mockBackupNotification.send).toHaveBeenCalledWith(
				mockPlan,
				'replication_failure',
				expect.objectContaining({
					id: backupId,
					failedMirrors: expect.arrayContaining([
						expect.objectContaining({ replicationId: 'rep-1', status: 'failed' }),
					]),
				})
			);
		});

		it('should not send notification when plan has notifications disabled', async () => {
			const mockPlan = {
				id: planId,
				title: 'Test Plan',
				settings: { notification: false },
			};
			mockPlanStore.getById.mockResolvedValue(mockPlan as any);

			await service.onReplicationPartialFailure({
				planId,
				backupId,
				mirrors: [],
			});

			expect(mockBackupNotification.send).not.toHaveBeenCalled();
		});

		it('should not throw on errors', async () => {
			mockPlanStore.getById.mockRejectedValue(new Error('DB error'));

			await expect(
				service.onReplicationPartialFailure({ planId, backupId, mirrors: [] })
			).resolves.not.toThrow();
		});
	});
});
