import { AppError } from './AppError';

export interface BackupHistoryQuery {
	page: number;
	pageSize: 10 | 20 | 50;
	timeZone: string;
	startDate?: string;
	endDate?: string;
	from?: number;
	until?: number;
}

const invalid = () =>
	new AppError(
		400,
		'Invalid backup history query. Use page >= 1, pageSize 10, 20 or 50, ISO calendar dates and a valid time zone.'
	);

function calendarDate(value: string): Date {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '0001-01-01' || value > '9998-12-31')
		throw invalid();
	const date = new Date(`${value}T00:00:00.000Z`);
	if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value)
		throw invalid();
	return date;
}

/** Earliest instant of a calendar day, not midnight interpreted in the server TZ.
 * Searching local dates also handles DST days with 23/25 hours, midnight gaps,
 * and skipped calendar days. Never obtain an end boundary by adding 24 hours.
 */
function dayBoundary(date: Date, formatter: Intl.DateTimeFormat): number {
	const target = date.toISOString().slice(0, 10);
	const localDate = (second: number) => {
		const parts = formatter.formatToParts(new Date(second * 1000));
		const part = (name: string) => parts.find(item => item.type === name)!.value;
		const year = part('era') === 'BC' ? 1 - Number(part('year')) : Number(part('year'));
		return `${String(year).padStart(4, '0')}-${part('month')}-${part('day')}`;
	};
	let low = date.getTime() / 1000 - 48 * 3600;
	let high = date.getTime() / 1000 + 48 * 3600;
	while (low < high) {
		const mid = Math.floor((low + high) / 2);
		if (localDate(mid) < target) low = mid + 1;
		else high = mid;
	}
	return low;
}

export function parseBackupHistoryQuery(input: unknown): BackupHistoryQuery {
	if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid();
	const query = input as Record<string, unknown>;
	if (
		Object.keys(query).some(
			key => !['page', 'pageSize', 'startDate', 'endDate', 'timeZone'].includes(key)
		)
	)
		throw invalid();
	for (const value of Object.values(query))
		if (typeof value !== 'string' || value.length > 100) throw invalid();
	const pageText = (query.page as string | undefined) ?? '1';
	const sizeText = (query.pageSize as string | undefined) ?? '10';
	if (!/^[1-9]\d{0,8}$/.test(pageText) || !['10', '20', '50'].includes(sizeText)) throw invalid();
	const timeZone = (query.timeZone as string | undefined) ?? 'UTC';
	let formatter: Intl.DateTimeFormat;
	try {
		// A named IANA zone (or UTC), not a caller-supplied fixed offset.
		if (!timeZone || /^[+-]/.test(timeZone)) throw invalid();
		formatter = new Intl.DateTimeFormat('en-CA', {
			timeZone,
			era: 'short',
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			calendar: 'gregory',
			numberingSystem: 'latn',
		});
	} catch {
		throw invalid();
	}
	const startDate = query.startDate as string | undefined;
	const endDate = query.endDate as string | undefined;
	const start = startDate === undefined ? undefined : calendarDate(startDate);
	const end = endDate === undefined ? undefined : calendarDate(endDate);
	if (startDate && endDate && startDate > endDate) throw invalid();
	if (end) end.setUTCDate(end.getUTCDate() + 1);
	return {
		page: Number(pageText),
		pageSize: Number(sizeText) as BackupHistoryQuery['pageSize'],
		timeZone: formatter.resolvedOptions().timeZone,
		startDate,
		endDate,
		from: start && dayBoundary(start, formatter),
		until: end && dayBoundary(end, formatter),
	};
}
