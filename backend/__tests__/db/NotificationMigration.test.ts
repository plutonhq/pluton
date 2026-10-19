import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { readFileSync } from 'node:fs';
import path from 'node:path';
describe('Phase 7 additive migration', () => {
	it('migrates a fresh database, preserves all previous tables and does not alter agent/legacy contracts', () => {
		const sqlite = new Database(':memory:');
		sqlite.pragma('foreign_keys=ON');
		try {
			migrate(drizzle(sqlite), { migrationsFolder: path.resolve('drizzle') });
			const tables = (
				sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as any[]
			).map(row => row.name);
			for (const table of [
				'notification_channels',
				'notification_deliveries',
				'notification_sources',
				'notification_events',
				'notification_observed',
				'notification_subscriptions',
				'backups',
				'recovery_tests',
				'agent_identities',
				'legacy_repositories',
			])
				expect(tables).toContain(table);
			expect(sqlite.pragma('foreign_key_check')).toEqual([]);
		} finally {
			sqlite.close();
		}
	});
	it('is strictly additive and contains no key, credential, snapshot, restore or legacy mutation', () => {
		const sql = readFileSync(path.resolve('drizzle/0010_phase7_notification_outbox.sql'), 'utf8');
		expect(sql).not.toMatch(
			/DROP\s|ALTER\s|UPDATE\s+(?:backups|plans|storages|agent|legacy|recovery_tests)\b|DELETE\s+FROM\s+(?:backups|plans|storages|agent|legacy|recovery_tests)\b/i
		);
		expect(sql).toContain('notification_backup_terminal');
		expect(sql).toContain('notification_recovery_terminal');
		expect(sql).not.toMatch(/ENCRYPTION_KEY|RESTIC_PASSWORD|SECRET\s*=/);
	});
});
