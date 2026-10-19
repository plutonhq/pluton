import path from 'path';
import { AppError } from '../../src/utils/AppError';
import {
	getLegacySnapshotParent,
	normalizeLegacySnapshotPath,
	resolvePathWithin,
	toResticSnapshotPath,
} from '../../src/utils/legacySnapshotPath';

describe('legacy snapshot path validation', () => {
	it('uses a relative logical path and keeps the snapshot root explicit', () => {
		expect(normalizeLegacySnapshotPath('')).toBe('');
		expect(normalizeLegacySnapshotPath('app-01/application/index.txt')).toBe('app-01/application/index.txt');
		expect(toResticSnapshotPath('')).toBe('/');
		expect(toResticSnapshotPath('app-01/application')).toBe('/app-01/application');
		expect(getLegacySnapshotParent('app-01/application/index.txt')).toBe('app-01/application');
	});

	it.each([
		'../etc/passwd',
		'one/../../etc/passwd',
		'%2e%2e/etc/passwd',
		'%252e%252e/etc/passwd',
		'/etc/passwd',
		'C:/Windows/System32',
		'one//two',
		'one\\two',
		'one\0two',
		'one/./two',
		'one/../two',
	])('rejects unsafe or ambiguous snapshot path %p', value => {
		expect(() => normalizeLegacySnapshotPath(value, false)).toThrow(AppError);
		expect(() => normalizeLegacySnapshotPath(value, false)).toThrow('safe relative POSIX path');
	});

	it('does not let a staged file resolve outside its workspace', () => {
		const workspace = path.resolve(process.cwd(), 'fixture-workspace');
		expect(resolvePathWithin(workspace, 'app-01/index.txt')).toBe(path.join(workspace, 'app-01', 'index.txt'));
		expect(() => resolvePathWithin(workspace, '../outside.txt')).toThrow('outside the restore workspace');
	});
});
