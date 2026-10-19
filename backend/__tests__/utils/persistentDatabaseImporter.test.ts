import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { Readable } from 'stream';
import { PersistentDatabaseImporter } from '../../src/utils/persistentDatabaseImporter';
import { RESTORE_PURPOSE } from '../../src/types/databaseRestores';
describe('Retained native import purpose and ambiguous cleanup boundaries', () => {
	let directory: string,
		file: string,
		row: any,
		approval: any,
		lease: any,
		store: any,
		connection: any,
		client: PersistentDatabaseImporter;
	let databases: string[], marker: string, query: jest.Mock;
	beforeEach(async () => {
		directory = await fs.mkdtemp(path.join(os.tmpdir(), 'retained-import-'));
		file = path.join(directory, 'dump.sql');
		const sql = 'CREATE TABLE fixture_entries(value INT);\n';
		await fs.writeFile(file, sql, { mode: 0o600 });
		row = {
			id: 'a'.repeat(24),
			targetId: 'c'.repeat(24),
			mode: 'custom',
			purpose: RESTORE_PURPOSE,
			ownerToken: 'd'.repeat(48),
			snapshotId: 'b'.repeat(64),
			expiresAt: Date.now() + 3600000,
			cancelRequested: false,
			artifact: {
				database: 'example_db',
				engine: 'mariadb',
				bytes: Buffer.byteLength(sql),
				sha256: crypto.createHash('sha256').update(sql).digest('hex'),
				artifactValidation: 'passed',
			},
		};
		approval = {
			id: row.targetId,
			mode: 'custom',
			purpose: RESTORE_PURPOSE,
			engine: 'mariadb',
			database: 'example_db',
			activationId: 'e'.repeat(32),
			target: { engine: 'mariadb' },
			storage: { id: 'f'.repeat(32) },
		};
		lease = null;
		databases = ['pluton_restore_guard'];
		marker = [row.id, row.snapshotId, row.artifact.sha256, row.ownerToken, RESTORE_PURPOSE].join(
			'\t'
		);
		store = {
			lease: jest.fn(() => lease),
			addLease: jest.fn(value => {
				lease = value;
			}),
			leaseState: jest.fn((_id, state) => {
				lease.state = state;
			}),
			removeLease: jest.fn(() => {
				lease = null;
			}),
		};
		query = jest.fn(async (_database, sql: string | Readable) => {
			if (sql instanceof Readable) {
				for await (const _ of sql) {
				}
				return '';
			}
			if (sql.startsWith('SELECT purpose'))
				return [RESTORE_PURPOSE, approval.activationId, approval.storage.id].join('\t');
			if (sql === 'SELECT VERSION();') return '11.8.8-MariaDB';
			if (sql === 'SHOW GRANTS;')
				return (
					'GRANT USAGE ON *.* TO ' +
					String.fromCharCode(96) +
					'restore_user' +
					String.fromCharCode(96) +
					'@' +
					String.fromCharCode(96) +
					'%' +
					String.fromCharCode(96) +
					'\n' +
					'GRANT ALL PRIVILEGES ON ' +
					String.fromCharCode(96) +
					'example\\_db' +
					String.fromCharCode(96) +
					'.* TO ' +
					String.fromCharCode(96) +
					'restore_user' +
					String.fromCharCode(96) +
					'@' +
					String.fromCharCode(96) +
					'%' +
					String.fromCharCode(96) +
					'\n' +
					'GRANT SELECT ON ' +
					String.fromCharCode(96) +
					'pluton_restore_guard' +
					String.fromCharCode(96) +
					'.' +
					String.fromCharCode(96) +
					'contract' +
					String.fromCharCode(96) +
					' TO ' +
					String.fromCharCode(96) +
					'restore_user' +
					String.fromCharCode(96) +
					'@' +
					String.fromCharCode(96) +
					'%' +
					String.fromCharCode(96)
				);
			if (sql === 'SHOW DATABASES;') return databases.join('\n');
			if (sql.startsWith('CREATE DATABASE')) {
				databases.push('example_db');
				return '';
			}
			if (sql.startsWith('DROP DATABASE')) {
				databases = databases.filter(name => name !== 'example_db');
				return '';
			}
			if (sql.startsWith('SELECT restore_id')) return marker;
			if (sql.startsWith('SELECT JSON_OBJECT'))
				return '{"schema":"example_db","name":"fixture_entries","type":"BASE TABLE"}';
			if (sql.includes('SUM(TABLE_TYPE=')) return '1\t0';
			if (sql.includes('SUM(DATA_LENGTH')) return '1024';
			return '';
		});
		connection = { query, close: jest.fn(async () => {}) };
		client = new PersistentDatabaseImporter(store, approval, '/fixture-ca');
		jest.spyOn(client as any, 'open').mockResolvedValue(connection);
	});
	afterEach(async () => {
		await fs.rm(directory, { recursive: true, force: true });
	});
	const restore = () =>
		client.restore(row, file, directory, new AbortController().signal, jest.fn());
	it('retains an acknowledged validated lease and metadata, without disposable cleanup', async () => {
		expect((await restore()).tables).toBe(1);
		expect(lease.state).toBe('validated');
		expect(store.removeLease).not.toHaveBeenCalled();
		const sql = query.mock.calls
			.map(call => call[1])
			.filter(value => typeof value === 'string')
			.join('\n');
		expect(sql).not.toContain('DROP DATABASE');
		expect(sql).toContain('__pluton_persistent_owner');
	});
	it.each(['11.8.8-MariaDB', '8.0.42', '9.0.1', 'invalid'])(
		'refuses unsupported MySQL server %s before lease/CREATE',
		async version => {
			approval.engine = approval.target.engine = row.artifact.engine = 'mysql';
			const original = query.getMockImplementation()!;
			query.mockImplementation(async (...args) =>
				args[1] === 'SELECT VERSION();'
					? version
					: args[1] === 'SELECT @@version_comment;'
						? 'MySQL Community Server - GPL'
						: original(...args)
			);
			await expect(restore()).rejects.toMatchObject({ code: 'database-client-incompatible' });
			expect(store.addLease).not.toHaveBeenCalled();
		}
	);
	it('every MySQL inspect/delete rechecks the real server vendor, not only its stored engine label', async () => {
		approval.engine = approval.target.engine = row.artifact.engine = 'mysql';
		const original = query.getMockImplementation()!;
		let vendor = 'MySQL Community Server - GPL';
		query.mockImplementation(async (...args) =>
			args[1] === 'SELECT VERSION();'
				? '8.4.11'
				: args[1] === 'SELECT @@version_comment;'
					? vendor
					: original(...args)
		);
		await restore();
		vendor = 'MariaDB Server';
		await expect(client.inspect(row, directory)).rejects.toMatchObject({
			code: 'database-client-incompatible',
		});
		await expect(client.removeOwned(row, directory)).rejects.toMatchObject({
			code: 'database-client-incompatible',
		});
		expect(lease).not.toBeNull();
		expect(query.mock.calls.some(call => String(call[1]).startsWith('DROP DATABASE'))).toBe(false);
	});
	it.each(['purpose', 'activation', 'storage'])(
		'refuses a wrong %s guard before CREATE',
		async field => {
			const original = query.getMockImplementation()!;
			query.mockImplementation(async (...args) =>
				String(args[1]).startsWith('SELECT purpose') ? 'wrong\tmarker\tvalue' : original(...args)
			);
			await expect(restore()).rejects.toMatchObject({ code: 'restore-purpose-guard-mismatch' });
			expect(store.addLease).not.toHaveBeenCalled();
		}
	);
	it('never drops an ambiguous CREATE without a matching ownership marker', async () => {
		await restore();
		marker = 'wrong-owner';
		await expect(client.removeOwned(row, directory)).rejects.toMatchObject({
			code: 'restore-ownership-uncertain',
		});
		expect(lease).not.toBeNull();
		expect(query.mock.calls.some(call => String(call[1]).startsWith('DROP DATABASE'))).toBe(false);
	});
	it('does not forget a lease on catalog/access errors or a foreign database', async () => {
		await restore();
		databases.push('foreign_database');
		await expect(client.removeOwned(row, directory)).rejects.toMatchObject({
			code: 'target-catalog-not-dedicated',
		});
		expect(store.removeLease).not.toHaveBeenCalled();
	});
	it('a failed SQL stream remains a failure with durable cleanup intent, not a successful retained import', async () => {
		const original = query.getMockImplementation()!;
		query.mockImplementation(async (...args) => {
			if (args[1] instanceof Readable) throw new Error('Private SQL failure');
			return original(...args);
		});
		await expect(restore()).rejects.toThrow();
		expect(lease.state).toBe('created');
		expect(connection.close).toHaveBeenCalled();
	});
	it('closes private connection even when the SQL file cannot be opened', async () => {
		await fs.unlink(file);
		await expect(restore()).rejects.toThrow();
		expect(connection.close).toHaveBeenCalled();
	});
	it.each(['id', 'ownerToken', 'snapshotId', 'purpose', 'targetId'])(
		'rejects malformed/cross-bound %s before constructing SQL',
		async key => {
			row[key] = 'foreign';
			await expect(restore()).rejects.toMatchObject({ code: 'target-binding-mismatch' });
			expect(query).not.toHaveBeenCalled();
		}
	);
	it('expiry denies new inspection while still permitting exact owned cleanup', async () => {
		await restore();
		row.expiresAt = Date.now() - 1;
		await expect(client.inspect(row, directory)).rejects.toMatchObject({
			code: 'restore-access-not-active',
		});
		await client.removeOwned(row, directory);
		expect(lease).toBeNull();
	});
});
