import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

const migrationsDir = path.resolve(process.cwd(), 'drizzle');

function applyMigrations(database: Database.Database, through: string): void {
	const migrations = fs
		.readdirSync(migrationsDir)
		.filter(file => file.endsWith('.sql') && file <= through)
		.sort();
	for (const migration of migrations) {
		database.exec(fs.readFileSync(path.join(migrationsDir, migration), 'utf8'));
	}
}

describe('legacy restore job migration', () => {
	it('creates the restore-job table on a fresh database', () => {
		const database = new Database(':memory:');
		applyMigrations(database, '0004_next_vision.sql');

		const columns = database
			.prepare("SELECT name FROM pragma_table_info('legacy_restore_jobs') ORDER BY cid")
			.all()
			.map((column: { name: string }) => column.name);
		expect(columns).toEqual([
			'id',
			'repository_id',
			'snapshot_id',
			'selected_paths',
			'staging_path',
			'status',
			'error_msg',
			'restored_file_count',
			'restored_bytes',
			'created_at',
			'started_at',
			'completed_at',
			'updated_at',
		]);
		database.close();
	});

	it('upgrades the Phase 1 schema without changing registered legacy repositories', () => {
		const database = new Database(':memory:');
		applyMigrations(database, '0003_luxuriant_fat_cobra.sql');
		database
			.prepare(
				'INSERT INTO legacy_repositories (id, display_name, repository_path, encrypted_password) VALUES (?, ?, ?, ?)'
			)
			.run('legacy-fixture', 'Fixture legacy repository', '/fixtures/legacy-repository', 'encrypted-fixture');

		database.exec(fs.readFileSync(path.join(migrationsDir, '0004_next_vision.sql'), 'utf8'));

		expect(database.prepare('SELECT count(*) AS count FROM legacy_repositories').get()).toEqual({ count: 1 });
		expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'legacy_restore_jobs'").get()).toEqual(
			expect.objectContaining({ name: 'legacy_restore_jobs' })
		);
		database.close();
	});
});
