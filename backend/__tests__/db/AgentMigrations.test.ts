import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const migrationsFolder = path.resolve(process.cwd(), 'drizzle');

function migrationDatabase(): Database.Database {
	const sqlite = new Database(':memory:');
	sqlite.pragma('foreign_keys = ON');
	return sqlite;
}

function expectAgentTables(sqlite: Database.Database): void {
	const rows = sqlite
		.prepare(
			"SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'agent_%' ORDER BY name"
		)
		.all() as { name: string }[];
	expect(rows.map(row => row.name)).toEqual([
		'agent_commands',
		'agent_enrollment_tokens',
		'agent_identities',
		'agent_request_nonces',
	]);
	expect(
		sqlite
			.prepare(
				"SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'remote_managed_repositories'"
			)
			.get()
	).toBeDefined();
}

describe('agent database migration', () => {
	it('migrates a fresh SQLite database including the agent control-plane and managed remote repository tables', () => {
		const sqlite = migrationDatabase();
		try {
			migrate(drizzle(sqlite), { migrationsFolder });
			expectAgentTables(sqlite);
		} finally {
			sqlite.close();
		}
	});

	it('upgrades a database at migration 0004 without changing existing tables destructively', async () => {
		const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'pluton-agent-migrations-'));
		const temporaryMeta = path.join(temporary, 'meta');
		await fs.mkdir(temporaryMeta);
		try {
			for (let index = 0; index <= 4; index += 1) {
				const prefix = `000${index}_`;
				const name = (await fs.readdir(migrationsFolder)).find(
					file => file.startsWith(prefix) && file.endsWith('.sql')
				);
				if (!name) throw new Error(`Missing source migration ${prefix}`);
				await fs.copyFile(path.join(migrationsFolder, name), path.join(temporary, name));
			}
			const journal = JSON.parse(
				await fs.readFile(path.join(migrationsFolder, 'meta', '_journal.json'), 'utf8')
			);
			journal.entries = journal.entries.slice(0, 5);
			await fs.writeFile(path.join(temporaryMeta, '_journal.json'), JSON.stringify(journal));

			const sqlite = migrationDatabase();
			try {
				migrate(drizzle(sqlite), { migrationsFolder: temporary });
				expect(
					sqlite
						.prepare(
							"SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'legacy_restore_jobs'"
						)
						.get()
				).toBeDefined();
				migrate(drizzle(sqlite), { migrationsFolder });
				expectAgentTables(sqlite);
				// Phase 2's independent legacy restore table remains present after upgrade.
				expect(
					sqlite
						.prepare(
							"SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'legacy_restore_jobs'"
						)
						.get()
				).toBeDefined();
			} finally {
				sqlite.close();
			}
		} finally {
			await fs.rm(temporary, { recursive: true, force: true });
		}
	});
});
