// Mocks
const mockRunResticCommand = jest.fn();
const mockGenerateResticRepoPath = jest.fn();
const mockTrackProcess = jest.fn();
const mockKillProcess = jest.fn();
const mockInitializeReplications = jest.fn();
const mockUpdateReplicationAction = jest.fn();
const mockUpdateReplicationResticProgress = jest.fn();
const mockPruneHandler = { prune: jest.fn().mockResolvedValue({ success: true }) };

jest.mock('../../../src/utils/restic/restic', () => ({
	runResticCommand: (...args: any[]) => mockRunResticCommand(...args),
}));

jest.mock('../../../src/utils/restic/helpers', () => ({
	generateResticRepoPath: (...args: any[]) => mockGenerateResticRepoPath(...args),
}));

jest.mock('../../../src/managers/ProcessManager', () => ({
	processManager: {
		trackProcess: (...args: any[]) => mockTrackProcess(...args),
		killProcess: (...args: any[]) => mockKillProcess(...args),
	},
}));

jest.mock('../../../src/managers/handlers/PruneHandler', () => ({
	PruneHandler: jest.fn().mockImplementation(() => mockPruneHandler),
}));

jest.mock('../../../src/services/ConfigService', () => ({
	configService: { config: { ENCRYPTION_KEY: 'test-encryption-key' } },
}));

import { EventEmitter } from 'events';
import { ReplicationHandler } from '../../../src/managers/handlers/ReplicationHandler';
import { ResolvedReplicationStorage } from '../../../src/types/events';

