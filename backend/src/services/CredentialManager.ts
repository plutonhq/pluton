import fs from 'fs';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import Database from 'better-sqlite3';
import path from 'path';
import { appPaths } from '../utils/AppPaths';
import {
	readEncryptionKeyFromEnvFile,
	writeEncryptionKeyToEnvFile,
	applyStrictPermissions,
	encEnvFileExists,
} from '../utils/envFileHelpers';

const BCRYPT_SALT_ROUNDS = 10;

class CredentialManager {
	private keysPath: string;
	private dataDir: string;

	constructor() {
		this.dataDir = appPaths.getDataDir();
		this.keysPath = path.join(this.dataDir, 'keys.json');
	}

	// ---------------------------------------------------------------------------
	// keys.json I/O helpers
	// ---------------------------------------------------------------------------

	public getKeysPath(): string {
		return this.keysPath;
	}

	public validatePersistedEncryptionKey(supplied?: string): string | null {
		const saved = readEncryptionKeyFromEnvFile(this.dataDir);
		if (encEnvFileExists(this.dataDir) && !saved)
			throw new Error(
				'Persisted ENCRYPTION_KEY is unreadable or invalid. Restore the matching private key file; startup will not replace it.'
			);
		if (saved && supplied && saved !== supplied)
			throw new Error(
				'Configured ENCRYPTION_KEY conflicts with the persisted key. Startup will not rotate it.'
			);
		return saved;
	}

	public readKeysFile(): Record<string, any> {
		try {
			const content: unknown = JSON.parse(fs.readFileSync(this.keysPath, 'utf-8'));
			if (!content || typeof content !== 'object' || Array.isArray(content)) throw new Error();
			return content as Record<string, any>;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
			// A damaged/unreadable existing key file is not a fresh installation.
			// Never include parser text (which may quote a secret), or regenerate keys.
			throw new Error(
				'Persisted credentials are unreadable or invalid. Restore the matching private key file before restarting.'
			);
		}
	}

	public writeKeysFile(content: Record<string, any>): void {
		const dir = path.dirname(this.keysPath);
		if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
		const temporary = path.join(dir, `.keys-${crypto.randomBytes(12).toString('hex')}.tmp`);
		try {
			fs.writeFileSync(temporary, JSON.stringify(content, null, 2), { flag: 'wx', mode: 0o600 });
			applyStrictPermissions(temporary);
			fs.renameSync(temporary, this.keysPath);
		} finally {
			fs.rmSync(temporary, { force: true });
		}
	}

	// ---------------------------------------------------------------------------
	// Secrets (SECRET + APIKEY)
	// ---------------------------------------------------------------------------

	public loadOrGenerateSecrets(
		envSecret?: string,
		envApiKey?: string
	): { SECRET: string; APIKEY: string } {
		const keysFileContent = this.readKeysFile();
		if (!fs.existsSync(this.keysPath)) {
			const databasePath = path.join(this.dataDir, 'db', 'pluton.db');
			if (fs.existsSync(databasePath)) {
				let initialized = true;
				try {
					const control = new Database(databasePath, { readonly: true, fileMustExist: true });
					try {
						control.pragma('query_only = ON');
						initialized = !!control
							.prepare(
								"SELECT 1 FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' LIMIT 1"
							)
							.get();
					} finally {
						control.close();
					}
				} catch {
					/* An unreadable existing control database is not a fresh installation. */
				}
				if (initialized)
					throw new Error(
						'Persisted credentials are missing from an initialized data volume. Restore the matching private key file before restarting.'
					);
			}
		}
		for (const [name, supplied] of [
			['SECRET', envSecret],
			['APIKEY', envApiKey],
		] as const) {
			const existing = keysFileContent[name];
			if (existing !== undefined && (typeof existing !== 'string' || !existing))
				throw new Error(`Persisted ${name} is invalid. Restore the matching private key file.`);
			if (existing && supplied && existing !== supplied)
				throw new Error(
					`Configured ${name} conflicts with persisted credentials. Startup will not rotate or overwrite it.`
				);
		}
		if (fs.existsSync(this.keysPath) && !keysFileContent.SECRET)
			throw new Error(
				'Persisted SECRET is missing. Restore the matching private key file; do not generate a replacement.'
			);

		const finalSecret =
			envSecret || keysFileContent.SECRET || crypto.randomBytes(32).toString('hex');
		const finalApiKey =
			envApiKey || keysFileContent.APIKEY || crypto.randomBytes(24).toString('hex');

		if (finalSecret !== keysFileContent.SECRET || finalApiKey !== keysFileContent.APIKEY) {
			try {
				this.writeKeysFile({
					...keysFileContent,
					SECRET: finalSecret,
					APIKEY: finalApiKey,
				});
				console.log(`[CredentialManager] Secrets updated in ${this.keysPath}`);
			} catch {
				throw new Error(
					'Private credential persistence failed. Startup cannot continue with unpersisted keys.'
				);
			}
		}

		return { SECRET: finalSecret, APIKEY: finalApiKey };
	}

	// ---------------------------------------------------------------------------
	// Password hashing
	// ---------------------------------------------------------------------------

