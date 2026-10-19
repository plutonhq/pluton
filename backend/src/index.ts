import { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createApp } from './createApp';
import { db, sqlite, dbFilePath } from './db';
import { initSetup } from './utils/initSetup';
import { configService, ConfigService } from './services/ConfigService';
import { requiresDesktopSetup } from './utils/installHelpers';
import { processManager } from './managers/ProcessManager';

// Export main entry point for use as a library
export { createApp } from './createApp';
export { db } from './db';
export { initSetup } from './utils/initSetup';
export { configService } from './services/ConfigService';

// This block only runs when this file is executed directly (e.g., npm run dev or packaged executable)
// Always run when imported as the main entry point
import fs from 'fs';
import { getMigrationsFolder, getMigrationsJournalPath } from './utils/migrations';
import { CLI_COMMAND_FLAGS } from './utils/cliCommands';

const isMainModule = import.meta.url === `file://${process.argv[1]}` || (process as any).pkg;
const isDevelopment = process.env.NODE_ENV === 'development';

// Backup event handlers are async but run detached from the emitter, so a
// rejection would end the process and leave the run with a stale lock.
process.on('unhandledRejection', (reason: any) => {
	console.error('[CORE] Unhandled promise rejection:', reason?.stack || reason);
});

if (isMainModule || isDevelopment) {
	(async () => {
		// These flags are also what lets ConfigService skip its server-credential fail-fast
		// at import time, so both sides read the same list. See utils/cliCommands.ts.
		const [RESET_PASSWORD_FLAG, RESTORE_PLUTON_FLAG] = CLI_COMMAND_FLAGS;

		// Handle --reset-password CLI command (runs and exits, does not start server)
		if (process.argv.includes(RESET_PASSWORD_FLAG)) {
			const { handlePasswordReset } = await import('./utils/cliPasswordReset');
			await handlePasswordReset();
			return; // handlePasswordReset calls process.exit(), but just in case
		}

		// Handle --restore-pluton CLI command (runs and exits, does not start server).
		// Must run before migrations, initSetup and listen. It replaces the whole data dir.
		if (process.argv.includes(RESTORE_PLUTON_FLAG)) {
			const { handleSelfRestore } = await import('./utils/cliSelfRestore');
			await handleSelfRestore({ sqlite, dbFilePath, edition: 'core' });
			return;
		}

		// For binary installations on desktop platforms, try to load credentials from env file or keyring
		if (requiresDesktopSetup() && configService.isSetupPending()) {
			console.log('Attempting to load credentials from env file or system keyring...');
			const loaded = await ConfigService.reinitializeFromEnvFileOrKeyring();
			if (loaded) {
				console.log('Credentials loaded successfully.');
			} else {
				console.log('No credentials found. Waiting for initial setup...');
			}
		}

		// Run database migrations first
		if (process.env.NODE_ENV === 'production') {
			console.log('Running database migrations...');
			try {
				const migrationsFolder = getMigrationsFolder();

				// Check if migrations exist
				const journalPath = getMigrationsJournalPath(migrationsFolder);
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

		const { app, shutdown } = await createApp();

		const port = configService.config.SERVER_PORT || 5173;

		const server = app.listen(port, () => {
			console.log(`Server running on port ${port}`);
			if (configService.isSetupPending()) {
				console.log(
					`⚠️  Initial setup required. Visit http://localhost:${port} to complete setup.`
				);
			}
		});

		server.on('error', (err: NodeJS.ErrnoException) => {
			if (err.code === 'EADDRINUSE') {
				console.error(
					`[Startup] Port ${port} is already in use. Another Pluton instance is running. Exiting.`
				);
				process.exit(0);
			}
			console.error('[Startup] HTTP server error:', err);
			process.exit(1);
		});

		// Handle graceful shutdown
		const gracefulShutdown = () => {
			console.log('Shutting down gracefully...');
			// Kill any restic/rclone children so a stop does not orphan them.
			processManager.killAll();
			const forceExit = setTimeout(() => {
				// Phase 6 may start bounded DB cleanup after the initial abort.
				// Do not orphan those groups when the shutdown deadline expires.
				processManager.killAll('SIGKILL');
				process.exit(1);
			}, 30000);
			void Promise.all([shutdown(), new Promise<void>(resolve => server.close(() => resolve()))])
				.then(() => {
					console.log('HTTP server closed.');
					clearTimeout(forceExit);
					process.exit(0);
				})
				.catch(() => {
					processManager.killAll('SIGKILL');
					process.exit(1);
				});
		};

		process.on('SIGINT', gracefulShutdown);
		process.on('SIGTERM', gracefulShutdown);
	})();
}
