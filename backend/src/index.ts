import './types/process.d.ts';
import { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createApp } from './createApp';
import { db } from './db';
import { initSetup } from './utils/initSetup';
import { configService, ConfigService } from './services/ConfigService';
import { requiresKeyringSetup } from './utils/installHelpers';

// Export main entry point for use as a library
export { createApp } from './createApp';
export { db } from './db';
export { initSetup } from './utils/initSetup';
export { configService } from './services/ConfigService';

// This block only runs when this file is executed directly (e.g., npm run dev or packaged executable)
// Always run when imported as the main entry point
import path from 'path';
import fs from 'fs';

const isMainModule = import.meta.url === `file://${process.argv[1]}` || (process as any).pkg;
const isDevelopment = process.env.NODE_ENV === 'development';

if (isMainModule || isDevelopment) {
	(async () => {
		// Handle --reset-password CLI command (runs and exits, does not start server)
		if (process.argv.includes('--reset-password')) {
			const { handlePasswordReset } = await import('./utils/cliPasswordReset');
			await handlePasswordReset();
			return; // handlePasswordReset calls process.exit(), but just in case
		}

		// For binary installations on Windows/macOS, try to load credentials from keyring
		if (requiresKeyringSetup() && configService.isSetupPending()) {
			console.log('Attempting to load credentials from system keyring...');
			const loaded = await ConfigService.reinitializeWithKeyringCredentials();
			if (loaded) {
				console.log('Credentials loaded from keyring successfully.');
			} else {
				console.log('No credentials found in keyring. Waiting for initial setup...');
			}
		}

		// Run database migrations first
		if (process.env.NODE_ENV === 'production') {
			console.log('Running database migrations...');
			try {
				const migrationsFolder =
					process.env.IS_DOCKER === 'true'
						? '/app/drizzle'
						: path.join(path.dirname(process.execPath), 'drizzle');

				// Check if migrations exist
				const journalPath = path.join(migrationsFolder, 'meta', '_journal.json');
				if (!fs.existsSync(journalPath)) {
					console.log('No migrations found (meta/_journal.json missing), skipping...');
				} else {
					migrate(db, { migrationsFolder });
					console.log('Database migrations completed successfully');
				}
			} catch (error: any) {
				// If tables already exist or columns already exist (edition upgrade) - skip migration
				if (
					error?.cause?.code === 'SQLITE_ERROR' &&
					(error?.cause?.message?.includes('already exists') ||
						error?.cause?.message?.includes('duplicate column'))
				) {
					console.log('Database schema already up-to-date, skipping migrations');
				} else {
					console.error('Database migration error:', error);
					process.exit(1);
				}
			}
		}

		// Only run initSetup if not in setup pending mode
		if (!configService.isSetupPending()) {
			await initSetup(db as unknown as BetterSQLite3Database);
		} else {
			console.log('Setup pending - skipping initSetup. Complete setup via web interface.');
		}

		const { app } = await createApp();

		const server = app.listen(configService.config.SERVER_PORT || 5173, () => {
			console.log(`Server running on port ${configService.config.SERVER_PORT || 5173}`);
			if (configService.isSetupPending()) {
				console.log(
					`⚠️  Initial setup required. Visit http://localhost:${configService.config.SERVER_PORT || 5173} to complete setup.`
				);
			}
		});

		// Graceful shutdown handling for Docker
		process.on('SIGTERM', async () => {
			console.log('SIGTERM received, shutting down gracefully...');
			const forceExit = setTimeout(() => {
				process.exit(1);
			}, 30000); // 30 seconds timeout

			server.close(() => {
				clearTimeout(forceExit);
				console.log('Server closed');
				process.exit(0);
			});
		});

		process.on('SIGINT', async () => {
			console.log('SIGINT received, shutting down gracefully...');
			server.close(() => {
				console.log('Server closed');
				process.exit(0);
			});
		});
	})();
}
