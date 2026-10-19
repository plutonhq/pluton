import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseRestoreStore } from '../../src/stores/DatabaseRestoreStore';
import { approval, row } from '../integration/persistentRestore.fixture';

describe('0016 additive explicit Resume migration and rollback compatibility', () => {
	it('upgrades actual 0015 state without changing identity, encrypted approval, leases, bindings or old guards', () => {
		const sqlite = new Database(':memory:');
		sqlite.pragma('foreign_keys=ON');
		try {
			const migrations = readMigrationFiles({ migrationsFolder: path.resolve('drizzle') });
			// This historical checkpoint ends at 0016; later additive migrations are permitted.
			expect(migrations.slice(0, 17)).toHaveLength(17);
			// Apply the actual historical migration SQL, not a parallel hand-written schema.
			for (const migration of migrations.slice(0, 16))
				for (const sql of migration.sql) sqlite.exec(sql);
			sqlite.exec(
				'CREATE TABLE __drizzle_migrations(id INTEGER PRIMARY KEY,hash TEXT NOT NULL,created_at NUMERIC)'
			);
			for (const migration of migrations.slice(0, 16))
				sqlite
					.prepare('INSERT INTO __drizzle_migrations(hash,created_at) VALUES(?,?)')
					.run(migration.hash, migration.folderMillis);
			sqlite.exec(`INSERT INTO storages(id,name,type) VALUES('storage-01','Synthetic','sftp');
				INSERT INTO devices(id,name) VALUES('app-01','Synthetic');
				INSERT INTO plans(id,title,source_id,source_type,method,storage_id,source_config,settings)
				VALUES('plan-01','Synthetic','app-01','device','backup','storage-01','{}','{}');
				INSERT INTO backups(id,plan_id,source_id,source_type,method,storage_id,status,in_progress,success)
				VALUES('backup-01','plan-01','app-01','device','backup','storage-01','completed',0,1);`);
			const target = approval();
			target.mode = 'internal';
			target.id = 'a'.repeat(24);
			target.storage.kind = 'fixed-ext4';
			const item = row(target);
			item.status = 'importing';
			// Reservation requires the same complete source binding as a real 0015 restore.
			sqlite.exec(`INSERT INTO agent_identities(agent_id,device_id,encrypted_secret,hostname,os,architecture,agent_version,capabilities)
				VALUES('agent-01','app-01','synthetic-cipher','app-01','Linux','x86_64','0.4.0','{}');
				UPDATE plans SET storage_path='managed/fixture' WHERE id='plan-01';`);
			sqlite.prepare('UPDATE backups SET storage_path=?,completion_stats=? WHERE id=?')
				.run('managed/fixture', JSON.stringify({ snapshot_id: item.snapshotId }), item.backupId);
			sqlite.prepare(`INSERT INTO remote_managed_repositories(id,plan_id,agent_id,storage_id,storage_path,encrypted_password,initialized_at)
				VALUES(?,?,'agent-01','storage-01','managed/fixture','synthetic-cipher',1)`)
				.run(item.repositoryId, item.planId);
			const sourceTables = ['plans', 'backups', 'agent_identities', 'remote_managed_repositories'];
			const sourceRows = sourceTables.map(table => sqlite.prepare(`SELECT * FROM ${table}`).all());
			const store = new DatabaseRestoreStore(sqlite, 'synthetic-migration-encryption-key');
			store.create(item);
			store.bind(item.id, target);
			store.addLease({
				restoreId: item.id,
				targetId: target.id,
				database: 'example_db',
				ownerToken: item.ownerToken,
				state: 'validated',
			});
			store.update(item.id, { status: 'stopped', completedAt: Date.now() });
			const binding = JSON.stringify({
				snapshotId: item.snapshotId,
				databaseId: item.databaseId,
				sha256: item.artifact.sha256,
			});
			sqlite
				.prepare(
					`INSERT INTO automatic_recovery_lifecycle(id,mode,binding,owner_token,action,state,observed_sequence,created_at,updated_at)
				VALUES(?,'persistent',?,?,'resume','stopped',7,?,?)`
				)
				.run(item.id, binding, item.ownerToken, item.createdAt, item.createdAt);
			const original = store.get(item.id),
				lease = store.lease(item.id);
			const lifecycle: any = sqlite.prepare('SELECT * FROM automatic_recovery_lifecycle').get();
			const protectedSchema = sqlite
				.prepare(
					"SELECT name,sql FROM sqlite_master WHERE type IN ('trigger','index') AND sql IS NOT NULL ORDER BY name"
				)
				.all();
			migrate(drizzle(sqlite), { migrationsFolder: path.resolve('drizzle') });
			migrate(drizzle(sqlite), { migrationsFolder: path.resolve('drizzle') });
			expect(sourceTables.map(table => sqlite.prepare(`SELECT * FROM ${table}`).all())).toEqual(sourceRows);
			expect(store.get(item.id)).toEqual(original);
			expect(store.lease(item.id)).toEqual(lease);
			expect(store.approval(item.id)).toEqual(target);
			expect(sqlite.prepare('SELECT * FROM automatic_recovery_lifecycle').get()).toEqual({
				...lifecycle,
				resume_sequence: 0,
			});
			for (const entry of protectedSchema as { name: string; sql: string }[])
				expect(
					sqlite.prepare('SELECT name,sql FROM sqlite_master WHERE name=?').get(entry.name)
				).toEqual(entry);
			expect(sqlite.pragma('foreign_key_check')).toEqual([]);
			expect(() =>
				sqlite.prepare("UPDATE automatic_recovery_lifecycle SET binding='{}'").run()
			).toThrow('immutable');
			expect(() =>
				sqlite.prepare('DELETE FROM persistent_database_restores WHERE id=?').run(item.id)
			).toThrow('internal lifecycle cleanup required');
			for (const value of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, 'invalid'])
				expect(() =>
					sqlite.prepare('UPDATE automatic_recovery_lifecycle SET resume_sequence=?').run(value)
				).toThrow();
			sqlite.prepare('UPDATE automatic_recovery_lifecycle SET resume_sequence=1').run();
			expect(() =>
				sqlite.prepare('UPDATE automatic_recovery_lifecycle SET resume_sequence=0').run()
			).toThrow('cannot decrease');
			// Old non-Resume SQL updates do not touch or reset the additive authority.
			sqlite
				.prepare("UPDATE automatic_recovery_lifecycle SET action='delete',state='removed'")
				.run();
			expect(
				sqlite.prepare('SELECT resume_sequence FROM automatic_recovery_lifecycle').get()
			).toEqual({ resume_sequence: 1 });
			expect(store.lease(item.id)).toEqual(lease); // Migration/metadata changes never delete SQL.
		} finally {
			sqlite.close();
		}
	});

	it('is additive, journaled after 0015 and contains no historical data or credential rewrite', () => {
		const sql = readFileSync(
			path.resolve('drizzle/0016_automatic_recovery_resume_intent.sql'),
			'utf8'
		);
		expect(sql).toMatch(
			/ALTER TABLE automatic_recovery_lifecycle ADD COLUMN resume_sequence INTEGER NOT NULL DEFAULT 0/
		);
		// BEFORE UPDATE is the monotonic guard, not a historical-data rewrite.
		expect(sql).not.toMatch(/^\s*(?:DROP|UPDATE|DELETE|INSERT)\b|SECRET|ENCRYPTION_KEY/im);
		const journal = JSON.parse(readFileSync(path.resolve('drizzle/meta/_journal.json'), 'utf8'));
		expect(journal.entries[15].tag).toBe('0015_automatic_recovery_lifecycle');
		expect(journal.entries[16]).toMatchObject({
			idx: 16,
			tag: '0016_automatic_recovery_resume_intent',
		});
		expect(journal.entries[16].when).toBeGreaterThan(journal.entries[15].when);
	});
});
