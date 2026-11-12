import pino from 'pino';
import { Writable } from 'stream';
import {
	createRepeatLimiterHook,
	REPEAT_WINDOW_MS,
} from '../../../src/utils/logging/repeatLimiter';

const createLogger = () => {
	const lines: any[] = [];
	const stream = new Writable({
		write(chunk, _enc, cb) {
			lines.push(JSON.parse(chunk.toString()));
			cb();
		},
	});
	const logger = pino({ hooks: { logMethod: createRepeatLimiterHook() } }, stream);
	return { logger, lines };
};

const tick = () => new Promise(resolve => setImmediate(resolve));

describe('createRepeatLimiterHook', () => {
	beforeEach(() => {
		jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
	});
	afterEach(() => {
		jest.useRealTimers();
	});

	it('writes the first copy and a summary at the next copy after the window', async () => {
		const { logger, lines } = createLogger();
		const log = logger.child({ module: 'Backup', planId: 'p1' });

		for (let i = 0; i < 5; i++) log.error('Disk full');
		jest.advanceTimersByTime(REPEAT_WINDOW_MS - 1000);
		log.error('Disk full');
		jest.setSystemTime(Date.now() + 2000);
		log.error('Disk full');
		await tick();

		expect(lines.map(l => [l.level, l.msg])).toEqual([
			[50, 'Disk full'],
			[50, 'Previous message repeated 5 times: Disk full'],
			[50, 'Disk full'],
		]);
		expect(lines[1]).toMatchObject({ module: 'Backup', planId: 'p1' });
	});

	it('writes the summary from the timer when no new copy comes', async () => {
		const { logger, lines } = createLogger();

		logger.warn({ code: 1 }, 'Slow');
		logger.warn({ code: 2 }, 'Slow');
		logger.warn('Slow');
		jest.advanceTimersByTime(REPEAT_WINDOW_MS);
		await tick();

		expect(lines.map(l => l.msg)).toEqual(['Slow', 'Previous message repeated 2 times: Slow']);
		expect(lines[1].level).toBe(40);
	});

	it('keeps separate keys for level, message and bindings', async () => {
		const { logger, lines } = createLogger();

		logger.child({ backupId: 'b1' }).info('Started');
		logger.child({ backupId: 'b2' }).info('Started');
		logger.warn('Started');
		logger.info('Other');
		jest.advanceTimersByTime(REPEAT_WINDOW_MS);
		await tick();

		expect(lines).toHaveLength(4);
		expect(lines.some(l => l.msg.startsWith('Previous'))).toBe(false);
	});

	it('does not write a summary when a message does not repeat', async () => {
		const { logger, lines } = createLogger();

		logger.info('Once');
		jest.advanceTimersByTime(REPEAT_WINDOW_MS * 2);
		logger.info('Once');
		await tick();

		expect(lines.map(l => l.msg)).toEqual(['Once', 'Once']);
	});
});
