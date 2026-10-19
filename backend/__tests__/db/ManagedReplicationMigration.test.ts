import Database from 'better-sqlite3';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import path from 'path';
import { DatabaseRestoreStore } from '../../src/stores/DatabaseRestoreStore';
import { approval, row } from '../integration/persistentRestore.fixture';
const { seedMysqlPersistentSource } = require('../integration/mysqlPersistentRestore.source.cjs');

it('0018 preserves actual 0017 source records, encrypted retained restore state and Resume intent', () => {
	const sqlite = new Database(':memory:');
	try {
		const migrations = readMigrationFiles({ migrationsFolder: path.resolve('drizzle') });
		expect(migrations.slice(0, 19)).toHaveLength(19);
		for (const migration of migrations.slice(0, 18))
			for (const statement of migration.sql) sqlite.exec(statement);
		const target = approval();
		const item = row(target);
		seedMysqlPersistentSource(sqlite, item);
		const restores = new DatabaseRestoreStore(sqlite, 'synthetic-migration-key');
		restores.create(item);
		restores.bind(item.id, target);
		expect(restores.claim(item.id)?.status).toBe('importing');
		restores.addLease({
			restoreId: item.id,
			targetId: target.id,
			database: 'example_db',
			ownerToken: item.ownerToken,
			state: 'validated',
		});
		const tables = [
			'plans',
			'backups',
			'remote_managed_repositories',
			'agent_identities',
			'persistent_database_restores',
			'persistent_restore_import_leases',
			'automatic_recovery_lifecycle',
			'retained_managed_repositories',
		];
		const before = tables.map(table => sqlite.prepare(`SELECT * FROM ${table}`).all());
		for (const statement of migrations[18].sql) sqlite.exec(statement);
		expect(tables.map(table => sqlite.prepare(`SELECT * FROM ${table}`).all())).toEqual(before);
		expect(restores.approval(item.id)).toEqual(target);
		expect(sqlite.prepare('SELECT count(*) FROM managed_replication_jobs').pluck().get()).toBe(0);
		expect(
			sqlite.prepare('SELECT count(*) FROM managed_replication_destinations').pluck().get()
		).toBe(0);
		// Old app SQL remains usable with no replication work; no init, identity or secret rewrite.
		expect(() =>
			sqlite.prepare("UPDATE plans SET title='Renamed synthetic fixture' WHERE id='plan-01'").run()
		).not.toThrow();
	} finally {
		sqlite.close();
	}
});
