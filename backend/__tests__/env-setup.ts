import os from 'os';
import path from 'path';

/**
 * This file runs BEFORE the test framework is installed (via setupFiles in jest.config.ts).
 * It sets required environment variables so that ConfigService doesn't call process.exit(1)
 * when it's transitively imported by test modules.
 */
process.env.NODE_ENV = 'test';
process.env.ENCRYPTION_KEY = 'test-encryption-key-min12';
process.env.USER_NAME = 'testuser';
process.env.USER_PASSWORD = 'testpassword123';
// Each Jest worker must use a private data directory. Some service tests import
// src/db directly, and SQLite cannot safely switch the same database to WAL
// mode concurrently from separate worker processes.
process.env.PLUTON_DATA_DIR = path.join(
	os.tmpdir(),
	`pluton-jest-${process.pid}-${process.env.JEST_WORKER_ID || 'worker'}`
);
