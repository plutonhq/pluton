import type { LogFn, Logger } from 'pino';

export const REPEAT_WINDOW_MS = 60 * 1000;
const MAX_KEYS = 500;

interface RepeatEntry {
	start: number;
	count: number;
	msg: string;
	logger: Logger;
	method: LogFn;
}

const messageOf = (args: unknown[]): string => {
	if (typeof args[0] === 'string') return args[0];
	if (typeof args[1] === 'string') return args[1];
	if (args[0] instanceof Error) return args[0].message;
	return '';
};

/**
 * A pino `logMethod` hook. The first copy of a message is written, the copies in the
 * next REPEAT_WINDOW_MS are counted, and one summary line is written when the window ends.
 */
export function createRepeatLimiterHook() {
	const entries = new Map<string, RepeatEntry>();
	let timer: NodeJS.Timeout | undefined;

	const close = (key: string, entry: RepeatEntry) => {
		entries.delete(key);
		if (entry.count > 0) {
			entry.method.call(
				entry.logger,
				`Previous message repeated ${entry.count} times: ${entry.msg}` as never
			);
		}
	};

	const closeExpired = (now: number) => {
		for (const [key, entry] of entries) {
			if (now - entry.start >= REPEAT_WINDOW_MS) close(key, entry);
		}
		if (!entries.size && timer) {
			clearInterval(timer);
			timer = undefined;
		}
	};

	return function logMethod(this: Logger, args: unknown[], method: LogFn, level: number) {
		const msg = messageOf(args);
		if (!msg) return method.apply(this, args as Parameters<LogFn>);

		const now = Date.now();
		const key = `${level}|${msg}|${JSON.stringify(this.bindings())}`;
		const entry = entries.get(key);
		if (entry && now - entry.start < REPEAT_WINDOW_MS) {
			entry.count++;
			return;
		}
		if (entry) close(key, entry);
		if (entries.size >= MAX_KEYS) closeExpired(now);
		if (entries.size >= MAX_KEYS) {
			const [oldestKey, oldest] = entries.entries().next().value!;
			close(oldestKey, oldest);
		}

		entries.set(key, { start: now, count: 0, msg, logger: this, method });
		if (!timer) {
			timer = setInterval(() => closeExpired(Date.now()), REPEAT_WINDOW_MS);
			timer.unref();
		}
		method.apply(this, args as Parameters<LogFn>);
	};
}
