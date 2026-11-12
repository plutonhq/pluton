import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import { RotatingLogStream } from '../../../src/utils/logging/RotatingLogStream';
import { LOG_PART_SIZE, logFileName } from '../../../src/utils/logging/logFiles';

let mockLogsDir = '';
jest.mock('../../../src/utils/AppPaths', () => ({
	appPaths: { getLogsDir: () => mockLogsDir },
}));

const read = (name: string) => readFileSync(path.join(mockLogsDir, name), 'utf8');
const nameAt = (prefix: string, date: Date, part = 0) =>
	logFileName(prefix, date.getFullYear(), date.getMonth() + 1, part);

describe('RotatingLogStream', () => {
	beforeEach(() => {
		mockLogsDir = mkdtempSync(path.join(os.tmpdir(), 'pluton-rotate-'));
	});
	afterEach(() => {
		jest.useRealTimers();
		rmSync(mockLogsDir, { recursive: true, force: true });
	});

	it('writes to the file of the current month', async () => {
		const stream = new RotatingLogStream('app', 1024 * 1024);
		stream.write('line 1\n');
		stream.write('line 2\n');
		await stream.end();

		expect(read(nameAt('app', new Date()))).toBe('line 1\nline 2\n');
	});

	it('appends to the latest part of the current month', async () => {
		const now = new Date();
		writeFileSync(path.join(mockLogsDir, nameAt('app', now, 0)), 'a\n');
		writeFileSync(path.join(mockLogsDir, nameAt('app', now, 1)), 'b\n');

		const stream = new RotatingLogStream('app', 1024 * 1024);
		expect(stream.currentFile).toBe(nameAt('app', now, 1));
		stream.write('c\n');
		await stream.end();

		expect(read(nameAt('app', now, 1))).toBe('b\nc\n');
	});

	it('starts a new part when the part size is reached', async () => {
		const now = new Date();
		writeFileSync(path.join(mockLogsDir, nameAt('app', now)), 'x'.repeat(LOG_PART_SIZE - 5));

		const stream = new RotatingLogStream('app', 100 * 1024 * 1024);
		stream.write('1234\n');
		stream.write('next\n');
		await stream.end();

		expect(read(nameAt('app', now)).length).toBe(LOG_PART_SIZE);
		expect(read(nameAt('app', now, 1))).toBe('next\n');
	});

	it('starts a new file at the month end', async () => {
		jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
		jest.setSystemTime(new Date(2026, 9, 31, 23, 59, 59));
		const stream = new RotatingLogStream('plan-p1', 1024 * 1024);
		stream.write('october\n');
		jest.setSystemTime(new Date(2026, 10, 1, 0, 0, 1));
		stream.write('november\n');
		jest.useRealTimers();
		await stream.end();

		expect(read('plan-p1-2026-10.log')).toBe('october\n');
		expect(read('plan-p1-2026-11.log')).toBe('november\n');
	});

	it('renames the legacy file and applies retention on open', async () => {
		writeFileSync(path.join(mockLogsDir, 'plan-p1.log'), 'old\n');
		writeFileSync(path.join(mockLogsDir, 'plan-p1-2020-01.log'), 'ancient\n');

		const stream = new RotatingLogStream('plan-p1', 1024 * 1024);
		await stream.end();

		expect(readdirSync(mockLogsDir)).toEqual([nameAt('plan-p1', new Date())]);
		expect(read(nameAt('plan-p1', new Date()))).toBe('old\n');
	});

	it('ignores writes after end', async () => {
		const stream = new RotatingLogStream('app', 1024 * 1024);
		await stream.end();
		expect(() => stream.write('late\n')).not.toThrow();
		expect(read(nameAt('app', new Date()))).toBe('');
	});
});
