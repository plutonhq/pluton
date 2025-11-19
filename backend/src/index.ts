import 'dotenv/config';
import { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createApp } from './createApp';
import { db } from './db';
import { initSetup } from './utils/initSetup';
import { configService } from './services/ConfigService';

// Export main entry point for use as a library
export { createApp } from './createApp';
export { db } from './db';
export { initSetup } from './utils/initSetup';
export { configService } from './services/ConfigService';

// This block only runs when this file is executed directly (e.g., npm run dev)
// Using import.meta.url to check if the module is the main module (for plutonhq/core-backend package)
if (import.meta.url.startsWith('file:')) {
	(async () => {
		// Run database migrations first
		if (process.env.NODE_ENV === 'production') {
			console.log('[CORE] Running database migrations...');
			try {
				const migrationsFolder = process.env.IS_DOCKER === 'true' ? '/app/drizzle' : './drizzle';
				migrate(db, { migrationsFolder });
				console.log('[CORE] Database migrations completed successfully');
			} catch (error: any) {
				// If tables already exist - skip migration
				if (
					error?.cause?.code === 'SQLITE_ERROR' &&
					error?.cause?.message?.includes('already exists')
				) {
					console.log('[CORE] Database tables already exist, skipping migrations');
				} else {
					console.error('[CORE] Database migration error:', error);
					process.exit(1);
				}
			}
		}

		await initSetup(db as unknown as BetterSQLite3Database);
		const { app } = await createApp();

		const server = app.listen(configService.config.SERVER_PORT || 5173, () => {
			console.log(`[CORE] Server running on port ${configService.config.SERVER_PORT || 5173}`);
		});

		// Graceful shutdown handling for Docker
		process.on('SIGTERM', async () => {
			console.log('[CORE] SIGTERM received, shutting down gracefully...');
			server.close(() => {
				console.log('[CORE] Server closed');
				process.exit(0);
			});
		});

		process.on('SIGINT', async () => {
			console.log('[CORE] SIGINT received, shutting down gracefully...');
			server.close(() => {
				console.log('[CORE] Server closed');
				process.exit(0);
			});
		});
	})();
}
