import { createReadStream } from 'fs';
import { open } from 'fs/promises';
import { Readable } from 'stream';
import { LogPage, PlanLogItem } from '../../types/plans';
import { BadRequestError } from '../AppError';
import {
	LogFile,
	compareLogFiles,
	dateMonthIndex,
	listLogFiles,
	monthIndex,
	parseLogFileName,
} from './logFiles';

const CHUNK_SIZE = 64 * 1024;
export const LOG_PAGE_SIZE = 200;
export const LOG_MAX_SCAN_BYTES = 5 * 1024 * 1024;

export type LogLevelName = 'info' | 'warn' | 'error';

export interface LogQuery {
	cursor?: string;
	from?: number;
	to?: number;
	levels?: string[];
	modules?: string[];
	search?: string;
	limit?: number;
}

export interface LogPageQuery extends LogQuery {
	prefix: string;
	maxScanBytes?: number;
}

interface LogCursor {
	file: string;
	offset?: number;
}

const levelName = (level: number): LogLevelName | undefined =>
	level >= 50 ? 'error' : level >= 40 ? 'warn' : level >= 30 ? 'info' : undefined;

const encodeCursor = (cursor: LogCursor) => Buffer.from(JSON.stringify(cursor)).toString('base64');

function decodeCursor(cursor: string, prefix: string): LogCursor {
	let parsed: any;
	try {
		parsed = JSON.parse(Buffer.from(cursor, 'base64').toString('utf8'));
	} catch {
		throw new BadRequestError('Invalid log cursor');
	}
	const file = parsed?.file;
	const offset = parsed?.offset;
	if (
		typeof file !== 'string' ||
		/[\\/]/.test(file) ||
		parseLogFileName(file)?.prefix !== prefix ||
		(offset !== undefined && !(Number.isInteger(offset) && offset >= 0))
	) {
		throw new BadRequestError('Invalid log cursor');
	}
	return { file, offset };
}

const toList = (value: unknown) =>
	typeof value === 'string' && value ? value.split(',').filter(Boolean) : undefined;
const toNumber = (value: unknown) => {
	const num = typeof value === 'string' && value !== '' ? Number(value) : NaN;
	return Number.isFinite(num) ? num : undefined;
};

/** Reads the log query parameters of a request. */
export function parseLogQuery(query: Record<string, unknown>): LogQuery {
	const limit = toNumber(query.limit);
	return {
		cursor: typeof query.cursor === 'string' && query.cursor ? query.cursor : undefined,
		from: toNumber(query.from),
		to: toNumber(query.to),
		levels: toList(query.levels),
		modules: toList(query.modules),
		search: typeof query.search === 'string' && query.search ? query.search : undefined,
		limit: limit && limit > 0 ? Math.min(limit, 1000) : undefined,
	};
}

async function readFirstLineTime(filePath: string): Promise<number | undefined> {
	const handle = await open(filePath, 'r');
	try {
		const buffer = Buffer.alloc(CHUNK_SIZE);
		const { bytesRead } = await handle.read(buffer, 0, CHUNK_SIZE, 0);
		const end = buffer.subarray(0, bytesRead).indexOf(0x0a);
		const line = buffer.subarray(0, end === -1 ? bytesRead : end).toString('utf8');
		const time = JSON.parse(line)?.time;
		return typeof time === 'number' ? time : undefined;
	} catch {
		return undefined;
	} finally {
		await handle.close();
	}
}

/** Skips a file whose entries are all outside the range. The first line is its oldest entry. */
async function isOutOfRange(file: LogFile, from?: number, to?: number) {
	if (from !== undefined && monthIndex(file.year, file.month) < dateMonthIndex(new Date(from))) {
		return true;
	}
	if (to === undefined) return false;
	const firstTime = await readFirstLineTime(file.path).catch(() => undefined);
	return firstTime !== undefined && firstTime > to;
}

/**
 * Reads one page of log entries, newest first. The read goes backwards through the
 * monthly files of `prefix` and stops at `limit` entries or after `maxScanBytes`.
 */
