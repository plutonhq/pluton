import * as native from 'child_process';
import * as fs from 'fs';
import { detectRecoveryClient } from '../../src/utils/recoveryDatabaseClients';

jest.mock('child_process', () => ({ spawnSync: jest.fn() }));
jest.mock('fs', () => ({
	...jest.requireActual('fs'),
	realpathSync: jest.fn(value => value),
	lstatSync: jest.fn(() => ({
		uid: 0,
		mode: 0o755,
		isSymbolicLink: () => false,
		isFile: () => true,
	})),
	accessSync: jest.fn(),
	readdirSync: jest.fn(() => []),
}));

describe('Phase 6 engine-specific native client detection', () => {
	let platform: PropertyDescriptor | undefined;
	let uid: PropertyDescriptor | undefined;
	beforeEach(() => {
		platform = Object.getOwnPropertyDescriptor(process, 'platform');
		uid = Object.getOwnPropertyDescriptor(process, 'getuid');
		Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
		Object.defineProperty(process, 'getuid', { value: () => 10001, configurable: true });
		jest.mocked(native.spawnSync).mockReset();
		jest.mocked(fs.accessSync).mockReset();
	});
	afterEach(() => {
		Object.defineProperty(process, 'platform', platform!);
		if (uid) Object.defineProperty(process, 'getuid', uid);
		else delete (process as any).getuid;
	});
	const output = (stdout: string) =>
		jest.mocked(native.spawnSync).mockReturnValue({
			status: 0,
			stdout,
			stderr: '',
			error: undefined,
		} as any);
	it('a mysql filename or MySQL-looking MariaDB banner never authorizes a MySQL import', () => {
		for (const banner of [
			'mysql Ver 15.1 Distrib 11.8.8-MariaDB',
			'mysql Ver 8.4 MySQL compatibility MariaDB',
		]) {
			output(banner);
			expect(() => detectRecoveryClient('mysql')).toThrow('database-client-incompatible');
		}
	});
	it('recognizes a genuine Oracle banner only after the fixed safety-flag probe succeeds', () => {
		output('mysql Ver 8.4.11 for Linux on x86_64 (MySQL Community Server - GPL)');
		expect(detectRecoveryClient('mysql')).toBe('/usr/bin/mysql');
		expect(native.spawnSync).toHaveBeenCalledWith(
			'/usr/bin/mysql',
			['--no-defaults', '--binary-mode', '--local-infile=0', '--version'],
			expect.objectContaining({
				shell: false,
				timeout: 2000,
				maxBuffer: 4096,
				env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' },
			})
		);
	});
	it('MariaDB requires sandbox flag support rather than accepting version text alone', () => {
		output('mariadb from 11.8.8-MariaDB');
		expect(detectRecoveryClient('mariadb')).toBe('/usr/bin/mariadb');
		expect(jest.mocked(native.spawnSync).mock.calls[0][1]).toContain('--sandbox');
		jest
			.mocked(native.spawnSync)
			.mockReturnValue({ status: 1, stdout: 'MariaDB', stderr: '' } as any);
		expect(() => detectRecoveryClient('mariadb')).toThrow('database-client-incompatible');
	});
	it.each([
		'13.23',
		'14.23',
		'15.18',
		'16.14',
		'17.10',
		'18.5',
		'18beta1',
		'18.6beta1',
		'19.0beta4',
		'unknown',
	])('rejects unpatched/unsupported psql %s', version => {
		output(`psql (PostgreSQL) ${version}`);
		expect(() => detectRecoveryClient('postgresql')).toThrow('database-client-incompatible');
	});
	it.each(['14.24', '15.19', '16.15', '17.11', '18.6', '18.7'])(
		'accepts patched psql %s',
		version => {
			output(`psql (PostgreSQL) ${version}`);
			expect(detectRecoveryClient('postgresql')).toBe('/usr/bin/psql');
		}
	);
	it('failed, timed-out and service-writable clients cannot pass validation', () => {
		output('psql (PostgreSQL) 18.6');
		jest
			.mocked(native.spawnSync)
			.mockReturnValue({
				status: null,
				error: new Error('timeout'),
				stdout: 'psql (PostgreSQL) 18.6',
			} as any);
		expect(() => detectRecoveryClient('postgresql')).toThrow('database-client-incompatible');
		jest
			.mocked(fs.lstatSync)
			.mockReturnValue({
				uid: 10001,
				mode: 0o777,
				isSymbolicLink: () => false,
				isFile: () => true,
			} as any);
		jest.mocked(native.spawnSync).mockClear();
		expect(() => detectRecoveryClient('postgresql')).toThrow('database-client-missing');
		expect(native.spawnSync).not.toHaveBeenCalled();
	});
});
