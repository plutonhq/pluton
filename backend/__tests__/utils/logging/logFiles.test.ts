import { existsSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import {
	deleteLogFiles,
	enforceRetention,
	listLogFiles,
	logFileName,
	migrateLegacyLog,
	migrateLegacyLogs,
	parseLogFileName,
} from '../../../src/utils/logging/logFiles';

let mockLogsDir = '';
jest.mock('../../../src/utils/AppPaths', () => ({
	appPaths: { getLogsDir: () => mockLogsDir },
}));

const write = (name: string, size = 10) =>
	writeFileSync(path.join(mockLogsDir, name), 'x'.repeat(size));
const monthsBack = (n: number) => {
	const now = new Date();
	return new Date(now.getFullYear(), now.getMonth() - n, 15);
};
const nameAt = (prefix: string, date: Date, part = 0) =>
	logFileName(prefix, date.getFullYear(), date.getMonth() + 1, part);

describe('logFiles', () => {
	beforeEach(() => {
		mockLogsDir = mkdtempSync(path.join(os.tmpdir(), 'pluton-logfiles-'));
	});
	afterEach(() => {
		rmSync(mockLogsDir, { recursive: true, force: true });
	});

	it('parses log file names and ignores other files', () => {
		expect(parseLogFileName('app-2026-11.log')).toEqual({
			prefix: 'app',
			year: 2026,
			month: 11,
			part: 0,
		});
		expect(parseLogFileName('plan-ab-12-2026-01.3.log')).toEqual({
			prefix: 'plan-ab-12',
			year: 2026,
			month: 1,
			part: 3,
		});
		expect(parseLogFileName('app.log')).toBeNull();
		expect(parseLogFileName('stdout.log')).toBeNull();
		expect(parseLogFileName('service-2026-11.err')).toBeNull();
		expect(parseLogFileName('app-2026-13.log')).toBeNull();
	});

	it('lists the files of one prefix, newest first', () => {
		['app-2026-10.log', 'app-2026-11.log', 'app-2026-11.2.log', 'app-2026-11.1.log'].forEach(n =>
			write(n)
		);
		write('plan-p1-2026-11.log');
		write('stdout.log');

		expect(listLogFiles('app').map(f => f.name)).toEqual([
			'app-2026-11.2.log',
			'app-2026-11.1.log',
			'app-2026-11.log',
			'app-2026-10.log',
		]);
		expect(listLogFiles('plan-p1')[0]).toMatchObject({ name: 'plan-p1-2026-11.log', size: 10 });
	});

	it('deletes files older than the age limit', () => {
		const current = nameAt('app', monthsBack(0));
		[current, nameAt('app', monthsBack(1)), nameAt('app', monthsBack(2))].forEach(n => write(n));
		write(nameAt('app', monthsBack(3)));

		enforceRetention('app', 1000, current);

		expect(listLogFiles('app')).toHaveLength(3);
		expect(existsSync(path.join(mockLogsDir, nameAt('app', monthsBack(3))))).toBe(false);
	});

	it('deletes the oldest files over the total and keeps the current file', () => {
		const now = monthsBack(0);
		const current = nameAt('app', now, 3);
		write(nameAt('app', now, 0), 40);
		write(nameAt('app', now, 1), 40);
		write(nameAt('app', now, 2), 40);
		write(current, 200);

		enforceRetention('app', 100, current);
		expect(listLogFiles('app').map(f => f.name)).toEqual([current]);

		write(nameAt('app', now, 2), 40);
		enforceRetention('app', 300, current);
		expect(listLogFiles('app').map(f => f.name)).toEqual([current, nameAt('app', now, 2)]);
	});

	it('deletes all files of a prefix', () => {
		write('plan-p1-2026-11.log');
		write('plan-p1-2026-11.1.log');
		write('plan-p2-2026-11.log');

		deleteLogFiles('plan-p1');

		expect(readdirSync(mockLogsDir)).toEqual(['plan-p2-2026-11.log']);
	});

	it('renames a legacy file to the month of its last change', () => {
		write('app.log');
		const mtime = new Date(2026, 6, 20);
		utimesSync(path.join(mockLogsDir, 'app.log'), mtime, mtime);
		write('app-2026-07.log');

		migrateLegacyLog('app.log', 'app');

		expect(readdirSync(mockLogsDir).sort()).toEqual(['app-2026-07.1.log', 'app-2026-07.log']);
		expect(() => migrateLegacyLog('app.log', 'app')).not.toThrow();
	});

	it('renames all legacy app and plan files and leaves other files', () => {
		const mtime = new Date(2026, 6, 20);
		['app.log', 'plan-p1.log', 'plan-p2-2026-07.log', 'stdout.log'].forEach(name => {
			write(name);
			utimesSync(path.join(mockLogsDir, name), mtime, mtime);
		});

		migrateLegacyLogs();

		expect(readdirSync(mockLogsDir).sort()).toEqual([
			'app-2026-07.log',
			'plan-p1-2026-07.log',
			'plan-p2-2026-07.log',
			'stdout.log',
		]);
	});
});
