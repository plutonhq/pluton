import { EventEmitter } from 'events';
import { DownloadEventListener } from '../../../src/services/listeners/DownloadEventListener';
import { BaseSnapshotManager } from '../../../src/managers/BaseSnapshotManager';
import { BackupStore } from '../../../src/stores/BackupStore';
import { DownloadEventService } from '../../../src/services/events/DownloadEventService';
import {
	DownloadStartEvent,
	DownloadErrorEvent,
	DownloadCompleteEvent,
} from '../../../src/types/events';

// Mock dependencies
jest.mock('../../../src/managers/BaseSnapshotManager');
jest.mock('../../../src/stores/BackupStore');
jest.mock('../../../src/services/events/DownloadEventService', () => ({
	DownloadEventService: jest.fn(),
}));
jest.mock('../../../src/utils/logger', () => ({
	planLogger: jest.fn().mockReturnValue({
		info: jest.fn(),
		error: jest.fn(),
		warn: jest.fn(),
	}),
}));

describe('DownloadEventListener', () => {
	let localAgent: EventEmitter;
	let mockBackupStore: jest.Mocked<BackupStore>;
	let mockDownloadEventService: jest.Mocked<DownloadEventService>;
	let listener: DownloadEventListener;

	beforeEach(() => {
		jest.clearAllMocks();

		// Use a real EventEmitter as the localAgent so we can emit events
		localAgent = new EventEmitter();

		mockBackupStore = new BackupStore(null as any) as jest.Mocked<BackupStore>;

		// Capture the mocked DownloadEventService instance created inside the constructor
		mockDownloadEventService = {
			onDownloadStart: jest.fn().mockResolvedValue(undefined),
			onDownloadError: jest.fn().mockResolvedValue(undefined),
			onDownloadComplete: jest.fn().mockResolvedValue(undefined),
		} as any;

		(DownloadEventService as jest.Mock).mockImplementation(() => mockDownloadEventService);

		listener = new DownloadEventListener(localAgent as any, mockBackupStore);
	});

	describe('constructor', () => {
		it('should create a DownloadEventService instance', () => {
			expect(DownloadEventService).toHaveBeenCalledWith(mockBackupStore, localAgent);
		});

		it('should register event listeners on the localAgent', () => {
			expect(localAgent.listenerCount('download_start')).toBe(1);
			expect(localAgent.listenerCount('download_error')).toBe(1);
			expect(localAgent.listenerCount('download_complete')).toBe(1);
		});
	});

	describe('download_start event', () => {
		it('should delegate to downloadEventService.onDownloadStart', () => {
			const event: DownloadStartEvent = {
				backupId: 'backup-1',
				planId: 'plan-1',
			};

			localAgent.emit('download_start', event);

			expect(mockDownloadEventService.onDownloadStart).toHaveBeenCalledWith(event);
			expect(mockDownloadEventService.onDownloadStart).toHaveBeenCalledTimes(1);
		});
	});

	describe('download_error event', () => {
		it('should delegate to downloadEventService.onDownloadError', () => {
			const event: DownloadErrorEvent = {
				backupId: 'backup-1',
				planId: 'plan-1',
				error: 'Download failed',
			};

			localAgent.emit('download_error', event);

			expect(mockDownloadEventService.onDownloadError).toHaveBeenCalledWith(event);
			expect(mockDownloadEventService.onDownloadError).toHaveBeenCalledTimes(1);
		});
	});

	describe('download_complete event', () => {
		it('should delegate to downloadEventService.onDownloadComplete', () => {
			const event: DownloadCompleteEvent = {
				backupId: 'backup-1',
				planId: 'plan-1',
				success: true,
			};

			localAgent.emit('download_complete', event);

			expect(mockDownloadEventService.onDownloadComplete).toHaveBeenCalledWith(event);
			expect(mockDownloadEventService.onDownloadComplete).toHaveBeenCalledTimes(1);
		});
	});
});
