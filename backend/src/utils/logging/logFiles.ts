import { existsSync, readdirSync, renameSync, statSync, unlinkSync } from 'fs';
import path from 'path';
import { appPaths } from '../AppPaths';

export const LOG_PART_SIZE = 10 * 1024 * 1024;
export const LOG_MONTHS_KEPT = 3;
export const APP_LOG_MAX_BYTES = 100 * 1024 * 1024;
export const PLAN_LOG_MAX_BYTES = 20 * 1024 * 1024;

const LOG_FILE_RE = /^(.+)-(\d{4})-(\d{2})(?:\.(\d+))?\.log$/;

export interface LogFileName {
	prefix: string;
	year: number;
	month: number;
	part: number;
}

export interface LogFile extends LogFileName {
	name: string;
	path: string;
	size: number;
}

export const monthIndex = (year: number, month: number) => year * 12 + (month - 1);
export const dateMonthIndex = (date: Date) => monthIndex(date.getFullYear(), date.getMonth() + 1);

export const logFileName = (prefix: string, year: number, month: number, part = 0) =>
	`${prefix}-${year}-${String(month).padStart(2, '0')}${part ? `.${part}` : ''}.log`;

export function parseLogFileName(name: string): LogFileName | null {
	const match = LOG_FILE_RE.exec(name);
	if (!match) return null;
	const month = Number(match[3]);
	if (month < 1 || month > 12) return null;
	return { prefix: match[1], year: Number(match[2]), month, part: Number(match[4] || 0) };
}

/** Newest first: month descending, then part descending. */
export const compareLogFiles = (a: LogFileName, b: LogFileName) =>
	monthIndex(b.year, b.month) - monthIndex(a.year, a.month) || b.part - a.part;

export function listLogFiles(prefix: string): LogFile[] {
	const dir = appPaths.getLogsDir();
	let names: string[];
	try {
		names = readdirSync(dir);
	} catch {
		return [];
	}
	const files: LogFile[] = [];
	for (const name of names) {
		const parsed = parseLogFileName(name);
		if (parsed?.prefix !== prefix) continue;
		const filePath = path.join(dir, name);
		try {
			files.push({ ...parsed, name, path: filePath, size: statSync(filePath).size });
		} catch {
			// Removed between readdir and stat
		}
	}
	return files.sort(compareLogFiles);
}

const removeFile = (filePath: string) => {
	try {
		unlinkSync(filePath);
	} catch {
		// Kept for the next pass
	}
};

export function enforceRetention(prefix: string, maxTotalBytes: number, currentFile: string) {
	const minMonth = dateMonthIndex(new Date()) - (LOG_MONTHS_KEPT - 1);
	const files = listLogFiles(prefix);
	let total = files.find(f => f.name === currentFile)?.size || 0;
	let full = false;
	for (const file of files) {
		if (file.name === currentFile) continue;
		if (full || monthIndex(file.year, file.month) < minMonth || total + file.size > maxTotalBytes) {
			full ||= total + file.size > maxTotalBytes;
			removeFile(file.path);
			continue;
		}
		total += file.size;
	}
}

export function deleteLogFiles(prefix: string) {
	listLogFiles(prefix).forEach(file => removeFile(file.path));
}

/** Returns the first name of that month that is not used, starting at `part`. */
export function freeLogFileName(prefix: string, year: number, month: number, part = 0) {
	const dir = appPaths.getLogsDir();
	while (existsSync(path.join(dir, logFileName(prefix, year, month, part)))) part++;
	return { name: logFileName(prefix, year, month, part), part };
}

/** Renames every legacy `app.log` and `plan-<id>.log` in the logs folder. */
export function migrateLegacyLogs() {
	let names: string[];
	try {
		names = readdirSync(appPaths.getLogsDir());
	} catch {
		return;
	}
	for (const name of names) {
		const legacy = /^(app|plan-.+)\.log$/.exec(name);
		if (legacy && !parseLogFileName(name)) migrateLegacyLog(name, legacy[1]);
	}
}

export function migrateLegacyLog(legacyName: string, prefix: string) {
	const dir = appPaths.getLogsDir();
	const legacyPath = path.join(dir, legacyName);
	try {
		const mtime = statSync(legacyPath).mtime;
		const { name } = freeLogFileName(prefix, mtime.getFullYear(), mtime.getMonth() + 1);
		renameSync(legacyPath, path.join(dir, name));
	} catch {
		// No legacy file
	}
}