	/**
	 * Hash a plaintext password and store the hash in keys.json.
	 * If no plaintext password is provided, returns the existing hash from keys.json (if any).
	 */
	public hashPasswordIfNeeded(plaintextPassword?: string): string | undefined {
		const keysFileContent = this.readKeysFile();

		if (plaintextPassword) {
			// If a hash already exists, check if the password still matches.
			// This avoids rewriting keys.json with a new hash on every restart.
			if (keysFileContent.PASSWORD_HASH) {
				try {
					if (bcrypt.compareSync(plaintextPassword, keysFileContent.PASSWORD_HASH)) {
						return keysFileContent.PASSWORD_HASH;
					}
				} catch {
					// Corrupted hash — fall through and re-hash
				}
			}

			const hash = bcrypt.hashSync(plaintextPassword, BCRYPT_SALT_ROUNDS);
			try {
				this.writeKeysFile({ ...keysFileContent, PASSWORD_HASH: hash });
				console.log('[CredentialManager] Password hash stored in keys.json');
			} catch (error) {
				console.error(`[CredentialManager] Failed to save password hash to keys.json: ${error}`);
			}
			return hash;
		}

		return keysFileContent.PASSWORD_HASH || undefined;
	}

	/**
	 * Hash a password and store the hash (and optionally username) in keys.json.
	 * Used by SetupController and password change endpoints.
	 */
	public hashAndStorePassword(plaintextPassword: string, userName?: string): string {
		const hash = bcrypt.hashSync(plaintextPassword, BCRYPT_SALT_ROUNDS);
		const keysFileContent = this.readKeysFile();

		try {
			const newContent: Record<string, any> = { ...keysFileContent, PASSWORD_HASH: hash };
			if (userName) {
				newContent.USER_NAME = userName;
			}
			this.writeKeysFile(newContent);
			console.log('[CredentialManager] Password hash updated in keys.json');
		} catch (error) {
			console.error(`[CredentialManager] Failed to save password hash to keys.json: ${error}`);
		}

		return hash;
	}

	/**
	 * Verify a plaintext password against a stored bcrypt hash.
	 */
	public verifyPassword(plaintextPassword: string, storedHash: string): boolean {
		if (!storedHash) return false;
		return bcrypt.compareSync(plaintextPassword, storedHash);
	}

	// ---------------------------------------------------------------------------
	// Credential loading (env file + keyring migration)
	// ---------------------------------------------------------------------------

	/**
	 * Load credentials from pluton.enc.env (preferred) or migrate from OS keyring (legacy).
	 * Returns the config values to apply if credentials were found.
	 */
	public async loadCredentialsFromEnvFileOrKeyring(): Promise<{
		loaded: boolean;
		config?: Record<string, any>;
	}> {
		// --- Step 1: Try loading ENCRYPTION_KEY from pluton.enc.env ---
		let encryptionKey = this.validatePersistedEncryptionKey();

		// --- Step 2: If no env file, try migrating from keyring (legacy) ---
		if (!encryptionKey) {
			try {
				const { keyringService } = await import('./KeyringService');
				const isAvailable = await keyringService.waitForInitialization();

				if (isAvailable) {
					const credentials = await keyringService.getAllCredentials();

					if (credentials.ENCRYPTION_KEY) {
						// Migrate ENCRYPTION_KEY from keyring to pluton.enc.env
						writeEncryptionKeyToEnvFile(this.dataDir, credentials.ENCRYPTION_KEY);
						encryptionKey = credentials.ENCRYPTION_KEY;
						console.log(
							'✅ [CredentialManager] Migrated ENCRYPTION_KEY from keyring to pluton.enc.env'
						);

						// Also migrate USER_NAME from keyring to keys.json if missing
						const keysFileContent = this.readKeysFile();
						if (!keysFileContent.USER_NAME && credentials.USER_NAME) {
							try {
								this.writeKeysFile({
									...keysFileContent,
									USER_NAME: credentials.USER_NAME,
								});
								console.log('[CredentialManager] Migrated USER_NAME from keyring to keys.json');
							} catch (error) {
								console.error(
									`[CredentialManager] Failed to migrate USER_NAME to keys.json: ${error}`
								);
							}
						}
					}
				}
			} catch (error) {
				console.error('[CredentialManager] Keyring migration attempt failed:', error);
			}
		}

		if (!encryptionKey) {
			console.log(
				'[CredentialManager] No ENCRYPTION_KEY found in env file or keyring. Awaiting setup wizard.'
			);
			return { loaded: false };
		}

		// --- Step 3: Load auth credentials from keys.json ---
		const keysFileContent = this.readKeysFile();
		const existingPasswordHash = keysFileContent.PASSWORD_HASH;
		const existingUserName = keysFileContent.USER_NAME;

		if (existingPasswordHash && existingUserName) {
			console.log(
				'✅ [CredentialManager] Credentials loaded (ENCRYPTION_KEY from env file, auth from keys.json).'
			);
			return {
				loaded: true,
				config: {
					ENCRYPTION_KEY: encryptionKey,
					USER_NAME: existingUserName,
					USER_PASSWORD: '', // Not needed at runtime
					PASSWORD_HASH: existingPasswordHash,
					SETUP_PENDING: false,
				},
			};
		}

		// If keys.json has no PASSWORD_HASH, this is a fresh install (or data was wiped).
		console.log('[CredentialManager] keys.json has no PASSWORD_HASH. Awaiting setup wizard.');
		return { loaded: false };
	}
}

export const credentialManager = new CredentialManager();
export { CredentialManager };
