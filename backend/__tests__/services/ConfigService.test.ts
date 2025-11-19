import { jest, beforeEach, afterEach, describe, it, expect } from '@jest/globals';
import * as fs from 'fs';

// Create mock functions
const mockExistsSync = jest.fn<typeof fs.existsSync>();
const mockReadFileSync = jest.fn<typeof fs.readFileSync>();
const mockGetConfigDir = jest.fn<() => string>();
const mockDotenvConfig = jest.fn();

// Mock fs module
jest.mock('fs', () => ({
	...jest.requireActual<typeof fs>('fs'),
	existsSync: mockExistsSync,
	readFileSync: mockReadFileSync,
}));

// Mock AppPaths
jest.mock('../../src/utils/AppPaths', () => ({
	appPaths: {
		getConfigDir: mockGetConfigDir,
	},
}));

// Mock dotenv - must match how it's imported (default import)
jest.mock('dotenv', () => ({
	__esModule: true,
	default: {
		config: mockDotenvConfig,
	},
}));

describe('ConfigService', () => {
	let originalEnv: NodeJS.ProcessEnv;
	let mockExit: jest.SpiedFunction<typeof process.exit>;
	let mockConsoleError: jest.SpiedFunction<typeof console.error>;
	let mockConsoleLog: jest.SpiedFunction<typeof console.log>;

	// These are the minimum required variables for the config to be valid
	const validBaseEnv = {
		SECRET: 'a_very_long_and_secure_secret_key',
		ENCRYPTION_KEY: 'another_long_and_secure_encryption_key',
		APIKEY: 'this_is_a_very_long_api_key_string',
		USER_NAME: 'admin',
		USER_PASSWORD: 'password',
		APP_TITLE: 'Test App',
	};

	beforeEach(() => {
		// Backup original process.env
		originalEnv = { ...process.env };

		// Clear process.env and set to production to prevent dotenv from loading
		process.env = { NODE_ENV: 'production' };

		// Mock process.exit to throw an error instead of stopping the test runner
		mockExit = jest.spyOn(process, 'exit').mockImplementation((() => {
			throw new Error('process.exit called');
		}) as any);

		// Mock console methods to suppress logs in test output and allow spying
		mockConsoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
		mockConsoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});

		// Reset mocks
		mockExistsSync.mockReset();
		mockReadFileSync.mockReset();
		mockDotenvConfig.mockReset();
		mockGetConfigDir.mockReset();

		// Mock appPaths to return a predictable directory
		mockGetConfigDir.mockReturnValue('/fake/config/dir');

		// Clear the module cache to reset the singleton
		jest.resetModules();
	});

	afterEach(() => {
		// Restore original process.env and mocks
		process.env = originalEnv;
		jest.restoreAllMocks();
	});

	it('should load default configuration when no environment variables or config file are present', async () => {
		// Arrange: Ensure required env vars are set, but nothing optional
		process.env = { ...validBaseEnv, NODE_ENV: 'production' };
		mockExistsSync.mockReturnValue(false);

		// Act: Dynamically import the service to get a fresh instance
		const { configService } = await import('../../src/services/ConfigService');
		const config = configService.config;

		// Assert: Check for default values
		expect(config.NODE_ENV).toBe('production');
		expect(config.SERVER_PORT).toBe(5173);
		expect(config.MAX_CONCURRENT_BACKUPS).toBe(2);
		expect(config.APP_URL).toBe('http://localhost:5173');
		expect(mockExit).not.toHaveBeenCalled();
	});

	it('should load configuration from environment variables', async () => {
		// Arrange
		process.env = {
			...validBaseEnv,
			NODE_ENV: 'production',
			SERVER_PORT: '8080',
			APP_URL: 'http://test.com',
			MAX_CONCURRENT_BACKUPS: '5',
		};
		mockExistsSync.mockReturnValue(false);

		// Act
		const { configService } = await import('../../src/services/ConfigService');
		const config = configService.config;

		// Assert
		expect(config.NODE_ENV).toBe('production');
		expect(config.SERVER_PORT).toBe(8080);
		expect(config.APP_URL).toBe('http://test.com');
		expect(config.MAX_CONCURRENT_BACKUPS).toBe(5);
		expect(mockExit).not.toHaveBeenCalled();
	});

	it('should load configuration from config.json, overriding environment variables', async () => {
		// Arrange
		process.env = {
			...validBaseEnv,
			NODE_ENV: 'production',
			SERVER_PORT: '8080',
			APP_TITLE: 'Env Title',
		};

		const mockConfigFile = {
			SERVER_PORT: 9090,
			APP_TITLE: 'File Title',
			MAX_CONCURRENT_BACKUPS: 10,
		};

		mockExistsSync.mockReturnValue(true);
		mockReadFileSync.mockReturnValue(JSON.stringify(mockConfigFile));

		// Act
		const { configService } = await import('../../src/services/ConfigService');
		const config = configService.config;

		// Assert
		expect(config.SERVER_PORT).toBe(9090);
		expect(config.APP_TITLE).toBe('File Title');
		expect(config.MAX_CONCURRENT_BACKUPS).toBe(10);
		expect(mockExit).not.toHaveBeenCalled();
	});

	it('should exit the process if required environment variables are missing', async () => {
		// Arrange: Deliberately omit a required variable
		process.env = {
			NODE_ENV: 'production',
			ENCRYPTION_KEY: validBaseEnv.ENCRYPTION_KEY,
			APIKEY: validBaseEnv.APIKEY,
			USER_NAME: validBaseEnv.USER_NAME,
			USER_PASSWORD: validBaseEnv.USER_PASSWORD,
			APP_TITLE: validBaseEnv.APP_TITLE,
		}; // SECRET is missing
		mockExistsSync.mockReturnValue(false);

		// Act & Assert
		await expect(import('../../src/services/ConfigService')).rejects.toThrow('process.exit called');
		expect(mockExit).toHaveBeenCalledWith(1);
		expect(mockConsoleError).toHaveBeenCalledWith(
			expect.stringContaining('Invalid environment configuration')
		);
		expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('SECRET'));
	});

	it('should exit the process for invalid data types', async () => {
		// Arrange
		process.env = {
			...validBaseEnv,
			NODE_ENV: 'production',
			SERVER_PORT: 'not-a-number',
		};
		mockExistsSync.mockReturnValue(false);

		// Act & Assert
		await expect(import('../../src/services/ConfigService')).rejects.toThrow();
	});

	it('should log an error and use defaults/env if config.json is invalid JSON', async () => {
		// Arrange
		process.env = { ...validBaseEnv, NODE_ENV: 'production', APP_TITLE: 'From Env' };
		mockExistsSync.mockReturnValue(true);
		mockReadFileSync.mockReturnValue("{ 'bad-json': true, }");

		// Act
		const { configService } = await import('../../src/services/ConfigService');
		const config = configService.config;

		// Assert
		expect(config.APP_TITLE).toBe('From Env');
		expect(mockExit).not.toHaveBeenCalled();
		expect(mockConsoleLog).toHaveBeenCalledWith(
			expect.stringContaining('Could not load or parse config.json')
		);
	});

	it('should ignore extra fields in config.json', async () => {
		// Arrange
		process.env = { ...validBaseEnv, NODE_ENV: 'production' };
		const mockConfigFile = {
			APP_TITLE: 'Valid Title',
			some_unknown_field: 'should be ignored',
		};
		mockExistsSync.mockReturnValue(true);
		mockReadFileSync.mockReturnValue(JSON.stringify(mockConfigFile));

		// Act
		const { configService } = await import('../../src/services/ConfigService');
		const config = configService.config;

		// Assert
		expect(config.APP_TITLE).toBe('Valid Title');
		expect(config).not.toHaveProperty('some_unknown_field');
		expect(mockExit).not.toHaveBeenCalled();
	});

	describe('isDevelopment', () => {
		it("should return true when NODE_ENV is 'development'", async () => {
			// Arrange
			process.env = { ...validBaseEnv, NODE_ENV: 'development' };
			mockExistsSync.mockReturnValue(false);

			// Act
			const { configService } = await import('../../src/services/ConfigService');

			// Assert
			expect(configService.isDevelopment()).toBe(true);
			// Verify dotenv.config() was called in development mode
			expect(mockDotenvConfig).toHaveBeenCalled();
		});

		it("should return false when NODE_ENV is 'production'", async () => {
			// Arrange
			process.env = { ...validBaseEnv, NODE_ENV: 'production' };
			mockExistsSync.mockReturnValue(false);

			// Act
			const { configService } = await import('../../src/services/ConfigService');

			// Assert
			expect(configService.isDevelopment()).toBe(false);
			// Verify dotenv.config() was NOT called in production mode
			expect(mockDotenvConfig).not.toHaveBeenCalled();
		});
	});
});
