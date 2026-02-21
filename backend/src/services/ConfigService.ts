import { z } from 'zod';
import fs from 'fs';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { appPaths } from '../utils/AppPaths';
import path from 'path';
import { requiresKeyringSetup } from '../utils/installHelpers';

const BCRYPT_SALT_ROUNDS = 10;

// Schema for the .env config file (with optional sensitive fields for setup mode)
const baseConfigSchema = z.object({
	// General
	NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
	SERVER_PORT: z.coerce.number().int().positive().default(5173),
	MQTT_PORT: z.coerce.number().int().positive().default(1883).optional(),
	APP_URL: z.string().default('http://localhost:5173'),
	APP_TITLE: z.string().min(1).default('Pluton'),
	MAX_CONCURRENT_BACKUPS: z.coerce.number().int().positive().default(2),
	LICENSE_KEY: z.string().optional(),

	// User Interface
	ALLOW_CUSTOM_RESTORE_PATH: z.coerce.boolean().default(true).optional(),
	ALLOW_FILE_BROWSER: z.coerce.boolean().default(true).optional(),
	FILE_BROWSER_ROOT: z.string().optional(),

	// Security (optional in setup mode)
	ENCRYPTION_KEY: z
		.string()
		.min(12, { message: 'ENCRYPTION_KEY is required for rclone/restic.' })
		.optional(),
	SECRET: z.string().min(12).optional(),
	APIKEY: z.string().min(12).optional(),
	DISABLE_EVENT_SCRIPTS: z.coerce.boolean().default(false).optional(),

	// User Authentication (optional in setup mode)
	USER_NAME: z.string().min(1).optional(),
	USER_PASSWORD: z.string().min(1).optional(),
	SESSION_DURATION: z.coerce.number().int().positive().default(7), // in days

	// INTERNAL
	IS_DOCKER: z.coerce.boolean().default(false).optional(),
	IS_BINARY: z.coerce.boolean().default(false).optional(),
	SETUP_PENDING: z.coerce.boolean().default(false).optional(),
});

// Full config schema (requires all sensitive fields)
const configSchema = baseConfigSchema.extend({
	ENCRYPTION_KEY: z.string().min(12, { message: 'ENCRYPTION_KEY is required for rclone/restic.' }),
	USER_NAME: z.string().min(1, { message: 'USER_NAME is required.' }),
	USER_PASSWORD: z.string().min(1, { message: 'USER_PASSWORD is required.' }),
});

// A schema for the user-editable config.json file
const userConfigSchema = baseConfigSchema
	.pick({
		APP_TITLE: true,
		APP_URL: true,
		MAX_CONCURRENT_BACKUPS: true,
		SESSION_DURATION: true,
		SERVER_PORT: true,
		MQTT_PORT: true,
		ALLOW_CUSTOM_RESTORE_PATH: true,
		ALLOW_FILE_BROWSER: true,
		FILE_BROWSER_ROOT: true,
		DISABLE_EVENT_SCRIPTS: true,
	})
	.partial();

// Final config schema for normal operation (requires all sensitive fields)
const finalConfigSchema = configSchema.extend({
	SECRET: z.string().min(12),
	APIKEY: z.string().min(12),
	PASSWORD_HASH: z.string().min(1).optional(),
});

// Setup mode config schema (doesn't require sensitive fields)
const setupModeConfigSchema = baseConfigSchema.extend({
	SECRET: z.string().min(12),
	APIKEY: z.string().min(12),
	PASSWORD_HASH: z.string().min(1).optional(),
	SETUP_PENDING: z.literal(true),
});

export type AppConfig = z.infer<typeof finalConfigSchema>;
export type SetupModeConfig = z.infer<typeof setupModeConfigSchema>;

class ConfigService {
	private static instance: ConfigService;
	private _config!: AppConfig | SetupModeConfig;
	private keysPath: string = '';
	private _isSetupPending: boolean = false;

