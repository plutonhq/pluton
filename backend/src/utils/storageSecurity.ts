import fs from 'fs';
import path from 'path';
import { createHash, X509Certificate } from 'crypto';
import Cryptr from 'cryptr';
import type Database from 'better-sqlite3';
import type { Storage } from '../db/schema/storages';
import { configService } from '../services/ConfigService';
import { providers } from './providers';
import { AppError } from './AppError';

export const S3_SECRET_FIELDS = new Set([
	'access_key_id',
	'secret_access_key',
	'session_token',
	'sse_customer_key',
	'sse_customer_key_base64',
	'sse_customer_key_md5',
]);
type StorageConfiguration = Pick<Storage, 'type' | 'credentials' | 'settings'>;
let protectedStorageDatabase: Pick<Database.Database, 'prepare'> | undefined;

/** Application-owned injection avoids a database import cycle and works in packaged ESM. */
export function configureProtectedStorageDatabase(
	database: Pick<Database.Database, 'prepare'> | undefined
): void {
	protectedStorageDatabase = database;
}
const hasControl = (value: string): boolean =>
	Array.from(value).some(
		character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
	);

export function isS3Storage(type: string | null | undefined): boolean {
	return type === 's3' || providers[type || '']?.type === 's3';
}

/** Move legacy secret settings to the encrypted credentials boundary on write. */
export function splitStorageSecrets(
	type: string | null | undefined,
	credentials: Record<string, any> = {},
	settings: Record<string, any> = {}
): { credentials: Record<string, string>; settings: Record<string, any> } {
	const cleanCredentials = Object.fromEntries(
		Object.entries(credentials).map(([k, v]) => [k, String(v)])
	);
	const cleanSettings = { ...settings };
	if (isS3Storage(type)) {
		for (const key of S3_SECRET_FIELDS) {
			if (!cleanCredentials[key] && cleanSettings[key] !== undefined && cleanSettings[key] !== '')
				cleanCredentials[key] = String(cleanSettings[key]);
			delete cleanSettings[key];
		}
	}
	return { credentials: cleanCredentials, settings: cleanSettings };
}

/** Server-only. Never return this projection through an API or Agent message. */
export function decryptStorageCredentials(storage: StorageConfiguration): Record<string, string> {
	const cryptr = new Cryptr(configService.config.SECRET as string);
	const credentials: Record<string, string> = {};
	try {
		for (const [key, value] of Object.entries(storage.credentials || {})) {
			if (typeof value !== 'string') throw new Error('invalid credential');
			credentials[key] = cryptr.decrypt(value);
		}
	} catch {
		throw new AppError(500, 'Storage credentials could not be decrypted.');
	}
	// Read existing installations without rewriting their state. Next edit encrypts these.
	if (isS3Storage(storage.type)) {
		for (const key of S3_SECRET_FIELDS) {
			if (!(key in credentials) && storage.settings?.[key])
				credentials[key] = String(storage.settings[key]);
		}
	}
	return credentials;
}

export function publicStorage<T extends StorageConfiguration>(
	storage: T,
	decrypted?: Record<string, string>
): T & { credentialsConfigured?: string[] } {
	if (!isS3Storage(storage.type)) return storage;
	const settings = { ...(storage.settings || {}) };
	for (const key of S3_SECRET_FIELDS) delete settings[key];
	const credentials = decrypted || decryptStorageCredentials(storage);
	const credentialsConfigured = [...S3_SECRET_FIELDS].filter(key => !!credentials[key]);
	return {
		...storage,
		credentials: Object.fromEntries(
			Object.entries(credentials).filter(([key]) => !S3_SECRET_FIELDS.has(key))
		),
		settings,
		credentialsConfigured,
	};
}

export function httpsS3Endpoint(raw: string): URL {
	let endpoint: URL;
	if (hasControl(raw) || /\s/.test(raw))
		throw new AppError(400, 'An HTTPS S3 API endpoint is required.');
	try {
		endpoint = new URL(raw);
	} catch {
		throw new AppError(400, 'An HTTPS S3 API endpoint is required.');
	}
	if (
		endpoint.protocol !== 'https:' ||
		endpoint.username ||
		endpoint.password ||
		endpoint.search ||
		endpoint.hash ||
		endpoint.pathname !== '/' ||
		endpoint.port === '8000' ||
		!endpoint.hostname
	) {
		throw new AppError(
			400,
			'Use the HTTPS S3 API endpoint, without credentials, path, query or console port.'
		);
	}
	endpoint.hostname = endpoint.hostname.toLowerCase().replace(/\.$/, '');
	return endpoint;
}

