import assert from 'node:assert/strict';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import Cryptr from 'cryptr';
import { plans } from '../../src/db/schema/plans';
import {
	remotePlanDatabaseCredentials,
	remotePlanDatabaseEntryCredentials,
} from '../../src/db/schema/remotePlanCredentials';
import { materializeRemoteLifecycleCollection } from '../../src/utils/remoteLifecycle';
import { PlanStore } from '../../src/stores/PlanStore';
import type { DatabaseType } from '../../src/db';

// Disposable in-memory database only. No application singleton or live DB opens.
const scenario = process.argv[2];
const sqlite = new Database(':memory:');
try {
	const db = drizzle(sqlite, {
		schema: { plans, remotePlanDatabaseCredentials, remotePlanDatabaseEntryCredentials },
	});
	const migrationScenario = scenario.startsWith('multi-migration');
	const oldDatabase = {
		engine: 'mariadb',
		host: 'localhost',
		port: 3306,
		tls: 'local',
		database: 'example_db',
		username: 'backup_reader',
		dumpFilename: 'app.sql',
		timeoutSeconds: 60,
		maxDumpBytes: 1024 ** 3,
		includeRoutines: false,
		includeEvents: false,
		passwordConfigured: true,
	};
	const cipher = new Cryptr('synthetic-migration-key').encrypt('synthetic-existing-password');
	if (migrationScenario) {
		const oldMigrations = readMigrationFiles({
			migrationsFolder: path.join(process.cwd(), 'drizzle'),
		}).slice(0, 8);
		for (const migration of oldMigrations)
			for (const statement of migration.sql) sqlite.exec(statement);
		sqlite.exec(
			'CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, hash text NOT NULL, created_at numeric);'
		);
		for (const migration of oldMigrations)
			sqlite
				.prepare('INSERT INTO __drizzle_migrations(hash, created_at) VALUES (?,?)')
				.run(migration.hash, migration.folderMillis);
		db.insert(plans)
			.values({
				id: 'plan-old',
				title: 'Old plan',
				sourceId: 'agent-01',
				sourceConfig: { includes: ['/srv/example-app'], excludes: [] },
				settings: {
					compression: true,
					remoteLifecycle: { version: 1, database: oldDatabase },
				} as any,
			})
			.run();
		sqlite
			.prepare(
				'INSERT INTO remote_plan_database_credentials(plan_id,encrypted_password) VALUES (?,?)'
			)
			.run('plan-old', cipher);
		if (scenario === 'multi-migration-rollback') {
			sqlite.exec(
				"CREATE TRIGGER reject_fixture_migration BEFORE UPDATE ON plans BEGIN SELECT RAISE(ABORT, 'Synthetic migration failure'); END;"
			);
			assert.throws(() => migrate(db, { migrationsFolder: path.join(process.cwd(), 'drizzle') }));
			assert.equal(
				(
					sqlite
						.prepare('SELECT encrypted_password FROM remote_plan_database_credentials')
						.get() as any
				).encrypted_password,
				cipher
			);
			assert.equal(
				JSON.parse((sqlite.prepare('SELECT settings FROM plans').get() as any).settings)
					.remoteLifecycle.version,
				1
			);
			assert.equal(
				sqlite
					.prepare(
						"SELECT name FROM sqlite_master WHERE name='remote_plan_database_entry_credentials'"
					)
					.get(),
				undefined
			);
			sqlite.exec('DROP TRIGGER reject_fixture_migration');
		}
	}
	migrate(db, { migrationsFolder: path.join(process.cwd(), 'drizzle') });
	sqlite.pragma('foreign_keys = ON');
	const store = new PlanStore(db as DatabaseType);
	const data = {
		id: 'plan-01',
		title: 'Example plan',
		sourceId: 'agent-01',
		sourceType: 'device',
		sourceConfig: { includes: ['/srv/example-app'], excludes: [] },
		settings: { remoteLifecycle: { version: 1, database: { passwordConfigured: true } } },
	} as any;
	if (migrationScenario) {
		const credentials = await store.getDatabaseCredentials('plan-old');
		const settings = JSON.parse(
			(sqlite.prepare("SELECT settings FROM plans WHERE id='plan-old'").get() as any).settings
		);
		assert.equal(credentials.length, 1);
		assert.equal(credentials[0].encryptedPassword, cipher);
		assert.equal(credentials[0].legacySingle, true);
		assert.equal(await store.getDatabaseCredential('plan-old'), cipher);
		assert.equal(settings.compression, true);
		assert.equal(settings.remoteLifecycle.version, 2);
		assert.equal(settings.remoteLifecycle.database, undefined);
		assert.equal(settings.remoteLifecycle.databases[0].databaseId, credentials[0].databaseId);
		assert.equal(
			materializeRemoteLifecycleCollection(
				settings.remoteLifecycle,
				credentials,
				'synthetic-migration-key'
			).databases![0].password,
			'synthetic-existing-password'
		);
		migrate(db, { migrationsFolder: path.join(process.cwd(), 'drizzle') });
		assert.deepEqual(
			await store.getDatabaseCredentials('plan-old'),
			credentials,
			'Migration replay must preserve ID/ciphertext'
		);
		await store.update(
			'plan-old',
			{ settings: { remoteLifecycle: { version: 2, databases: [] } } as any },
			[]
		);
		assert.deepEqual(await store.getDatabaseCredentials('plan-old'), []);
		assert.equal(
			await store.getDatabaseCredential('plan-old'),
			null,
			'Explicit entry removal also removes its legacy ciphertext copy'
		);
	} else if (scenario.startsWith('multi-')) {
		const entries = ['db_one', 'db_two'].map((databaseId, i) => ({
			...oldDatabase,
			databaseId,
			dumpFilename: `db${i}.sql`,
		}));
		const credentials = entries.map(entry => ({
			databaseId: entry.databaseId,
			encryptedPassword: `synthetic-${entry.databaseId}`,
			legacySingle: false,
		}));
		const multiData = {
			...data,
			settings: { remoteLifecycle: { version: 2, databases: entries } },
		};
		await store.create(multiData, credentials);
		if (scenario === 'multi-persistence') {
			await store.update(
				'plan-01',
				{ settings: { remoteLifecycle: { version: 2, databases: [...entries].reverse() } } as any },
				[...credentials].reverse()
			);
			assert.deepEqual(await store.getDatabaseCredentials('plan-01'), credentials);
			const updated = [
				{ ...credentials[0], encryptedPassword: 'synthetic-replacement' },
				credentials[1],
			];
			await store.update('plan-01', { title: 'Changed A' }, updated);
			assert.deepEqual(await store.getDatabaseCredentials('plan-01'), updated);
			await store.update(
				'plan-01',
				{ settings: { remoteLifecycle: { version: 2, databases: [entries[1]] } } as any },
				[credentials[1]]
			);
			assert.deepEqual(await store.getDatabaseCredentials('plan-01'), [credentials[1]]);
			await store.create(
				{
					...multiData,
					id: 'plan-02',
					settings: {
						remoteLifecycle: { version: 2, databases: [{ ...entries[0], databaseId: 'db_other' }] },
					},
				},
				[{ ...credentials[0], databaseId: 'db_other' }]
			);
			await store.delete('plan-01');
			assert.deepEqual(await store.getDatabaseCredentials('plan-01'), []);
			assert.equal((await store.getDatabaseCredentials('plan-02')).length, 1);
			// Foreign-key cascade is also correct independently of explicit store cleanup.
			sqlite.prepare("DELETE FROM plans WHERE id='plan-02'").run();
			assert.deepEqual(await store.getDatabaseCredentials('plan-02'), []);
		} else if (scenario === 'multi-ownership') {
			await assert.rejects(store.create({ ...multiData, id: 'plan-02' }, credentials));
			assert.equal(sqlite.prepare("SELECT id FROM plans WHERE id='plan-02'").get(), undefined);
			assert.deepEqual(await store.getDatabaseCredentials('plan-01'), credentials);
			await assert.rejects(
				store.update('plan-01', { title: 'Orphan attempted' }, [credentials[0]])
			);
			assert.equal(
				(sqlite.prepare("SELECT title FROM plans WHERE id='plan-01'").get() as any).title,
				data.title
			);
		} else if (scenario === 'multi-update-rollback') {
			sqlite.exec(
				"CREATE TRIGGER reject_fixture_multi_write BEFORE UPDATE ON remote_plan_database_entry_credentials WHEN OLD.database_id='db_two' BEGIN SELECT RAISE(ABORT, 'Synthetic credential failure'); END;"
			);
			await assert.rejects(
				store.update(
					'plan-01',
					{ title: 'Must roll back' },
					credentials.map(entry => ({ ...entry, encryptedPassword: 'synthetic-new' }))
				)
			);
			assert.deepEqual(await store.getDatabaseCredentials('plan-01'), credentials);
			assert.equal(
				(sqlite.prepare("SELECT title FROM plans WHERE id='plan-01'").get() as any).title,
				data.title
			);
		} else if (scenario === 'multi-create-rollback') {
			sqlite.exec(
				"CREATE TRIGGER reject_fixture_multi_insert BEFORE INSERT ON remote_plan_database_entry_credentials WHEN NEW.database_id='db_four' BEGIN SELECT RAISE(ABORT, 'Synthetic credential failure'); END;"
			);
			const newEntries = entries.map((entry, i) => ({
				...entry,
				databaseId: i ? 'db_four' : 'db_three',
			}));
			await assert.rejects(
				store.create(
					{
						...multiData,
						id: 'plan-02',
						settings: { remoteLifecycle: { version: 2, databases: newEntries } },
					},
					credentials.map((entry, i) => ({ ...entry, databaseId: newEntries[i].databaseId }))
				)
			);
			assert.deepEqual(await store.getDatabaseCredentials('plan-02'), []);
			assert.equal(sqlite.prepare("SELECT id FROM plans WHERE id='plan-02'").get(), undefined);
		} else throw new Error('Unknown collection test.');
	} else if (scenario === 'persistence') {
		const created = await store.create(data, 'synthetic-ciphertext-01');
		assert.ok(!JSON.stringify(created).includes('synthetic-ciphertext'));
		assert.equal(await store.getDatabaseCredential('plan-01'), 'synthetic-ciphertext-01');
		await store.update('plan-01', { title: 'Updated' }, 'synthetic-ciphertext-02');
		assert.equal(await store.getDatabaseCredential('plan-01'), 'synthetic-ciphertext-02');
		await store.update('plan-01', { settings: { remoteLifecycle: { version: 1 } } as any }, null);
		assert.equal(await store.getDatabaseCredential('plan-01'), null);
		await store.update('plan-01', { title: 'Updated again' }, 'synthetic-ciphertext-03');
		await store.create({ ...data, id: 'plan-02' }, 'synthetic-ciphertext-other');
		await store.delete('plan-01');
		assert.equal(await store.getDatabaseCredential('plan-01'), null);
		assert.equal(await store.getDatabaseCredential('plan-02'), 'synthetic-ciphertext-other');
	} else if (scenario === 'plan-write-failure' || scenario === 'credential-write-failure') {
		const table = scenario === 'plan-write-failure' ? 'plans' : 'remote_plan_database_credentials';
		sqlite.exec(
			`CREATE TRIGGER reject_fixture_write BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT, 'Synthetic insertion failure'); END;`
		);
		await assert.rejects(store.create(data, 'synthetic-ciphertext'));
		assert.deepEqual(sqlite.prepare('SELECT count(*) AS count FROM plans').get(), { count: 0 });
		assert.equal(await store.getDatabaseCredential('plan-01'), null);
	} else if (scenario === 'phase4') {
		await store.create({ ...data, settings: { encryption: true } });
		await store.update('plan-01', { title: 'Filesystem-only' });
		assert.equal(await store.getDatabaseCredential('plan-01'), null);
	} else {
		throw new Error('Unknown synthetic migration test.');
	}
	console.log(`PASS ${scenario}`);
} finally {
	sqlite.close();
}
