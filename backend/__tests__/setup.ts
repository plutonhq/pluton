// import { drizzle } from 'drizzle-orm/better-sqlite3';
// import Database from 'better-sqlite3';
// import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { initializeLogger } from '../src/utils/logger';

beforeAll(() => {
	console.log('--- JEST SETUP FILE IS RUNNING ---');
	//initialize logger
	initializeLogger();

	// Create an in-memory SQLite database for testing
	// const sqlite = new Database(':memory:');
	// const db = drizzle(sqlite);

	// Run migrations to set up the schema
	// migrate(db, { migrationsFolder: './drizzle' });

	// might need to mock the main 'db' export to use this test instance.
	// Jest's module mocking capabilities are perfect for this.
});
