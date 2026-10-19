import Database from 'better-sqlite3';
import Cryptr from 'cryptr';
import { StorageStore } from '../../src/stores/StorageStore';
import { canonicalS3RepositoryIdentity } from '../../src/utils/storageSecurity';

jest.mock('../../src/services/ConfigService', () => ({
	configService: { config: { SECRET: 'synthetic-storage-secret' } },
}));
const cryptr = new Cryptr('synthetic-storage-secret');
const storage = (endpoint = 'https://tenant.example.internal') =>
	({
		id: 'mirror-01',
		name: 'mirror_01',
		type: 's3compatible',
		credentials: Object.fromEntries(
			Object.entries({
				endpoint,
				bucket: 'fixture-bucket',
				access_key_id: 'synthetic-access',
				secret_access_key: 'synthetic-secret',
			}).map(([key, value]) => [key, cryptr.encrypt(value)])
		),
		settings: { hcp_mode: true },
	}) as any;

describe('storage edit/delete managed repository guards', () => {
	let sqlite: Database.Database;
	let store: StorageStore;
	beforeEach(() => {
		sqlite = new Database(':memory:');
		store = new StorageStore({ $client: sqlite } as any);
		sqlite.exec(`CREATE TABLE managed_replication_jobs(source_storage_id TEXT,destination_storage_id TEXT,status TEXT);
		 CREATE TABLE managed_replication_destinations(destination_storage_id TEXT,destination_storage_path TEXT,destination_authority TEXT,destination_prefix TEXT);
		 CREATE TABLE storages(id TEXT,credentials TEXT,settings TEXT);
		 CREATE TABLE plans(id TEXT,settings TEXT);`);
	});
	afterEach(() => sqlite.close());
	it.each(['pending', 'running', 'uncertain'])(
		'refuses %s source or destination reservation before remote publication',
		status => {
			sqlite
				.prepare('INSERT INTO managed_replication_jobs VALUES(?,?,?)')
				.run('primary-01', 'mirror-01', status);
			for (const id of ['primary-01', 'mirror-01'])
				expect(() => store.assertManagedReplicationStorageEditable(id, storage())).toThrow(
					expect.objectContaining({ statusCode: 409 })
				);
			expect(() =>
				store.assertManagedReplicationStorageEditable('unrelated-01', storage())
			).not.toThrow();
		}
	);
	it('permits idle credential rotation and exact physical aliases, but refuses binding changes or config deletion', () => {
		const identity = canonicalS3RepositoryIdentity(storage(), 'fixture-bucket/pluton/plan-01');
		sqlite
			.prepare('INSERT INTO managed_replication_destinations VALUES(?,?,?,?)')
			.run('mirror-01', 'fixture-bucket/pluton/plan-01', identity.authority, identity.prefix);
		expect(() =>
			store.assertManagedReplicationStorageEditable(
				'mirror-01',
				storage('https://fixture-bucket.tenant.example.internal')
			)
		).not.toThrow();
		expect(() =>
			store.assertManagedReplicationStorageEditable(
				'mirror-01',
				storage('https://other.example.internal')
			)
		).toThrow(expect.objectContaining({ statusCode: 409 }));
		expect(() => store.assertManagedReplicationStorageEditable('mirror-01')).toThrow(
			expect.objectContaining({ statusCode: 409 })
		);
	});
	it('remains additive for existing schemas before managed replication installation', () => {
		sqlite.exec(
			'DROP TABLE managed_replication_jobs; DROP TABLE managed_replication_destinations;'
		);
		expect(() =>
			store.assertManagedReplicationStorageEditable('mirror-01', storage())
		).not.toThrow();
	});
});