	/**
	 * Returns the config. In setup mode, some fields may be undefined.
	 */
	public get config(): AppConfig {
		if (this._isSetupPending) {
			// Return a partial config that works for setup mode
			return this._config as AppConfig;
		}
		return this._config as AppConfig;
	}

	/**
	 * Check if the app is in setup pending mode (waiting for credentials)
	 */
	public isSetupPending(): boolean {
		return this._isSetupPending;
	}

	private constructor() {
		// Note: dotenv is loaded in index.ts before this service is initialized

		// 1. Load env variables
		const rawEnv = process.env;
		const normalizedEnv = { ...rawEnv };

		// Map PLUTON_ prefixed variables for non-docker setups
		if (normalizedEnv.PLUTON_ENCRYPTION_KEY) {
			normalizedEnv.ENCRYPTION_KEY = normalizedEnv.PLUTON_ENCRYPTION_KEY;
		}
		if (normalizedEnv.PLUTON_USER_NAME) {
			normalizedEnv.USER_NAME = normalizedEnv.PLUTON_USER_NAME;
		}
		if (normalizedEnv.PLUTON_USER_PASSWORD) {
			normalizedEnv.USER_PASSWORD = normalizedEnv.PLUTON_USER_PASSWORD;
		}

		const envConfig = configSchema.partial().parse(normalizedEnv);
		// Initialize or load SECRET and APIKEY

		// 2. Layer user's config.json file
		let fileConfig: Record<string, any> = {};
		const configPath = path.join(appPaths.getConfigDir(), 'config.json');
		try {
			if (fs.existsSync(configPath)) {
				const fileContent = fs.readFileSync(configPath, 'utf-8');
				const parsedJson = JSON.parse(fileContent);

				// Security validation: Check if config.json contains sensitive fields
				const sensitiveFields = ['ENCRYPTION_KEY', 'USER_NAME', 'USER_PASSWORD'];
				const foundSensitiveFields = sensitiveFields.filter(field => field in parsedJson);

				if (foundSensitiveFields.length > 0) {
					console.warn(
						'⚠️  [ConfigService] SECURITY WARNING: config.json contains sensitive fields that should be in environment variables:'
					);
					foundSensitiveFields.forEach(field => {
						console.warn(`  - ${field}`);
					});
					console.warn(
						'⚠️  These fields will be ignored. Please move them to system environment variables.'
					);
				}

				fileConfig = userConfigSchema.parse(parsedJson); // Validate the user's config (will exclude sensitive fields)
				console.log(`[ConfigService] Loaded user configuration from ${configPath}`);
			} else {
				console.log(`[ConfigService] No config.json found at ${configPath}`);
			}
		} catch (error) {
			console.log(
				`[ConfigService] Could not load or parse config.json at ${configPath}. Using defaults. Error: ${error}`
			);
		}

		// 3. Load or Generate System Secrets (New logic)
		this.keysPath = path.join(appPaths.getDataDir(), 'keys.json');
		const secrets = this.loadOrGenerateSecrets(envConfig.SECRET, envConfig.APIKEY);

		// 4. Hash the password if provided via env var
		const passwordHash = this.hashPasswordIfNeeded(envConfig.USER_PASSWORD);

		// 5. Merge all sources (file overrides env, which overrides defaults)
		const mergedConfig = {
			...envConfig,
			...fileConfig,
			SECRET: secrets.SECRET, // System secrets fill in the gaps
			APIKEY: secrets.APIKEY,
			PASSWORD_HASH: passwordHash,
			IS_DOCKER: rawEnv.IS_DOCKER === 'true' || rawEnv.IS_DOCKER === '1',
			IS_BINARY: (process as any).pkg ? true : false,
		};

		// 6. Validate final configuration
		const parsedConfig = finalConfigSchema.safeParse(mergedConfig);

		if (!parsedConfig.success) {
			// Check if we're in binary mode on a keyring-supported platform
			// In this case, we can start in "setup pending" mode
			if (requiresKeyringSetup()) {
				console.log('⏳ [ConfigService] Binary mode detected without credentials.');
				console.log('⏳ [ConfigService] Starting in setup pending mode...');
				console.log('⏳ [ConfigService] Please complete the initial setup via the web interface.');

				// Create a setup-mode config with placeholder values
				this._isSetupPending = true;
				this._config = {
					...mergedConfig,
					ENCRYPTION_KEY: '', // Will be set during setup
					USER_NAME: 'admin', // Default value
					USER_PASSWORD: '', // Will be set during setup
					PASSWORD_HASH: '', // Will be set during setup
					SETUP_PENDING: true,
				} as SetupModeConfig;

				console.log('⏳ Environment configuration loaded in SETUP PENDING mode.');
				return;
			}

			// If validation fails and not in keyring mode, log the errors and exit immediately.
			// This is "fail-fast" and prevents the app from running in a broken state.
			console.error('❌ Invalid environment configuration:');
			parsedConfig.error.issues.forEach(err => {
				console.error(`  - ${err.path.join('.')}: ${err.message}`);
			});
			console.error('\n💡 Required environment variables for production:');
			console.error('  - ENCRYPTION_KEY (min 12 characters)');
			console.error('  - USER_NAME');
			console.error('  - USER_PASSWORD');
			console.error('\nPlease set these environment variables and restart the application.');
			process.exit(1);
		}

		this._config = parsedConfig.data;
		console.log('✅ Environment configuration loaded and validated successfully.');
	}

