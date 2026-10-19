import fs from 'fs';
import path from 'path';
import Cryptr from 'cryptr';
import Database from 'better-sqlite3';
import { checkServerIdentity, rootCertificates } from 'tls';
import {
	canonicalS3RepositoryIdentity,
	configureProtectedStorageDatabase,
	decryptStorageCredentials,
	httpsS3Endpoint,
	publicStorage,
	protectedStorageEnvironment,
	rcloneRemoteEnvironment,
	redactStorageOutput,
	splitStorageSecrets,
	storageRcloneOptions,
	trustEnvironment,
	validateHcpConfiguration,
} from '../../src/utils/storageSecurity';

jest.mock('../../src/services/ConfigService', () => ({
	configService: { config: { SECRET: 'synthetic-storage-secret' } },
}));

const plain = {
	endpoint: 'https://tenant.example.internal',
	bucket: 'fixture-bucket',
	access_key_id: 'synthetic-access',
	secret_access_key: 'synthetic-secret',
	region: 'us-east-1',
};
const cryptr = new Cryptr('synthetic-storage-secret');
const stored = (credentials = plain, settings: Record<string, any> = {}) => ({
	type: 's3compatible',
	credentials: Object.fromEntries(
		Object.entries(credentials).map(([key, value]) => [key, cryptr.encrypt(value)])
	),
	settings,
});

