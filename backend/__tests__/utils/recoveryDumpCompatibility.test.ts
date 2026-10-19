import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { checkRecoveryDumpCompatibility } from '../../src/utils/recoveryDumpCompatibility';
describe('bounded plain SQL version/engine compatibility gate', () => {
	let root: string, file: string;
	beforeEach(async () => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), 'dump-compatibility-'));
		file = path.join(root, 'same-filename.sql');
	});
	afterEach(async () => {
		await fs.rm(root, { recursive: true, force: true });
	});
	it.each([
		['mariadb', '11.8.8-MariaDB', '-- Server version\t11.8.8-MariaDB\n'],
		['mysql', '8.4.11', '-- Server version\t8.4.11\n'],
		[
			'postgresql',
			'18.6 (Debian)',
			'-- Dumped from database version 18.6\n-- Dumped by pg_dump version 18.6\n',
		],
	])(
		'%s checks the real target and a matching recorded-engine header without altering bytes',
		async (engine, server, header) => {
			const sql = header + 'SELECT 1;\n';
			await fs.writeFile(file, sql);
			expect(await checkRecoveryDumpCompatibility(engine as any, file, server)).toBe(
				'header-and-target-checked'
			);
			expect(await fs.readFile(file, 'utf8')).toBe(sql);
		}
	);
	it.each([
		['mariadb', '11.8.8-MariaDB', '-- Server version 12.0.1-MariaDB\n'],
		['mariadb', '11.8.8-MariaDB', '-- Server version 11.9.0-MariaDB\n'],
		['mariadb', '11.8.8-MariaDB', '-- Server version 8.4.11\n'],
		['mysql', '8.4.11', '-- Server version 11.8.8-MariaDB\n'],
		['mysql', '11.8.8-MariaDB', 'SELECT 1;\n'],
		['mariadb', '8.4.11', 'SELECT 1;\n'],
		['postgresql', '18.6', '-- Dumped from database version 19.1\n'],
		[
			'postgresql',
			'18.6',
			'-- Dumped from database version 18.6\n-- Dumped by pg_dump version 19.1\n',
		],
		['postgresql', '18.6', '-- Server version 8.4.11\n'],
		['mariadb', '11.8.8-MariaDB', '-- Dumped from database version 18.6\n'],
		['postgresql', '18.6', 'PGDMP\0archive'],
		['mysql', 'unrecognized-private-provider-value', 'SELECT 1;'],
	])('fails closed for incompatible %s target/header', async (engine, server, sql) => {
		await fs.writeFile(file, sql);
		await expect(checkRecoveryDumpCompatibility(engine as any, file, server)).rejects.toMatchObject(
			{ code: 'database-client-incompatible' }
		);
	});
	it('does not invent a source version for historical/headerless SQL', async () => {
		await fs.writeFile(file, 'SELECT 1;\n');
		expect(await checkRecoveryDumpCompatibility('mariadb', file, '11.8.8-MariaDB')).toBe(
			'not-recorded'
		);
	});
});
