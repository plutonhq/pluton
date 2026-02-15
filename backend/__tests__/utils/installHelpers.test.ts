import {
	isBinaryMode,
	isDockerMode,
	getInstallType,
	isLinuxDesktop,
	isKeyringPlatform,
	requiresKeyringSetup,
} from '../../src/utils/installHelpers';

describe('installHelpers', () => {
	const originalPlatform = process.platform;
	const originalEnv = { ...process.env };
	const originalPkg = (process as any).pkg;

	afterEach(() => {
		Object.defineProperty(process, 'platform', { value: originalPlatform });
		process.env = { ...originalEnv };
		if (originalPkg !== undefined) {
			(process as any).pkg = originalPkg;
		} else {
			delete (process as any).pkg;
		}
	});

	describe('isBinaryMode', () => {
		it('should return true when process.pkg is set', () => {
			(process as any).pkg = { entrypoint: '/snapshot/app/index.js' };
			expect(isBinaryMode()).toBe(true);
		});

		it('should return false when process.pkg is not set', () => {
			delete (process as any).pkg;
			expect(isBinaryMode()).toBe(false);
		});

		it('should return false when process.pkg is undefined', () => {
			(process as any).pkg = undefined;
			expect(isBinaryMode()).toBe(false);
		});
	});

	describe('isDockerMode', () => {
		it('should return true when IS_DOCKER is "true"', () => {
			process.env.IS_DOCKER = 'true';
			expect(isDockerMode()).toBe(true);
		});

		it('should return true when IS_DOCKER is "1"', () => {
			process.env.IS_DOCKER = '1';
			expect(isDockerMode()).toBe(true);
		});

		it('should return false when IS_DOCKER is not set', () => {
			delete process.env.IS_DOCKER;
			expect(isDockerMode()).toBe(false);
		});

		it('should return false when IS_DOCKER is "false"', () => {
			process.env.IS_DOCKER = 'false';
			expect(isDockerMode()).toBe(false);
		});

		it('should return false when IS_DOCKER is "0"', () => {
			process.env.IS_DOCKER = '0';
			expect(isDockerMode()).toBe(false);
		});
	});

	describe('getInstallType', () => {
		it('should return "docker" when in docker mode', () => {
			process.env.IS_DOCKER = 'true';
			delete (process as any).pkg;
			expect(getInstallType()).toBe('docker');
		});

		it('should return "binary" when in binary mode but not docker', () => {
			delete process.env.IS_DOCKER;
			(process as any).pkg = { entrypoint: '/snapshot/app/index.js' };
			expect(getInstallType()).toBe('binary');
		});

		it('should return "dev" when neither docker nor binary', () => {
			delete process.env.IS_DOCKER;
			delete (process as any).pkg;
			expect(getInstallType()).toBe('dev');
		});

		it('should prioritize docker over binary when both are set', () => {
			process.env.IS_DOCKER = 'true';
			(process as any).pkg = { entrypoint: '/snapshot/app/index.js' };
			expect(getInstallType()).toBe('docker');
		});
	});

	describe('isLinuxDesktop', () => {
		beforeEach(() => {
			delete process.env.PLUTON_LINUX_DESKTOP;
			delete process.env.DISPLAY;
			delete process.env.WAYLAND_DISPLAY;
			delete process.env.XDG_CURRENT_DESKTOP;
			delete process.env.DESKTOP_SESSION;
			delete process.env.GNOME_DESKTOP_SESSION_ID;
			delete process.env.KDE_FULL_SESSION;
		});

		it('should return false on non-linux platforms', () => {
			Object.defineProperty(process, 'platform', { value: 'win32' });
			process.env.DISPLAY = ':0';
			expect(isLinuxDesktop()).toBe(false);
		});

		it('should return false on darwin', () => {
			Object.defineProperty(process, 'platform', { value: 'darwin' });
			expect(isLinuxDesktop()).toBe(false);
		});

		it('should return true when PLUTON_LINUX_DESKTOP is "true"', () => {
			Object.defineProperty(process, 'platform', { value: 'linux' });
			process.env.PLUTON_LINUX_DESKTOP = 'true';
			expect(isLinuxDesktop()).toBe(true);
		});

		it('should return true when PLUTON_LINUX_DESKTOP is "1"', () => {
			Object.defineProperty(process, 'platform', { value: 'linux' });
			process.env.PLUTON_LINUX_DESKTOP = '1';
			expect(isLinuxDesktop()).toBe(true);
		});

		it('should return true when DISPLAY is set', () => {
			Object.defineProperty(process, 'platform', { value: 'linux' });
			process.env.DISPLAY = ':0';
			expect(isLinuxDesktop()).toBe(true);
		});

		it('should return true when WAYLAND_DISPLAY is set', () => {
			Object.defineProperty(process, 'platform', { value: 'linux' });
			process.env.WAYLAND_DISPLAY = 'wayland-0';
			expect(isLinuxDesktop()).toBe(true);
		});

		it('should return true when XDG_CURRENT_DESKTOP is set', () => {
			Object.defineProperty(process, 'platform', { value: 'linux' });
			process.env.XDG_CURRENT_DESKTOP = 'GNOME';
			expect(isLinuxDesktop()).toBe(true);
		});

		it('should return true when DESKTOP_SESSION is set', () => {
			Object.defineProperty(process, 'platform', { value: 'linux' });
			process.env.DESKTOP_SESSION = 'ubuntu';
			expect(isLinuxDesktop()).toBe(true);
		});

		it('should return true when GNOME_DESKTOP_SESSION_ID is set', () => {
			Object.defineProperty(process, 'platform', { value: 'linux' });
			process.env.GNOME_DESKTOP_SESSION_ID = 'this-is-deprecated';
			expect(isLinuxDesktop()).toBe(true);
		});

		it('should return true when KDE_FULL_SESSION is set', () => {
			Object.defineProperty(process, 'platform', { value: 'linux' });
			process.env.KDE_FULL_SESSION = 'true';
			expect(isLinuxDesktop()).toBe(true);
		});

		it('should return false on linux with no desktop indicators', () => {
			Object.defineProperty(process, 'platform', { value: 'linux' });
			expect(isLinuxDesktop()).toBe(false);
		});
	});

	describe('isKeyringPlatform', () => {
		beforeEach(() => {
			delete process.env.DISPLAY;
			delete process.env.WAYLAND_DISPLAY;
			delete process.env.XDG_CURRENT_DESKTOP;
			delete process.env.DESKTOP_SESSION;
			delete process.env.GNOME_DESKTOP_SESSION_ID;
			delete process.env.KDE_FULL_SESSION;
			delete process.env.PLUTON_LINUX_DESKTOP;
		});

		it('should return true on win32', () => {
			Object.defineProperty(process, 'platform', { value: 'win32' });
			expect(isKeyringPlatform()).toBe(true);
		});

		it('should return true on darwin', () => {
			Object.defineProperty(process, 'platform', { value: 'darwin' });
			expect(isKeyringPlatform()).toBe(true);
		});

		it('should return true on linux desktop', () => {
			Object.defineProperty(process, 'platform', { value: 'linux' });
			process.env.DISPLAY = ':0';
			expect(isKeyringPlatform()).toBe(true);
		});

		it('should return false on linux server (no desktop)', () => {
			Object.defineProperty(process, 'platform', { value: 'linux' });
			expect(isKeyringPlatform()).toBe(false);
		});

		it('should return false on unsupported platforms', () => {
			Object.defineProperty(process, 'platform', { value: 'freebsd' });
			expect(isKeyringPlatform()).toBe(false);
		});
	});

	describe('requiresKeyringSetup', () => {
		beforeEach(() => {
			delete (process as any).pkg;
			delete process.env.IS_DOCKER;
			delete process.env.DISPLAY;
			delete process.env.WAYLAND_DISPLAY;
			delete process.env.XDG_CURRENT_DESKTOP;
			delete process.env.DESKTOP_SESSION;
			delete process.env.GNOME_DESKTOP_SESSION_ID;
			delete process.env.KDE_FULL_SESSION;
			delete process.env.PLUTON_LINUX_DESKTOP;
		});

		it('should return true when binary mode on win32', () => {
			(process as any).pkg = { entrypoint: '/snapshot/app/index.js' };
			Object.defineProperty(process, 'platform', { value: 'win32' });
			expect(requiresKeyringSetup()).toBe(true);
		});

		it('should return true when binary mode on darwin', () => {
			(process as any).pkg = { entrypoint: '/snapshot/app/index.js' };
			Object.defineProperty(process, 'platform', { value: 'darwin' });
			expect(requiresKeyringSetup()).toBe(true);
		});

		it('should return true when binary mode on linux desktop', () => {
			(process as any).pkg = { entrypoint: '/snapshot/app/index.js' };
			Object.defineProperty(process, 'platform', { value: 'linux' });
			process.env.DISPLAY = ':0';
			expect(requiresKeyringSetup()).toBe(true);
		});

		it('should return false when binary mode on linux server', () => {
			(process as any).pkg = { entrypoint: '/snapshot/app/index.js' };
			Object.defineProperty(process, 'platform', { value: 'linux' });
			expect(requiresKeyringSetup()).toBe(false);
		});

		it('should return false when not in binary mode', () => {
			delete (process as any).pkg;
			Object.defineProperty(process, 'platform', { value: 'win32' });
			expect(requiresKeyringSetup()).toBe(false);
		});

		it('should return false in dev mode even on keyring platform', () => {
			delete (process as any).pkg;
			delete process.env.IS_DOCKER;
			Object.defineProperty(process, 'platform', { value: 'darwin' });
			expect(requiresKeyringSetup()).toBe(false);
		});
	});
});