describe('HCP S3 protected storage boundary', () => {
	afterEach(() => {
		configureProtectedStorageDatabase(undefined);
		delete process.env.PLUTON_STORAGE_CA_FILE;
		jest.restoreAllMocks();
	});
	it('resolves only referenced protected remotes from injected SQLite in both S3 provider types', () => {
		expect(protectedStorageEnvironment(['lsd', 'mirror_01:fixture-bucket'])).toEqual({});
		const sqlite = new Database(':memory:');
		try {
			sqlite.exec('CREATE TABLE storages(name TEXT, type TEXT, credentials TEXT, settings TEXT)');
			for (const [name, type] of [['mirror_01', 's3compatible'], ['aws_01', 's3']]) {
				const storage = stored(plain, { hcp_mode: true });
				sqlite.prepare('INSERT INTO storages VALUES(?,?,?,?)').run(name, type, JSON.stringify(storage.credentials), JSON.stringify(storage.settings));
			}
			configureProtectedStorageDatabase(sqlite);
			const mirror = protectedStorageEnvironment(['snapshots', '--repo', 'rclone:mirror_01:fixture-bucket/pluton']);
			expect(mirror.RCLONE_CONFIG_MIRROR_01_SECRET_ACCESS_KEY).toBe(plain.secret_access_key);
			expect(Object.keys(mirror).some(key => key.startsWith('RCLONE_CONFIG_AWS_01_'))).toBe(false);
			const aws = protectedStorageEnvironment(['lsd', 'aws_01:fixture-bucket']);
			expect(aws.RCLONE_CONFIG_AWS_01_PROVIDER).toBe('AWS');
			expect(aws.RCLONE_CONFIG_AWS_01_SECRET_ACCESS_KEY).toBe(plain.secret_access_key);
			expect(protectedStorageEnvironment(['lsd', 'unrelated:fixture-bucket'])).toEqual({});
		} finally { configureProtectedStorageDatabase(undefined); sqlite.close(); }
	});

	it('moves token and SSE-C out of public settings and retains encrypted credential compatibility', () => {
		const split = splitStorageSecrets('s3compatible', plain, {
			session_token: 'synthetic-token',
			sse_customer_key: 'synthetic-sse',
			force_path_style: false,
		});
		expect(split.settings).toEqual({ force_path_style: false });
		expect(split.credentials).toMatchObject({
			session_token: 'synthetic-token',
			sse_customer_key: 'synthetic-sse',
		});
		const record = stored(split.credentials, split.settings);
		expect(decryptStorageCredentials(record)).toEqual(split.credentials);
		const result = publicStorage(record);
		expect(result.credentials).toEqual({
			endpoint: plain.endpoint,
			bucket: plain.bucket,
			region: plain.region,
		});
		expect(result.credentialsConfigured).toEqual(
			expect.arrayContaining([
				'access_key_id',
				'secret_access_key',
				'session_token',
				'sse_customer_key',
			])
		);
		expect(JSON.stringify(result)).not.toContain('synthetic-secret');
	});

	it('redacts legacy token settings without rewriting stored state', () => {
		const record = stored(plain, { session_token: 'legacy-synthetic-token' });
		expect(decryptStorageCredentials(record).session_token).toBe('legacy-synthetic-token');
		expect(publicStorage(record).settings).toEqual({});
		expect(record.settings.session_token).toBe('legacy-synthetic-token');
	});

	it.each([
		'http://tenant.example.internal',
		'https://user:password@tenant.example.internal',
		'https://tenant.example.internal/hs3',
		'https://tenant.example.internal:8000',
		'https://tenant.example.internal/?token=secret',
	])('rejects unsafe/console endpoint %s', endpoint => {
		expect(() => httpsS3Endpoint(endpoint)).toThrow();
	});

	it('preserves explicit region, SigV4 default, addressing and existing-bucket behavior', () => {
		const options = storageRcloneOptions(
			stored(plain, { force_path_style: false, hcp_mode: true })
		);
		expect(options).toMatchObject({
			type: 's3',
			provider: 'Other',
			region: 'us-east-1',
			endpoint: plain.endpoint,
			force_path_style: 'false',
			env_auth: 'false',
			no_check_bucket: 'true',
		});
		expect(options.v2_auth).toBeUndefined();
		expect(options.hcp_mode).toBeUndefined();
		expect(options.bucket).toBeUndefined();
	});

	it('refuses missing credentials and user-controlled TLS/file credential settings', () => {
		expect(() => storageRcloneOptions(stored({ ...plain, secret_access_key: '' }))).toThrow(
			'credentials'
		);
		expect(() =>
			validateHcpConfiguration(plain, { hcp_mode: true, ca_cert: '/arbitrary/ca' })
		).toThrow('operator');
		expect(() =>
			validateHcpConfiguration(plain, {
				hcp_mode: true,
				shared_credentials_file: '/arbitrary/credentials',
			})
		).toThrow('explicit');
	});

	it('canonicalizes TLS default ports, DNS case and virtual-host aliases independently of credentials', () => {
		const first = canonicalS3RepositoryIdentity(
			stored({ ...plain, endpoint: 'https://TENANT.example.internal:443/' }),
			'fixture-bucket/pluton/plan-01'
		);
		const alias = canonicalS3RepositoryIdentity(
			stored({
				...plain,
				endpoint: 'https://fixture-bucket.tenant.example.internal',
				secret_access_key: 'other-synthetic-secret',
			}),
			'fixture-bucket/pluton/plan-01'
		);
		expect(alias).toEqual(first);
		expect(first.authority).toBe('https://tenant.example.internal/fixture-bucket');
		expect(first.prefix).toBe('pluton/plan-01');
		expect(
			canonicalS3RepositoryIdentity(stored(), 'fixture-bucket/pluton/plan-02').fingerprint
		).not.toBe(first.fingerprint);
	});

	it.each([
		'fixture-bucket',
		'other-bucket/pluton/plan-01',
		'fixture-bucket/../other',
		'fixture-bucket/pluton//other',
		'fixture-bucket/pluton/%2e%2e',
		'fixture-bucket/pluton\\other',
	])('refuses bucket-root or ambiguous scope %s', repositoryPath => {
		expect(() => canonicalS3RepositoryIdentity(stored(), repositoryPath)).toThrow();
	});

	it('keeps secrets in a named child environment and redacts echoed diagnostics', () => {
		const environment = rcloneRemoteEnvironment('mirror_01', storageRcloneOptions(stored()));
		expect(environment.RCLONE_CONFIG_MIRROR_01_SECRET_ACCESS_KEY).toBe(plain.secret_access_key);
		expect(
			redactStorageOutput(`denied ${plain.secret_access_key}; ${plain.access_key_id}`, environment)
		).toBe('denied [redacted]; [redacted]');
		expect(() => rcloneRemoteEnvironment('mirror\n01', {})).toThrow();
	});

	it('keeps standard TLS verification enabled and rejects wrong hostname', () => {
		expect(trustEnvironment()).toEqual({});
		const error = checkServerIdentity('mirror.example.internal', {
			subject: { CN: 'other.example.internal' },
			subjectaltname: 'DNS:other.example.internal',
		} as any);
		expect(error).toHaveProperty('code', 'ERR_TLS_CERT_ALTNAME_INVALID');
	});

	it('accepts a valid CA bundle solely from the operator and forwards both runtime trust variables', () => {
		process.env.PLUTON_STORAGE_CA_FILE = path.resolve('operator-storage-ca.pem');
		jest
			.spyOn(fs, 'lstatSync')
			.mockReturnValue({
				isFile: () => true,
				isSymbolicLink: () => false,
				size: rootCertificates[0].length,
				mode: 0o600,
			} as any);
		jest.spyOn(fs, 'readFileSync').mockReturnValue(rootCertificates[0]);
		expect(trustEnvironment()).toEqual({
			SSL_CERT_FILE: process.env.PLUTON_STORAGE_CA_FILE,
			RCLONE_CA_CERT: process.env.PLUTON_STORAGE_CA_FILE,
		});
	});

	it('fails closed for arbitrary, missing, non-certificate and symlink CA configuration', () => {
		for (const value of ['relative-ca.pem', path.resolve('missing-storage-ca.pem')]) {
			process.env.PLUTON_STORAGE_CA_FILE = value;
			expect(() => trustEnvironment()).toThrow('Operator storage CA');
		}
		process.env.PLUTON_STORAGE_CA_FILE = path.resolve('synthetic-ca.pem');
		jest
			.spyOn(fs, 'lstatSync')
			.mockReturnValue({
				isFile: () => true,
				isSymbolicLink: () => false,
				size: 12,
				mode: 0o600,
			} as any);
		jest.spyOn(fs, 'readFileSync').mockReturnValue('not a certificate');
		expect(() => trustEnvironment()).toThrow('Operator storage CA');
		(fs.lstatSync as jest.Mock).mockReturnValue({
			isFile: () => true,
			isSymbolicLink: () => true,
			size: 12,
			mode: 0o600,
		});
		expect(() => trustEnvironment()).toThrow('Operator storage CA');
	});
});
