import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { randomBytes } from 'node:crypto';
import Cryptr from 'cryptr';

it('0017 upgrades actual 0016 without rewriting existing credentials or repository identity', () => {
	const sqlite = new Database(':memory:');
	try {
		const migrations = readMigrationFiles({ migrationsFolder: './drizzle' });
		for (const migration of migrations.slice(0, 17))
			for (const statement of migration.sql) sqlite.exec(statement);
		sqlite.exec(
			'CREATE TABLE __drizzle_migrations(id INTEGER PRIMARY KEY,hash TEXT NOT NULL,created_at NUMERIC)'
		);
		for (const migration of migrations.slice(0, 17))
			sqlite
				.prepare('INSERT INTO __drizzle_migrations(hash,created_at) VALUES (?,?)')
				.run(migration.hash, migration.folderMillis);
		const ciphertext = new Cryptr(randomBytes(32).toString('hex')).encrypt(
			randomBytes(32).toString('hex')
		);
		sqlite.exec(
			"INSERT INTO storages(id,name,type) VALUES('storage-a','Example','sftp'); INSERT INTO devices(id,name) VALUES('device-a','Example');"
		);
		sqlite.exec(
			"INSERT INTO plans(id,title,source_id,source_type,source_config,settings) VALUES('plan-a','Example','device-a','device','{}','{}')"
		);
		sqlite
			.prepare(
				"INSERT INTO agent_identities(agent_id,device_id,encrypted_secret,hostname,os,architecture,agent_version,capabilities) VALUES ('agent-a','device-a',?,'app-01','linux','x64','0.4.0','{}')"
			)
			.run(ciphertext);
		sqlite
			.prepare(
				"INSERT INTO remote_managed_repositories(id,plan_id,agent_id,storage_id,storage_path,encrypted_password) VALUES ('repo-a','plan-a','agent-a','storage-a','managed/example',?)"
			)
			.run(ciphertext);
		const before = sqlite.prepare('SELECT * FROM remote_managed_repositories').get();
		migrate(drizzle(sqlite), { migrationsFolder: './drizzle' });
		migrate(drizzle(sqlite), { migrationsFolder: './drizzle' });
		expect(sqlite.prepare('SELECT * FROM remote_managed_repositories').get()).toEqual(before);
		expect(sqlite.prepare('SELECT count(*) FROM retained_managed_repositories').pluck().get()).toBe(
			0
		);
		expect(migrations[17].sql.join('\n')).not.toMatch(/\b(?:DROP|ALTER|DELETE|UPDATE|INSERT)\b/i);
	} finally {
		sqlite.close();
	}
});
