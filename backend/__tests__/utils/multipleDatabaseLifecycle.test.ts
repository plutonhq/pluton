import Cryptr from 'cryptr';
import {
	materializeRemoteLifecycleCollection,
	parseRemoteLifecycle,
	prepareRemoteLifecycleCollection,
} from '../../src/utils/remoteLifecycle';
import type { PlanBackupSettings } from '../../src/types/plans';

const secret = 'synthetic-multiple-database-secret';
const database = {
	engine: 'mariadb' as const,
	host: 'localhost',
	port: 3306,
	tls: 'local' as const,
	database: 'example_db',
	username: 'backup_reader',
	dumpFilename: 'app.sql',
	timeoutSeconds: 60,
	maxDumpBytes: 1024 ** 3,
	includeRoutines: false,
	includeEvents: false,
	password: 'synthetic-password-one',
};
const settings = (databases: unknown[]) =>
	({ remoteLifecycle: { version: 2, databases } }) as PlanBackupSettings;
const create = () =>
	prepareRemoteLifecycleCollection(
		settings([
			database,
			{
				...database,
				engine: 'postgresql',
				port: 5432,
				database: 'analytics',
				dumpFilename: 'analytics.sql',
				password: 'synthetic-password-two:with\\escape',
			},
		]),
		undefined,
		[],
		secret
	);

describe('Phase 5 multi-database identity and credential boundaries', () => {
	it('generates stable opaque server IDs, encrypts each independently, and returns no secret', () => {
		const result = create();
		expect(result.credentials).toHaveLength(2);
		const entries = result.settings.remoteLifecycle!.databases!;
		expect(entries[0].databaseId).toMatch(/^db_[a-f0-9]{32}$/);
		expect(entries[1].databaseId).not.toBe(entries[0].databaseId);
		expect(
			entries.every(entry => entry.passwordConfigured && !Object.hasOwn(entry, 'password'))
		).toBe(true);
		expect(JSON.stringify(result.settings)).not.toContain('synthetic-password');
		const payload = materializeRemoteLifecycleCollection(
			result.settings.remoteLifecycle,
			result.credentials,
			secret
		);
		expect(payload.databases!.map(entry => entry.password)).toEqual([
			database.password,
			'synthetic-password-two:with\\escape',
		]);
		expect(payload.databases!.every(entry => !Object.hasOwn(entry, 'passwordConfigured'))).toBe(
			true
		);
	});
	it('reordering retains identity/password and changing A does not modify B ciphertext', () => {
		const initial = create();
		const entries = initial.settings.remoteLifecycle!.databases!;
		const reordered = prepareRemoteLifecycleCollection(
			settings([...entries].reverse()),
			initial.settings.remoteLifecycle,
			initial.credentials,
			secret
		);
		expect(reordered.credentials).toEqual([...initial.credentials].reverse());
		const updated = prepareRemoteLifecycleCollection(
			settings([{ ...entries[0], password: 'synthetic-replacement' }, entries[1]]),
			initial.settings.remoteLifecycle,
			initial.credentials,
			secret
		);
		expect(updated.credentials[1]).toEqual(initial.credentials[1]);
		expect(new Cryptr(secret).decrypt(updated.credentials[0].encryptedPassword)).toBe(
			'synthetic-replacement'
		);
		const removed = prepareRemoteLifecycleCollection(
			settings([entries[1]]),
			initial.settings.remoteLifecycle,
			initial.credentials,
			secret
		);
		expect(removed.credentials).toEqual([initial.credentials[1]]);
	});
	it('rejects invented/cross-plan IDs, forged saved-password state and missing/decrypt-invalid credentials', () => {
		const initial = create();
		expect(() =>
			prepareRemoteLifecycleCollection(
				settings([{ ...database, databaseId: 'db_other_plan' }]),
				initial.settings.remoteLifecycle,
				initial.credentials,
				secret
			)
		).toThrow('does not belong');
		expect(() =>
			prepareRemoteLifecycleCollection(
				settings([{ ...database, password: undefined, passwordConfigured: true }]),
				undefined,
				[],
				secret
			)
		).toThrow('password is required');
		for (const credentials of [
			[],
			initial.credentials.slice(1),
			initial.credentials.map(item => ({ ...item, encryptedPassword: 'synthetic-invalid' })),
		]) {
			expect(() =>
				materializeRemoteLifecycleCollection(initial.settings.remoteLifecycle, credentials, secret)
			).toThrow('credentials could not be prepared');
		}
		expect(() =>
			materializeRemoteLifecycleCollection(
				initial.settings.remoteLifecycle,
				initial.credentials,
				'wrong-synthetic-key'
			)
		).toThrow('credentials could not be prepared');
	});
	it('old single-DB input binds its sole existing ID but cannot truncate a multi-DB plan', () => {
		const single = prepareRemoteLifecycleCollection(
			{ remoteLifecycle: { version: 1, database } } as PlanBackupSettings,
			undefined,
			[],
			secret
		);
		const { databaseId: _id, ...oldConfig } = single.settings.remoteLifecycle!.databases![0];
		const saved = prepareRemoteLifecycleCollection(
			{ remoteLifecycle: { version: 1, database: oldConfig } } as PlanBackupSettings,
			single.settings.remoteLifecycle,
			single.credentials,
			secret
		);
		expect(saved.credentials).toEqual(single.credentials);
		const multi = create();
		expect(() =>
			prepareRemoteLifecycleCollection(
				{ remoteLifecycle: { version: 1, database } } as PlanBackupSettings,
				multi.settings.remoteLifecycle,
				multi.credentials,
				secret
			)
		).toThrow('cannot replace');
	});
	it.each([
		['duplicate filename', [database, { ...database }]],
		['case collision', [database, { ...database, dumpFilename: 'APP.sql' }]],
		[
			'duplicate identity',
			[
				{ ...database, databaseId: 'db_same' },
				{ ...database, databaseId: 'db_same', dumpFilename: 'other.sql' },
			],
		],
		[
			'too many databases',
			Array.from({ length: 9 }, (_, i) => ({ ...database, dumpFilename: `db${i}.sql` })),
		],
		['traversal', [{ ...database, dumpFilename: '../app.sql' }]],
		['option-like filename', [{ ...database, dumpFilename: '-app.sql' }]],
		['normalization collision', [{ ...database, dumpFilename: 'ａｐｐ.sql' }]],
		[
			'PG connection string',
			[{ ...database, engine: 'postgresql', database: 'postgresql://user:secret@db/app' }],
		],
		['PG socket path', [{ ...database, engine: 'postgresql', host: '/run/postgresql' }]],
		[
			'PG newline password',
			[{ ...database, engine: 'postgresql', password: 'synthetic\npassword' }],
		],
		['PG MySQL flags', [{ ...database, engine: 'postgresql', includeEvents: true }]],
		['remote plaintext', [{ ...database, host: 'db.example.internal' }]],
		['arbitrary flags', [{ ...database, flags: ['--file=/etc/passwd'] }]],
	] as [string, unknown[]][])('rejects %s without reflecting input', (_label, databases) => {
		expect(() => parseRemoteLifecycle({ version: 2, databases })).toThrow(
			'configuration is invalid'
		);
	});
});