function s3Endpoint(storage: StorageConfiguration, credentials: Record<string, string>): URL {
	const explicit = credentials.endpoint || String(storage.settings?.endpoint || '');
	if (explicit) return httpsS3Endpoint(explicit);
	if (storage.type !== 's3') return httpsS3Endpoint('');
	const region = credentials.region || String(storage.settings?.region || 'us-east-1');
	if (!/^[a-z0-9-]+$/.test(region)) throw new AppError(400, 'Invalid S3 region.');
	return httpsS3Endpoint(`https://s3.${region}.amazonaws.com`);
}

export function isHcpMode(settings: Record<string, any> | null | undefined): boolean {
	return settings?.hcp_mode === true || settings?.hcp_mode === 'true';
}

/** Explicit existing-bucket mode; namespace/bucket provisioning is never attempted. */
export function validateHcpConfiguration(
	credentials: Record<string, string>,
	settings: Record<string, any>
): void {
	if (!isHcpMode(settings)) return;
	httpsS3Endpoint(credentials.endpoint || String(settings.endpoint || ''));
	if (
		!credentials.bucket ||
		credentials.bucket.includes('/') ||
		credentials.bucket.includes('\\') ||
		hasControl(credentials.bucket) ||
		/\s/.test(credentials.bucket)
	)
		throw new AppError(400, 'An existing S3 bucket/namespace is required.');
	if (!credentials.access_key_id || !credentials.secret_access_key)
		throw new AppError(400, 'S3 access credentials are required.');
	if (
		String(credentials.env_auth || settings.env_auth) === 'true' ||
		settings.shared_credentials_file ||
		credentials.shared_credentials_file ||
		settings.download_url
	)
		throw new AppError(
			400,
			'HCP uses explicit protected credentials and the approved S3 endpoint.'
		);
	for (const key of ['no_check_certificate', 'insecure', 'ca_cert', 'tls_ca', 'skip_verify']) {
		if (settings[key] !== undefined)
			throw new AppError(400, 'TLS trust is controlled by the server operator.');
	}
}

/** Server child-process options, including secrets. Do not serialize or log. */
export function storageRcloneOptions(
	storage: StorageConfiguration,
	plaintext?: Record<string, string>
): Record<string, string> {
	if (!isS3Storage(storage.type))
		throw new AppError(400, 'This managed mirror requires S3 storage.');
	const credentials = plaintext || decryptStorageCredentials(storage);
	const settings = storage.settings || {};
	const endpoint = s3Endpoint(storage, credentials);
	if (!credentials.access_key_id || !credentials.secret_access_key)
		throw new AppError(400, 'Protected S3 access credentials are required.');
	const setup = providers[storage.type || '']?.setup(credentials, 'client');
	if (!setup) throw new AppError(400, 'The S3 provider configuration is incomplete.');
	const options: Record<string, string> = { type: 's3' };
	for (let index = 0; index < setup.length; index += 2) {
		if (!/^[a-z][a-z0-9_]*$/.test(setup[index]))
			throw new AppError(400, 'Unsupported S3 provider configuration.');
		options[setup[index]] = String(setup[index + 1]);
	}
	const allowed = new Set(
		(providers[storage.type || '']?.settings || []).map(setting => setting.value)
	);
	for (const [key, value] of Object.entries({ ...settings, ...credentials })) {
		if (
			allowed.has(key) &&
			key !== 'bucket' &&
			key !== 'hcp_mode' &&
			key !== 'shared_credentials_file' &&
			key !== 'profile' &&
			key !== 'download_url'
		) {
			if (hasControl(String(value))) throw new AppError(400, 'Invalid S3 configuration value.');
			options[key] = String(value);
		}
	}
	return { ...options, endpoint: endpoint.origin, env_auth: 'false', no_check_bucket: 'true' };
}

/** Standard bucket-root repositories overlap every child of the same authority. */
export function s3RepositoryScope(
	storage: StorageConfiguration,
	repositoryPath?: string | null
): { authority: string; prefix: string } {
	const scopePath =
		(repositoryPath || '').replace(/^\/+|\/+$/g, '') || decryptStorageCredentials(storage).bucket;
	const root = !scopePath?.includes('/');
	const identity = canonicalS3RepositoryIdentity(
		storage,
		root ? `${scopePath}/scope-placeholder` : scopePath
	);
	return { authority: identity.authority, prefix: root ? '' : identity.prefix };
}