describe('ReplicationHandler', () => {
	let emitter: EventEmitter;
	let mockProgressManager: any;
	let cancelledBackups: Set<string>;
	let handler: ReplicationHandler;

	const planId = 'plan-1';
	const backupId = 'backup-1';
	const sourceRepoPath = '/repo/source';
	const pruneSettings = { snapCount: 5, policy: 'keep-last' };
	const retryInfo = { attempts: 0, maxAttempts: 1 };

	const resolvedStorages: ResolvedReplicationStorage[] = [
		{
			replicationId: 'rep-1',
			storageId: 'storage-1',
			storagePath: '/mirror/path1',
			storageName: 'mirror-storage-1',
			storageType: 'b2',
		},
		{
			replicationId: 'rep-2',
			storageId: 'storage-2',
			storagePath: '/mirror/path2',
			storageName: 'mirror-storage-2',
			storageType: 's3',
		},
	];

	beforeEach(() => {
		jest.clearAllMocks();
		emitter = new EventEmitter();
		mockProgressManager = {
			initializeReplications: mockInitializeReplications.mockResolvedValue(undefined),
			updateReplicationAction: mockUpdateReplicationAction.mockResolvedValue(undefined),
			updateReplicationResticProgress:
				mockUpdateReplicationResticProgress.mockResolvedValue(undefined),
		};
		cancelledBackups = new Set();
		handler = new ReplicationHandler(emitter, mockProgressManager, cancelledBackups);

		mockGenerateResticRepoPath.mockImplementation(
			(name: string, path: string) => `rclone:${name}:${path}`
		);
		mockRunResticCommand.mockResolvedValue('ok');
	});

	describe('replicateSnapshot', () => {
		it('should initialize replication progress entries', async () => {
			await handler.replicateSnapshot(
				planId,
				backupId,
				sourceRepoPath,
				true,
				resolvedStorages,
				pruneSettings,
				false,
				retryInfo
			);

			expect(mockInitializeReplications).toHaveBeenCalledWith(planId, backupId, [
				{
					replicationId: 'rep-1',
					storageId: 'storage-1',
					storageName: 'mirror-storage-1',
					storageType: 'b2',
				},
				{
					replicationId: 'rep-2',
					storageId: 'storage-2',
					storageName: 'mirror-storage-2',
					storageType: 's3',
				},
			]);
		});

		it('should replicate sequentially when concurrent is false', async () => {
			const callOrder: string[] = [];
			mockRunResticCommand.mockImplementation(async (args: string[]) => {
				if (args.includes('copy')) {
					const repo = args[1]; // -r <destRepoPath>
					callOrder.push(repo);
				}
				return 'ok';
			});

			const results = await handler.replicateSnapshot(
				planId,
				backupId,
				sourceRepoPath,
				true,
				resolvedStorages,
				pruneSettings,
				false,
				retryInfo
			);

			expect(results).toHaveLength(2);
			expect(results[0].replicationId).toBe('rep-1');
			expect(results[1].replicationId).toBe('rep-2');
			// Sequential: second repo path should appear after first
			expect(callOrder.indexOf(callOrder[0])).toBeLessThan(
				callOrder.indexOf(callOrder[callOrder.length - 1])
			);
		});

		it('should replicate concurrently when concurrent is true', async () => {
			const results = await handler.replicateSnapshot(
				planId,
				backupId,
				sourceRepoPath,
				true,
				resolvedStorages,
				pruneSettings,
				true,
				retryInfo
			);

			expect(results).toHaveLength(2);
			expect(results[0].status).toBe('completed');
			expect(results[1].status).toBe('completed');
		});

		it('should return completed mirrors on success', async () => {
			const results = await handler.replicateSnapshot(
				planId,
				backupId,
				sourceRepoPath,
				true,
				[resolvedStorages[0]],
				pruneSettings,
				false,
				retryInfo
			);

			expect(results).toHaveLength(1);
			expect(results[0]).toMatchObject({
				replicationId: 'rep-1',
				storageId: 'storage-1',
				storageName: 'mirror-storage-1',
				storagePath: '/mirror/path1',
				storageType: 'b2',
				status: 'completed',
			});
			expect(results[0].started).toBeDefined();
			expect(results[0].ended).toBeDefined();
		});

		it('should return failed mirror when restic copy fails', async () => {
			mockRunResticCommand.mockImplementation(async (args: string[]) => {
				if (args.includes('copy')) {
					throw new Error('Copy failed: network error');
				}
				return 'ok';
			});

			const results = await handler.replicateSnapshot(
				planId,
				backupId,
				sourceRepoPath,
				true,
				[resolvedStorages[0]],
				pruneSettings,
				false,
				retryInfo
			);

			expect(results).toHaveLength(1);
			expect(results[0].status).toBe('failed');
			expect(results[0].error).toBe('Copy failed: network error');
		});

		it('should emit replication_start event for each storage', async () => {
			const emittedEvents: any[] = [];
			emitter.on('replication_start', data => emittedEvents.push(data));

			await handler.replicateSnapshot(
				planId,
				backupId,
				sourceRepoPath,
				true,
				resolvedStorages,
				pruneSettings,
				false,
				retryInfo
			);

			expect(emittedEvents).toHaveLength(2);
			expect(emittedEvents[0]).toMatchObject({
				planId,
				backupId,
				replicationId: 'rep-1',
				storageId: 'storage-1',
			});
			expect(emittedEvents[1]).toMatchObject({
				planId,
				backupId,
				replicationId: 'rep-2',
			});
		});

		it('should emit replication_complete events with success on completion', async () => {
			const emittedEvents: any[] = [];
			emitter.on('replication_complete', data => emittedEvents.push(data));

			await handler.replicateSnapshot(
				planId,
				backupId,
				sourceRepoPath,
				true,
				[resolvedStorages[0]],
				pruneSettings,
				false,
				retryInfo
			);

			expect(emittedEvents).toHaveLength(1);
			expect(emittedEvents[0]).toMatchObject({
				planId,
				backupId,
				replicationId: 'rep-1',
				success: true,
			});
		});

		it('should emit replication_complete events with failure on error', async () => {
			mockRunResticCommand.mockImplementation(async (args: string[]) => {
				if (args.includes('copy')) {
					throw new Error('Network timeout');
				}
				return 'ok';
			});

			const emittedEvents: any[] = [];
			emitter.on('replication_complete', data => emittedEvents.push(data));

			await handler.replicateSnapshot(
				planId,
				backupId,
				sourceRepoPath,
				true,
				[resolvedStorages[0]],
				pruneSettings,
				false,
				retryInfo
			);

			expect(emittedEvents).toHaveLength(1);
			expect(emittedEvents[0]).toMatchObject({
				planId,
				backupId,
				replicationId: 'rep-1',
				success: false,
				error: 'Network timeout',
			});
		});

		it('should mark remaining mirrors as failed when cancelled during sequential replication', async () => {
			let callCount = 0;
			mockRunResticCommand.mockImplementation(async (args: string[]) => {
				callCount++;
				if (callCount === 3) {
					// Cancel during the first storage's copy command
					cancelledBackups.add(planId);
				}
				return 'ok';
			});

			const results = await handler.replicateSnapshot(
				planId,
				backupId,
				sourceRepoPath,
				true,
				resolvedStorages,
				pruneSettings,
				false,
				retryInfo
			);

			// First one completed, second should be cancelled
			const failedResults = results.filter(r => r.status === 'failed');
			const cancelledResult = failedResults.find(r => r.error === 'Cancelled by user');
			expect(cancelledResult).toBeDefined();
		});

		it('should update replication progress actions throughout lifecycle', async () => {
			await handler.replicateSnapshot(
				planId,
				backupId,
				sourceRepoPath,
				true,
				[resolvedStorages[0]],
				pruneSettings,
				false,
				retryInfo
			);

			// Check that relevant progress actions were called
			const actionCalls = mockUpdateReplicationAction.mock.calls.map((c: any) => c[3]);
			expect(actionCalls).toContain('REPLICATION_COPY_START');
			expect(actionCalls).toContain('REPLICATION_INIT_START');
			expect(actionCalls).toContain('REPLICATION_INIT_COMPLETE');
			expect(actionCalls).toContain('REPLICATION_COPY_COMPLETE');
			expect(actionCalls).toContain('REPLICATION_COMPLETE');
		});

		it('should track processes with processManager', async () => {
			await handler.replicateSnapshot(
				planId,
				backupId,
				sourceRepoPath,
				true,
				[resolvedStorages[0]],
				pruneSettings,
				false,
				retryInfo
			);

			// runResticCommand is called with an onProcess callback that calls trackProcess
			expect(mockRunResticCommand).toHaveBeenCalled();
			// Verify onProcess callback was provided by checking the last argument
			const calls = mockRunResticCommand.mock.calls;
			for (const call of calls) {
				const lastArg = call[call.length - 1];
				if (typeof lastArg === 'function') {
					// Simulate tracking
					lastArg({ pid: 123 });
					expect(mockTrackProcess).toHaveBeenCalledWith(expect.stringContaining('replication-'), {
						pid: 123,
					});
				}
			}
		});

		it('should run prune after successful copy', async () => {
			await handler.replicateSnapshot(
				planId,
				backupId,
				sourceRepoPath,
				true,
				[resolvedStorages[0]],
				pruneSettings,
				false,
				retryInfo
			);

			const actionCalls = mockUpdateReplicationAction.mock.calls.map((c: any) => c[3]);
			expect(actionCalls).toContain('REPLICATION_PRUNE_START');
			expect(actionCalls).toContain('REPLICATION_PRUNE_COMPLETE');
		});

		it('should handle prune failure gracefully (non-fatal)', async () => {
			mockPruneHandler.prune.mockRejectedValueOnce(new Error('Prune failed'));

			const results = await handler.replicateSnapshot(
				planId,
				backupId,
				sourceRepoPath,
				true,
				[resolvedStorages[0]],
				pruneSettings,
				false,
				retryInfo
			);

			// Mirror should still be completed even if prune fails
			expect(results[0].status).toBe('completed');
			const actionCalls = mockUpdateReplicationAction.mock.calls.map((c: any) => c[3]);
			expect(actionCalls).toContain('REPLICATION_PRUNE_FAILED');
		});

		it('should use --insecure-no-password flags when encryption is false', async () => {
			await handler.replicateSnapshot(
				planId,
				backupId,
				sourceRepoPath,
				false, // no encryption
				[resolvedStorages[0]],
				pruneSettings,
				false,
				retryInfo
			);

			const copyCalls = mockRunResticCommand.mock.calls.filter((c: any) => c[0].includes('copy'));
			expect(copyCalls.length).toBeGreaterThan(0);
			expect(copyCalls[0][0]).toContain('--insecure-no-password');
			expect(copyCalls[0][0]).toContain('--from-insecure-no-password');
		});

		it('should report REPLICATION_INIT_FAILED when repo init fails', async () => {
			// First call is snapshots check (fails = repo doesn't exist)
			// Second call is init (also fails)
			mockRunResticCommand
				.mockRejectedValueOnce(new Error('repo not found'))
				.mockRejectedValueOnce(new Error('Init permission denied'));

			const results = await handler.replicateSnapshot(
				planId,
				backupId,
				sourceRepoPath,
				true,
				[resolvedStorages[0]],
				pruneSettings,
				false,
				retryInfo
			);

			expect(results[0].status).toBe('failed');
			expect(results[0].error).toBe('Init permission denied');
			const actionCalls = mockUpdateReplicationAction.mock.calls.map((c: any) => c[3]);
			expect(actionCalls).toContain('REPLICATION_INIT_FAILED');
		});
	});

	describe('cancelReplications', () => {
		it('should kill all active replication processes for a backup', async () => {
			// Start a replication that we can check tracking for
			let copyResolve: Function;
			const copyPromise = new Promise(resolve => {
				copyResolve = resolve;
			});
			mockRunResticCommand.mockImplementation(async (args: string[]) => {
				if (args.includes('copy')) {
					// Simulate a long-running copy
					await copyPromise;
				}
				return 'ok';
			});

			// Start replication in the background
			const replicatePromise = handler.replicateSnapshot(
				planId,
				backupId,
				sourceRepoPath,
				true,
				[resolvedStorages[0]],
				pruneSettings,
				false,
				retryInfo
			);

			// Give it a tick to start
			await new Promise(resolve => setTimeout(resolve, 10));

			// Cancel
			await handler.cancelReplications(backupId);

			// Let the copy complete
			copyResolve!('ok');
			await replicatePromise;

			expect(mockKillProcess).toHaveBeenCalledWith(`replication-${backupId}-rep-1`);
		});

		it('should not throw if no active replications exist', async () => {
			await expect(handler.cancelReplications('non-existent')).resolves.not.toThrow();
		});
	});
});
