import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { parseLogQuery, readLogPage, streamLogFiles } from '../../../src/utils/logging/LogReader';

let mockLogsDir = '';
jest.mock('../../../src/utils/AppPaths', () => ({
	appPaths: { getLogsDir: () => mockLogsDir },
}));

const T0 = new Date(2026, 9, 1).getTime();
const HOUR = 3600 * 1000;

type Entry = { time: number; level?: number; msg?: string; module?: string; backupId?: string };
const writeLog = (name: string, entries: Entry[]) =>
	writeFileSync(
		path.join(mockLogsDir, name),
		entries
			.map(e => JSON.stringify({ level: 30, module: 'backup', msg: 'm', ...e }) + '\n')
			.join('')
	);

const readAll = async (query: Parameters<typeof readLogPage>[0]) => {
	const msgs: string[] = [];
	let cursor: string | undefined;
	let pages = 0;
	do {
		const page = await readLogPage({ ...query, cursor });
		msgs.push(...page.items.map(i => i.msg));
		cursor = page.nextCursor ?? undefined;
		pages++;
	} while (cursor && pages < 100);
	return { msgs, pages };
};

describe('LogReader', () => {
	beforeEach(() => {
		mockLogsDir = mkdtempSync(path.join(os.tmpdir(), 'pluton-logreader-'));
		// October: two parts, November: one part
		writeLog('app-2026-10.log', [
			{ time: T0 + 1 * HOUR, msg: 'oct-1' },
			{ time: T0 + 2 * HOUR, msg: 'oct-2', level: 40, module: 'restore' },
		]);
		writeLog('app-2026-10.1.log', [
			{ time: T0 + 3 * HOUR, msg: 'oct-3', level: 50, backupId: 'bk-42' },
			{ time: T0 + 4 * HOUR, msg: 'oct-4' },
		]);
		writeLog('app-2026-11.log', [
			{ time: new Date(2026, 10, 2).getTime(), msg: 'nov-1' },
			{ time: new Date(2026, 10, 3).getTime(), msg: 'nov-2', level: 60 },
		]);
		writeFileSync(path.join(mockLogsDir, 'stdout.log'), 'ignored\n');
	});
	afterEach(() => {
		rmSync(mockLogsDir, { recursive: true, force: true });
	});

	it('reads newest first and the cursor crosses part and month boundaries', async () => {
		const first = await readLogPage({ prefix: 'app', limit: 3 });
		expect(first.items.map(i => i.msg)).toEqual(['nov-2', 'nov-1', 'oct-4']);
		expect(first.nextCursor).not.toBeNull();
		expect(first.scannedTo).toBe(T0 + 4 * HOUR);

		const second = await readLogPage({ prefix: 'app', limit: 3, cursor: first.nextCursor! });
		expect(second.items.map(i => i.msg)).toEqual(['oct-3', 'oct-2', 'oct-1']);

		const { msgs } = await readAll({ prefix: 'app', limit: 1 });
		expect(msgs).toEqual(['nov-2', 'nov-1', 'oct-4', 'oct-3', 'oct-2', 'oct-1']);
	});

	it('returns an empty page when there are no files', async () => {
		await expect(readLogPage({ prefix: 'plan-none' })).resolves.toEqual({
			items: [],
			nextCursor: null,
			scannedTo: null,
			modules: [],
		});
	});

	it('applies from and to', async () => {
		const page = await readLogPage({
			prefix: 'app',
			from: T0 + 2 * HOUR,
			to: T0 + 3 * HOUR,
		});
		expect(page.items.map(i => i.msg)).toEqual(['oct-3', 'oct-2']);
		expect(page.nextCursor).toBeNull();

		const nov = await readLogPage({ prefix: 'app', from: new Date(2026, 10, 1).getTime() });
		expect(nov.items.map(i => i.msg)).toEqual(['nov-2', 'nov-1']);
		expect(nov.nextCursor).toBeNull();
	});

	it('filters by level, module and search, and lists the modules seen', async () => {
		const errors = await readLogPage({ prefix: 'app', levels: ['error'] });
		expect(errors.items.map(i => i.msg)).toEqual(['nov-2', 'oct-3']);
		expect(errors.modules.sort()).toEqual(['backup', 'restore']);

		const warn = await readLogPage({ prefix: 'app', levels: ['warn'], modules: ['restore'] });
		expect(warn.items.map(i => i.msg)).toEqual(['oct-2']);

		const search = await readLogPage({ prefix: 'app', search: 'BK-4' });
		expect(search.items.map(i => i.msg)).toEqual(['oct-3']);
		expect((await readLogPage({ prefix: 'app', search: 'NOV' })).items).toHaveLength(2);
	});

	it('stops after maxScanBytes and continues from the cursor', async () => {
		const many = Array.from({ length: 2000 }, (_, i) => ({ time: T0 + i, msg: `e-${i}` }));
		writeLog('plan-p1-2026-10.log', many);

		const page = await readLogPage({ prefix: 'plan-p1', limit: 5000, maxScanBytes: 1 });
		expect(page.items.length).toBeGreaterThan(0);
		expect(page.items.length).toBeLessThan(2000);
		expect(page.nextCursor).not.toBeNull();
		expect(page.items[0].msg).toBe('e-1999');

		const { msgs } = await readAll({ prefix: 'plan-p1', limit: 5000, maxScanBytes: 1 });
		expect(msgs).toEqual(many.map(e => e.msg).reverse());
	});

	it('does not count lines newer than `to` in maxScanBytes', async () => {
		const many = Array.from({ length: 5000 }, (_, i) => ({ time: T0 + i, msg: `e-${i}` }));
		writeLog('plan-p2-2026-10.log', many);

		const page = await readLogPage({ prefix: 'plan-p2', to: T0 + 10, maxScanBytes: 64 * 1024 });
		expect(page.items[0].msg).toBe('e-10');
		expect(page.scannedTo).toBe(T0);
	});

	it('rejects a cursor with a bad file name', async () => {
		const bad = (file: string, offset?: number) =>
			Buffer.from(JSON.stringify({ file, offset })).toString('base64');

		for (const cursor of [
			bad('../secret-2026-10.log'),
			bad('plan-other-2026-10.log'),
			bad('app.log'),
			bad('app-2026-10.log', -1),
			'not-base64-json',
		]) {
			await expect(readLogPage({ prefix: 'app', cursor })).rejects.toHaveProperty(
				'statusCode',
				400
			);
		}
	});

	it('streams the raw files in the range, oldest first', async () => {
		const read = async (from?: number, to?: number) => {
			let text = '';
			for await (const chunk of streamLogFiles('app', from, to)) text += chunk.toString();
			return text
				.trim()
				.split('\n')
				.map(l => JSON.parse(l).msg);
		};
		expect(await read()).toEqual(['oct-1', 'oct-2', 'oct-3', 'oct-4', 'nov-1', 'nov-2']);
		expect(await read(new Date(2026, 10, 1).getTime())).toEqual(['nov-1', 'nov-2']);
		expect(await read(undefined, T0 + 2 * HOUR)).toEqual(['oct-1', 'oct-2']);
	});

	it('parses the query parameters', () => {
		expect(
			parseLogQuery({ from: '10', to: 'x', levels: 'warn,error', modules: '', limit: '5000' })
		).toEqual({
			cursor: undefined,
			from: 10,
			to: undefined,
			levels: ['warn', 'error'],
			modules: undefined,
			search: undefined,
			limit: 1000,
		});
	});
});