export function canonicalS3RepositoryIdentity(
	storage: StorageConfiguration,
	repositoryPath: string
): {
	authority: string;
	prefix: string;
	fingerprint: string;
} {
	if (!isS3Storage(storage.type)) throw new AppError(400, 'S3 storage is required.');
	const credentials = decryptStorageCredentials(storage);
	const bucket = credentials.bucket;
	if (!bucket || !/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(bucket))
		throw new AppError(400, 'A valid existing bucket is required.');
	const endpoint = s3Endpoint(storage, credentials);
	if (endpoint.hostname.startsWith(bucket + '.'))
		endpoint.hostname = endpoint.hostname.slice(bucket.length + 1);
	// AWS bucket names are global within a partition, irrespective of regional endpoint aliases.
	if (/^s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com$/.test(endpoint.hostname))
		endpoint.hostname = 's3.amazonaws.com';
	const parts = repositoryPath.replace(/^\/+|\/+$/g, '').split('/');
	if (
		parts.shift() !== bucket ||
		parts.length === 0 ||
		parts.some(
			part => !part || part === '.' || part === '..' || /[\\%\s]/.test(part) || hasControl(part)
		)
	) {
		throw new AppError(
			400,
			'Use a dedicated repository prefix within the configured S3 bucket; bucket roots are forbidden.'
		);
	}
	const authority = `${endpoint.origin}/${bucket}`;
	const prefix = parts.join('/');
	return {
		authority,
		prefix,
		fingerprint: createHash('sha256')
			.update(JSON.stringify([authority, prefix]))
			.digest('hex'),
	};
}

/** Operator configuration only. No user/API path or TLS verification bypass. */
export function trustEnvironment(): Record<string, string> {
	const filename = process.env.PLUTON_STORAGE_CA_FILE;
	if (!filename) return {};
	try {
		if (!path.isAbsolute(filename)) throw new Error('relative');
		const stat = fs.lstatSync(filename);
		if (
			!stat.isFile() ||
			stat.isSymbolicLink() ||
			stat.size > 1024 * 1024 ||
			(process.platform !== 'win32' &&
				(stat.mode & 0o022 || (process.env.NODE_ENV === 'production' && stat.uid !== 0)))
		)
			throw new Error('unsafe');
		const pem = fs.readFileSync(filename, 'utf8');
		const blocks = pem.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g);
		if (!blocks?.length || blocks.some(block => !new X509Certificate(block).ca))
			throw new Error('not-ca');
		return { SSL_CERT_FILE: filename, RCLONE_CA_CERT: filename };
	} catch {
		throw new AppError(500, 'Operator storage CA configuration is invalid or inaccessible.');
	}
}

export function rcloneRemoteEnvironment(
	name: string,
	options: Record<string, string>
): Record<string, string> {
	if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new AppError(400, 'Invalid storage remote name.');
	return Object.fromEntries(
		Object.entries(options).map(([key, value]) => [
			`RCLONE_CONFIG_${name.toUpperCase()}_${key.toUpperCase()}`,
			value,
		])
	);
}

/** Read protected HCP credentials at execution time, never from a shared config file. */
export function protectedStorageEnvironment(args: string[]): Record<string, string> {
	const database = protectedStorageDatabase;
	if (!database) return {};
	if (
		!database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='storages'").get()
	)
		return {};
	const rows = database
		.prepare("SELECT name,type,credentials,settings FROM storages WHERE type IN ('s3','s3compatible')")
		.all() as Array<any>;
	const environment: Record<string, string> = {};
	for (const row of rows) {
		const name = String(row.name);
		if (
			!args.some(
				argument => argument.startsWith(`${name}:`) || argument.startsWith(`rclone:${name}:`)
			)
		)
			continue;
		const storage = {
			...row,
			credentials: JSON.parse(row.credentials || '{}'),
			settings: JSON.parse(row.settings || '{}'),
		};
		if (!isHcpMode(storage.settings)) continue;
		Object.assign(environment, rcloneRemoteEnvironment(name, storageRcloneOptions(storage)));
	}
	return environment;
}

export function redactStorageOutput(
	value: string,
	environment: Record<string, string | undefined>
): string {
	let result = value;
	for (const [key, secret] of Object.entries(environment)) {
		if (/(?:SECRET|TOKEN|ACCESS_KEY|SSE_CUSTOMER|PASS)/i.test(key) && secret && secret.length >= 4)
			result = result.split(secret).join('[redacted]');
	}
	return result;
}

export function storageDiagnosticCode(error: unknown): string {
	const message = error instanceof Error ? error.message : '';
	if (/hostname|certificate.*(?:valid for|name)|ERR_TLS_CERT_ALTNAME_INVALID/i.test(message))
		return 'TLS_HOSTNAME_MISMATCH';
	if (/certificate|unknown authority|x509|SSL_CERT/i.test(message)) return 'TLS_TRUST_INVALID';
	if (
		/AccessDenied|Forbidden|InvalidAccessKey|SignatureDoesNotMatch|status.*(?:401|403)/i.test(
			message
		)
	)
		return 'S3_AUTHENTICATION_DENIED';
	if (/NoSuchBucket|bucket.*(?:not found|does not exist)|status.*404/i.test(message))
		return 'S3_NAMESPACE_UNAVAILABLE';
	if (/timeout|connection refused|ENOTFOUND|DNS|no such host/i.test(message))
		return 'S3_NETWORK_UNAVAILABLE';
	return 'S3_OPERATION_FAILED';
}
