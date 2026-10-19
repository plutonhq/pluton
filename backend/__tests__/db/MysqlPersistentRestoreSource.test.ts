import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { DatabaseRestoreStore } from '../../src/stores/DatabaseRestoreStore';
import { row } from '../integration/persistentRestore.fixture';
const {
	seedMysqlPersistentSource,
	admissionDiagnostic,
} = require('../integration/mysqlPersistentRestore.source.cjs');

describe('real MySQL persistent runtime fixture source reservation', () => {
	let sqlite: Database.Database;
	let store: DatabaseRestoreStore;
	beforeEach(() => {
		sqlite = new Database(':memory:');
		sqlite.pragma('foreign_keys=ON');
		migrate(drizzle(sqlite), { migrationsFolder: 'drizzle' });
		store = new DatabaseRestoreStore(sqlite, 'synthetic-fixture-key');
	});
	afterEach(() => sqlite.close());
	it('reproduces the original empty-source refusal and exposes its sanitized 409 code', () => {
		try {
			store.create(row());
			throw new Error('Expected empty-source refusal');
		} catch (error) {
			expect(admissionDiagnostic(error)).toBe(
				'decision=refused code=RETAINED_DATABASE_RESTORE_DEPENDENCY status=409'
			);
		}
		expect(store.list()).toHaveLength(0);
	});
	it('reserves a MySQL restore using the exact runtime fixture seed with real foreign keys', () => {
		const item = row();
		item.artifact.engine = 'mysql';
		seedMysqlPersistentSource(sqlite, item);
		expect(store.create(item)).toMatchObject({ id: item.id, snapshotId: item.snapshotId });
		expect(sqlite.pragma('foreign_key_check')).toEqual([]);
		const before = store.get(item.id);
		// A seed is creation-only: collision must fail, never replace retained state.
		expect(() => seedMysqlPersistentSource(sqlite, item)).toThrow();
		expect(store.get(item.id)).toEqual(before);
	});
	it.each(['snapshot', 'repository', 'backup'])(
		'still refuses a mismatched %s without reserving',
		field => {
			const item = row();
			seedMysqlPersistentSource(sqlite, item);
			if (field === 'snapshot') item.snapshotId = 'a'.repeat(64);
			if (field === 'repository') item.repositoryId = 'repo-other';
			if (field === 'backup') item.backupId = 'backup-other';
			expect(() => store.create(item)).toThrow(
				expect.objectContaining({ statusCode: 409, code: 'RETAINED_DATABASE_RESTORE_DEPENDENCY' })
			);
			expect(store.list()).toHaveLength(0);
		}
	);
	it('does not log arbitrary messages, credentials or unsafe codes', () => {
		expect(
			admissionDiagnostic({ code: 'secret\ncredential', statusCode: '409', message: 'private' })
		).toBe('decision=refused code=unclassified status=unknown');
	});
});
