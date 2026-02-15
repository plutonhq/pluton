import fs from 'fs';

// Mock only fs, not path or os
jest.mock('fs');

describe('AppPaths', () => {
	// Store original environment variables
	const originalEnv = process.env;
	const originalPlatform = process.platform;

	beforeEach(() => {
		// Reset mocks
		jest.clearAllMocks();

		// Reset environment
		process.env = { ...originalEnv };
		delete process.env.IS_DOCKER;
		delete process.env.PLUTON_DATA_DIR;
		delete process.env.NODE_ENV;
	});

	afterEach(() => {
		// Restore original environment
		process.env = originalEnv;
		Object.defineProperty(process, 'platform', {
			value: originalPlatform,
			configurable: true,
		});

		// Reset modules after each test
		jest.resetModules();
	});

	describe('Base Directory Determination', () => {
		it('should use process.cwd()/data in development mode', () => {
			// Arrange
			process.env.NODE_ENV = 'development';
			const mockFs = require('fs');
			mockFs.existsSync.mockReturnValue(false);
			mockFs.mkdirSync.mockImplementation(() => undefined);
			mockFs.writeFileSync.mockImplementation(() => undefined);

			// Act
			const { appPaths: freshAppPaths } = require('../../src/utils/AppPaths');

			// Assert - in dev mode it uses process.cwd() + /data
			const expectedPath = require('path').join(process.cwd(), 'data');
			expect(freshAppPaths.getBaseDir()).toBe(expectedPath);
		});

		it('should use /data when IS_DOCKER is true', () => {
			// Arrange
			process.env.IS_DOCKER = 'true';
			process.env.NODE_ENV = 'production';
			const mockFs = require('fs');
			mockFs.existsSync.mockReturnValue(false);
			mockFs.mkdirSync.mockImplementation(() => undefined);
			mockFs.writeFileSync.mockImplementation(() => undefined);

			// Act
			const { appPaths: freshAppPaths } = require('../../src/utils/AppPaths');

			// Assert
			expect(freshAppPaths.getBaseDir()).toBe('/data');
		});

		it('should use PLUTON_DATA_DIR when set', () => {
			// Arrange
			const customDir = '/custom/pluton/data';
			process.env.PLUTON_DATA_DIR = customDir;
			process.env.NODE_ENV = 'production';
			const mockFs = require('fs');
			mockFs.existsSync.mockReturnValue(false);
			mockFs.mkdirSync.mockImplementation(() => undefined);
			mockFs.writeFileSync.mockImplementation(() => undefined);

			// Act
			const { appPaths: freshAppPaths } = require('../../src/utils/AppPaths');

			// Assert
			expect(freshAppPaths.getBaseDir()).toBe(customDir);
		});

		// These Windows tests require the native path module to handle backslashes
		const windowsIt = process.platform === 'win32' ? it : it.skip;

		windowsIt('should use ProgramData on Windows', () => {
			// Arrange
			process.env.NODE_ENV = 'production';
			process.env.PROGRAMDATA = 'C:\\ProgramData';
			Object.defineProperty(process, 'platform', {
				value: 'win32',
				configurable: true,
			});
			const mockFs = require('fs');
			mockFs.existsSync.mockReturnValue(false);
			mockFs.mkdirSync.mockImplementation(() => undefined);
			mockFs.writeFileSync.mockImplementation(() => undefined);

			// Act
			const path = require('path');
			const { appPaths: freshAppPaths } = require('../../src/utils/AppPaths');

			// Assert
			const expectedPath = path.join('C:\\ProgramData', 'Pluton');
			expect(freshAppPaths.getBaseDir()).toBe(expectedPath);
		});

		windowsIt('should use default ProgramData path when PROGRAMDATA is not set on Windows', () => {
			// Arrange
			process.env.NODE_ENV = 'production';
			delete process.env.PROGRAMDATA;
			Object.defineProperty(process, 'platform', {
				value: 'win32',
				configurable: true,
			});
			const mockFs = require('fs');
			mockFs.existsSync.mockReturnValue(false);
			mockFs.mkdirSync.mockImplementation(() => undefined);
			mockFs.writeFileSync.mockImplementation(() => undefined);

			// Act
			const path = require('path');
			const { appPaths: freshAppPaths } = require('../../src/utils/AppPaths');

			// Assert
			const expectedPath = path.join('C:\\ProgramData', 'Pluton');
			expect(freshAppPaths.getBaseDir()).toBe(expectedPath);
		});

		it('should use /var/lib/pluton on macOS', () => {
			// This test only works on non-Windows platforms because AppPaths uses os.platform()
			if (originalPlatform === 'win32') {
				// On Windows, we can't properly test macOS behavior
				// Just verify it doesn't crash
				process.env.NODE_ENV = 'production';
				const mockFs = require('fs');
				mockFs.existsSync.mockReturnValue(false);
				mockFs.mkdirSync.mockImplementation(() => undefined);
				mockFs.writeFileSync.mockImplementation(() => undefined);

				expect(() => require('../../src/utils/AppPaths')).not.toThrow();
			} else {
				// Arrange
				process.env.NODE_ENV = 'production';
				Object.defineProperty(process, 'platform', {
					value: 'darwin',
					configurable: true,
				});
				const mockFs = require('fs');
				mockFs.existsSync.mockReturnValue(false);
				mockFs.mkdirSync.mockImplementation(() => undefined);
				mockFs.writeFileSync.mockImplementation(() => undefined);

				// Act
				const { appPaths: freshAppPaths } = require('../../src/utils/AppPaths');

				// Assert
				expect(freshAppPaths.getBaseDir()).toBe('/var/lib/pluton');
			}
		});

		it('should use /var/lib/pluton on Linux', () => {
			// This test only works on non-Windows platforms because AppPaths uses os.platform()
			if (originalPlatform === 'win32') {
				// On Windows, we can't properly test Linux behavior
				// Just verify it doesn't crash
				process.env.NODE_ENV = 'production';
				const mockFs = require('fs');
				mockFs.existsSync.mockReturnValue(false);
				mockFs.mkdirSync.mockImplementation(() => undefined);
				mockFs.writeFileSync.mockImplementation(() => undefined);

				expect(() => require('../../src/utils/AppPaths')).not.toThrow();
			} else {
				// Arrange
				process.env.NODE_ENV = 'production';
				Object.defineProperty(process, 'platform', {
					value: 'linux',
					configurable: true,
				});
				const mockFs = require('fs');
				mockFs.existsSync.mockReturnValue(false);
				mockFs.mkdirSync.mockImplementation(() => undefined);
				mockFs.writeFileSync.mockImplementation(() => undefined);

				// Act
				const { appPaths: freshAppPaths } = require('../../src/utils/AppPaths');

				// Assert
				expect(freshAppPaths.getBaseDir()).toBe('/var/lib/pluton');
			}
		});
	});

	describe('Directory Creation', () => {
		it('should create all required directories', () => {
			// Arrange
			process.env.NODE_ENV = 'production';
			process.env.IS_DOCKER = 'true';
			const mockFs = require('fs');
			mockFs.existsSync.mockReturnValue(false);
			mockFs.mkdirSync.mockImplementation(() => undefined);
			mockFs.writeFileSync.mockImplementation(() => undefined);

			// Act
			require('../../src/utils/AppPaths');

			// Assert - check that mkdirSync was called for key directories
			expect(mockFs.mkdirSync).toHaveBeenCalledWith('/data', { recursive: true });
			expect(mockFs.mkdirSync).toHaveBeenCalledWith(
				expect.stringContaining('db'),
				expect.objectContaining({ recursive: true })
			);
			expect(mockFs.mkdirSync).toHaveBeenCalledWith(
				expect.stringContaining('logs'),
				expect.objectContaining({ recursive: true })
			);
			expect(mockFs.mkdirSync).toHaveBeenCalledWith(
				expect.stringContaining('config'),
				expect.objectContaining({ recursive: true })
			);
		});

		it('should handle EEXIST error when directory already exists', () => {
			// Arrange
			process.env.IS_DOCKER = 'true';
			process.env.NODE_ENV = 'production';
			const mockFs = require('fs');
			mockFs.existsSync.mockReturnValue(false);
			mockFs.writeFileSync.mockImplementation(() => undefined);
			const eexistError: any = new Error('Directory exists');
			eexistError.code = 'EEXIST';
			mockFs.mkdirSync.mockImplementation(() => {
				throw eexistError;
			});

			// Act & Assert - should not throw
			expect(() => {
				require('../../src/utils/AppPaths');
			}).not.toThrow();
		});

		it('should throw error when directory creation fails with non-EEXIST error', () => {
			// Arrange
			process.env.IS_DOCKER = 'true';
			process.env.NODE_ENV = 'production';
			const mockFs = require('fs');
			mockFs.existsSync.mockReturnValue(false);
			const permissionError: any = new Error('Permission denied');
			permissionError.code = 'EACCES';
			mockFs.mkdirSync.mockImplementation(() => {
				throw permissionError;
			});
			const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

			// Act & Assert
			expect(() => {
				require('../../src/utils/AppPaths');
			}).toThrow('Permission denied');

			expect(consoleErrorSpy).toHaveBeenCalledWith(
				expect.stringContaining('FATAL: Could not create directory')
			);

			consoleErrorSpy.mockRestore();
		});
	});

	describe('rclone.conf Creation', () => {
		it('should create rclone.conf if it does not exist', () => {
			// Arrange
			process.env.IS_DOCKER = 'true';
			process.env.NODE_ENV = 'production';
			const mockFs = require('fs');
			mockFs.existsSync.mockReturnValue(false);
			mockFs.mkdirSync.mockImplementation(() => undefined);
			mockFs.writeFileSync.mockImplementation(() => undefined);

			// Act
			require('../../src/utils/AppPaths');

			// Assert
			expect(mockFs.writeFileSync).toHaveBeenCalledWith(
				expect.stringContaining('rclone.conf'),
				'',
				{ mode: 0o600 }
			);
		});

		it('should not create rclone.conf if it already exists', () => {
			// Arrange
			process.env.IS_DOCKER = 'true';
			process.env.NODE_ENV = 'production';
			const mockFs = require('fs');
			mockFs.existsSync.mockReturnValue(true);
			mockFs.mkdirSync.mockImplementation(() => undefined);
			mockFs.writeFileSync.mockImplementation(() => undefined);

			// Act
			require('../../src/utils/AppPaths');

			// Assert
			expect(mockFs.writeFileSync).not.toHaveBeenCalled();
		});

		it('should throw error when rclone.conf creation fails', () => {
			// Arrange
			process.env.IS_DOCKER = 'true';
			process.env.NODE_ENV = 'production';
			const mockFs = require('fs');
			mockFs.existsSync.mockReturnValue(false);
			mockFs.mkdirSync.mockImplementation(() => undefined);
			const writeError = new Error('Write failed');
			mockFs.writeFileSync.mockImplementation(() => {
				throw writeError;
			});
			const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

			// Act & Assert
			expect(() => {
				require('../../src/utils/AppPaths');
			}).toThrow('Write failed');

			expect(consoleErrorSpy).toHaveBeenCalledWith(
				expect.stringContaining('FATAL: Could not create rclone.conf')
			);

			consoleErrorSpy.mockRestore();
		});
	});

	describe('Singleton Pattern', () => {
		it('should return the same instance on multiple calls', () => {
			// Arrange
			process.env.IS_DOCKER = 'true';
			process.env.NODE_ENV = 'production';
			const mockFs = require('fs');
			mockFs.existsSync.mockReturnValue(false);
			mockFs.mkdirSync.mockImplementation(() => undefined);
			mockFs.writeFileSync.mockImplementation(() => undefined);

			// Act
			const { appPaths: instance1 } = require('../../src/utils/AppPaths');
			const { appPaths: instance2 } = require('../../src/utils/AppPaths');

			// Assert
			expect(instance1).toBe(instance2);
		});
	});

	describe('Getter Methods', () => {
		it('should return correct base directory', () => {
			process.env.IS_DOCKER = 'true';
			process.env.NODE_ENV = 'production';
			const mockFs = require('fs');
			mockFs.existsSync.mockReturnValue(false);
			mockFs.mkdirSync.mockImplementation(() => undefined);
			mockFs.writeFileSync.mockImplementation(() => undefined);

			const { appPaths: freshAppPaths } = require('../../src/utils/AppPaths');
			expect(freshAppPaths.getBaseDir()).toBe('/data');
		});

		it('should return correct data directory', () => {
			process.env.IS_DOCKER = 'true';
			process.env.NODE_ENV = 'production';
			const mockFs = require('fs');
			mockFs.existsSync.mockReturnValue(false);
			mockFs.mkdirSync.mockImplementation(() => undefined);
			mockFs.writeFileSync.mockImplementation(() => undefined);

			const { appPaths: freshAppPaths } = require('../../src/utils/AppPaths');
			expect(freshAppPaths.getDataDir()).toBe('/data');
		});

		it('should return correct db directory', () => {
			process.env.IS_DOCKER = 'true';
			process.env.NODE_ENV = 'production';
			const mockFs = require('fs');
			mockFs.existsSync.mockReturnValue(false);
			mockFs.mkdirSync.mockImplementation(() => undefined);
			mockFs.writeFileSync.mockImplementation(() => undefined);

			const path = require('path');
			const { appPaths: freshAppPaths } = require('../../src/utils/AppPaths');
			expect(freshAppPaths.getDbDir()).toBe(path.join('/data', 'db'));
		});

		it('should return correct schedules path', () => {
			process.env.IS_DOCKER = 'true';
			process.env.NODE_ENV = 'production';
			const mockFs = require('fs');
			mockFs.existsSync.mockReturnValue(false);
			mockFs.mkdirSync.mockImplementation(() => undefined);
			mockFs.writeFileSync.mockImplementation(() => undefined);

			const path = require('path');
			const { appPaths: freshAppPaths } = require('../../src/utils/AppPaths');
			expect(freshAppPaths.getSchedulesPath()).toBe(path.join('/data', 'schedules.json'));
		});

		it('should return correct logs directory', () => {
			process.env.IS_DOCKER = 'true';
			process.env.NODE_ENV = 'production';
			const mockFs = require('fs');
			mockFs.existsSync.mockReturnValue(false);
			mockFs.mkdirSync.mockImplementation(() => undefined);
			mockFs.writeFileSync.mockImplementation(() => undefined);

			const path = require('path');
			const { appPaths: freshAppPaths } = require('../../src/utils/AppPaths');
			expect(freshAppPaths.getLogsDir()).toBe(path.join('/data', 'logs'));
		});

		it('should return correct progress directory', () => {
			process.env.IS_DOCKER = 'true';
			process.env.NODE_ENV = 'production';
			const mockFs = require('fs');
			mockFs.existsSync.mockReturnValue(false);
			mockFs.mkdirSync.mockImplementation(() => undefined);
			mockFs.writeFileSync.mockImplementation(() => undefined);

			const path = require('path');
			const { appPaths: freshAppPaths } = require('../../src/utils/AppPaths');
			expect(freshAppPaths.getProgressDir()).toBe(path.join('/data', 'progress'));
		});

		it('should return correct stats directory', () => {
			process.env.IS_DOCKER = 'true';
			process.env.NODE_ENV = 'production';
			const mockFs = require('fs');
			mockFs.existsSync.mockReturnValue(false);
			mockFs.mkdirSync.mockImplementation(() => undefined);
			mockFs.writeFileSync.mockImplementation(() => undefined);

			const path = require('path');
			const { appPaths: freshAppPaths } = require('../../src/utils/AppPaths');
			expect(freshAppPaths.getStatsDir()).toBe(path.join('/data', 'stats'));
		});

		it('should return correct temp directory', () => {
			process.env.IS_DOCKER = 'true';
			process.env.NODE_ENV = 'production';
			const mockFs = require('fs');
			mockFs.existsSync.mockReturnValue(false);
			mockFs.mkdirSync.mockImplementation(() => undefined);
			mockFs.writeFileSync.mockImplementation(() => undefined);

			const path = require('path');
			const os = require('os');
			const { appPaths: freshAppPaths } = require('../../src/utils/AppPaths');
			expect(freshAppPaths.getTempDir()).toBe(path.join(os.tmpdir(), 'pluton'));
		});

		it('should return correct downloads directory', () => {
			process.env.IS_DOCKER = 'true';
			process.env.NODE_ENV = 'production';
			const mockFs = require('fs');
			mockFs.existsSync.mockReturnValue(false);
			mockFs.mkdirSync.mockImplementation(() => undefined);
			mockFs.writeFileSync.mockImplementation(() => undefined);

			const path = require('path');
			const os = require('os');
			const { appPaths: freshAppPaths } = require('../../src/utils/AppPaths');
			expect(freshAppPaths.getDownloadsDir()).toBe(path.join(os.tmpdir(), 'pluton', 'downloads'));
		});

		it('should return correct restores directory', () => {
			process.env.IS_DOCKER = 'true';
			process.env.NODE_ENV = 'production';
			const mockFs = require('fs');
			mockFs.existsSync.mockReturnValue(false);
			mockFs.mkdirSync.mockImplementation(() => undefined);
			mockFs.writeFileSync.mockImplementation(() => undefined);

			const path = require('path');
			const os = require('os');
			const { appPaths: freshAppPaths } = require('../../src/utils/AppPaths');
			expect(freshAppPaths.getRestoresDir()).toBe(path.join(os.tmpdir(), 'pluton', 'restores'));
		});

		it('should return correct sync directory', () => {
			process.env.IS_DOCKER = 'true';
			process.env.NODE_ENV = 'production';
			const mockFs = require('fs');
			mockFs.existsSync.mockReturnValue(false);
			mockFs.mkdirSync.mockImplementation(() => undefined);
			mockFs.writeFileSync.mockImplementation(() => undefined);

			const path = require('path');
			const { appPaths: freshAppPaths } = require('../../src/utils/AppPaths');
			expect(freshAppPaths.getSyncDir()).toBe(path.join('/data', 'sync'));
		});

		it('should return correct config directory', () => {
			process.env.IS_DOCKER = 'true';
			process.env.NODE_ENV = 'production';
			const mockFs = require('fs');
			mockFs.existsSync.mockReturnValue(false);
			mockFs.mkdirSync.mockImplementation(() => undefined);
			mockFs.writeFileSync.mockImplementation(() => undefined);

			const path = require('path');
			const { appPaths: freshAppPaths } = require('../../src/utils/AppPaths');
			expect(freshAppPaths.getConfigDir()).toBe(path.join('/data', 'config'));
		});

		it('should return correct rescue directory', () => {
			process.env.IS_DOCKER = 'true';
			process.env.NODE_ENV = 'production';
			const mockFs = require('fs');
			mockFs.existsSync.mockReturnValue(false);
			mockFs.mkdirSync.mockImplementation(() => undefined);
			mockFs.writeFileSync.mockImplementation(() => undefined);

			const path = require('path');
			const { appPaths: freshAppPaths } = require('../../src/utils/AppPaths');
			expect(freshAppPaths.getRescueDir()).toBe(path.join('/data', 'rescue'));
		});
	});

	describe('Priority Order', () => {
		it('should prioritize IS_DOCKER over PLUTON_DATA_DIR', () => {
			// Arrange
			process.env.NODE_ENV = 'production';
			process.env.IS_DOCKER = 'true';
			process.env.PLUTON_DATA_DIR = '/custom/dir';
			const mockFs = require('fs');
			mockFs.existsSync.mockReturnValue(false);
			mockFs.mkdirSync.mockImplementation(() => undefined);
			mockFs.writeFileSync.mockImplementation(() => undefined);

			// Act
			const { appPaths: freshAppPaths } = require('../../src/utils/AppPaths');

			// Assert
			expect(freshAppPaths.getBaseDir()).toBe('/data');
		});

		it('should prioritize PLUTON_DATA_DIR over platform defaults', () => {
			// Arrange
			process.env.NODE_ENV = 'production';
			process.env.PLUTON_DATA_DIR = '/custom/dir';
			Object.defineProperty(process, 'platform', {
				value: 'linux',
				configurable: true,
			});
			const mockFs = require('fs');
			mockFs.existsSync.mockReturnValue(false);
			mockFs.mkdirSync.mockImplementation(() => undefined);
			mockFs.writeFileSync.mockImplementation(() => undefined);

			// Act
			const { appPaths: freshAppPaths } = require('../../src/utils/AppPaths');

			// Assert
			expect(freshAppPaths.getBaseDir()).toBe('/custom/dir');
		});

		it('should prioritize development mode over all other settings', () => {
			// Arrange
			process.env.NODE_ENV = 'development';
			process.env.IS_DOCKER = 'true';
			process.env.PLUTON_DATA_DIR = '/custom/dir';
			const mockFs = require('fs');
			mockFs.existsSync.mockReturnValue(false);
			mockFs.mkdirSync.mockImplementation(() => undefined);
			mockFs.writeFileSync.mockImplementation(() => undefined);

			// Act
			const path = require('path');
			const { appPaths: freshAppPaths } = require('../../src/utils/AppPaths');

			// Assert
			const expectedPath = path.join(process.cwd(), 'data');
			expect(freshAppPaths.getBaseDir()).toBe(expectedPath);
		});
	});
});
