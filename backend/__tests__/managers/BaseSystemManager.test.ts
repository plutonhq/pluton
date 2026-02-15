import type { Stats } from 'fs';

jest.mock('systeminformation', () => ({
	__esModule: true,
	default: {
		system: jest.fn(),
		cpu: jest.fn(),
		mem: jest.fn(),
		memLayout: jest.fn(),
		osInfo: jest.fn(),
		diskLayout: jest.fn(),
		networkInterfaces: jest.fn(),
		currentLoad: jest.fn(),
		time: jest.fn(),
		fsSize: jest.fn(),
	},
}));

jest.mock('child_process', () => {
	const execSync = jest.fn();
	const exec = jest.fn();
	const spawn = jest.fn();
	return { execSync, exec, spawn };
});

const readFileMock = jest.fn();
const writeFileMock = jest.fn();
const readdirMock = jest.fn();
const statMock = jest.fn();
const chmodMock = jest.fn();
const mkdtempMock = jest.fn();
const rmMock = jest.fn();

jest.mock('fs/promises', () => ({
	__esModule: true,
	readFile: (...args: any[]) => readFileMock(...args),
	writeFile: (...args: any[]) => writeFileMock(...args),
	readdir: (...args: any[]) => readdirMock(...args),
	stat: (...args: any[]) => statMock(...args),
	chmod: (...args: any[]) => chmodMock(...args),
	mkdtemp: (...args: any[]) => mkdtempMock(...args),
	rm: (...args: any[]) => rmMock(...args),
}));

const createWriteStreamMock = jest.fn();
jest.mock('fs', () => ({
	__esModule: true,
	createWriteStream: (...args: any[]) => createWriteStreamMock(...args),
}));

const httpsGetMock = jest.fn();
jest.mock('https', () => ({
	__esModule: true,
	default: { get: (...args: any[]) => httpsGetMock(...args) },
}));

const mockPromisifiedExec = jest.fn().mockResolvedValue({ stdout: '', stderr: '' });
jest.mock('util', () => ({
	__esModule: true,
	promisify: jest.fn().mockReturnValue(mockPromisifiedExec),
}));

jest.mock('../../src/utils/versions', () => ({
	__esModule: true,
	getResticVersion: jest.fn(() => '1.0.0'),
	getRcloneVersion: jest.fn(() => '2.0.0'),
}));

jest.mock('../../src/utils/runCommand', () => ({
	__esModule: true,
	runCommand: jest.fn().mockResolvedValue('[SUCCESS] New version: v9.9.9'),
}));

jest.mock('../../src/utils/AppPaths', () => ({
	__esModule: true,
	appPaths: {
		getTempDir: jest.fn(() => '/tmp'),
	},
}));

jest.mock('../../src/services/ConfigService', () => ({
	configService: {
		get: jest.fn().mockReturnValue(undefined),
		getAll: jest.fn().mockReturnValue({}),
		config: {
			ENCRYPTION_KEY: 'test-encryption-key',
		},
	},
	ConfigService: {
		getInstance: jest.fn().mockReturnValue({
			get: jest.fn().mockReturnValue(undefined),
			getAll: jest.fn().mockReturnValue({}),
			config: {
				ENCRYPTION_KEY: 'test-encryption-key',
			},
		}),
	},
}));

import os from 'os';
import si from 'systeminformation';
import { execSync } from 'child_process';
import { BaseSystemManager } from '../../src/managers/BaseSystemManager';

const siMock = si as unknown as jest.Mocked<typeof si>;

