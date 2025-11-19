// Set up environment variables FIRST, before any imports
process.env.APP_TITLE = 'Pluton Test';
process.env.SECRET = 'test-secret-key-12345';
process.env.ENCRYPTION_KEY = 'test-encryption-key-12345';
process.env.APIKEY = 'test-api-key-12345';
process.env.USER_NAME = 'testUser';
process.env.USER_PASSWORD = 'testPassword';
process.env.NODE_ENV = 'test';

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import si from 'systeminformation';

// Mock all dependencies BEFORE importing modules that use them
jest.mock('fs/promises');
jest.mock('fs'); // Add this to mock synchronous fs operations
jest.mock('os');
jest.mock('path');
jest.mock('systeminformation');
jest.mock('../../src/utils/versions');
jest.mock('../../src/managers/BaseStorageManager');
jest.mock('../../src/services/ConfigService');
jest.mock('../../src/managers/SecurityKeyManager');

// Mock fs.mkdirSync before AppPaths is imported
const fsMock = require('fs');
fsMock.mkdirSync = jest.fn();
fsMock.existsSync = jest.fn().mockReturnValue(true);

// Mock path methods before imports
(path.join as jest.Mock) = jest.fn((...args) => args.join('/'));
(path.resolve as jest.Mock) = jest.fn((...args) => args.join('/'));

// Now import modules that depend on AppPaths
jest.mock('../../src/utils/AppPaths', () => ({
	appPaths: {
		getDataDir: jest.fn().mockReturnValue('/data'),
		getTempDir: jest.fn().mockReturnValue('/tmp/pluton'),
		getBaseDir: jest.fn().mockReturnValue('/data'),
		getDbDir: jest.fn().mockReturnValue('/data/db'),
		getSchedulesPath: jest.fn().mockReturnValue('/data/schedules'),
		getLogsDir: jest.fn().mockReturnValue('/data/logs'),
		getProgressDir: jest.fn().mockReturnValue('/data/progress'),
		getStatsDir: jest.fn().mockReturnValue('/data/stats'),
		getDownloadsDir: jest.fn().mockReturnValue('/data/downloads'),
		getRestoresDir: jest.fn().mockReturnValue('/data/restores'),
		getSyncDir: jest.fn().mockReturnValue('/data/sync'),
		getConfigDir: jest.fn().mockReturnValue('/data/config'),
		getRescueDir: jest.fn().mockReturnValue('/data/rescue'),
	},
}));

import { initSetup, runInitialSetup } from '../../src/utils/initSetup';
import { settings } from '../../src/db/schema/settings';
import { storages } from '../../src/db/schema/storages';
import { devices } from '../../src/db/schema/devices';
import { BaseStorageManager } from '../../src/managers/BaseStorageManager';
import { getRcloneVersion, getResticVersion } from '../../src/utils/versions';
import { configService } from '../../src/services/ConfigService';
import { appPaths } from '../../src/utils/AppPaths';
import { securityKeyManager } from '../../src/managers/SecurityKeyManager';

