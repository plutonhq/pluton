import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { DatabaseRestoreStore } from '../../src/stores/DatabaseRestoreStore';
import {
	RESTORE_PURPOSE,
	type DatabaseRestore,
	type PersistentTargetApproval,
} from '../../src/types/databaseRestores';

export const sql = 'CREATE TABLE fixture_entries(value VARCHAR(100));\n';
export function approval(engine: 'mariadb' | 'postgresql' = 'mariadb'): PersistentTargetApproval {
	return {
		version: 1,
		id: 'c'.repeat(24),
		purpose: RESTORE_PURPOSE,
		mode: 'custom',
		activationId: 'd'.repeat(32),
		engine,
		database: 'example_db',
		target: {
			engine,
			host: 'recovery.example.internal',
			port: engine === 'mariadb' ? 3306 : 5432,
			username: 'restore_user',
			tls: 'verify-identity',
			enabled: true,
			dedicated: true,
			password: crypto.randomBytes(24).toString('hex'),
		},
		caSha256: 'a'.repeat(64),
		maxSqlBytes: 128 * 1024 ** 2,
		maxRetentionSeconds: 86400,
		storage: { id: 'e'.repeat(32), kind: 'operator-approved-external', quotaBytes: 2 * 1024 ** 3 },
	};
}
export function row(target = approval(), id = 'a'.repeat(24)): DatabaseRestore {
	return {
		id,
		owner: 'administrator',
		purpose: RESTORE_PURPOSE,
		planId: 'plan-01',
		repositoryId: 'repo-01',
		backupId: 'backup-01',
		snapshotId: 'b'.repeat(64),
		databaseId: 'db_example',
		artifact: {
			databaseId: 'db_example',
			engine: target.engine,
			database: 'example_db',
			path: '/pluton/database/db_example.sql',
			bytes: Buffer.byteLength(sql),
			sha256: crypto.createHash('sha256').update(sql).digest('hex'),
			artifactValidation: 'pending',
			importValidation: 'pending',
		},
		metadataToken: 'f'.repeat(64),
		mode: target.mode,
		targetId: target.id,
		targetFingerprint: null,
		encryptedApproval: null,
		ownerToken: crypto.randomBytes(24).toString('hex'),
		database: null,
		status: 'queued',
		stage: 'snapshot-validation',
		cleanup: 'none',
		createdAt: Date.now(),
		startedAt: null,
		expiresAt: Date.now() + 86400_000,
		ttlSeconds: 86400,
		lastValidatedAt: null,
		inspection: null,
		errorCode: null,
		cancelRequested: false,
	};
}
export function fixture(file = ':memory:') {
	const sqlite = new Database(file);
	sqlite.pragma('foreign_keys=ON');
	migrate(drizzle(sqlite), { migrationsFolder: 'drizzle' });
	sqlite.exec(`INSERT INTO storages(id,name,type) VALUES('storage-01','Fixture SFTP','sftp');
      INSERT INTO devices(id,name) VALUES('app-01','Fixture');
      INSERT INTO agent_identities(agent_id,device_id,encrypted_secret,hostname,os,architecture,agent_version,capabilities)
      VALUES('agent-01','app-01','synthetic-cipher','app-01','Linux','x86_64','0.4.0','{}');
      INSERT INTO plans(id,title,source_id,source_type,method,storage_id,source_config,settings)
      VALUES('plan-01','Fixture','app-01','device','backup','storage-01','{}','{}');
      INSERT INTO backups(id,plan_id,source_id,source_type,method,storage_id,status,in_progress,success)
      VALUES('backup-01','plan-01','app-01','device','backup','storage-01','completed',0,1);`);
	sqlite
		.prepare('UPDATE backups SET completion_stats=?,storage_path=? WHERE id=?')
		.run(JSON.stringify({ snapshot_id: 'b'.repeat(64) }), 'managed/fixture', 'backup-01');
	sqlite
		.prepare(
			'INSERT INTO remote_managed_repositories(id,plan_id,agent_id,storage_id,storage_path,encrypted_password,initialized_at) VALUES(?,?,?,?,?,?,?)'
		)
		.run('repo-01', 'plan-01', 'agent-01', 'storage-01', 'managed/fixture', 'synthetic-cipher', 1);
	const key = crypto.randomBytes(32).toString('hex');
	return { sqlite, key, store: new DatabaseRestoreStore(sqlite, key) };
}
