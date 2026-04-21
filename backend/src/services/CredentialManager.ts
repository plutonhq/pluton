import fs from 'fs';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import path from 'path';
import { appPaths } from '../utils/AppPaths';
import {
	readEncryptionKeyFromEnvFile,
	writeEncryptionKeyToEnvFile,
	applyStrictPermissions,
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

	public readKeysFile(): Record<string, any> {
		try {
			if (fs.existsSync(this.keysPath)) {
				return JSON.parse(fs.readFileSync(this.keysPath, 'utf-8'));
			}
		} catch {
			// Ignore read errors
		}
		return {};
	}

	public writeKeysFile(content: Record<string, any>): void {
		const dir = path.dirname(this.keysPath);
		if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(this.keysPath, JSON.stringify(content, null, 2), { mode: 0o600 });
		applyStrictPermissions(this.keysPath);
	}

	// ---------------------------------------------------------------------------
	// Secrets (SECRET + APIKEY)
	// ---------------------------------------------------------------------------

	public loadOrGenerateSecrets(
		envSecret?: string,
		envApiKey?: string
	): { SECRET: string; APIKEY: string } {
		const keysFileContent = this.readKeysFile();

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
			} catch (error) {
				console.error(`[CredentialManager] Failed to save secrets to keys.json: ${error}`);
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
				console.error(
					`[CredentialManager] Failed to save password hash to keys.json: ${error}`
				);
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
			console.error(
				`[CredentialManager] Failed to save password hash to keys.json: ${error}`
			);
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
		let encryptionKey = readEncryptionKeyFromEnvFile(this.dataDir);

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
								console.log(
									'[CredentialManager] Migrated USER_NAME from keyring to keys.json'
								);
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
