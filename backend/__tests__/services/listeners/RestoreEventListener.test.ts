import { EventEmitter } from 'events';
import { RestoreEventListener } from '../../../src/services/listeners/RestoreEventListener';
import { BaseRestoreManager } from '../../../src/managers/BaseRestoreManager';
import { PlanStore } from '../../../src/stores/PlanStore';
import { BackupStore } from '../../../src/stores/BackupStore';
import { RestoreStore } from '../../../src/stores/RestoreStore';
import { RestoreEventService } from '../../../src/services/events/RestoreEventService';
import {
	RestoreStartEvent,
	RestoreCompleteEvent,
	RestoreErrorEvent,
} from '../../../src/types/events';

// Mock dependencies
jest.mock('../../../src/managers/BaseRestoreManager');
jest.mock('../../../src/stores/PlanStore');
jest.mock('../../../src/stores/BackupStore');
jest.mock('../../../src/stores/RestoreStore');
jest.mock('../../../src/services/events/RestoreEventService', () => ({
	RestoreEventService: jest.fn(),
}));
jest.mock('../../../src/utils/logger', () => ({
	planLogger: jest.fn().mockReturnValue({
		info: jest.fn(),
		error: jest.fn(),
		warn: jest.fn(),
	}),
}));

describe('RestoreEventListener', () => {
	let localAgent: EventEmitter;
	let mockPlanStore: jest.Mocked<PlanStore>;
	let mockBackupStore: jest.Mocked<BackupStore>;
	let mockRestoreStore: jest.Mocked<RestoreStore>;
	let mockRestoreEventService: jest.Mocked<RestoreEventService>;
	let listener: RestoreEventListener;

	beforeEach(() => {
		jest.clearAllMocks();

		// Use a real EventEmitter as the localAgent so we can emit events
		localAgent = new EventEmitter();

		mockPlanStore = new PlanStore(null as any) as jest.Mocked<PlanStore>;
		mockBackupStore = new BackupStore(null as any) as jest.Mocked<BackupStore>;
		mockRestoreStore = new RestoreStore(null as any) as jest.Mocked<RestoreStore>;

		// Capture the mocked RestoreEventService instance created inside the constructor
		mockRestoreEventService = {
			onRestoreStart: jest.fn().mockResolvedValue(undefined),
			onRestoreComplete: jest.fn().mockResolvedValue(undefined),
			onRestoreError: jest.fn().mockResolvedValue(undefined),
			onRestoreFailed: jest.fn().mockResolvedValue(undefined),
		} as any;

		(RestoreEventService as jest.Mock).mockImplementation(() => mockRestoreEventService);

		listener = new RestoreEventListener(
			localAgent as any,
			mockPlanStore,
			mockBackupStore,
			mockRestoreStore
		);
	});

	describe('constructor', () => {
		it('should create a RestoreEventService instance', () => {
			expect(RestoreEventService).toHaveBeenCalledWith(
				mockPlanStore,
				mockBackupStore,
				mockRestoreStore,
				localAgent
			);
		});

		it('should register event listeners on the localAgent', () => {
			expect(localAgent.listenerCount('restore_start')).toBe(1);
			expect(localAgent.listenerCount('restore_complete')).toBe(1);
			expect(localAgent.listenerCount('restore_error')).toBe(1);
			expect(localAgent.listenerCount('restore_failed')).toBe(1);
		});
	});

	describe('restore_start event', () => {
		it('should delegate to restoreEventService.onRestoreStart', () => {
			const event: RestoreStartEvent = {
				planId: 'plan-1',
				backupId: 'backup-1',
				restoreId: 'restore-1',
				summary: {} as any,
				config: {} as any,
			};

			localAgent.emit('restore_start', event);

			expect(mockRestoreEventService.onRestoreStart).toHaveBeenCalledWith(event);
			expect(mockRestoreEventService.onRestoreStart).toHaveBeenCalledTimes(1);
		});
	});

	describe('restore_complete event', () => {
		it('should delegate to restoreEventService.onRestoreComplete', () => {
			const event: RestoreCompleteEvent = {
				backupId: 'backup-1',
				restoreId: 'restore-1',
				planId: 'plan-1',
				success: true,
			};

			localAgent.emit('restore_complete', event);

			expect(mockRestoreEventService.onRestoreComplete).toHaveBeenCalledWith(event);
			expect(mockRestoreEventService.onRestoreComplete).toHaveBeenCalledTimes(1);
		});
	});

	describe('restore_error event', () => {
		it('should delegate to restoreEventService.onRestoreError', () => {
			const event: RestoreErrorEvent = {
				backupId: 'backup-1',
				planId: 'plan-1',
				error: 'Restore failed',
			};

			localAgent.emit('restore_error', event);

			expect(mockRestoreEventService.onRestoreError).toHaveBeenCalledWith(event);
			expect(mockRestoreEventService.onRestoreError).toHaveBeenCalledTimes(1);
		});
	});

	describe('restore_failed event', () => {
		it('should delegate to restoreEventService.onRestoreFailed', () => {
			const event: RestoreErrorEvent = {
				backupId: 'backup-1',
				planId: 'plan-1',
				error: 'Restore permanently failed',
				restoreId: 'restore-1',
			};

			localAgent.emit('restore_failed', event);

			expect(mockRestoreEventService.onRestoreFailed).toHaveBeenCalledWith(event);
			expect(mockRestoreEventService.onRestoreFailed).toHaveBeenCalledTimes(1);
		});
	});
});
