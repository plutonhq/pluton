import pino from 'pino';

// setup.ts mocks the logger globally; this file tests the real one.
jest.unmock('../../src/utils/logger');

jest.mock('pino', () => {
	const fn: any = jest.fn();
	fn.multistream = jest.fn(streams => ({ streams }));
	fn.transport = jest.fn(options => ({ transport: options }));
	return fn;
});

jest.mock('../../src/utils/logging/RotatingLogStream', () => ({
	RotatingLogStream: jest.fn().mockImplementation((prefix: string, maxBytes: number) => ({
		prefix,
		maxBytes,
		write: jest.fn(),
		flushSync: jest.fn(),
		end: jest.fn().mockResolvedValue(undefined),
	})),
}));

// The production test re-imports AppPaths, which creates /var/lib/pluton on Linux.
jest.mock('../../src/utils/AppPaths', () => ({
	appPaths: { getLogsDir: () => '/tmp/pluton-test-logs' },
}));

jest.mock('../../src/utils/logging/logFiles', () => ({
	...jest.requireActual('../../src/utils/logging/logFiles'),
	migrateLegacyLogs: jest.fn(),
}));

const mockHook = jest.fn();
jest.mock('../../src/utils/logging/repeatLimiter', () => ({
	createRepeatLimiterHook: () => mockHook,
}));

const APP_MAX = 100 * 1024 * 1024;
const PLAN_MAX = 20 * 1024 * 1024;

describe('Logger Utility', () => {
	let mockMainLogger: pino.Logger;
	let mockChildLogger: pino.Logger;
	let mockPlanLogger: pino.Logger;
	let pinoMock: jest.Mock & { multistream: jest.Mock; transport: jest.Mock };
	let StreamMock: jest.Mock;

	const load = () => require('../../src/utils/logger');

	beforeEach(() => {
		jest.resetModules();

		mockChildLogger = { child: jest.fn(), info: jest.fn() } as unknown as pino.Logger;
		mockPlanLogger = {
			child: jest.fn().mockReturnValue(mockChildLogger),
		} as unknown as pino.Logger;
		mockMainLogger = {
			child: jest.fn().mockReturnValue(mockChildLogger),
		} as unknown as pino.Logger;

		pinoMock = jest.requireMock('pino');
		pinoMock.mockReset();
		pinoMock.mockReturnValueOnce(mockMainLogger).mockReturnValue(mockPlanLogger);
		StreamMock = jest.requireMock('../../src/utils/logging/RotatingLogStream').RotatingLogStream;
		StreamMock.mockClear();
	});

	describe('initializeLogger', () => {
		it('writes to the rotating app stream and to pino-pretty outside production', () => {
			load().initializeLogger();

			expect(StreamMock).toHaveBeenCalledWith('app', APP_MAX);
			const appStream = StreamMock.mock.results[0].value;
			expect(pinoMock.transport).toHaveBeenCalledWith(
				expect.objectContaining({ target: 'pino-pretty' })
			);
			expect(pinoMock.multistream).toHaveBeenCalledWith([
				{ level: 'info', stream: appStream },
				{ level: 'info', stream: expect.objectContaining({ transport: expect.anything() }) },
			]);
			expect(pinoMock).toHaveBeenCalledWith(
				{ hooks: { logMethod: mockHook } },
				expect.objectContaining({ streams: expect.any(Array) })
			);
		});

		it('does not use pino-pretty in production', () => {
			const env = process.env.NODE_ENV;
			process.env.NODE_ENV = 'production';
			try {
				load().initializeLogger();
			} finally {
				process.env.NODE_ENV = env;
			}
			expect(pinoMock.transport).not.toHaveBeenCalled();
			expect(pinoMock.multistream.mock.calls[0][0]).toHaveLength(1);
		});

		it('creates all child loggers once', () => {
			const { initializeLogger } = load();
			initializeLogger();
			initializeLogger();

			expect(pinoMock).toHaveBeenCalledTimes(1);
			for (const module of ['CRON', 'Notification', 'Server', 'Storage', 'System']) {
				expect(mockMainLogger.child).toHaveBeenCalledWith({ module });
			}
			expect(mockMainLogger.child).toHaveBeenCalledTimes(5);
		});
	});

	describe('DeviceLogger', () => {
		it('creates a child logger with the Device module and deviceId', () => {
			const { initializeLogger, DeviceLogger } = load();
			initializeLogger();

			expect(DeviceLogger('device-123')).toBe(mockChildLogger);
			expect(mockMainLogger.child).toHaveBeenCalledWith({
				module: 'Device',
				deviceId: 'device-123',
			});
			DeviceLogger();
			expect(mockMainLogger.child).toHaveBeenCalledWith({ module: 'Device' });
		});
	});

	describe('planLogger', () => {
		it('creates one rotating stream for each plan and caches it', () => {
			const { initializeLogger, planLogger } = load();
			initializeLogger();
			pinoMock.mockClear();

			planLogger('Backup', 'plan-1');
			planLogger('Restore', 'plan-1');
			planLogger('Backup', 'plan-2');

			expect(StreamMock).toHaveBeenCalledWith('plan-plan-1', PLAN_MAX);
			expect(StreamMock).toHaveBeenCalledWith('plan-plan-2', PLAN_MAX);
			expect(pinoMock).toHaveBeenCalledTimes(2);
			expect(pinoMock).toHaveBeenCalledWith(
				{ hooks: { logMethod: mockHook } },
				StreamMock.mock.results[1].value
			);
		});

		it('adds the task, planId and backupId to the child logger', () => {
			const { initializeLogger, planLogger } = load();
			initializeLogger();

			expect(planLogger('Backup', 'plan-123', 'backup-456')).toBe(mockChildLogger);
			expect(mockPlanLogger.child).toHaveBeenCalledWith({
				module: 'Backup',
				planId: 'plan-123',
				backupId: 'backup-456',
			});
		});

		it('uses the main logger when planId is not provided', () => {
			const { initializeLogger, planLogger } = load();
			initializeLogger();
			pinoMock.mockClear();

			planLogger('General');

			expect(pinoMock).not.toHaveBeenCalled();
			expect(mockMainLogger.child).toHaveBeenCalledWith({ module: 'General' });
		});
	});

	describe('closePlanLogger and flushLogs', () => {
		it('ends the plan stream and removes it from the cache', async () => {
			const { initializeLogger, planLogger, closePlanLogger } = load();
			initializeLogger();

			planLogger('Backup', 'plan-1');
			const stream = StreamMock.mock.results[1].value;
			await closePlanLogger('plan-1');
			expect(stream.end).toHaveBeenCalled();

			planLogger('Backup', 'plan-1');
			expect(StreamMock).toHaveBeenCalledTimes(3);
			await expect(closePlanLogger('unknown')).resolves.toBeUndefined();
		});

		it('flushes the app stream and all plan streams', () => {
			const { initializeLogger, planLogger, flushLogs } = load();
			initializeLogger();
			planLogger('Backup', 'plan-1');

			flushLogs();

			expect(StreamMock.mock.results[0].value.flushSync).toHaveBeenCalled();
			expect(StreamMock.mock.results[1].value.flushSync).toHaveBeenCalled();
		});
	});
});
