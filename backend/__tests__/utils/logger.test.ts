import pino from 'pino';

// Mock pino at the module level
jest.mock('pino', () => {
	return jest.fn();
});

// Mock AppPaths
jest.mock('../../src/utils/AppPaths', () => ({
	appPaths: {
		getLogsDir: jest.fn().mockReturnValue('/test/logs'),
	},
}));

describe('Logger Utility', () => {
	let mockMainLogger: pino.Logger;
	let mockChildLogger: pino.Logger;
	let mockPlanLogger: pino.Logger;
	let pinoMock: jest.Mock;

	beforeEach(() => {
		// Reset modules to get a fresh instance
		jest.resetModules();

		// Create mock logger instances
		mockChildLogger = {
			child: jest.fn(),
			info: jest.fn(),
			error: jest.fn(),
			warn: jest.fn(),
			debug: jest.fn(),
			trace: jest.fn(),
			fatal: jest.fn(),
			silent: jest.fn(),
			level: 'info',
		} as unknown as pino.Logger;

		mockPlanLogger = {
			child: jest.fn().mockReturnValue(mockChildLogger),
			info: jest.fn(),
			error: jest.fn(),
			warn: jest.fn(),
			debug: jest.fn(),
			trace: jest.fn(),
			fatal: jest.fn(),
			silent: jest.fn(),
			level: 'info',
		} as unknown as pino.Logger;

		mockMainLogger = {
			child: jest.fn().mockReturnValue(mockChildLogger),
			info: jest.fn(),
			error: jest.fn(),
			warn: jest.fn(),
			debug: jest.fn(),
			trace: jest.fn(),
			fatal: jest.fn(),
			silent: jest.fn(),
			level: 'info',
		} as unknown as pino.Logger;

		// Get the mocked pino function
		pinoMock = jest.requireMock('pino') as jest.Mock;

		// Clear previous mock calls
		pinoMock.mockClear();

		// Setup the mock implementation
		pinoMock
			.mockReturnValueOnce(mockMainLogger) // First call for main logger
			.mockReturnValue(mockPlanLogger); // Subsequent calls for plan loggers
	});

	describe('initializeLogger', () => {
		it('should initialize the main logger with correct configuration', () => {
			const { initializeLogger } = require('../../src/utils/logger');

			initializeLogger();

			expect(pinoMock).toHaveBeenCalledWith({
				transport: {
					targets: [
						{
							target: 'pino/file',
							options: { destination: '/test/logs/app.log', mkdir: true },
							level: 'info',
						},
						{
							target: 'pino-pretty',
							options: {
								colorize: true,
								translateTime: 'SYS:standard',
								ignore: 'pid,hostname',
							},
							level: 'info',
						},
					],
				},
			});
		});

		it('should create all child loggers with correct modules', () => {
			const { initializeLogger } = require('../../src/utils/logger');

			initializeLogger();

			expect(mockMainLogger.child).toHaveBeenCalledWith({ module: 'CRON' });
			expect(mockMainLogger.child).toHaveBeenCalledWith({ module: 'Notification' });
			expect(mockMainLogger.child).toHaveBeenCalledWith({ module: 'Server' });
			expect(mockMainLogger.child).toHaveBeenCalledWith({ module: 'Storage' });
			expect(mockMainLogger.child).toHaveBeenCalledWith({ module: 'System' });
			expect(mockMainLogger.child).toHaveBeenCalledTimes(5);
		});

		it('should not reinitialize if already initialized', () => {
			const { initializeLogger } = require('../../src/utils/logger');

			initializeLogger();
			initializeLogger();
			initializeLogger();

			expect(pinoMock).toHaveBeenCalledTimes(1);
			expect(mockMainLogger.child).toHaveBeenCalledTimes(5);
		});

		it('should use the correct log path from appPaths', () => {
			const { initializeLogger } = require('../../src/utils/logger');
			const { appPaths } = require('../../src/utils/AppPaths');

			(appPaths.getLogsDir as jest.Mock).mockReturnValue('/custom/log/path');

			initializeLogger();

			expect(appPaths.getLogsDir).toHaveBeenCalled();
			expect(pinoMock).toHaveBeenCalledWith(
				expect.objectContaining({
					transport: expect.objectContaining({
						targets: expect.arrayContaining([
							expect.objectContaining({
								target: 'pino/file',
								options: { destination: '/custom/log/path/app.log', mkdir: true },
							}),
						]),
					}),
				})
			);
		});
	});

	describe('DeviceLogger', () => {
		it('should create a child logger with Device module and deviceId', () => {
			const { initializeLogger, DeviceLogger } = require('../../src/utils/logger');

			initializeLogger();
			(mockMainLogger.child as jest.Mock).mockClear();

			DeviceLogger('device-123');

			expect(mockMainLogger.child).toHaveBeenCalledWith({
				module: 'Device',
				deviceId: 'device-123',
			});
		});

		it('should create a child logger with only Device module when deviceId is not provided', () => {
			const { initializeLogger, DeviceLogger } = require('../../src/utils/logger');

			initializeLogger();
			(mockMainLogger.child as jest.Mock).mockClear();

			DeviceLogger();

			expect(mockMainLogger.child).toHaveBeenCalledWith({ module: 'Device' });
		});

		it('should return a logger instance', () => {
			const { initializeLogger, DeviceLogger } = require('../../src/utils/logger');

			initializeLogger();

			const result = DeviceLogger('device-456');

			expect(result).toBe(mockChildLogger);
		});
	});

	describe('planLogger', () => {
		it('should create a plan-specific logger with planId and cache it', () => {
			const { initializeLogger, planLogger } = require('../../src/utils/logger');

			initializeLogger();
			pinoMock.mockClear();

			planLogger('Backup', 'plan-123');

			expect(pinoMock).toHaveBeenCalledWith({
				transport: {
					targets: [
						{
							target: 'pino/file',
							options: { destination: '/test/logs/plan-plan-123.log', mkdir: true },
							level: 'info',
						},
					],
				},
			});
		});

		it('should reuse cached plan logger for the same planId', () => {
			const { initializeLogger, planLogger } = require('../../src/utils/logger');

			initializeLogger();
			pinoMock.mockClear();

			planLogger('Backup', 'plan-123');
			planLogger('Restore', 'plan-123');

			expect(pinoMock).toHaveBeenCalledTimes(1);
		});

		it('should create child logger with task, planId, and backupId metadata', () => {
			const { initializeLogger, planLogger } = require('../../src/utils/logger');

			initializeLogger();
			(mockPlanLogger.child as jest.Mock).mockClear();

			planLogger('Backup', 'plan-123', 'backup-456');

			expect(mockPlanLogger.child).toHaveBeenCalledWith({
				module: 'Backup',
				planId: 'plan-123',
				backupId: 'backup-456',
			});
		});

		it('should create child logger with only task and planId when backupId is not provided', () => {
			const { initializeLogger, planLogger } = require('../../src/utils/logger');

			initializeLogger();
			(mockPlanLogger.child as jest.Mock).mockClear();

			planLogger('Restore', 'plan-789');

			expect(mockPlanLogger.child).toHaveBeenCalledWith({
				module: 'Restore',
				planId: 'plan-789',
			});
		});

		it('should use main logger when planId is not provided', () => {
			const { initializeLogger, planLogger } = require('../../src/utils/logger');

			initializeLogger();
			pinoMock.mockClear();
			(mockMainLogger.child as jest.Mock).mockClear();

			planLogger('General');

			expect(pinoMock).toHaveBeenCalledTimes(0);
			expect(mockMainLogger.child).toHaveBeenCalledWith({ module: 'General' });
		});

		it('should create separate loggers for different planIds', () => {
			const { initializeLogger, planLogger } = require('../../src/utils/logger');

			initializeLogger();
			pinoMock.mockClear();

			planLogger('Backup', 'plan-1');
			planLogger('Backup', 'plan-2');

			expect(pinoMock).toHaveBeenCalledTimes(2);
			expect(pinoMock).toHaveBeenNthCalledWith(1, {
				transport: {
					targets: [
						{
							target: 'pino/file',
							options: { destination: '/test/logs/plan-plan-1.log', mkdir: true },
							level: 'info',
						},
					],
				},
			});
			expect(pinoMock).toHaveBeenNthCalledWith(2, {
				transport: {
					targets: [
						{
							target: 'pino/file',
							options: { destination: '/test/logs/plan-plan-2.log', mkdir: true },
							level: 'info',
						},
					],
				},
			});
		});

		it('should return a logger instance', () => {
			const { initializeLogger, planLogger } = require('../../src/utils/logger');

			initializeLogger();

			const result = planLogger('Backup', 'plan-999');

			expect(result).toBe(mockChildLogger);
		});
	});

	describe('Exported loggers', () => {
		it('should allow logger usage after initialization', () => {
			const { initializeLogger, DeviceLogger } = require('../../src/utils/logger');

			// Before initialization, calling DeviceLogger would fail
			initializeLogger();

			// After initialization, we can use the loggers
			const deviceLogger = DeviceLogger('test-device');

			// Verify it works
			expect(deviceLogger).toBeDefined();
			expect(mockMainLogger.child).toHaveBeenCalled();
		});

		it('should verify initializeLogger creates all child loggers', () => {
			const { initializeLogger } = require('../../src/utils/logger');

			initializeLogger();

			// Verify all 5 specialized loggers were created (CRON, Notification, Server, Storage, System)
			expect(mockMainLogger.child).toHaveBeenCalledTimes(5);
			expect(mockMainLogger.child).toHaveBeenCalledWith({ module: 'CRON' });
			expect(mockMainLogger.child).toHaveBeenCalledWith({ module: 'Notification' });
			expect(mockMainLogger.child).toHaveBeenCalledWith({ module: 'Server' });
			expect(mockMainLogger.child).toHaveBeenCalledWith({ module: 'Storage' });
			expect(mockMainLogger.child).toHaveBeenCalledWith({ module: 'System' });
		});
	});
});
