import { parseBackupHistoryQuery } from '../../src/utils/backupHistoryQuery';

describe('backup history query and calendar boundaries', () => {
	it('defaults to a bounded first page and UTC for non-browser callers', () => {
		expect(parseBackupHistoryQuery({})).toMatchObject({
			page: 1,
			pageSize: 10,
			timeZone: 'UTC',
			from: undefined,
			until: undefined,
		});
	});
	it.each([
		{ page: '0' },
		{ page: '-1' },
		{ page: '1.5' },
		{ page: '1e2' },
		{ page: '9999999999' },
		{ pageSize: '51' },
		{ pageSize: '1000000' },
		{ pageSize: 'all' },
		{ pageSize: '11' },
		{ pageSize: ['10', '50'] },
		{ startDate: {} },
		{ planId: 'other-plan' },
		{ sort: 'sql' },
		{ timeZone: 'Not/AZone' },
		{ timeZone: '+01:00' },
		{ timeZone: '' },
		{ startDate: '2026-02-30' },
		{ startDate: '2026-1-1' },
		{ endDate: '' },
		{ startDate: '2026-02-02', endDate: '2026-02-01' },
		{ startDate: '0000-01-01' },
	])('rejects invalid/unbounded/foreign query input %j', query => {
		expect(() => parseBackupHistoryQuery(query)).toThrow('Invalid backup history query');
	});
	it.each([
		['UTC', '2026-01-01', '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z'],
		['UTC', '0001-01-01', '0001-01-01T00:00:00Z', '0001-01-02T00:00:00Z'],
		['Asia/Jakarta', '2026-01-01', '2025-12-31T17:00:00Z', '2026-01-01T17:00:00Z'],
		['America/New_York', '2026-03-08', '2026-03-08T05:00:00Z', '2026-03-09T04:00:00Z'],
		['America/New_York', '2026-11-01', '2026-11-01T04:00:00Z', '2026-11-02T05:00:00Z'],
		['Australia/Lord_Howe', '2026-10-04', '2026-10-03T13:30:00Z', '2026-10-04T13:00:00Z'],
		['America/Sao_Paulo', '2018-11-04', '2018-11-04T03:00:00Z', '2018-11-05T02:00:00Z'],
		['Pacific/Apia', '2011-12-30', '2011-12-30T10:00:00Z', '2011-12-30T10:00:00Z'],
	])('%s calendar day %s has exact inclusive-day boundaries', (timeZone, day, from, until) => {
		const result = parseBackupHistoryQuery({ startDate: day, endDate: day, timeZone });
		expect(result.from).toBe(Date.parse(from) / 1000);
		expect(result.until).toBe(Date.parse(until) / 1000);
	});
	it('allows optional boundaries and cross-year historic ranges, independent of server timezone', () => {
		const range = parseBackupHistoryQuery({
			startDate: '1999-12-31',
			endDate: '2000-01-01',
			timeZone: 'Europe/London',
		});
		expect(range.from).toBe(Date.parse('1999-12-31T00:00Z') / 1000);
		expect(range.until).toBe(Date.parse('2000-01-02T00:00Z') / 1000);
		expect(parseBackupHistoryQuery({ startDate: '2026-01-01' }).until).toBeUndefined();
		expect(parseBackupHistoryQuery({ endDate: '2026-01-01' }).from).toBeUndefined();
	});
});
