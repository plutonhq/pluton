import { z } from 'zod';
import fs from 'fs';
import { appPaths } from '../utils/AppPaths';
import path from 'path';
import { requiresDesktopSetup } from '../utils/installHelpers';
import { isCliCommandInvocation } from '../utils/cliCommands';
import { verifyFilePermissions } from '../utils/envFileHelpers';
import { credentialManager } from './CredentialManager';
import { parseWebOrigins, WebOriginConfigError } from '../utils/webOrigins';

// Schema for the .env config file (with optional sensitive fields for setup mode)
const baseConfigSchema = z.object({
	// General
	NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
	SERVER_PORT: z.coerce.number().int().positive().default(5173),
	APP_URL: z.string().default('http://localhost:5173'),
	APP_ALLOWED_ORIGINS: z.string().optional(),
	APP_TITLE: z.string().min(1).default('Pluton'),
	MAX_CONCURRENT_BACKUPS: z.coerce.number().int().positive().default(2),
	LICENSE_KEY: z.string().optional(),

	// User Interface
	ALLOW_CUSTOM_RESTORE_PATH: z.coerce.boolean().default(true).optional(),
	ALLOW_FILE_BROWSER: z.coerce.boolean().default(true).optional(),
	FILE_BROWSER_ROOT: z.string().optional(),

	// Reverse proxy: value passed to Express's `trust proxy` setting.
	TRUST_PROXY: z.string().optional(),

	// Agent control plane. HTTPS is required unless this explicit server-side
	// exception is set for a trusted LAN pilot.
	ALLOW_INSECURE_AGENT_HTTP: z
		.preprocess(
			value =>
				typeof value === 'string' && ['true', 'false', '1', '0'].includes(value)
					? value === 'true' || value === '1'
					: value,
			z.boolean()
		)
		.default(false)
		.optional(),
	AGENT_SERVER_URL: z.string().optional(),
	AGENT_OFFLINE_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(90).optional(),

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
		APP_ALLOWED_ORIGINS: true,
		MAX_CONCURRENT_BACKUPS: true,
		SESSION_DURATION: true,
		SERVER_PORT: true,
		ALLOW_CUSTOM_RESTORE_PATH: true,
		ALLOW_FILE_BROWSER: true,
		FILE_BROWSER_ROOT: true,
		DISABLE_EVENT_SCRIPTS: true,
		TRUST_PROXY: true,
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

		// 1b. Load ENCRYPTION_KEY from pluton.enc.env if not already in process env
		const envFileKey = credentialManager.validatePersistedEncryptionKey(
			normalizedEnv.ENCRYPTION_KEY
		);
		if (!normalizedEnv.ENCRYPTION_KEY) {
			if (envFileKey) {
				normalizedEnv.ENCRYPTION_KEY = envFileKey;
				console.log('[ConfigService] Loaded ENCRYPTION_KEY from pluton.enc.env');
			}
		}

		const envConfig = configSchema.partial().parse(normalizedEnv);

		// 2. Layer user's config.json file
		let fileConfig: Record<string, any> = {};
		const configPath = path.join(appPaths.getConfigDir(), 'config.json');
		try {
			if (fs.existsSync(configPath)) {
				const fileContent = fs.readFileSync(configPath, 'utf-8');
				const parsedJson = JSON.parse(fileContent);
				// A broken origin policy must not silently fall back to a more permissive one.
				parseWebOrigins({ ...envConfig, ...parsedJson });

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
			if (error instanceof WebOriginConfigError) throw error;
			console.log(
				'[ConfigService] Could not read or validate config.json; using defaults. Configuration values were not logged.'
			);
		}

		// Validate operator web/agent URL policy before any secret generation or persistence.
		const webPolicy = parseWebOrigins({ ...envConfig, ...fileConfig });
		if (envConfig.AGENT_SERVER_URL) {
			const agentOrigin = parseWebOrigins({ APP_URL: envConfig.AGENT_SERVER_URL }).canonical;
			if (agentOrigin.startsWith('http:') && envConfig.ALLOW_INSECURE_AGENT_HTTP !== true)
				throw new Error(
					'HTTP AGENT_SERVER_URL requires the explicit trusted-LAN Agent transport exception.'
				);
			envConfig.AGENT_SERVER_URL = agentOrigin;
		}

		// 3. Load or Generate System Secrets
		const secrets = credentialManager.loadOrGenerateSecrets(envConfig.SECRET, envConfig.APIKEY);

		// 4. Hash the password if provided via env var
		const passwordHash = credentialManager.hashPasswordIfNeeded(envConfig.USER_PASSWORD);

		// 5. Merge all sources (file overrides env, which overrides defaults)
		const mergedConfig = {
			...envConfig,
			...fileConfig,
			APP_URL: webPolicy.canonical,
			SECRET: secrets.SECRET, // System secrets fill in the gaps
			APIKEY: secrets.APIKEY,
			PASSWORD_HASH: passwordHash,
			IS_DOCKER: rawEnv.IS_DOCKER === 'true' || rawEnv.IS_DOCKER === '1',
			IS_BINARY: (process as any).pkg ? true : false,
		};

		// 6. Validate final configuration
		const parsedConfig = finalConfigSchema.safeParse(mergedConfig);

		if (!parsedConfig.success) {
			// Check if we're in binary mode on a desktop platform
			// In this case, we can start in "setup pending" mode
			//
			// CLI commands (--restore-pluton, --reset-password) take the same branch: they do
			// their work and exit without ever booting the app, so the server's credential
			// requirements dont apply to them. Exiting here would make them unreachable on docker/server installs
			const isCliCommand = isCliCommandInvocation();
			if (requiresDesktopSetup() || isCliCommand) {
				if (isCliCommand) {
					console.log('[ConfigService] Running a CLI command without full server credentials.');
				} else {
					console.log('⏳ [ConfigService] Binary mode detected without credentials.');
					console.log('⏳ [ConfigService] Starting in setup pending mode...');
					console.log(
						'⏳ [ConfigService] Please complete the initial setup via the web interface.'
					);
				}

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

				if (!isCliCommand) {
					console.log('⏳ Environment configuration loaded in SETUP PENDING mode.');
				}
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

		// Verify permissions on sensitive files
		verifyFilePermissions(credentialManager.getKeysPath());
		verifyFilePermissions(appPaths.getEncEnvFilePath());

		console.log('✅ Environment configuration loaded and validated successfully.');
	}

	/**
	 * Hash a password and store the hash (and username) in keys.json.
	 * Used by SetupController and password change endpoints.
	 */
	public hashAndStorePassword(plaintextPassword: string, userName?: string): string {
		const hash = credentialManager.hashAndStorePassword(plaintextPassword, userName);
		(this._config as any).PASSWORD_HASH = hash;
		return hash;
	}

	/**
	 * Verify a plaintext password against the stored bcrypt hash.
	 */
	public verifyPassword(plaintextPassword: string): boolean {
		const hash = (this._config as any).PASSWORD_HASH;
		return credentialManager.verifyPassword(plaintextPassword, hash);
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
	 * This is called after credentials are stored in the env file.
	 */
	public completeSetup(credentials: {
		ENCRYPTION_KEY: string;
		USER_NAME: string;
		USER_PASSWORD: string;
	}): void {
		if (!this._isSetupPending) {
			throw new Error('Setup is not pending. Cannot complete setup.');
		}

		// Hash the password and store both USER_NAME and PASSWORD_HASH in keys.json
		const passwordHash = credentialManager.hashAndStorePassword(
			credentials.USER_PASSWORD,
			credentials.USER_NAME
		);

		// Update the config with the new credentials
		this._config = {
			...this._config,
			...credentials,
			PASSWORD_HASH: passwordHash,
			SETUP_PENDING: false,
		} as AppConfig;

		this._isSetupPending = false;
		console.log('✅ [ConfigService] Setup completed. Credentials stored securely.');
	}

	/**
	 * Roll back in-memory state to setup-pending after a post-setup failure
	 * (e.g. initSetup threw). The persisted files (pluton.enc.env, keys.json) are
	 * left in place — they are idempotent and will be picked up on next restart.
	 */
	public markSetupPending(): void {
		this._isSetupPending = true;
		(this._config as any).SETUP_PENDING = true;
		console.log('⚠️  [ConfigService] Setup rolled back to pending state.');
	}

	/**
	 * Reinitialize ConfigService by loading ENCRYPTION_KEY from pluton.enc.env (preferred)
	 * or by migrating from the OS keyring (legacy desktop installs).
	 *
	 * On subsequent startups (keys.json already has USER_NAME + PASSWORD_HASH),
	 * only ENCRYPTION_KEY is needed from the env file (or keyring for migration).
	 * USER_NAME and PASSWORD_HASH are read from keys.json to avoid overwriting CLI password resets.
	 */
	public static async reinitializeFromEnvFileOrKeyring(): Promise<boolean> {
		if (!ConfigService.instance || !ConfigService.instance._isSetupPending) {
			return false;
		}

		const result = await credentialManager.loadCredentialsFromEnvFileOrKeyring();

		if (result.loaded && result.config) {
			ConfigService.instance._config = {
				...ConfigService.instance._config,
				...result.config,
			} as AppConfig;
			ConfigService.instance._isSetupPending = false;
			return true;
		}

		return false;
	}

	/**
	 * @deprecated Use reinitializeFromEnvFileOrKeyring() instead.
	 * Kept for backward compatibility during migration period.
	 */
	public static async reinitializeWithKeyringCredentials(): Promise<boolean> {
		return ConfigService.reinitializeFromEnvFileOrKeyring();
	}
}

// Export a single, ready-to-use instance (the singleton)
export const configService = ConfigService.getInstance();

// Also export the class for static methods
export { ConfigService };