describe('BaseSystemManager', () => {
	beforeEach(() => {
		jest.clearAllMocks();

		// Reset the promisified exec mock for each test
		mockPromisifiedExec.mockReset();
		mockPromisifiedExec.mockResolvedValue({ stdout: '', stderr: '' });

		// Default OS platform linux
		jest.spyOn(os, 'platform').mockReturnValue('linux' as NodeJS.Platform);

		// systeminformation default mocks
		siMock.system.mockResolvedValue({
			manufacturer: 'ACME',
			model: 'X',
			version: '1',
			serial: 'S',
			uuid: 'U',
		} as any);
		siMock.cpu.mockResolvedValue({
			manufacturer: 'Intel',
			brand: 'i7',
			speed: 3.2,
			cores: 8,
			physicalCores: 4,
			processors: 1,
			cache: { l1d: 1, l1i: 1, l2: 2, l3: 8 },
		} as any);
		siMock.mem.mockResolvedValue({
			total: 100,
			free: 50,
			used: 50,
			active: 40,
			available: 60,
			swaptotal: 10,
			swapused: 2,
			swapfree: 8,
		} as any);
		siMock.memLayout.mockResolvedValue([
			{
				size: 4096,
				bank: 'A',
				type: 'DDR4',
				clockSpeed: 2400,
				formFactor: 'DIMM',
				manufacturer: 'ACME',
				partNum: 'PN',
				serialNum: 'SN',
				voltageConfigured: 1.2,
				voltageMin: 1.1,
				voltageMax: 1.3,
			},
		] as any);
		siMock.osInfo.mockResolvedValue({
			platform: 'linux',
			distro: 'Ubuntu',
			release: '22.04',
			kernel: '5.15',
			arch: 'x64',
			hostname: 'host',
			logofile: 'ubuntu',
		} as any);
		siMock.diskLayout.mockResolvedValue([
			{
				device: '/dev/vda',
				name: 'vda',
				type: 'disk',
				vendor: 'V',
				size: 1000,
				interfaceType: 'SATA',
			},
		] as any);
		siMock.networkInterfaces.mockResolvedValue([
			{
				iface: 'eth0',
				ifaceName: 'eth0',
				ip4: '1.1.1.1',
				ip6: '',
				mac: '00:00:00:00:00:00',
				internal: false,
				operstate: 'up',
				type: 'wired',
				speed: 1000,
				dhcp: true,
			},
		] as any);
		siMock.currentLoad.mockResolvedValue({
			currentLoad: 10,
			cpus: [{ load: 10 }, { load: 20 }],
		} as any);
		siMock.time.mockReturnValue({
			current: Date.now(),
			uptime: 1000,
			timezone: 'UTC',
			timezoneName: 'UTC',
		} as any);
		siMock.fsSize.mockResolvedValue([
			// should skip: /proc and /snap
			{ fs: 'proc', type: 'proc', size: 1, used: 1, available: 0, use: 100, mount: '/proc' },
			{
				fs: '/dev/loop0',
				type: 'squashfs',
				size: 1,
				used: 1,
				available: 0,
				use: 100,
				mount: '/snap/core',
			},
			// include:
			{ fs: '/dev/vda4', type: 'ext4', size: 10, used: 5, available: 5, use: 50, mount: '/' },
		] as any);

		// fs/promises defaults
		readFileMock.mockResolvedValue('KEY1=OLD\nOTHER=val\n');
		writeFileMock.mockResolvedValue(undefined);
		readdirMock.mockResolvedValue([]);
		statMock.mockRejectedValue(new Error('not found'));
		chmodMock.mockResolvedValue(undefined);
		mkdtempMock.mockResolvedValue('/tmp/pluton-updater-abc');
		rmMock.mockResolvedValue(undefined);

		// child_process defaults
		(execSync as unknown as jest.Mock).mockReset();
	});

	describe('getMetrics', () => {
		it('returns aggregated metrics and filters filesystems', async () => {
			const manager = new BaseSystemManager();
			const res = await manager.getMetrics();
			expect(res.success).toBe(true);
			const disks = (res.result as any).disks.filesystems;
			expect(disks.length).toBe(1);
			expect(disks[0]).toMatchObject({
				fs: '/dev/vda4',
				type: 'ext4',
				mount: '/',
				// Match current friendly name
				name: 'Root (/)',
			});
			const net = (res.result as any).network;
			expect(Array.isArray(net)).toBe(true);
			expect(net[0].iface).toBe('eth0');
		});
	});

	describe('getVersions', () => {
		it('returns node, system, platform, os, restic, rclone', async () => {
			const manager = new BaseSystemManager();
			const res = await manager.getVersions();
			expect(res.success).toBe(true);
			const result = res.result as any;
			expect(result.node).toMatch(/^v/);
			expect(result.platform).toBe(os.platform());
			expect(result.system).toBe(os.release());
			expect(result.restic).toBe('1.0.0');
			expect(result.rclone).toBe('2.0.0');
			// os field is the object returned by getOSVersion
			expect(result.os).toEqual({ success: true, result: 'Ubuntu 22.04' });
		});
	});

	describe('checkDiskSpace', () => {
		it('parses df output successfully', async () => {
			(execSync as unknown as jest.Mock).mockReturnValue(
				Buffer.from(
					'Filesystem      Size  Used Avail Use% Mounted on\n/dev/vda4       8.8G  4.2G  4.2G  51% /\n'
				)
			);
			const manager = new BaseSystemManager();
			const res = await manager.checkDiskSpace();
			expect(res.success).toBe(true);
			expect(res.result).toMatchObject({
				filesystem: '/dev/vda4',
				size: '8.8G',
				used: '4.2G',
				available: '4.2G',
				percentage: '51%',
				mounted: '/',
			});
		});

		it('returns failure when df errors', async () => {
			(execSync as unknown as jest.Mock).mockImplementation(() => {
				throw new Error('df error');
			});
			const manager = new BaseSystemManager();
			const res = await manager.checkDiskSpace();
			expect(res.success).toBe(false);
		});
	});

	describe('getRootDrives (linux)', () => {
		it('returns meaningful mounts and friendly names', async () => {
			siMock.fsSize.mockResolvedValueOnce([
				{ fs: '/dev/vda4', type: 'ext4', mount: '/' },
				{ fs: '/dev/vdb', type: 'ext4', mount: '/data' },
				{ fs: '/dev/vda2', type: 'vfat', mount: '/boot/efi' }, // skipped
			] as any);
			const manager = new BaseSystemManager();
			const res = await manager.getRootDrives();
			expect(res.success).toBe(true);
			const drives = res.result as any[];
			expect(drives.find(d => d.path === '/')).toBeTruthy();

			// Be tolerant to naming differences; ensure /data is present and has a string name
			const dataDrive = drives.find(d => d.path === '/data');
			expect(dataDrive).toBeTruthy();
			expect(typeof dataDrive?.name).toBe('string');

			expect(drives.find(d => d.path === '/boot/efi')).toBeFalsy();
		});

		it('falls back to root on error', async () => {
			siMock.fsSize.mockRejectedValueOnce(new Error('fail'));
			const manager = new BaseSystemManager();
			const res = await manager.getRootDrives();
			expect(res.success).toBe(true);
			expect(res.result).toEqual([
				{ name: 'Root (/)', path: '/', type: 'directory', isDirectory: true },
			]);
		});
	});

	describe('getBrowsePath', () => {
		it('without givenPath returns drives with stats and fallback on stat error', async () => {
			const manager = new BaseSystemManager();
			const drivesResult = {
				success: true,
				result: [
					{ name: 'Etc', path: '/etc', type: 'directory', isDirectory: true },
					{ name: 'Missing', path: '/missing', type: 'directory', isDirectory: true },
				],
			};
			jest.spyOn(manager, 'getRootDrives').mockResolvedValue(drivesResult as any);

			const goodStats: Partial<Stats> & { isDirectory: () => boolean } = {
				isDirectory: () => true,
				size: 0 as any,
				mtime: new Date('2020-01-01'),
				uid: 1000 as any,
				mode: 0o040755 as any,
			};
			statMock.mockImplementation(async (p: string) => {
				if (p === '/etc') return goodStats as any;
				throw new Error('not found');
			});

			const res = await manager.getBrowsePath();
			expect(res.success).toBe(true);
			const items = (res.result as any).items;
			const etc = items.find((i: any) => i.path === '/etc');
			const missing = items.find((i: any) => i.path === '/missing');
			expect(etc.permissions.startsWith('d')).toBe(true);
			expect(missing.permissions).toBe('');
		});

		it('with givenPath lists directory contents sorted with directories first', async () => {
			const manager = new BaseSystemManager();
			// Dirents
			readdirMock.mockResolvedValue([
				{ name: 'b', isDirectory: () => true },
				{ name: 'a.txt', isDirectory: () => false },
			]);

			statMock.mockImplementation(async (p: string) => {
				if (p.endsWith('/b')) {
					return { size: 0, mtime: new Date('2021-01-01'), uid: 1000, mode: 0o040755 } as any;
				}
				return { size: 5, mtime: new Date('2021-01-02'), uid: 1000, mode: 0o100644 } as any;
			});

			const res = await manager.getBrowsePath('/tmp');
			expect(res.success).toBe(true);
			const items = (res.result as any).items;
			expect(items[0].name).toBe('b'); // dir first
			expect(items[1].name).toBe('a.txt');
			expect(items[0].isDirectory).toBe(true);
			expect(items[1].isDirectory).toBe(false);
		});
	});

	describe('updateRestic / updateRclone', () => {
		it('returns success with new version string', async () => {
			const manager = new BaseSystemManager();
			// Stub private method
			(manager as any).executeUpdateScript = jest.fn().mockResolvedValue('v1.2.3');

			const r1 = await manager.updateRestic();
			expect(r1).toEqual({ success: true, result: 'v1.2.3' });

			const r2 = await manager.updateRclone();
			expect(r2).toEqual({ success: true, result: 'v1.2.3' });
		});

		it('returns failure on script error', async () => {
			const manager = new BaseSystemManager();
			(manager as any).executeUpdateScript = jest.fn().mockRejectedValue(new Error('bad'));

			const r1 = await manager.updateRestic();
			expect(r1.success).toBe(false);
			const r2 = await manager.updateRclone();
			expect(r2.success).toBe(false);
		});
	});

	describe('updateSettings', () => {
		it('writes environment vars on linux', async () => {
			jest.spyOn(os, 'platform').mockReturnValue('linux' as any);
			readFileMock.mockResolvedValue('RCLONE_TEMP_DIR=/old\nSOME=keep\n');

			const manager = new BaseSystemManager();
			const res = await manager.updateSettings({
				tempDir: '/tmp/pluton',
				restic: {
					maxProcessor: 4,
					cacheDir: '/cache/restic',
					tmpDir: '/tmp', // not used by code, but fine
					readConcurrency: 8,
					packSize: '4M',
				},
				rclone: {
					tempDir: '/tmp/rclone',
					cacheDir: '/cache/rclone',
					bwlimit: '10M:100k',
					timeout: '5m',
					retries: 3,
					lowLevelRetries: 5,
					transfers: 4,
					checkers: 8,
					bufferSize: '16M',
					multiThreadStream: 4,
					// configPass included below in deletion test
					configPass: 'secret',
				},
			} as any);

			expect(res.success).toBe(true);
			expect(writeFileMock).toHaveBeenCalledTimes(1);
			const content = (writeFileMock.mock.calls[0] as any[])[1] as string;
			expect(content).toEqual(expect.stringContaining('GOMAXPROCS=4'));
			expect(content).toEqual(expect.stringContaining('RESTIC_CACHE_DIR=/cache/restic'));
			expect(content).toEqual(expect.stringContaining('RESTIC_READ_CONCURRENCY=8'));
			expect(content).toEqual(expect.stringContaining('RESTIC_PACK_SIZE=4M'));
			expect(content).toEqual(expect.stringContaining('RCLONE_TEMP_DIR=/tmp/rclone'));
			expect(content).toEqual(expect.stringContaining('RCLONE_CACHE_DIR=/cache/rclone'));
			expect(content).toEqual(expect.stringContaining('RCLONE_BWLIMIT=10M:100k'));
			expect(content).toEqual(expect.stringContaining('RCLONE_TIMEOUT=5m'));
			expect(content).toEqual(expect.stringContaining('RCLONE_RETRIES=3'));
			expect(content).toEqual(expect.stringContaining('RCLONE_LOW_LEVEL_RETRIES=5'));
			expect(content).toEqual(expect.stringContaining('RCLONE_TRANSFERS=4'));
			expect(content).toEqual(expect.stringContaining('RCLONE_CHECKERS=8'));
			expect(content).toEqual(expect.stringContaining('RCLONE_BUFFER_SIZE=16M'));
			expect(content).toEqual(expect.stringContaining('RCLONE_MULTI_THREAD_STREAMS=4'));
			expect(content).toEqual(expect.stringContaining('RCLONE_CONFIG_PASS=secret'));
		});
	});

	describe('getMountPoints and analyzeBlockDevices', () => {
		// Skip this linux-only test on Windows
		const linuxIt = process.platform === 'win32' ? it.skip : it;

		linuxIt('returns analyzed filesystems on linux', async () => {
			jest.spyOn(os, 'platform').mockReturnValue('linux' as any);

			const lsblkJson = JSON.stringify({
				blockdevices: [
					{
						name: 'vda',
						size: '10G',
						children: [
							{
								name: 'vda2',
								fstype: 'vfat',
								label: null,
								uuid: 'EFI',
								mountpoint: '/boot/efi',
								size: '256M',
							},
							{
								name: 'vda3',
								fstype: 'ext4',
								label: null,
								uuid: 'BOOT',
								mountpoint: '/boot',
								size: '800M',
							},
							{
								name: 'vda4',
								fstype: 'ext4',
								label: null,
								uuid: 'ROOT',
								mountpoint: '/',
								size: '9G',
							},
						],
					},
					{
						name: 'vdb',
						fstype: 'ext4',
						label: 'data',
						uuid: 'DATA',
						mountpoint: '/data',
						size: '300G',
					},
				],
			});
			const dfOut = `Filesystem      Size  Used Avail Use% Mounted on
/dev/vda4       8.8G  4.2G  4.2G  51% /
/dev/vdb         300G   10G  290G  4% /data
/dev/vda3       800M   65M  650M  10% /boot
/dev/vda2       256M  6.1M  250M  3% /boot/efi
`;

			// Route exec calls by command content to handle preliminary checks
			(mockPromisifiedExec as jest.Mock).mockImplementation((cmd: string) => {
				const s = String(cmd);
				if (/which\s+lsblk|command\s+-v\s+lsblk/i.test(s)) {
					return Promise.resolve({ stdout: '/usr/bin/lsblk\n', stderr: '' });
				}
				if (/lsblk/i.test(s)) {
					return Promise.resolve({ stdout: lsblkJson, stderr: '' });
				}
				if (/\bdf\b/i.test(s)) {
					return Promise.resolve({ stdout: dfOut, stderr: '' });
				}
				return Promise.resolve({ stdout: '', stderr: '' });
			});

			const manager = new BaseSystemManager();
			const res = await manager.getMountPoints();
			expect(res.success).toBe(true);
			const fsList = res.result as any[];
			const root = fsList.find(f => f.mountpoint === '/');
			expect(root.isCritical).toBe(true);
			expect(root.size).toBe('9 GB');
			expect(root.used).toBe('4.2 GB');

			const efi = fsList.find(f => f.mountpoint === '/boot/efi');
			expect(efi.isCritical).toBe(true);
			expect(efi.size).toBe('256 MB');

			const data = fsList.find(f => f.mountpoint === '/data');
			expect(data.isCritical).toBe(false);
			expect(data.size).toBe('300 GB');
			expect(data.used).toBe('10 GB');
		});

		it('returns error on non-linux', async () => {
			jest.spyOn(os, 'platform').mockReturnValue('darwin' as any);
			const manager = new BaseSystemManager();
			const res = await manager.getMountPoints();
			expect(res.success).toBe(false);
		});

		it('analyzeBlockDevices parses provided lsblk JSON directly', async () => {
			const manager = new BaseSystemManager();
			const lsblkJson = JSON.stringify({
				blockdevices: [
					{
						name: 'sda',
						fstype: null,
						mountpoint: null,
						label: null,
						uuid: null,
						size: '100G',
						children: [
							{
								name: 'sda1',
								fstype: 'ext4',
								label: 'root',
								uuid: 'UUID1',
								mountpoint: '/',
								size: '50G',
							},
							{
								name: 'sda2',
								fstype: 'ext4',
								label: 'home',
								uuid: 'UUID2',
								mountpoint: '/home',
								size: '50G',
							},
						],
					},
				],
			});
			const dfMap = new Map<string, any>([
				['/', { used: '5G', available: '45G', usePercent: '10%' }],
				['/home', { used: '7G', available: '43G', usePercent: '14%' }],
			]);
			const out = await manager.analyzeBlockDevices(lsblkJson, dfMap);
			expect(out).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ mountpoint: '/', used: '5 GB', isCritical: true }),
					expect.objectContaining({ mountpoint: '/home', used: '7 GB', isCritical: false }),
				])
			);
		});
	});

	describe('isServerEdition', () => {
		it('detects server editions', async () => {
			const manager = new BaseSystemManager();
			await expect(
				manager.isServerEdition({ platform: 'win32', distro: 'Windows Server 2019' } as any)
			).resolves.toBe(true);
			await expect(
				manager.isServerEdition({ platform: 'linux', distro: 'Ubuntu Server 22.04' } as any)
			).resolves.toBe(true);
			await expect(
				manager.isServerEdition({ platform: 'linux', distro: 'Ubuntu Desktop' } as any)
			).resolves.toBe(false);
			await expect(
				manager.isServerEdition({ platform: 'darwin', distro: 'macOS Server' } as any)
			).resolves.toBe(true);
		});
	});

	describe('parseDfOutput (private)', () => {
		it('parses df -h output to a map', () => {
			const manager = new BaseSystemManager();
			const dfOut = `Filesystem      Size  Used Avail Use% Mounted on
/dev/sda1        50G   10G   40G  20% /
/dev/sda2        50G   20G   30G  40% /home
`;
			const map = (manager as any).parseDfOutput(dfOut) as Map<
				string,
				{ used: string; available: string; usePercent: string }
			>;
			expect(map.get('/')?.used).toBe('10G');
			expect(map.get('/home')?.available).toBe('30G');
			expect(map.get('/home')?.usePercent).toBe('40%');
		});
	});
});