	private loadOrGenerateSecrets(envSecret?: string, envApiKey?: string) {
		let keysFileContent: Record<string, any> = {};

		// Read existing keys.json
		try {
			if (fs.existsSync(this.keysPath)) {
				keysFileContent = JSON.parse(fs.readFileSync(this.keysPath, 'utf-8'));
			}
		} catch (error) {
			// Ignore read errors, we will overwrite/create
		}

		// Priority: Env > Existing File > Generate
		const finalSecret =
			envSecret || keysFileContent.SECRET || crypto.randomBytes(32).toString('hex');
		const finalApiKey =
			envApiKey || keysFileContent.APIKEY || crypto.randomBytes(24).toString('hex');

		// Save if something changed or didn't exist
		if (finalSecret !== keysFileContent.SECRET || finalApiKey !== keysFileContent.APIKEY) {
			try {
				const newContent = {
					...keysFileContent,
					SECRET: finalSecret,
					APIKEY: finalApiKey,
				};

				// Ensure dir exists (synchronously, as ConfigService is sync)
				const dir = path.dirname(this.keysPath);
				if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

				fs.writeFileSync(this.keysPath, JSON.stringify(newContent, null, 2), { mode: 0o600 });
				console.log(`[ConfigService] Secrets updated in ${this.keysPath}`);
			} catch (error) {
				console.error(`[ConfigService] Failed to save secrets to keys.json: ${error}`);
			}
		}

		return { SECRET: finalSecret, APIKEY: finalApiKey };
	}

	/**
	 * Hash a plaintext password and store the hash in keys.json.
	 * If no plaintext password is provided, returns the existing hash from keys.json (if any).
	 */
	private hashPasswordIfNeeded(plaintextPassword?: string): string | undefined {
		let keysFileContent: Record<string, any> = {};
		try {
			if (fs.existsSync(this.keysPath)) {
				keysFileContent = JSON.parse(fs.readFileSync(this.keysPath, 'utf-8'));
			}
		} catch (error) {
			// Ignore read errors
		}

		// If a plaintext password is provided (from env var), hash it and store
		if (plaintextPassword) {
			const hash = bcrypt.hashSync(plaintextPassword, BCRYPT_SALT_ROUNDS);
			try {
				const newContent = { ...keysFileContent, PASSWORD_HASH: hash };
				const dir = path.dirname(this.keysPath);
				if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
				fs.writeFileSync(this.keysPath, JSON.stringify(newContent, null, 2), { mode: 0o600 });
				console.log('[ConfigService] Password hash stored in keys.json');
			} catch (error) {
				console.error(`[ConfigService] Failed to save password hash to keys.json: ${error}`);
			}
			return hash;
		}

		// Otherwise, return the existing hash from keys.json (for keyring/setup flow)
		return keysFileContent.PASSWORD_HASH || undefined;
	}

