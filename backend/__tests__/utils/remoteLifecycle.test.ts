import Cryptr from 'cryptr';
import {
	materializeRemoteLifecycle,
	parseRemoteLifecycle,
	prepareRemoteLifecycleSettings,
} from '../../src/utils/remoteLifecycle';
import type { PlanBackupSettings } from '../../src/types/plans';

const secret = 'synthetic-phase5-encryption-secret';
const password = 'test-only-database-password';
const database = {
	engine: 'mariadb' as const,
	host: 'localhost',
	port: 3306,
	tls: 'local' as const,
	database: 'example_db',
	username: 'backup_reader',
	dumpFilename: 'app.sql',
	timeoutSeconds: 900,
	maxDumpBytes: 1024 ** 3,
	includeRoutines: false,
	includeEvents: false,
};
const settings = {
	remoteLifecycle: { version: 1, database: { ...database, password } },
} as PlanBackupSettings;

describe('remote lifecycle credential boundary', () => {
	it('accepts loopback IPv6 with the explicit local transport policy', () => {
		expect(
			parseRemoteLifecycle({ version: 1, database: { ...database, host: '::1' } }).database?.host
		).toBe('::1');
	});
	it('encrypts separately and strips password from public/persisted plan settings', () => {
		const prepared = prepareRemoteLifecycleSettings(settings, null, secret);
		expect(prepared.settings.remoteLifecycle?.database).toEqual({
			...database,
			passwordConfigured: true,
		});
		expect(JSON.stringify(prepared.settings)).not.toContain(password);
		expect(prepared.credential).not.toContain(password);
		expect(new Cryptr(secret).decrypt(prepared.credential!)).toBe(password);
		const payload = materializeRemoteLifecycle(
			prepared.settings.remoteLifecycle,
			prepared.credential!,
			secret
		);
		expect(payload.database?.password).toBe(password);
		expect(payload.database).not.toHaveProperty('passwordConfigured');
	});
	it('keeps a saved secret on blank replacement and deletes it on database disable', () => {
		const prepared = prepareRemoteLifecycleSettings(settings, null, secret);
		const updated = prepareRemoteLifecycleSettings(prepared.settings, prepared.credential!, secret);
		expect(updated.credential).toBe(prepared.credential);
		expect(
			prepareRemoteLifecycleSettings(
				{ remoteLifecycle: { version: 1 } } as PlanBackupSettings,
				prepared.credential!,
				secret
			).credential
		).toBeNull();
	});
	it('never trusts passwordConfigured, encrypted credentials or executable selection from the client', () => {
		expect(() =>
			prepareRemoteLifecycleSettings(
				{
					remoteLifecycle: { version: 1, database: { ...database, passwordConfigured: true } },
				} as PlanBackupSettings,
				null,
				secret
			)
		).toThrow('password is required');
		for (const field of ['encryptedPassword', 'secretRef', 'binary', 'flags', 'command']) {
			expect(() =>
				parseRemoteLifecycle({ version: 1, database: { ...database, [field]: password } })
			).toThrow('configuration is invalid');
		}
	});
	it('fails closed and sanitized on missing/wrong-key credentials and unsafe configs', () => {
		const prepared = prepareRemoteLifecycleSettings(settings, null, secret);
		for (const credential of [null, 'synthetic-invalid-ciphertext', prepared.credential!]) {
			expect(() =>
				materializeRemoteLifecycle(
					prepared.settings.remoteLifecycle,
					credential,
					'different-secret'
				)
			).toThrow('credentials could not be prepared');
		}
		for (const change of [
			{ dumpFilename: '../escape.sql' },
			{ database: '--all-databases' },
			{ host: 'db.example.internal', tls: 'local' },
			{ password: 'a\0b' },
		]) {
			expect(() =>
				parseRemoteLifecycle({ version: 1, database: { ...database, ...change } })
			).toThrow('configuration is invalid');
		}
	});
	it.each(['../hook', '/bin/sh', 'folder/hook', '$(id)'])(
		'rejects unsafe hook identifier %s',
		id => {
			expect(() =>
				parseRemoteLifecycle({ version: 1, preHook: { id, args: [], timeoutSeconds: 60 } })
			).toThrow('configuration is invalid');
		}
	);
	it.each(['--command', '/etc/passwd', '../escape', 'curl | sh', '$(id)', '`id`', 'x\nsecret'])(
		'rejects unsafe hook argv %s',
		arg => {
			expect(() =>
				parseRemoteLifecycle({
					version: 1,
					postHook: { id: 'cleanup', args: [arg], timeoutSeconds: 60 },
				})
			).toThrow('configuration is invalid');
		}
	);
});
