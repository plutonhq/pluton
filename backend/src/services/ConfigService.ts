import { z } from 'zod';
import fs from 'fs';
import crypto from 'crypto';
import { appPaths } from '../utils/AppPaths';
import path from 'path';

// Schema for the .env config file
const configSchema = z.object({
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

	// Security
	ENCRYPTION_KEY: z.string().min(12, { message: 'ENCRYPTION_KEY is required for rclone/restic.' }),
	SECRET: z.string().min(12).optional(),
	APIKEY: z.string().min(12).optional(),
	DISABLE_EVENT_SCRIPTS: z.coerce.boolean().default(false).optional(),

	// User Authentication
	USER_NAME: z.string().min(1).default('admin'),
	USER_PASSWORD: z.string().min(1),
	SESSION_DURATION: z.coerce.number().int().positive().default(7), // in days
});

// A schema for the user-editable config.json file
const userConfigSchema = configSchema
	.pick({
		APP_TITLE: true,
		APP_URL: true,
		MAX_CONCURRENT_BACKUPS: true,
		SESSION_DURATION: true,
		SERVER_PORT: true,
		MQTT_PORT: true,
		ALLOW_CUSTOM_RESTORE_PATH: true,
		ALLOW_FILE_BROWSER: true,
		DISABLE_EVENT_SCRIPTS: true,
	})
	.partial();

const finalConfigSchema = configSchema.extend({
	SECRET: z.string().min(12),
	APIKEY: z.string().min(12),
});

export type AppConfig = z.infer<typeof finalConfigSchema>;

class ConfigService {
	private static instance: ConfigService;
	public readonly config: AppConfig;
	private keysPath: string;

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
		let fileConfig = {};
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
			}
		} catch (error) {
			console.log(
				`[ConfigService] Could not load or parse config.json at ${configPath}. Using defaults. Error: ${error}`
			);
		}

		// 3. Load or Generate System Secrets (New logic)
		this.keysPath = path.join(appPaths.getDataDir(), 'keys.json');
		const secrets = this.loadOrGenerateSecrets(envConfig.SECRET, envConfig.APIKEY);

		// 4. Merge all sources (file overrides env, which overrides defaults)
		const mergedConfig = {
			...envConfig,
			...fileConfig,
			SECRET: secrets.SECRET, // System secrets fill in the gaps
			APIKEY: secrets.APIKEY,
		};

		// 5. Validate final configuration
		const parsedConfig = finalConfigSchema.safeParse(mergedConfig);

		if (!parsedConfig.success) {
			// If validation fails, log the errors and exit immediately.
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

		this.config = parsedConfig.data;
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
				// IMPORTANT: Preserve existing data (like publicKey/encryptedPrivateKey)
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
}

// Export a single, ready-to-use instance (the singleton)
export const configService = ConfigService.getInstance();