describe('initSetup', () => {
	let mockDb: any;
	const setupCompletePath = '/data/.setup_complete';

	beforeEach(() => {
		jest.clearAllMocks();

		// Mock database methods
		mockDb = {
			select: jest.fn().mockReturnThis(),
			from: jest.fn().mockReturnThis(),
			where: jest.fn().mockReturnThis(),
			get: jest.fn(),
			insert: jest.fn().mockReturnThis(),
			values: jest.fn(),
		};

		// Mock appPaths
		(appPaths.getDataDir as jest.Mock).mockReturnValue('/data');
		(appPaths.getTempDir as jest.Mock).mockReturnValue('/tmp/pluton');

		// Mock path.join
		(path.join as jest.Mock).mockImplementation((...args) => args.join('/'));

		// Mock console.log to reduce noise
		jest.spyOn(console, 'log').mockImplementation();
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	describe('when setup is already complete', () => {
		it('should skip setup if .setup_complete file exists', async () => {
			// Arrange
			(fs.access as jest.Mock).mockResolvedValue(undefined);

			// Act
			await initSetup(mockDb);

			// Assert
			expect(fs.access).toHaveBeenCalledWith(setupCompletePath);
			expect(console.log).toHaveBeenCalledWith('[INIT] Setup already completed. Skipping.');
			expect(mockDb.select).not.toHaveBeenCalled();
		});
	});

	describe('when setup is not complete', () => {
		beforeEach(() => {
			// Mock fs.access to throw error (file doesn't exist)
			(fs.access as jest.Mock).mockRejectedValue(new Error('File not found'));
			(fs.writeFile as jest.Mock).mockResolvedValue(undefined);
		});

		it('should run initial setup when .setup_complete file does not exist', async () => {
			// Arrange
			mockDb.get.mockResolvedValue(null);
			mockDb.values.mockResolvedValue(undefined);

			(securityKeyManager.setupInitialKeys as jest.Mock).mockResolvedValue(undefined);
			(getResticVersion as jest.Mock).mockReturnValue('0.16.0');
			(getRcloneVersion as jest.Mock).mockReturnValue('1.64.0');
			(os.hostname as jest.Mock).mockReturnValue('test-hostname');
			(os.platform as jest.Mock).mockReturnValue('linux');
			(si.osInfo as jest.Mock).mockResolvedValue({ distro: 'Ubuntu', release: '22.04' });
			(configService.config as any) = { APP_TITLE: 'Pluton' };

			const mockStorageManager = {
				createRemote: jest.fn().mockResolvedValue({ success: true }),
			};
			(BaseStorageManager as jest.Mock).mockImplementation(() => mockStorageManager);

			// Act
			await initSetup(mockDb);

			// Assert
			expect(console.log).toHaveBeenCalledWith(
				'[INIT] First run detected. Starting initial setup...'
			);
			expect(securityKeyManager.setupInitialKeys).toHaveBeenCalled();
			expect(fs.writeFile).toHaveBeenCalledWith(setupCompletePath, expect.any(String));
			expect(console.log).toHaveBeenCalledWith('[INIT] Initial setup complete.');
		});

		it('should create the .setup_complete file with current timestamp', async () => {
			// Arrange
			mockDb.get.mockResolvedValue(null);
			mockDb.values.mockResolvedValue(undefined);

			(securityKeyManager.setupInitialKeys as jest.Mock).mockResolvedValue(undefined);
			(getResticVersion as jest.Mock).mockReturnValue('0.16.0');
			(getRcloneVersion as jest.Mock).mockReturnValue('1.64.0');
			(os.hostname as jest.Mock).mockReturnValue('test-hostname');
			(os.platform as jest.Mock).mockReturnValue('linux');
			(si.osInfo as jest.Mock).mockResolvedValue({ distro: 'Ubuntu', release: '22.04' });
			(configService.config as any) = { APP_TITLE: 'Pluton' };

			const mockStorageManager = {
				createRemote: jest.fn().mockResolvedValue({ success: true }),
			};
			(BaseStorageManager as jest.Mock).mockImplementation(() => mockStorageManager);

			const beforeDate = new Date();

			// Act
			await initSetup(mockDb);

			// Assert
			const afterDate = new Date();
			expect(fs.writeFile).toHaveBeenCalledWith(setupCompletePath, expect.any(String));

			const writtenValue = (fs.writeFile as jest.Mock).mock.calls[0][1];
			const writtenDate = new Date(writtenValue);

			expect(writtenDate.getTime()).toBeGreaterThanOrEqual(beforeDate.getTime());
			expect(writtenDate.getTime()).toBeLessThanOrEqual(afterDate.getTime());
		});
	});
});

describe('runInitialSetup', () => {
	let mockDb: any;

	beforeEach(() => {
		jest.clearAllMocks();

		mockDb = {
			select: jest.fn().mockReturnThis(),
			from: jest.fn().mockReturnThis(),
			where: jest.fn().mockReturnThis(),
			get: jest.fn(),
			insert: jest.fn().mockReturnThis(),
			values: jest.fn(),
		};

		(appPaths.getTempDir as jest.Mock).mockReturnValue('/tmp/pluton');
		(path.join as jest.Mock).mockImplementation((...args) => args.join('/'));
		jest.spyOn(console, 'log').mockImplementation();
	});

	describe('setupInitialKeys', () => {
		it('should call securityKeyManager.setupInitialKeys', async () => {
			// Arrange
			mockDb.get.mockResolvedValue(null);
			mockDb.values.mockResolvedValue(undefined);

			(securityKeyManager.setupInitialKeys as jest.Mock).mockResolvedValue(undefined);
			(getResticVersion as jest.Mock).mockReturnValue('0.16.0');
			(getRcloneVersion as jest.Mock).mockReturnValue('1.64.0');
			(os.hostname as jest.Mock).mockReturnValue('test-hostname');
			(os.platform as jest.Mock).mockReturnValue('linux');
			(si.osInfo as jest.Mock).mockResolvedValue({ distro: 'Ubuntu', release: '22.04' });
			(configService.config as any) = { APP_TITLE: 'Pluton' };

			const mockStorageManager = {
				createRemote: jest.fn().mockResolvedValue({ success: true }),
			};
			(BaseStorageManager as jest.Mock).mockImplementation(() => mockStorageManager);

			// Act
			await runInitialSetup(mockDb);

			// Assert
			expect(securityKeyManager.setupInitialKeys).toHaveBeenCalled();
		});
	});

	describe('createMainDevice', () => {
		beforeEach(() => {
			(securityKeyManager.setupInitialKeys as jest.Mock).mockResolvedValue(undefined);
			(configService.config as any) = { APP_TITLE: 'Pluton' };
		});

		it('should create main device if it does not exist', async () => {
			// Arrange
			mockDb.get.mockResolvedValue(null);
			mockDb.values.mockResolvedValue(undefined);

			(getResticVersion as jest.Mock).mockReturnValue('0.16.0');
			(getRcloneVersion as jest.Mock).mockReturnValue('1.64.0');
			(os.hostname as jest.Mock).mockReturnValue('test-hostname');
			(os.platform as jest.Mock).mockReturnValue('linux');
			(si.osInfo as jest.Mock).mockResolvedValue({ distro: 'Ubuntu', release: '22.04' });

			const mockStorageManager = {
				createRemote: jest.fn().mockResolvedValue({ success: true }),
			};
			(BaseStorageManager as jest.Mock).mockImplementation(() => mockStorageManager);

			// Act
			await runInitialSetup(mockDb);

			// Assert
			expect(mockDb.insert).toHaveBeenCalledWith(devices);
			expect(mockDb.values).toHaveBeenCalledWith({
				id: 'main',
				agentId: 'main',
				name: 'test-hostname',
				ip: '127.0.0.1',
				hostname: 'test-hostname',
				platform: 'linux',
				os: 'Ubuntu 22.04',
				versions: {
					restic: '0.16.0',
					rclone: '1.64.0',
					agent: '',
				},
				status: 'active',
				lastSeen: expect.any(Date),
				settings: { tempDir: '/tmp/pluton' },
			});
		});

		it('should not create main device if it already exists', async () => {
			// Arrange
			const existingDevice = { id: 'main', name: 'existing' };
			mockDb.get.mockResolvedValueOnce(existingDevice).mockResolvedValue(null);
			mockDb.values.mockResolvedValue(undefined);

			const mockStorageManager = {
				createRemote: jest.fn().mockResolvedValue({ success: true }),
			};
			(BaseStorageManager as jest.Mock).mockImplementation(() => mockStorageManager);

			// Act
			await runInitialSetup(mockDb);

			// Assert
			expect(mockDb.insert).toHaveBeenCalledTimes(2); // Only for storages and settings
			expect(mockDb.insert).not.toHaveBeenCalledWith(devices);
		});

		it('should correctly detect system information', async () => {
			// Arrange
			mockDb.get.mockResolvedValue(null);
			mockDb.values.mockResolvedValue(undefined);

			(getResticVersion as jest.Mock).mockReturnValue('0.17.0');
			(getRcloneVersion as jest.Mock).mockReturnValue('1.65.0');
			(os.hostname as jest.Mock).mockReturnValue('production-server');
			(os.platform as jest.Mock).mockReturnValue('darwin');
			(si.osInfo as jest.Mock).mockResolvedValue({ distro: 'macOS', release: '13.0' });

			const mockStorageManager = {
				createRemote: jest.fn().mockResolvedValue({ success: true }),
			};
			(BaseStorageManager as jest.Mock).mockImplementation(() => mockStorageManager);

			// Act
			await runInitialSetup(mockDb);

			// Assert
			expect(mockDb.values).toHaveBeenCalledWith(
				expect.objectContaining({
					hostname: 'production-server',
					platform: 'darwin',
					os: 'macOS 13.0',
					versions: {
						restic: '0.17.0',
						rclone: '1.65.0',
						agent: '',
					},
				})
			);
		});
	});

	describe('createLocalStorage', () => {
		beforeEach(() => {
			(securityKeyManager.setupInitialKeys as jest.Mock).mockResolvedValue(undefined);
			(getResticVersion as jest.Mock).mockReturnValue('0.16.0');
			(getRcloneVersion as jest.Mock).mockReturnValue('1.64.0');
			(os.hostname as jest.Mock).mockReturnValue('test-hostname');
			(os.platform as jest.Mock).mockReturnValue('linux');
			(si.osInfo as jest.Mock).mockResolvedValue({ distro: 'Ubuntu', release: '22.04' });
			(configService.config as any) = { APP_TITLE: 'Pluton' };
		});

		it('should create local storage if it does not exist', async () => {
			// Arrange
			mockDb.get.mockResolvedValue(null);
			mockDb.values.mockResolvedValue(undefined);

			const mockStorageManager = {
				createRemote: jest.fn().mockResolvedValue({ success: true }),
			};
			(BaseStorageManager as jest.Mock).mockImplementation(() => mockStorageManager);

			// Act
			await runInitialSetup(mockDb);

			// Assert
			expect(console.log).toHaveBeenCalledWith('Create Local Storage!');
			expect(mockDb.insert).toHaveBeenCalledWith(storages);
			expect(mockDb.values).toHaveBeenCalledWith({
				id: 'local',
				name: 'Local Storage',
				type: 'local',
				settings: {},
				credentials: {},
				authType: 'none',
				tags: [],
			});
		});

		it('should create rclone remote for local storage', async () => {
			// Arrange
			mockDb.get.mockResolvedValue(null);
			mockDb.values.mockResolvedValue(undefined);

			const mockStorageManager = {
				createRemote: jest.fn().mockResolvedValue({ success: true }),
			};
			(BaseStorageManager as jest.Mock).mockImplementation(() => mockStorageManager);

			// Act
			await runInitialSetup(mockDb);

			// Assert
			expect(console.log).toHaveBeenCalledWith('Create Rclone Local Storage!');
			expect(BaseStorageManager).toHaveBeenCalled();
			expect(mockStorageManager.createRemote).toHaveBeenCalledWith(
				'local',
				'local',
				'none',
				{},
				{}
			);
		});

		it('should not create local storage if it already exists', async () => {
			// Arrange
			const existingStorage = { id: 'local', name: 'Local Storage' };
			mockDb.get
				.mockResolvedValueOnce(null)
				.mockResolvedValueOnce(existingStorage)
				.mockResolvedValue(null);
			mockDb.values.mockResolvedValue(undefined);

			// Act
			await runInitialSetup(mockDb);

			// Assert
			expect(mockDb.insert).toHaveBeenCalledTimes(2); // Only for devices and settings
			expect(mockDb.insert).not.toHaveBeenCalledWith(storages);
		});

		it('should handle errors when creating rclone remote', async () => {
			// Arrange
			mockDb.get.mockResolvedValue(null);
			mockDb.values.mockResolvedValue(undefined);

			const mockError = new Error('Rclone failed');
			const mockStorageManager = {
				createRemote: jest.fn().mockRejectedValue(mockError),
			};
			(BaseStorageManager as jest.Mock).mockImplementation(() => mockStorageManager);

			// Act
			await runInitialSetup(mockDb);

			// Assert
			expect(console.log).toHaveBeenCalledWith('[Error] creating Local Storage:', mockError);
			// Should not throw, just log the error
		});
	});

	describe('createDefaultSettings', () => {
		beforeEach(() => {
			(securityKeyManager.setupInitialKeys as jest.Mock).mockResolvedValue(undefined);
			(getResticVersion as jest.Mock).mockReturnValue('0.16.0');
			(getRcloneVersion as jest.Mock).mockReturnValue('1.64.0');
			(os.hostname as jest.Mock).mockReturnValue('test-hostname');
			(os.platform as jest.Mock).mockReturnValue('linux');
			(si.osInfo as jest.Mock).mockResolvedValue({ distro: 'Ubuntu', release: '22.04' });
		});

		it('should create default settings if they do not exist', async () => {
			// Arrange
			mockDb.get.mockResolvedValue(null);
			mockDb.values.mockResolvedValue(undefined);
			(configService.config as any) = { APP_TITLE: 'Custom Title' };

			const mockStorageManager = {
				createRemote: jest.fn().mockResolvedValue({ success: true }),
			};
			(BaseStorageManager as jest.Mock).mockImplementation(() => mockStorageManager);

			// Act
			await runInitialSetup(mockDb);

			// Assert
			expect(mockDb.insert).toHaveBeenCalledWith(settings);
			expect(mockDb.values).toHaveBeenCalledWith({
				settings: {
					theme: 'auto',
					admin_email: '',
					integration: {},
					totp: { enabled: false, secret: '', recoveryCodes: [] },
					reporting: {
						emails: [],
						time: '20:00',
						daily: { enabled: false },
						weekly: { enabled: false },
						monthly: { enabled: false },
					},
					title: 'Custom Title',
					description: 'Pluton backup for your data.',
				},
			});
		});

		it('should use default title if APP_TITLE is not configured', async () => {
			// Arrange
			mockDb.get.mockResolvedValue(null);
			mockDb.values.mockResolvedValue(undefined);
			(configService.config as any) = {};

			const mockStorageManager = {
				createRemote: jest.fn().mockResolvedValue({ success: true }),
			};
			(BaseStorageManager as jest.Mock).mockImplementation(() => mockStorageManager);

			// Act
			await runInitialSetup(mockDb);

			// Assert
			expect(mockDb.values).toHaveBeenCalledWith(
				expect.objectContaining({
					settings: expect.objectContaining({
						title: 'Pluton',
					}),
				})
			);
		});

		it('should not create default settings if they already exist', async () => {
			// Arrange
			const existingSettings = { id: 1, settings: {} };
			mockDb.get
				.mockResolvedValueOnce(null)
				.mockResolvedValueOnce(null)
				.mockResolvedValueOnce(existingSettings);
			mockDb.values.mockResolvedValue(undefined);
			(configService.config as any) = { APP_TITLE: 'Pluton' };

			const mockStorageManager = {
				createRemote: jest.fn().mockResolvedValue({ success: true }),
			};
			(BaseStorageManager as jest.Mock).mockImplementation(() => mockStorageManager);

			// Act
			await runInitialSetup(mockDb);

			// Assert
			expect(mockDb.insert).toHaveBeenCalledTimes(2); // Only for devices and storages
			expect(mockDb.insert).not.toHaveBeenCalledWith(settings);
		});
	});

	describe('execution order', () => {
		it('should execute setup steps in correct order', async () => {
			// Arrange
			const callOrder: string[] = [];

			mockDb.get.mockResolvedValue(null);
			mockDb.values.mockResolvedValue(undefined);

			(securityKeyManager.setupInitialKeys as jest.Mock).mockImplementation(() => {
				callOrder.push('setupInitialKeys');
				return Promise.resolve();
			});

			(si.osInfo as jest.Mock).mockImplementation(() => {
				callOrder.push('createMainDevice');
				return Promise.resolve({ distro: 'Ubuntu', release: '22.04' });
			});

			const mockStorageManager = {
				createRemote: jest.fn().mockImplementation(() => {
					callOrder.push('createLocalStorage');
					return Promise.resolve({ success: true });
				}),
			};
			(BaseStorageManager as jest.Mock).mockImplementation(() => mockStorageManager);

			// Override mockDb.insert to track when settings are created
			mockDb.insert = jest.fn().mockImplementation((table: any) => {
				if (table === settings) {
					callOrder.push('createDefaultSettings');
				}
				// Return the mock object to allow chaining
				return {
					values: mockDb.values,
				};
			});

			(getResticVersion as jest.Mock).mockReturnValue('0.16.0');
			(getRcloneVersion as jest.Mock).mockReturnValue('1.64.0');
			(os.hostname as jest.Mock).mockReturnValue('test-hostname');
			(os.platform as jest.Mock).mockReturnValue('linux');
			(configService.config as any) = { APP_TITLE: 'Pluton' };

			// Act
			await runInitialSetup(mockDb);

			// Assert
			expect(callOrder).toEqual([
				'setupInitialKeys',
				'createMainDevice',
				'createLocalStorage',
				'createDefaultSettings',
			]);
		});
	});
});