export async function readLogPage({
	prefix,
	cursor,
	from,
	to,
	levels,
	modules,
	search,
	limit = LOG_PAGE_SIZE,
	maxScanBytes = LOG_MAX_SCAN_BYTES,
}: LogPageQuery): Promise<LogPage> {
	const start = cursor ? decodeCursor(cursor, prefix) : undefined;
	const startName = start && parseLogFileName(start.file)!;
	const files = listLogFiles(prefix).filter(f => !startName || compareLogFiles(f, startName) >= 0);
	const levelSet = levels?.length ? new Set(levels) : undefined;
	const moduleSet = modules?.length ? new Set(modules) : undefined;
	const searchText = search?.toLowerCase();

	const items: PlanLogItem[] = [];
	const seenModules = new Set<string>();
	let scannedTo: number | null = null;
	let scanned = 0;
	let reachedRange = to === undefined;

	for (let index = 0; index < files.length; index++) {
		const file = files[index];
		if (await isOutOfRange(file, from, undefined)) break;
		if (await isOutOfRange(file, undefined, to)) continue;

		const handle = await open(file.path, 'r').catch(() => undefined);
		if (!handle) continue;
		try {
			let lineEnd =
				file.name === start?.file && start.offset !== undefined
					? Math.min(start.offset, file.size)
					: file.size;
			let buffer = Buffer.alloc(0);
			let bufferStart = lineEnd;

			while (lineEnd > 0) {
				const relEnd = lineEnd - bufferStart;
				const newline = relEnd > 0 ? buffer.lastIndexOf(0x0a, relEnd - 1) : -1;
				if (newline === -1 && bufferStart > 0) {
					if (scanned >= maxScanBytes) {
						return page(encodeCursor({ file: file.name, offset: lineEnd }));
					}
					const readStart = Math.max(0, bufferStart - CHUNK_SIZE);
					const chunk = Buffer.alloc(bufferStart - readStart);
					await handle.read(chunk, 0, chunk.length, readStart);
					buffer = Buffer.concat([chunk, buffer.subarray(0, relEnd)]);
					bufferStart = readStart;
					// Lines newer than `to` do not count, so a past range does not give empty pages
					if (reachedRange) scanned += chunk.length;
					continue;
				}

				const line = buffer
					.subarray(newline + 1, relEnd)
					.toString('utf8')
					.trim();
				lineEnd = bufferStart + Math.max(newline, 0);

				let entry: PlanLogItem | undefined;
				try {
					entry = line ? JSON.parse(line) : undefined;
				} catch {
					entry = undefined;
				}
				if (!entry || typeof entry.time !== 'number') continue;
				if (from !== undefined && entry.time < from) return page(null);
				scannedTo = entry.time;
				if (to !== undefined && entry.time > to) continue;
				reachedRange = true;

				if (entry.module) seenModules.add(entry.module);
				if (levelSet && !levelSet.has(levelName(entry.level) as string)) continue;
				if (moduleSet && !moduleSet.has(entry.module)) continue;
				if (
					searchText &&
					!String(entry.msg ?? '')
						.toLowerCase()
						.includes(searchText) &&
					!String(entry.backupId ?? '')
						.toLowerCase()
						.includes(searchText)
				) {
					continue;
				}

				items.push(entry);
				if (items.length >= limit) {
					const next = lineEnd > 0 ? { file: file.name, offset: lineEnd } : nextFile(index);
					return page(next ? encodeCursor(next) : null);
				}
			}
		} finally {
			await handle.close();
		}

		if (scanned >= maxScanBytes) {
			const next = nextFile(index);
			return page(next ? encodeCursor(next) : null);
		}
	}
	return page(null);

	function nextFile(index: number): LogCursor | null {
		const next = files[index + 1];
		return next ? { file: next.name } : null;
	}

	function page(nextCursor: string | null): LogPage {
		return { items, nextCursor, scannedTo, modules: [...seenModules] };
	}
}

/** Joins the raw log files that overlap the range, oldest first. */
export function streamLogFiles(prefix: string, from?: number, to?: number): Readable {
	const files = listLogFiles(prefix).reverse();
	return Readable.from(
		(async function* () {
			for (const file of files) {
				if (await isOutOfRange(file, from, to)) continue;
				try {
					for await (const chunk of createReadStream(file.path)) yield chunk as Buffer;
				} catch {
					// Removed by retention while the download ran
				}
			}
		})()
	);
}
