import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { Readable } from 'stream';
import {
	RecoveryDatabaseImporter,
	assertRecoveryMysqlGrants,
	postgresRecoveryInput,
} from '../../src/utils/recoveryDatabaseImport';
import { RecoveryTestError } from '../../src/utils/recoveryValidation';
import type { RecoveryProcessInput } from '../../src/utils/recoveryProcess';

describe('Phase 6 safe native database import', () => {
	let scratch: string,
		file: string,
		leases: any[],
		store: any,
		target: any,
		entry: any,
		run: jest.Mock,
		importer: RecoveryDatabaseImporter,
		sql: string[];
	const password = 'synthetic-private-import-password:with\\escape';
	beforeEach(async () => {
		scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'phase6-import-'));
		file = path.join(scratch, 'dump.sql');
		await fs.writeFile(file, 'SELECT 1;\n');
		leases = [];
		sql = [];
		target = {
			engine: 'mariadb',
			host: 'localhost',
			port: 3306,
			username: 'recovery_user',
			tls: 'local',
			enabled: true,
			dedicated: true,
			password,
		};
		entry = {
			databaseId: 'db_app',
			engine: 'mariadb',
			database: 'example_db',
			path: '/pluton/database/app.sql',
			bytes: 10,
			sha256: 'a'.repeat(64),
			artifactValidation: 'passed',
			importValidation: 'pending',
		};
		store = {
			addLease: jest.fn(async lease => leases.push(lease)),
			removeLease: jest.fn(async id => {
				leases = leases.filter(lease => lease.id !== id);
			}),
			leases: jest.fn(async () => leases),
			leaseTarget: jest.fn(async () => target),
		};
		run = jest.fn(async (input: RecoveryProcessInput) => {
			expect(input.args.join(' ')).not.toContain(password);
			expect(input.env).not.toHaveProperty('SECRET');
			expect(input.env).not.toHaveProperty('ENCRYPTION_KEY');
			expect(input.env).not.toHaveProperty('MYSQL_PWD');
			const credential = input.env.PGPASSFILE || input.args[0].split('=')[1];
			expect(await fs.readFile(credential!, 'utf8')).toContain('synthetic-private-import-password');
			if (process.platform !== 'win32')
				expect((await fs.stat(credential!)).mode & 0o777).toBe(0o600);
			if (input.input instanceof Readable) {
				let received = '';
				for await (const chunk of input.input) received += chunk;
				sql.push(received);
				return '';
			}
			const text = input.input as string;
			sql.push(text);
			if (text.startsWith('SELECT purpose')) return 'pluton-phase6-recovery-only\n';
			if (text.startsWith('SELECT count(*) FROM pg_roles')) return '0\n0\n';
			if (text === 'SHOW server_version;') return '18.6\n';
			if (text === 'SELECT VERSION();')
				return target.engine === 'mariadb' ? '11.8.8-MariaDB\n' : '8.4.11\n';
			if (text === 'SHOW GRANTS;')
				return 'GRANT USAGE ON *.* TO `recovery_user`@`localhost`\nGRANT ALL PRIVILEGES ON `example\\_db`.* TO `recovery_user`@`localhost`\nGRANT SELECT ON `pluton_recovery_guard`.`pluton_recovery_guard` TO `recovery_user`@`localhost`\n';
			if (/SHOW DATABASES|SELECT datname/.test(text))
				return `pluton_recovery_guard\n${leases.map(lease => lease.database).join('\n')}\n`;
			if (text.startsWith('SELECT owner_token'))
				return (
					leases.find(
						lease =>
							input.args.includes(`--database=${lease.database}`) ||
							input.args.includes(lease.database)
					)?.ownerToken || ''
				);
			if (text.includes('information_schema.tables'))
				return target.engine === 'postgresql' ? '0|0\n' : '0\t0\n';
			return '';
		});
		importer = new RecoveryDatabaseImporter(
			store,
			run,
			engine =>
				`/usr/bin/${engine === 'postgresql' ? 'psql' : engine === 'mysql' ? 'mysql' : 'mariadb'}`,
			() => '/etc/ssl/certs/ca-certificates.crt'
		);
	});
	afterEach(async () => {
		await fs.rm(scratch, { recursive: true, force: true });
	});
	const importInput = () => ({
		testId: 'a'.repeat(24),
		targetId: 'target-01',
		target,
		entry,
		file,
		directory: scratch,
		signal: new AbortController().signal,
		allowedDatabases: ['example_db'],
		stage: jest.fn(),
	});
	it('checks the actual target and refuses a newer or cross-engine SQL header before CREATE/lease', async () => {
		for (const header of [
			'-- Server version 12.0.1-MariaDB\n',
			'-- Server version 8.4.11\n',
			'-- Dumped from database version 18.6\n',
		]) {
			await fs.writeFile(file, header + 'SELECT 1;\n');
			await expect(importer.importDatabase(importInput())).rejects.toMatchObject({
				code: 'database-client-incompatible',
			});
		}
		expect(store.addLease).not.toHaveBeenCalled();
		expect(sql.some(text => text.startsWith('CREATE DATABASE'))).toBe(false);
	});
	it('internal PostgreSQL cancellation cleanup only terminates this role in the exact ownership-checked temporary DB', async () => {
		target.engine = entry.engine = 'postgresql';
		await importer.importDatabase({ ...importInput(), targetId: `irt_${'b'.repeat(24)}` });
		await importer.cleanup(leases[0], scratch, true);
		const terminated = sql.find(value => value.includes('pg_terminate_backend'))!;
		expect(terminated).toContain('usename=current_user');
		expect(terminated).toContain("backend_type='client backend'");
		expect(terminated).toContain('pid<>pg_backend_pid()');
		const index = sql.indexOf(terminated);
		expect(sql[index - 1]).toContain('SELECT owner_token');
		expect(sql[index + 1]).toContain('SELECT owner_token');
		expect(leases).toHaveLength(0);
	});
	it('internal termination never runs for an unowned database or a Custom target', async () => {
		target.engine = entry.engine = 'postgresql';
		await importer.importDatabase(importInput());
		await expect(importer.cleanup(leases[0], scratch, true)).rejects.toMatchObject({
			code: 'database-cleanup-failed',
		});
		expect(sql.some(value => value.includes('pg_terminate_backend'))).toBe(false);
	});
	it('mandatory empty-catalog confirmation rejects unknown databases and changed recovery markers', async () => {
		await expect(
			importer.verifyEmptyTarget({ ...target, id: 'irt_example' }, scratch)
		).resolves.toBeUndefined();
		const original = run.getMockImplementation()!;
		run.mockImplementation(async input =>
			input.input === 'SHOW DATABASES;' ? 'pluton_recovery_guard\nunknown_db\n' : original(input)
		);
		await expect(
			importer.verifyEmptyTarget({ ...target, id: 'irt_example' }, scratch)
		).rejects.toMatchObject({ code: 'database-cleanup-failed' });
		run.mockImplementation(async input =>
			input.input.startsWith('SELECT purpose') ? 'wrong-purpose' : original(input)
		);
		await expect(
			importer.verifyEmptyTarget({ ...target, id: 'irt_example' }, scratch)
		).rejects.toMatchObject({ code: 'database-cleanup-failed' });
	});
	it.each(['mariadb', 'mysql', 'postgresql'])(
		'%s imports with a separate private credential file, bounded native client and fixed catalog verification',
		async engine => {
			target.engine = entry.engine = engine;
			await importer.importDatabase(importInput());
			expect(entry.importValidation).toBe('passed');
			expect(entry.tables).toBe(0);
			expect(entry.views).toBe(0);
			expect(leases).toHaveLength(1);
			const imports = run.mock.calls
				.map(([input]) => input)
				.filter(input => input.stage === 'database-import');
			expect(imports[0].timeoutMs).toBe(60 * 60_000);
			expect(imports[0].capture).toBe(false);
			if (engine === 'postgresql') {
				expect(leases[0].database).toMatch(/^pluton_rt_[a-f0-9]{24}$/);
				expect(sql.find(value => value.includes('SELECT 1;'))).toMatch(
					/^\\restrict [a-f0-9]{64}\nSELECT 1;/
				);
			} else {
				expect(leases[0].database).toBe('example_db');
				expect(imports[0].args).toContain('--binary-mode');
				expect(imports[0].args).toContain('--local-infile=0');
				if (engine === 'mariadb') expect(imports[0].args).toContain('--sandbox');
			}
			await importer.cleanup(leases[0], scratch);
			expect(leases).toEqual([]);
			expect(sql.some(value => value.startsWith('DROP DATABASE'))).toBe(true);
			expect(await fs.readdir(scratch)).toEqual(['dump.sql']);
		}
	);
	it.each([
		'database-authentication-failed',
		'database-target-unavailable',
		'database-import-timeout',
		'database-import-failed',
		'cancelled',
	])('safe %s failure cleans the safely created DB and credential files', async code => {
		const original = run.getMockImplementation()!;
		run.mockImplementation(async input => {
			if (input.stage === 'database-import')
				throw new RecoveryTestError('database-import', code as any);
			return original(input);
		});
		await expect(importer.importDatabase(importInput())).rejects.toMatchObject({ code });
		expect(entry.importValidation).toBe('failed');
		expect(leases).toHaveLength(1);
		await importer.cleanup(leases[0], scratch);
		expect(leases).toEqual([]);
		expect(await fs.readdir(scratch)).toEqual(['dump.sql']);
		expect(JSON.stringify(entry)).not.toContain(password);
	});
	it('an existing original DB is never imported into or dropped', async () => {
		const original = run.getMockImplementation()!;
		run.mockImplementation(async input =>
			input.input === 'SHOW DATABASES;' ? 'pluton_recovery_guard\nexample_db\n' : original(input)
		);
		await expect(importer.importDatabase(importInput())).rejects.toMatchObject({
			code: 'database-already-exists',
		});
		expect(store.addLease).not.toHaveBeenCalled();
		expect(sql.some(value => /CREATE DATABASE|DROP DATABASE/.test(value))).toBe(false);
	});
	it('unknown non-system databases and an absent dedicated marker fail closed before CREATE', async () => {
		const original = run.getMockImplementation()!;
		run.mockImplementation(async input =>
			input.input === 'SHOW DATABASES;' ? 'pluton_recovery_guard\nunknown_app\n' : original(input)
		);
		await expect(importer.importDatabase(importInput())).rejects.toMatchObject({
			code: 'recovery-target-unsafe',
		});
		expect(store.addLease).not.toHaveBeenCalled();
		run.mockImplementation(async input =>
			(input.input as string)?.startsWith?.('SELECT purpose') ? 'production' : original(input)
		);
		await expect(importer.importDatabase(importInput())).rejects.toMatchObject({
			code: 'recovery-target-unsafe',
		});
	});
	it('PostgreSQL superuser/inherited-role credentials cannot import', async () => {
		target.engine = entry.engine = 'postgresql';
		const original = run.getMockImplementation()!;
		for (const result of ['1\n0\n', '0\n1\n']) {
			run.mockImplementation(async input =>
				(input.input as string)?.startsWith?.('SELECT count(*) FROM pg_roles')
					? result
					: original(input)
			);
			await expect(importer.importDatabase(importInput())).rejects.toMatchObject({
				code: 'recovery-target-unsafe',
			});
		}
		expect(store.addLease).not.toHaveBeenCalled();
	});
	it('cleanup never drops a database with a missing/mismatched ownership marker', async () => {
		await importer.importDatabase(importInput());
		const original = run.getMockImplementation()!;
		run.mockImplementation(async input =>
			(input.input as string)?.startsWith?.('SELECT owner_token')
				? 'unknown-owner'
				: original(input)
		);
		await expect(importer.cleanup(leases[0], scratch)).rejects.toMatchObject({
			code: 'database-cleanup-failed',
		});
		expect(store.removeLease).not.toHaveBeenCalled();
		expect(sql.some(value => value.startsWith('DROP DATABASE'))).toBe(false);
		expect(await fs.readdir(scratch)).toEqual(['dump.sql']);
	});
	it('missing/incompatible clients fail before credentials or SQL execution', async () => {
		for (const code of ['database-client-missing', 'database-client-incompatible']) {
			const unavailable = new RecoveryDatabaseImporter(store, run, () => {
				throw new RecoveryTestError('database-target-preflight', code as any);
			});
			await expect(unavailable.importDatabase(importInput())).rejects.toMatchObject({ code });
		}
		expect(run).not.toHaveBeenCalled();
		expect(await fs.readdir(scratch)).toEqual(['dump.sql']);
	});
	it.each(['mariadb', 'mysql', 'postgresql'])(
		'%s uses verified system-CA TLS for a non-loopback target',
		async engine => {
			target.engine = entry.engine = engine;
			target.host = 'recovery.example.internal';
			target.tls = 'verify-identity';
			const original = run.getMockImplementation()!;
			run.mockImplementation(async input => {
				if (engine === 'postgresql') {
					expect(input.env.PGSSLMODE).toBe('verify-full');
					expect(input.env.PGSSLROOTCERT).toBe('/etc/ssl/certs/ca-certificates.crt');
				} else {
					const credentials = await fs.readFile(input.args[0].split('=')[1], 'utf8');
					expect(credentials).toContain('ssl-ca="/etc/ssl/certs/ca-certificates.crt"');
					expect(credentials).toContain(
						engine === 'mysql' ? 'ssl-mode=VERIFY_IDENTITY' : 'ssl-verify-server-cert=ON'
					);
				}
				return original(input);
			});
			await importer.importDatabase(importInput());
			await importer.cleanup(leases[0], scratch);
		}
	);
	it('an unavailable trusted CA fails before private credentials are created', async () => {
		target.tls = 'verify-identity';
		const unavailable = new RecoveryDatabaseImporter(
			store,
			run,
			() => '/usr/bin/mariadb',
			() => {
				throw new RecoveryTestError('database-target-preflight', 'database-tls-failed');
			}
		);
		await expect(unavailable.importDatabase(importInput())).rejects.toMatchObject({
			code: 'database-tls-failed',
		});
		expect(run).not.toHaveBeenCalled();
		expect(entry.importValidation).toBe('failed');
		expect(await fs.readdir(scratch)).toEqual(['dump.sql']);
	});
	it.each([
		'GRANT ALL PRIVILEGES ON *.* TO x',
		'GRANT FILE ON *.* TO x',
		'GRANT SELECT ON `example%`.* TO x',
		'GRANT SELECT ON `example_db`.* TO x',
		'GRANT ALL PRIVILEGES ON `example\\_db`.* TO x WITH GRANT OPTION',
		'GRANT `admin_role` TO x',
	])('rejects dangerous/wildcard/admin grants: %s', grant => {
		expect(() => assertRecoveryMysqlGrants(grant, ['example_db'])).toThrow(RecoveryTestError);
	});
	it('retains original SQL bytes and owners while replacing only the public pg_dump transport key', async () => {
		const body =
			'CREATE TABLE metrics (id integer);\nALTER TABLE metrics OWNER TO app_owner;\nCOPY metrics (id) FROM stdin;\n1\n\\.\n';
		const archive = `-- PostgreSQL database dump\n\n\\restrict archivedKey\n${body}\n\\unrestrict archivedKey\n-- PostgreSQL database dump complete\n`;
		await fs.writeFile(file, archive);
		const chunks: Buffer[] = [];
		for await (const chunk of await postgresRecoveryInput(file)) chunks.push(Buffer.from(chunk));
		const protectedInput = Buffer.concat(chunks).toString();
		expect(protectedInput).toMatch(/^\\restrict [a-f0-9]{64}\n/);
		expect(protectedInput).toContain(body.trim());
		expect(protectedInput).not.toContain('archivedKey');
		expect(protectedInput).not.toContain('\\unrestrict');
		expect(await fs.readFile(file, 'utf8')).toBe(archive);
	});
	it('malformed PostgreSQL envelope fails without executing SQL', async () => {
		await fs.writeFile(
			file,
			'-- PostgreSQL database dump\n\\restrict archivedKey\nSELECT 1;\n\\unrestrict wrongKey\n'
		);
		await expect(postgresRecoveryInput(file)).rejects.toMatchObject({
			code: 'database-import-failed',
		});
		expect(run).not.toHaveBeenCalled();
	});
});
