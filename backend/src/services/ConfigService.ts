import { z } from 'zod';
import fs from 'fs';
import { appPaths } from '../utils/AppPaths';
import path from 'path';

// Schema for the .env config file
const configSchema = z.object({
	// General
	NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),
	SERVER_PORT: z.coerce.number().int().positive().default(5173),
	MQTT_PORT: z.coerce.number().int().positive().default(1883).optional(),
	APP_URL: z.string().default('http://localhost:5173'),
	APP_TITLE: z.string().min(1),
	MAX_CONCURRENT_BACKUPS: z.coerce.number().int().positive().default(2),
	LICENSE_KEY: z.string().optional(),

	// User Interface
	ALLOW_CUSTOM_RESTORE_PATH: z.coerce.boolean().default(true).optional(),
	ALLOW_FILE_BROWSER: z.coerce.boolean().default(true).optional(),

	// Security
	SECRET: z
		.string()
		.min(12, { message: 'SECRET must be at least 12 characters long for secure encryption.' }),
	ENCRYPTION_KEY: z.string().min(12, { message: 'ENCRYPTION_KEY is required for rclone/restic.' }),
	APIKEY: z.string().min(12, { message: 'APIKEY must be at least 12 characters long.' }),
	DISABLE_EVENT_SCRIPTS: z.coerce.boolean().default(false).optional(),

	// User Authentication
	USER_NAME: z.string().min(1),
	USER_PASSWORD: z.string().min(1),
	SESSION_DURATION: z.coerce.number().int().positive().default(7), // in days
});

export type AppConfig = z.infer<typeof configSchema>;

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

class ConfigService {
	private static instance: ConfigService;
	public readonly config: AppConfig;

	private constructor() {
		// Note: dotenv is loaded in index.ts before this service is initialized

		// Load env variables
		const envConfig = configSchema.partial().parse(process.env);

		// 3. Layer user's config.json file
		let fileConfig = {};
		const configPath = path.join(appPaths.getConfigDir(), 'config.json');
		try {
			if (fs.existsSync(configPath)) {
				const fileContent = fs.readFileSync(configPath, 'utf-8');
				const parsedJson = JSON.parse(fileContent);
				fileConfig = userConfigSchema.parse(parsedJson); // Validate the user's config
				console.log(`[ConfigService] Loaded user configuration from ${configPath}`);
			}
		} catch (error) {
			console.log(
				`[ConfigService] Could not load or parse config.json at ${configPath}. Using defaults. Error: ${error}`
			);
		}

		// 4. Merge all sources (file overrides env, which overrides defaults)
		const mergedConfig = {
			...envConfig,
			...fileConfig,
		};

		const parsedConfig = configSchema.safeParse(mergedConfig);

		if (!parsedConfig.success) {
			// If validation fails, log the errors and exit immediately.
			// This is "fail-fast" and prevents the app from running in a broken state.
			console.error('❌ Invalid environment configuration:');
			parsedConfig.error.issues.forEach(err => {
				console.error(`  - ${err.path.join('.')}: ${err.message}`);
			});
			process.exit(1);
		}

		this.config = parsedConfig.data;
		console.log('✅ Environment configuration loaded and validated successfully.');
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
