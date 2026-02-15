import { EventEmitter } from 'events';
import { BackupEventListener } from '../../../src/services/listeners/BackupEventListener';
import { BaseBackupManager } from '../../../src/managers/BaseBackupManager';
import { PlanStore } from '../../../src/stores/PlanStore';
import { BackupStore } from '../../../src/stores/BackupStore';
import { BackupEventService } from '../../../src/services/events/BackupEventService';
import {
	BackupStartEvent,
	BackupCompleteEvent,
	BackupErrorEvent,
	BackupStatUpdateEvent,
	PruneEndEvent,
} from '../../../src/types/events';

// Mock dependencies
jest.mock('../../../src/db/index', () => ({
	db: { select: jest.fn(), insert: jest.fn(), update: jest.fn(), delete: jest.fn() },
}));
jest.mock('../../../src/services/ConfigService', () => ({
	configService: {
		config: { SECRET: 'test-secret', APIKEY: 'test-key' },
	},
}));
jest.mock('../../../src/managers/BaseBackupManager');
jest.mock('../../../src/stores/PlanStore');
jest.mock('../../../src/stores/BackupStore');
jest.mock('../../../src/services/events/BackupEventService', () => ({
	BackupEventService: jest.fn(),
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
jest.mock('../../../src/jobs/JobProcessor', () => {
	const emitter = new (require('events').EventEmitter)();
	return {
		jobProcessor: Object.assign(emitter, {
			__test_emitter: true,
		}),
	};
});
jest.mock('../../../src/utils/logger', () => ({
	planLogger: jest.fn().mockReturnValue({
		info: jest.fn(),
		error: jest.fn(),
		warn: jest.fn(),
	}),
}));

// Re-import jobProcessor after mock so we can emit on it
import { jobProcessor } from '../../../src/jobs/JobProcessor';

describe('BackupEventListener', () => {
	let localAgent: EventEmitter;
	let mockPlanStore: jest.Mocked<PlanStore>;
	let mockBackupStore: jest.Mocked<BackupStore>;
	let mockBackupEventService: jest.Mocked<BackupEventService>;
	let listener: BackupEventListener;

	beforeEach(() => {
		jest.clearAllMocks();

		// Use a real EventEmitter as the localAgent so we can emit events
		localAgent = new EventEmitter();

		mockPlanStore = new PlanStore(null as any) as jest.Mocked<PlanStore>;
		mockBackupStore = new BackupStore(null as any) as jest.Mocked<BackupStore>;

		// Capture the mocked BackupEventService instance created inside the constructor
		mockBackupEventService = {
			onBackupStart: jest.fn().mockResolvedValue(undefined),
			onBackupComplete: jest.fn().mockResolvedValue(undefined),
			onBackupError: jest.fn().mockResolvedValue(undefined),
			onBackupFailure: jest.fn().mockResolvedValue(undefined),
			onBackupStatsUpdate: jest.fn().mockResolvedValue(undefined),
			onPruneEnd: jest.fn().mockResolvedValue(undefined),
		} as any;

		(BackupEventService as jest.Mock).mockImplementation(() => mockBackupEventService);

		listener = new BackupEventListener(localAgent as any, mockPlanStore, mockBackupStore);
	});

	describe('constructor', () => {
		it('should create a BackupEventService instance', () => {
			expect(BackupEventService).toHaveBeenCalledWith(mockPlanStore, mockBackupStore, localAgent);
		});

		it('should register event listeners on the localAgent', () => {
			expect(localAgent.listenerCount('backup_start')).toBe(1);
			expect(localAgent.listenerCount('backup_complete')).toBe(1);
			expect(localAgent.listenerCount('backup_error')).toBe(1);
			expect(localAgent.listenerCount('backup_stats_update')).toBe(1);
			expect(localAgent.listenerCount('pruneEnd')).toBe(1);
		});
	});

	describe('backup_start event', () => {
		it('should delegate to backupEventService.onBackupStart', () => {
			const event: BackupStartEvent = {
				planId: 'plan-1',
				backupId: 'backup-1',
				summary: {} as any,
			};

			localAgent.emit('backup_start', event);

			expect(mockBackupEventService.onBackupStart).toHaveBeenCalledWith(event);
			expect(mockBackupEventService.onBackupStart).toHaveBeenCalledTimes(1);
		});
	});

	describe('backup_complete event', () => {
		it('should delegate to backupEventService.onBackupComplete', () => {
			const event: BackupCompleteEvent = {
				planId: 'plan-1',
				backupId: 'backup-1',
				success: true,
				summary: {} as any,
			};

			localAgent.emit('backup_complete', event);

			expect(mockBackupEventService.onBackupComplete).toHaveBeenCalledWith(event);
			expect(mockBackupEventService.onBackupComplete).toHaveBeenCalledTimes(1);
		});
	});

	describe('backup_error event', () => {
		it('should delegate to backupEventService.onBackupError', () => {
			const event: BackupErrorEvent = {
				planId: 'plan-1',
				backupId: 'backup-1',
				error: 'Something went wrong',
			};

			localAgent.emit('backup_error', event);

			expect(mockBackupEventService.onBackupError).toHaveBeenCalledWith(event);
			expect(mockBackupEventService.onBackupError).toHaveBeenCalledTimes(1);
		});
	});

	describe('backup_stats_update event', () => {
		it('should delegate to backupEventService.onBackupStatsUpdate', () => {
			const event: BackupStatUpdateEvent = {
				planId: 'plan-1',
				backupId: 'backup-1',
				total_size: 1024,
				snapshots: ['snap-1'],
			};

			localAgent.emit('backup_stats_update', event);

			expect(mockBackupEventService.onBackupStatsUpdate).toHaveBeenCalledWith(event);
			expect(mockBackupEventService.onBackupStatsUpdate).toHaveBeenCalledTimes(1);
		});
	});

	describe('pruneEnd event', () => {
		it('should delegate to backupEventService.onPruneEnd', () => {
			const event: PruneEndEvent = {
				planId: 'plan-1',
				success: true,
				stats: { total_size: 512, snapshots: ['snap-1'] },
			};

			localAgent.emit('pruneEnd', event);

			expect(mockBackupEventService.onPruneEnd).toHaveBeenCalledWith(event);
			expect(mockBackupEventService.onPruneEnd).toHaveBeenCalledTimes(1);
		});
	});

	describe('backup_failed event (jobProcessor)', () => {
		it('should delegate to backupEventService.onBackupFailure', () => {
			const event = {
				planId: 'plan-1',
				backupId: 'backup-1',
				error: 'Job permanently failed',
			};

			(jobProcessor as unknown as EventEmitter).emit('backup_failed', event);

			expect(mockBackupEventService.onBackupFailure).toHaveBeenCalledWith(event);
			expect(mockBackupEventService.onBackupFailure).toHaveBeenCalledTimes(1);
		});
	});
});
