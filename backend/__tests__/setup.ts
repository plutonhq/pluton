// import { drizzle } from 'drizzle-orm/better-sqlite3';
// import Database from 'better-sqlite3';
// import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import 'dotenv/config';

// The real logger writes to data/logs/app.log, the same file the dev server uses.
jest.mock('../src/utils/logger', () => {
	const pino = jest.requireActual('pino');
	const silent = pino({ level: 'silent' });
	return {
		initializeLogger: jest.fn(),
		logger: silent,
		cronLogger: silent,
		notificationLogger: silent,
		serverLogger: silent,
		StorageLogger: silent,
		SystemLogger: silent,
		DeviceLogger: jest.fn(() => silent),
		planLogger: jest.fn(() => silent),
	};
});

// Mock templateLoader globally to avoid import.meta.url issues in Jest
jest.mock('../src/notifications/templateLoader', () => ({
	loadTemplate: jest.fn().mockReturnValue('<html>{{content}}</html>'),
	loadEmailWrapperTemplate: jest
		.fn()
		.mockReturnValue('<html><body>{{EMAIL_BODY_CONTENT}}</body></html>'),
	loadBackupTemplate: jest.fn().mockReturnValue('<div>Backup template</div>'),
}));

// import.meta does not work under Jest
jest.mock('../src/utils/snapshotIndex/workerLocator', () => ({
	getSnapshotIndexWorker: jest.fn(),
}));

beforeAll(() => {
	console.log('--- JEST SETUP FILE IS RUNNING ---');

	// Create an in-memory SQLite database for testing
	// const sqlite = new Database(':memory:');
	// const db = drizzle(sqlite);

	// Run migrations to set up the schema
	// migrate(db, { migrationsFolder: './drizzle' });

	// might need to mock the main 'db' export to use this test instance.
	// Jest's module mocking capabilities are perfect for this.
});
