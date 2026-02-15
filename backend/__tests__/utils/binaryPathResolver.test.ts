import path from 'path';
import fs from 'fs';
import os from 'os';
import { getBinaryPath } from '../../src/utils/binaryPathResolver';

jest.mock('fs');
jest.mock('os');

const mockedExistsSync = fs.existsSync as jest.MockedFunction<typeof fs.existsSync>;
const mockedPlatform = os.platform as jest.MockedFunction<typeof os.platform>;
const mockedArch = os.arch as jest.MockedFunction<typeof os.arch>;

describe('getBinaryPath', () => {
	let originalAppDir: string | undefined;
	let originalPkg: any;
	let originalExecPath: string;
	let originalCwd: string;

	beforeEach(() => {
		jest.clearAllMocks();

		// Save originals
		originalAppDir = process.env.APPDIR;
		originalPkg = (process as any).pkg;
		originalExecPath = process.execPath;
		originalCwd = process.cwd();

		// Remove by default
		delete process.env.APPDIR;
		delete (process as any).pkg;

		// Default to linux-x64
		mockedPlatform.mockReturnValue('linux');
		mockedArch.mockReturnValue('x64');

		// Default: nothing exists on disk
		mockedExistsSync.mockReturnValue(false);
	});

	afterEach(() => {
		// Restore originals
		if (originalAppDir !== undefined) {
			process.env.APPDIR = originalAppDir;
		} else {
			delete process.env.APPDIR;
		}
		(process as any).pkg = originalPkg;
		Object.defineProperty(process, 'execPath', { value: originalExecPath, writable: true });
	});

	// ----------------------------------------------------------------
	// Priority 1: AppImage path ($APPDIR)
	// ----------------------------------------------------------------
	describe('Priority 1 – AppImage path', () => {
		it('returns AppImage binary path when APPDIR is set and binary exists', () => {
			process.env.APPDIR = '/tmp/.mount_App';
			mockedExistsSync.mockImplementation(p => {
				return p === path.join('/tmp/.mount_App', 'usr', 'bin', 'binaries', 'linux-x64', 'restic');
			});

			const result = getBinaryPath('restic');
			expect(result).toBe(
				path.join('/tmp/.mount_App', 'usr', 'bin', 'binaries', 'linux-x64', 'restic')
			);
		});

		it('skips AppImage path when APPDIR is set but binary does not exist', () => {
			process.env.APPDIR = '/tmp/.mount_App';
			mockedExistsSync.mockReturnValue(false);

			const result = getBinaryPath('restic');
			// Falls through to fallback (binary name)
			expect(result).toBe('restic');
		});
	});

	// ----------------------------------------------------------------
	// Priority 2: pkg-packaged executable
	// ----------------------------------------------------------------
	describe('Priority 2 – pkg-packaged', () => {
		it('returns pkg binary path when process.pkg is set and binary exists', () => {
			(process as any).pkg = {};
			Object.defineProperty(process, 'execPath', { value: '/opt/app/myapp', writable: true });

			const expectedPath = path.join('/opt/app', 'binaries', 'linux-x64', 'rclone');
			mockedExistsSync.mockImplementation(p => p === expectedPath);

			const result = getBinaryPath('rclone');
			expect(result).toBe(expectedPath);
		});

		it('skips pkg path when process.pkg is set but binary does not exist', () => {
			(process as any).pkg = {};
			Object.defineProperty(process, 'execPath', { value: '/opt/app/myapp', writable: true });
			mockedExistsSync.mockReturnValue(false);

			const result = getBinaryPath('rclone');
			expect(result).toBe('rclone');
		});
	});

	// ----------------------------------------------------------------
	// Priority 3: Production path next to executable
	// ----------------------------------------------------------------
	describe('Priority 3 – Production path near executable', () => {
		it('returns production binary path when binary exists next to executable', () => {
			Object.defineProperty(process, 'execPath', {
				value: '/usr/local/myapp/myapp',
				writable: true,
			});

			const expectedPath = path.join('/usr/local/myapp', 'restic');
			mockedExistsSync.mockImplementation(p => p === expectedPath);

			const result = getBinaryPath('restic');
			expect(result).toBe(expectedPath);
		});
	});

	// ----------------------------------------------------------------
	// Priority 4: Development path at cwd/binaries
	// ----------------------------------------------------------------
	describe('Priority 4 – Development path', () => {
		it('returns dev binary path when binary exists in cwd/binaries', () => {
			const expectedPath = path.resolve(process.cwd(), 'binaries', 'linux-x64', 'rear');
			mockedExistsSync.mockImplementation(p => p === expectedPath);

			const result = getBinaryPath('rear');
			expect(result).toBe(expectedPath);
		});
	});

	// ----------------------------------------------------------------
	// Priority 5: Standard system paths
	// ----------------------------------------------------------------
	describe('Priority 5 – Standard system paths', () => {
		it('returns /usr/local/bin path when binary exists there', () => {
			const expectedPath = path.join('/usr/local/bin', 'restic');
			mockedExistsSync.mockImplementation(p => p === expectedPath);

			const result = getBinaryPath('restic');
			expect(result).toBe(expectedPath);
		});

		it('returns /usr/bin path when binary exists there but not in /usr/local/bin', () => {
			const expectedPath = path.join('/usr/bin', 'restic');
			mockedExistsSync.mockImplementation(p => p === expectedPath);

			const result = getBinaryPath('restic');
			expect(result).toBe(expectedPath);
		});

		it('returns /bin path when binary exists only there', () => {
			const expectedPath = path.join('/bin', 'rclone');
			mockedExistsSync.mockImplementation(p => p === expectedPath);

			const result = getBinaryPath('rclone');
			expect(result).toBe(expectedPath);
		});
	});

	// ----------------------------------------------------------------
	// Fallback: returns just the binary name
	// ----------------------------------------------------------------
	describe('Fallback', () => {
		it('returns just the binary name when no path matches', () => {
			mockedExistsSync.mockReturnValue(false);

			expect(getBinaryPath('restic')).toBe('restic');
			expect(getBinaryPath('rclone')).toBe('rclone');
			expect(getBinaryPath('rear')).toBe('rear');
		});
	});

	// ----------------------------------------------------------------
	// Windows: .exe extension
	// ----------------------------------------------------------------
	describe('Windows .exe extension', () => {
		beforeEach(() => {
			mockedPlatform.mockReturnValue('win32');
			mockedArch.mockReturnValue('x64');
		});

		it('appends .exe on Windows for AppImage path', () => {
			process.env.APPDIR = 'C:\\AppImage';
			const expectedPath = path.join(
				'C:\\AppImage',
				'usr',
				'bin',
				'binaries',
				'win32-x64',
				'restic.exe'
			);
			mockedExistsSync.mockImplementation(p => p === expectedPath);

			const result = getBinaryPath('restic');
			expect(result).toBe(expectedPath);
		});

		it('appends .exe on Windows for pkg path', () => {
			(process as any).pkg = {};
			Object.defineProperty(process, 'execPath', {
				value: 'C:\\Program Files\\app\\app.exe',
				writable: true,
			});

			const expectedPath = path.join(
				'C:\\Program Files\\app',
				'binaries',
				'win32-x64',
				'rclone.exe'
			);
			mockedExistsSync.mockImplementation(p => p === expectedPath);

			const result = getBinaryPath('rclone');
			expect(result).toBe(expectedPath);
		});

		it('appends .exe on Windows for production path', () => {
			Object.defineProperty(process, 'execPath', { value: 'C:\\app\\myapp.exe', writable: true });

			const expectedPath = path.join('C:\\app', 'restic.exe');
			mockedExistsSync.mockImplementation(p => p === expectedPath);

			const result = getBinaryPath('restic');
			expect(result).toBe(expectedPath);
		});

		it('appends .exe on Windows for dev path', () => {
			const expectedPath = path.resolve(process.cwd(), 'binaries', 'win32-x64', 'rear.exe');
			mockedExistsSync.mockImplementation(p => p === expectedPath);

			const result = getBinaryPath('rear');
			expect(result).toBe(expectedPath);
		});

		it('returns just the binary name (without .exe) as fallback on Windows', () => {
			mockedExistsSync.mockReturnValue(false);

			expect(getBinaryPath('restic')).toBe('restic');
		});
	});

	// ----------------------------------------------------------------
	// Priority ordering: earlier matches win
	// ----------------------------------------------------------------
	describe('Priority ordering', () => {
		it('prefers AppImage over pkg when both are available', () => {
			process.env.APPDIR = '/tmp/.mount_App';
			(process as any).pkg = {};
			Object.defineProperty(process, 'execPath', { value: '/opt/app/myapp', writable: true });

			const appImagePath = path.join(
				'/tmp/.mount_App',
				'usr',
				'bin',
				'binaries',
				'linux-x64',
				'restic'
			);
			const pkgPath = path.join('/opt/app', 'binaries', 'linux-x64', 'restic');

			mockedExistsSync.mockImplementation(p => p === appImagePath || p === pkgPath);

			const result = getBinaryPath('restic');
			expect(result).toBe(appImagePath);
		});

		it('prefers pkg over production when AppImage is not set', () => {
			(process as any).pkg = {};
			Object.defineProperty(process, 'execPath', { value: '/opt/app/myapp', writable: true });

			const pkgPath = path.join('/opt/app', 'binaries', 'linux-x64', 'restic');
			const prodPath = path.join('/opt/app', 'restic');

			mockedExistsSync.mockImplementation(p => p === pkgPath || p === prodPath);

			const result = getBinaryPath('restic');
			expect(result).toBe(pkgPath);
		});

		it('prefers production over dev path', () => {
			Object.defineProperty(process, 'execPath', {
				value: '/usr/local/myapp/myapp',
				writable: true,
			});

			const prodPath = path.join('/usr/local/myapp', 'restic');
			const devPath = path.resolve(process.cwd(), 'binaries', 'linux-x64', 'restic');

			mockedExistsSync.mockImplementation(p => p === prodPath || p === devPath);

			const result = getBinaryPath('restic');
			expect(result).toBe(prodPath);
		});
	});
});