	/**
	 * Hash a password and store the hash in keys.json.
	 * Used by SetupController and password change endpoints.
	 */
	public hashAndStorePassword(plaintextPassword: string): string {
		const hash = bcrypt.hashSync(plaintextPassword, BCRYPT_SALT_ROUNDS);

		let keysFileContent: Record<string, any> = {};
		try {
			if (fs.existsSync(this.keysPath)) {
				keysFileContent = JSON.parse(fs.readFileSync(this.keysPath, 'utf-8'));
			}
		} catch (error) {
			// Ignore read errors
		}

		try {
			const newContent = { ...keysFileContent, PASSWORD_HASH: hash };
			const dir = path.dirname(this.keysPath);
			if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
			fs.writeFileSync(this.keysPath, JSON.stringify(newContent, null, 2), { mode: 0o600 });
			console.log('[ConfigService] Password hash updated in keys.json');
		} catch (error) {
			console.error(`[ConfigService] Failed to save password hash to keys.json: ${error}`);
		}

		// Update in-memory config
		(this._config as any).PASSWORD_HASH = hash;

		return hash;
	}

	/**
	 * Verify a plaintext password against the stored bcrypt hash.
	 */
	public verifyPassword(plaintextPassword: string): boolean {
		const hash = (this._config as any).PASSWORD_HASH;
		if (!hash) return false;
		return bcrypt.compareSync(plaintextPassword, hash);
	}

	/**
	 * Gets the singleton instance of the ConfigService.
	 */

	public static getInstance(): ConfigService {
		if (!ConfigService.instance) {
			ConfigService.instance = new ConfigService();
		}
		return ConfigService.instance;
	}

	/**
	 * A getter to check if the app is in development mode.
	 */
	public isDevelopment(): boolean {
		return this.config.NODE_ENV === 'development';
	}

	/**
	 * Complete the initial setup by updating config with credentials.
	 * This is called after credentials are stored in the keyring.
	 */
	public completeSetup(credentials: {
		ENCRYPTION_KEY: string;
		USER_NAME: string;
		USER_PASSWORD: string;
	}): void {
		if (!this._isSetupPending) {
			throw new Error('Setup is not pending. Cannot complete setup.');
		}

		// Hash the password and store in keys.json
		const passwordHash = this.hashAndStorePassword(credentials.USER_PASSWORD);

		// Update the config with the new credentials
		this._config = {
			...this._config,
			...credentials,
			PASSWORD_HASH: passwordHash,
			SETUP_PENDING: false,
		} as AppConfig;

		this._isSetupPending = false;
		console.log('✅ [ConfigService] Setup completed. Credentials loaded from keyring.');
	}

	/**
	 * Reinitialize ConfigService with credentials from keyring.
	 * Used after initial setup to reload config with actual credentials.
	 */
	public static async reinitializeWithKeyringCredentials(): Promise<boolean> {
		if (!ConfigService.instance || !ConfigService.instance._isSetupPending) {
			return false;
		}

		try {
			// Dynamically import keyring service to avoid circular dependencies
			const { keyringService } = await import('./KeyringService');
			const credentials = await keyringService.getAllCredentials();

			if (credentials.ENCRYPTION_KEY && credentials.USER_NAME && credentials.USER_PASSWORD) {
				// All credentials present - complete normal setup
				ConfigService.instance.completeSetup({
					ENCRYPTION_KEY: credentials.ENCRYPTION_KEY,
					USER_NAME: credentials.USER_NAME,
					USER_PASSWORD: credentials.USER_PASSWORD,
				});
				return true;
			}
		} catch (error) {
			console.error('[ConfigService] Failed to reinitialize with keyring credentials:', error);
		}

		return false;
	}
}

// Export a single, ready-to-use instance (the singleton)
export const configService = ConfigService.getInstance();

// Also export the class for static methods
export { ConfigService };
