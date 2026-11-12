import { mkdirSync, openSync, statSync } from 'fs';
import path from 'path';
import pino from 'pino';
import { appPaths } from '../AppPaths';
import {
	LOG_PART_SIZE,
	dateMonthIndex,
	enforceRetention,
	freeLogFileName,
	listLogFiles,
	migrateLegacyLog,
	monthIndex,
} from './logFiles';

type Destination = ReturnType<typeof pino.destination>;

/**
 * A pino destination that writes to monthly log files with parts of LOG_PART_SIZE.
 * A new SonicBoom is opened for each file, so buffered lines stay in their own file.
 */
export class RotatingLogStream {
	private sonic!: Destination;
	private fileName = '';
	private part = 0;
	private bytes = 0;
	private monthEnd = 0;
	private closed = false;

	constructor(
		private prefix: string,
		private maxTotalBytes: number
	) {
		mkdirSync(appPaths.getLogsDir(), { recursive: true });
		migrateLegacyLog(`${prefix}.log`, prefix);
		const now = new Date();
		const latest = listLogFiles(prefix)[0];
		if (latest && monthIndex(latest.year, latest.month) === dateMonthIndex(now)) {
			this.open(latest.name, latest.part, now);
		} else {
			this.openNext(now, 0);
		}
	}

	get currentFile() {
		return this.fileName;
	}

	write(chunk: string) {
		if (this.closed) return;
		const length = Buffer.byteLength(chunk);
		const now = Date.now();
		if (now >= this.monthEnd) {
			this.rotate(new Date(now), 0);
		} else if (this.bytes > 0 && this.bytes + length > LOG_PART_SIZE) {
			this.rotate(new Date(now), this.part + 1);
		}
		this.sonic.write(chunk);
		this.bytes += length;
	}

	flushSync() {
		if (this.closed) return;
		try {
			this.sonic.flushSync();
		} catch {
			// Nothing to flush or the write failed; nothing to do at this point
		}
	}

	/** Writes the buffered lines, then closes the file. */
	end(): Promise<void> {
		if (this.closed) return Promise.resolve();
		this.closed = true;
		const sonic = this.sonic;
		return new Promise(resolve => {
			sonic.once('close', () => resolve());
			sonic.once('error', () => resolve());
			sonic.end();
		});
	}

	private rotate(now: Date, part: number) {
		this.sonic.end();
		this.openNext(now, part);
	}

	private openNext(now: Date, part: number) {
		const next = freeLogFileName(this.prefix, now.getFullYear(), now.getMonth() + 1, part);
		this.open(next.name, next.part, now);
	}

	private open(name: string, part: number, now: Date) {
		const filePath = path.join(appPaths.getLogsDir(), name);
		const fd = openSync(filePath, 'a');
		this.sonic = pino.destination({ dest: fd, sync: false });
		// A failed log write must not stop the app
		this.sonic.on('error', () => {});
		this.fileName = name;
		this.part = part;
		this.bytes = statSync(filePath).size;
		this.monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();
		enforceRetention(this.prefix, this.maxTotalBytes, name);
	}
}
