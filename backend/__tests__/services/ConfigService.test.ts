import * as fs from 'fs';

// Create mock functions
const mockExistsSync = jest.fn() as jest.MockedFunction<typeof fs.existsSync>;
const mockReadFileSync = jest.fn() as jest.MockedFunction<typeof fs.readFileSync>;
const mockWriteFileSync = jest.fn();
const mockMkdirSync = jest.fn();
const mockGetConfigDir = jest.fn() as jest.MockedFunction<() => string>;
const mockGetDataDir = jest.fn() as jest.MockedFunction<() => string>;
const mockGetEncEnvFilePath = jest.fn() as jest.MockedFunction<() => string>;
const mockDotenvConfig = jest.fn();

// Mock fs module
jest.mock('fs', () => ({
	...jest.requireActual<typeof fs>('fs'),
	existsSync: mockExistsSync,
	readFileSync: mockReadFileSync,
	writeFileSync: mockWriteFileSync,
	mkdirSync: mockMkdirSync,
}));

// Mock AppPaths
jest.mock('../../src/utils/AppPaths', () => ({
	appPaths: {
		getConfigDir: mockGetConfigDir,
		getDataDir: mockGetDataDir,
		getEncEnvFilePath: mockGetEncEnvFilePath,
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
		mockWriteFileSync.mockReset();
		mockMkdirSync.mockReset();
		mockDotenvConfig.mockReset();
		mockGetConfigDir.mockReset();
		mockGetDataDir.mockReset();
		mockGetEncEnvFilePath.mockReset();

		// Mock appPaths to return a predictable directory
		mockGetConfigDir.mockReturnValue('/fake/config/dir');
		mockGetDataDir.mockReturnValue('/fake/data/dir');
		mockGetEncEnvFilePath.mockReturnValue('/fake/data/dir/pluton.enc.env');

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

	it('should derive default APP_URL from SERVER_PORT when APP_URL is not set', async () => {
		process.env = { ...validBaseEnv, NODE_ENV: 'production', SERVER_PORT: '8080' };
		mockExistsSync.mockReturnValue(false);

		const { configService } = await import('../../src/services/ConfigService');

		expect(configService.config.APP_URL).toBe('http://localhost:8080');
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

	it('should read "false" in boolean env flags as false', async () => {
		process.env = {
			...validBaseEnv,
			NODE_ENV: 'production',
			ALLOW_FILE_BROWSER: 'false',
			ALLOW_CUSTOM_RESTORE_PATH: '0',
			DISABLE_EVENT_SCRIPTS: 'true',
		};
		mockExistsSync.mockReturnValue(false);

		const { configService } = await import('../../src/services/ConfigService');

		expect(configService.config.ALLOW_FILE_BROWSER).toBe(false);
		expect(configService.config.ALLOW_CUSTOM_RESTORE_PATH).toBe(false);
		expect(configService.config.DISABLE_EVENT_SCRIPTS).toBe(true);
	});

	it('should keep env values for keys that config.json does not have', async () => {
		process.env = {
			...validBaseEnv,
			NODE_ENV: 'production',
			SERVER_PORT: '8080',
			MAX_CONCURRENT_BACKUPS: '4',
			SESSION_DURATION: '30',
			ALLOW_FILE_BROWSER: 'false',
		};
		mockExistsSync.mockReturnValue(true);
		mockReadFileSync.mockReturnValue(JSON.stringify({ APP_TITLE: 'File Title' }));

		const { configService } = await import('../../src/services/ConfigService');
		const config = configService.config;

		expect(config.APP_TITLE).toBe('File Title');
		expect(config.SERVER_PORT).toBe(8080);
		expect(config.MAX_CONCURRENT_BACKUPS).toBe(4);
		expect(config.SESSION_DURATION).toBe(30);
		expect(config.ALLOW_FILE_BROWSER).toBe(false);
		expect(config.APP_URL).toBe('http://localhost:8080');
	});

	it('should exit the process if required environment variables are missing', async () => {
		// Arrange: Deliberately omit a required variable
		process.env = {
			NODE_ENV: 'production',
			SECRET: validBaseEnv.SECRET,
			APIKEY: validBaseEnv.APIKEY,
			USER_NAME: validBaseEnv.USER_NAME,
			USER_PASSWORD: validBaseEnv.USER_PASSWORD,
			APP_TITLE: validBaseEnv.APP_TITLE,
		}; // ENCRYPTION_KEY is missing
		mockExistsSync.mockReturnValue(false);

		// Act & Assert
		await expect(import('../../src/services/ConfigService')).rejects.toThrow('process.exit called');
		expect(mockExit).toHaveBeenCalledWith(1);
		expect(mockConsoleError).toHaveBeenCalledWith(
			expect.stringContaining('Invalid environment configuration')
		);
		expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('ENCRYPTION_KEY'));
	});

	describe('CLI command invocations', () => {
		// The fail-fast exists to stop the *app* booting broken. A CLI command never boots the
		// app, and on docker/server installs the server's credentials are legitimately absent
		// from the invoking shell, so exiting here made --restore-pluton unreachable there.
		const originalArgv = process.argv;
		afterEach(() => {
			process.argv = originalArgv;
		});

		it.each([['--restore-pluton'], ['--reset-password']])(
			'does not exit when credentials are missing but %s was passed',
			async flag => {
				process.env = { NODE_ENV: 'production' };
				process.argv = ['node', 'pluton', flag];
				mockExistsSync.mockReturnValue(false);

				const { configService } = await import('../../src/services/ConfigService');

				expect(mockExit).not.toHaveBeenCalled();
				expect(configService.isSetupPending()).toBe(true);
			}
		);

		it('still exposes SERVER_PORT, which the restore guard probes', async () => {
			process.env = { NODE_ENV: 'production', SERVER_PORT: '8080' };
			process.argv = ['node', 'pluton', '--restore-pluton', './b.pluton'];
			mockExistsSync.mockReturnValue(false);

			const { configService } = await import('../../src/services/ConfigService');

			expect(configService.config.SERVER_PORT).toBe(8080);
		});

		it('reproduces the docker restore command: only PLUTON_ENCRYPTION_KEY is passed', async () => {
			// Design doc 5.6 passes the key and nothing else. Before the escape hatch this
			// exited 1 during import and the restore was impossible on docker.
			process.env = {
				NODE_ENV: 'production',
				IS_DOCKER: 'true',
				PLUTON_ENCRYPTION_KEY: 'a-real-encryption-key-123',
			};
			process.argv = ['node', 'pluton', '--restore-pluton', '/tmp/blob'];
			mockExistsSync.mockReturnValue(false);

			await import('../../src/services/ConfigService');

			expect(mockExit).not.toHaveBeenCalled();
		});

		it('STILL fail-fasts for a real server boot with no CLI flag', async () => {
			// The guard must only be scoped, never weakened.
			process.env = { NODE_ENV: 'production' };
			process.argv = ['node', 'pluton'];
			mockExistsSync.mockReturnValue(false);

			await expect(import('../../src/services/ConfigService')).rejects.toThrow(
				'process.exit called'
			);
			expect(mockExit).toHaveBeenCalledWith(1);
		});

		it('does not treat an unrelated flag as a CLI command', async () => {
			process.env = { NODE_ENV: 'production' };
			process.argv = ['node', 'pluton', '--verbose'];
			mockExistsSync.mockReturnValue(false);

			await expect(import('../../src/services/ConfigService')).rejects.toThrow(
				'process.exit called'
			);
		});
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
		});

		it("should return false when NODE_ENV is 'production'", async () => {
			// Arrange
			process.env = { ...validBaseEnv, NODE_ENV: 'production' };
			mockExistsSync.mockReturnValue(false);

			// Act
			const { configService } = await import('../../src/services/ConfigService');

			// Assert
			expect(configService.isDevelopment()).toBe(false);
		});
	});
});
