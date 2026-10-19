import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { backups } from '../../src/db/schema/backups';
import { BackupStore } from '../../src/stores/BackupStore';
describe('atomic remote progress persistence', () => {
	it('re-reads inside a synchronous transaction and cannot revive a completed row', async () => {
		const sqlite = new Database(':memory:');
		try {
			sqlite.exec(
				`CREATE TABLE backups (id TEXT PRIMARY KEY, title TEXT, description TEXT, created_at INTEGER NOT NULL, updated_at INTEGER, started_at INTEGER, ended_at INTEGER, in_progress INTEGER, success INTEGER, active INTEGER, status TEXT, error_msg TEXT, plan_id TEXT, storage_id TEXT, storage_path TEXT, source_id TEXT NOT NULL, method TEXT NOT NULL, source_type TEXT, source_config TEXT, encryption INTEGER, compression INTEGER, download TEXT, task_stats TEXT, progress_stats TEXT, completion_stats TEXT, mirrors TEXT)`
			);
			const db = drizzle(sqlite, { schema: { backups } });
			db.insert(backups)
				.values({
					id: 'backup-01',
					planId: 'plan-01',
					sourceId: 'app-01',
					method: 'backup',
					status: 'started',
					inProgress: true,
				})
				.run();
			const store = new BackupStore(db as any);
			await store.updateRemoteProgress('backup-01', 'plan-01', 'command-01', 1, 5, {
				backupStage: 'backing-up',
				progress: { bytesProcessed: 10 },
			});
			expect((await store.getById('backup-01'))?.progressStats?.bytesProcessed).toBe(10);
			expect(
				await store.updateRemoteProgress('backup-01', 'other-plan', 'command-01', 1, 6, {})
			).toBeNull();
			expect(
				await store.updateRemoteProgress('backup-01', 'plan-01', 'command-01', 1, 4, {})
			).toBeNull();
			await store.update('backup-01', { status: 'completed', inProgress: false, success: true });
			expect(
				await store.updateRemoteProgress('backup-01', 'plan-01', 'command-01', 2, 100, {
					phase: 'running',
				})
			).toBeNull();
			expect(await store.getById('backup-01')).toMatchObject({
				status: 'completed',
				success: true,
				inProgress: false,
			});
		} finally {
			sqlite.close();
		}
	});
});
