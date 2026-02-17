import os from 'os';
import { execSync } from 'child_process';
import { chmod, readdir, stat, mkdtemp, rm } from 'fs/promises';
import { createWriteStream } from 'fs';
import path from 'path';
import si from 'systeminformation';
import https from 'https';
import { promisify } from 'util';
import { exec } from 'child_process';
import { getRcloneVersion, getResticVersion } from '../utils/versions';
// import { defaultDockerInfo } from '../utils/docker';
import { DeviceSettings, DiscoveredFilesystem, LsblkDevice, LsblkOutput } from '../types/devices';
import { BaseStorageManager } from './BaseStorageManager';
import { runCommand } from '../utils/runCommand';
import { appPaths } from '../utils/AppPaths';
import { saveRcloneGlobalSettings, saveResticGlobalSettings } from '../utils/globalSettings';

const execAsync = promisify(exec);

export class BaseSystemManager {
	private storageManager: BaseStorageManager;
	constructor() {
		this.storageManager = new BaseStorageManager();
	}

	async getMetrics(): Promise<{ success: boolean; result: Record<string, any> }> {
		try {
			// Get all metrics in parallel for better performance
			const [
				systemInfo,
				cpuInfo,
				memInfo,
				memLayout,
				osInfo,
				diskInfo,
				networkInfo,
				currentLoadInfo,
				timeInfo,
				// dockerInfo,
				// dockerContainers,
			] = await Promise.all([
				si.system(),
				si.cpu(),
				si.mem(),
				si.memLayout(),
				si.osInfo(),
				si.diskLayout(),
				si.networkInterfaces(),
				si.currentLoad(),
				si.time(),
				// si.dockerInfo().catch(() => defaultDockerInfo),
				// si.dockerContainers().catch(() => []),
			]);

			// Check if Server Edition
			const isServer = this.isServerEdition(osInfo);

			// Get filesystem stats for all mounted disks
			const fsStats = await si.fsSize();

			const metrics = {
				system: {
					manufacturer: systemInfo.manufacturer,
					model: systemInfo.model,
					version: systemInfo.version,
					serial: systemInfo.serial,
					uuid: systemInfo.uuid,
				},
				cpu: {
					manufacturer: cpuInfo.manufacturer,
					brand: cpuInfo.brand,
					speed: cpuInfo.speed,
					cores: cpuInfo.cores,
					physicalCores: cpuInfo.physicalCores,
					processors: cpuInfo.processors,
					cache: cpuInfo.cache,
					load: {
						currentLoad: currentLoadInfo.currentLoad,
						cpus: currentLoadInfo.cpus.map(cpu => cpu.load),
					},
				},
				memory: {
					total: memInfo.total,
					free: memInfo.free,
					used: memInfo.used,
					active: memInfo.active,
					available: memInfo.available,
					swapTotal: memInfo.swaptotal,
					swapUsed: memInfo.swapused,
					swapFree: memInfo.swapfree,
					layout: memLayout.map(module => ({
						size: module.size,
						bank: module.bank,
						type: module.type,
						clockSpeed: module.clockSpeed,
						formFactor: module.formFactor,
						manufacturer: module.manufacturer,
						partNum: module.partNum,
						serialNum: module.serialNum,
						voltageConfigured: module.voltageConfigured,
						voltageMin: module.voltageMin,
						voltageMax: module.voltageMax,
					})),
				},
				os: {
					platform: osInfo.platform,
					distro: osInfo.distro,
					release: osInfo.release,
					kernel: osInfo.kernel,
					arch: osInfo.arch,
					hostname: osInfo.hostname,
					logofile: osInfo.logofile,
					isServer,
				},
				time: {
					current: timeInfo.current,
					uptime: timeInfo.uptime,
					timezone: timeInfo.timezone,
					timezoneName: timeInfo.timezoneName,
				},
				disks: {
					physical: diskInfo.map(disk => ({
						device: disk.device,
						name: disk.name,
						type: disk.type,
						vendor: disk.vendor,
						size: disk.size,
						interfaceType: disk.interfaceType,
					})),
					filesystems: fsStats
						.filter(fs => this.shouldSkipMountPoint(fs))
						.map(fs => ({
							fs: fs.fs,
							type: fs.type,
							size: fs.size,
							used: fs.used,
							available: fs.available,
							use: fs.use,
							mount: fs.mount,
							name: this.getFriendlyMountName(fs),
						})),
				},
				network: Array.isArray(networkInfo)
					? networkInfo.map(net => ({
							iface: net.iface,
							ifaceName: net.ifaceName,
							ip4: net.ip4,
							ip6: net.ip6,
							mac: net.mac,
							internal: net.internal,
							operstate: net.operstate,
							type: net.type,
							speed: net.speed,
							dhcp: net.dhcp,
						}))
					: [networkInfo],
				// docker: {
				// 	info: {
				// 		containers: dockerInfo.containers,
				// 		containersRunning: dockerInfo.containersRunning,
				// 		containersPaused: dockerInfo.containersPaused,
				// 		containersStopped: dockerInfo.containersStopped,
				// 		images: dockerInfo.images,
				// 		driver: dockerInfo.driver,
				// 		memoryLimit: dockerInfo.memoryLimit,
				// 		swapLimit: dockerInfo.swapLimit,
				// 		kernelMemory: dockerInfo.kernelMemory,
				// 		cpuCfsPeriod: dockerInfo.cpuCfsPeriod,
				// 		cpuCfsQuota: dockerInfo.cpuCfsQuota,
				// 		cpuShares: dockerInfo.cpuShares,
				// 		cpuSet: dockerInfo.cpuSet,
				// 		ipv4Forwarding: dockerInfo.ipv4Forwarding,
				// 		bridgeNfIptables: dockerInfo.bridgeNfIptables,
				// 		bridgeNfIp6tables: dockerInfo.bridgeNfIp6tables,
				// 		debug: dockerInfo.debug,
				// 		nfd: dockerInfo.nfd,
				// 		oomKillDisable: dockerInfo.oomKillDisable,
				// 		ngoroutines: dockerInfo.ngoroutines,
				// 		systemTime: dockerInfo.systemTime,
				// 		loggingDriver: dockerInfo.loggingDriver,
				// 		cgroupDriver: dockerInfo.cgroupDriver,
				// 		nEventsListener: dockerInfo.nEventsListener,
				// 		kernelVersion: dockerInfo.kernelVersion,
				// 		operatingSystem: dockerInfo.operatingSystem,
				// 		osType: dockerInfo.osType,
				// 		architecture: dockerInfo.architecture,
				// 		serverVersion: dockerInfo.serverVersion,
				// 	},
				// 	containers: dockerContainers.map(container => ({
				// 		id: container.id,
				// 		name: container.name,
				// 		image: container.image,
				// 		imageID: container.imageID,
				// 		command: container.command,
				// 		created: container.created,
				// 		started: container.started,
				// 		finished: container.finished,
				// 		state: container.state,
				// 		status: container.status,
				// 		ports: container.ports,
				// 		mounts: container.mounts,
				// 		networkMode: container.networkMode,
				// 		networks: container.networks,
				// 		memoryUsage: container.memoryUsage,
				// 		memoryLimit: container.memoryLimit,
				// 		cpuPercent: container.cpuPercent,
				// 		restartCount: container.restartCount,
				// 		platform: container.platform,
				// 		sizeRw: container.sizeRw,
				// 		sizeRootFs: container.sizeRootFs,
				// 	})),
				// },
			};

			return { success: true, result: metrics };
		} catch (error: any) {
			return {
				success: false,
				result: error?.message || 'Failed to fetch system metrics',
			};
		}
	}

	async getVersions(): Promise<{ success: boolean; result: Record<string, any> }> {
		try {
			const osVersion = await this.getOSVersion();
			const versions = {
				node: process.version,
				system: os.release(),
				platform: os.platform(),
				os: osVersion,
				restic: getResticVersion(),
				rclone: getRcloneVersion(),
			};

			return { success: true, result: versions };
		} catch (error: any) {
			return {
				success: false,
				result: error?.message || 'Failed to fetch version information',
			};
		}
	}
	async checkDiskSpace(): Promise<{ success: boolean; result: string | Record<string, any> }> {
		try {
			const df = execSync('df -h /').toString();
			const lines = df.trim().split('\n');
			const [filesystem, size, used, available, percentage, mounted] = lines[1].split(/\s+/);

			return {
				success: true,
				result: {
					filesystem,
					size,
					used,
					available,
					percentage,
					mounted,
				},
			};
		} catch {
			return { success: false, result: 'Unable to fetch disk space information' };
		}
	}

	async getRootDrives(): Promise<{ success: boolean; result: Record<string, any> }> {
		const platform = os.platform();

		if (platform === 'win32') {
			const { stdout } = await execAsync('wmic logicaldisk get name,volumename');
			const result = stdout
				.trim()
				.split('\n')
				.slice(1)
				.map(line => {
					const [name] = line.trim().split(/\s+/);
					return {
						name,
						path: name,
						type: 'drive',
						isDirectory: true,
					};
				});

			return { success: true, result };
		}

		if (platform === 'darwin') {
			const { stdout } = await execAsync('df -h /Volumes/');
			const result = stdout
				.trim()
				.split('\n')
				.slice(1)
				.map(line => {
					const fields = line.split(/\s+/);
					const name = fields[fields.length - 1];
					return {
						name,
						path: name,
						type: 'directory',
						isDirectory: true,
					};
				});
			return { success: true, result };
		}

		// Linux - Get meaningful mount points instead of all df output
		try {
			const fsStats = await si.fsSize();

			// Filter out virtual/special filesystems
			const meaningfulMounts = fsStats.filter(fs => this.shouldSkipMountPoint(fs));

			const result = meaningfulMounts.map(fs => ({
				name: this.getFriendlyMountName(fs),
				path: fs.mount,
				type: 'directory',
				isDirectory: true,
			}));

			// Always include root if not already present
			const hasRoot = result.some(item => item.path === '/');
			if (!hasRoot) {
				result.unshift({
					name: 'Root (/)',
					path: '/',
					type: 'directory',
					isDirectory: true,
				});
			}

			return { success: true, result };
		} catch (error) {
			// Fallback to simple root
			return {
				success: true,
				result: [
					{
						name: 'Root (/)',
						path: '/',
						type: 'directory',
						isDirectory: true,
					},
				],
			};
		}
	}

	// Add these new helper methods
	private shouldSkipMountPoint(fs: any): boolean {
		const mountpoint = fs.mount;
		const fstype = fs.type?.toLowerCase() || '';

		// Skip virtual/special filesystems
		const virtualFS = [
			'proc',
			'sysfs',
			'devfs',
			'devpts',
			'tmpfs',
			'cgroup',
			'cgroup2',
			'pstore',
			'bpf',
			'tracefs',
			'debugfs',
			'securityfs',
			'hugetlbfs',
			'mqueue',
			'ramfs',
			'autofs',
			'rpc_pipefs',
			'nfsd',
			'binfmt_misc',
			'fuse.gvfsd-fuse',
			'fusectl',
		];

		for (const vfs of virtualFS) {
			if (fstype === vfs) {
				return false; // Skip this mount
			}
		}

		// Skip snap mounts
		if (mountpoint.startsWith('/snap/')) {
			return false;
		}

		// Skip special directories
		const skipPaths = [
			'/dev',
			'/proc',
			'/sys',
			'/run',
			'/boot/efi',
			'/mnt/wslg', // WSL-specific
		];

		for (const skipPath of skipPaths) {
			if (mountpoint === skipPath || mountpoint.startsWith(skipPath + '/')) {
				return false;
			}
		}

		return true; // Include this mount
	}

	private getFriendlyMountName(fs: any): string {
		if (os.platform() === 'win32') {
			return `Local Disk (${fs.mount})`;
		}

		const mountpoint = fs.mount;
		const device = fs.fs;

		switch (mountpoint) {
			case '/':
				return 'Root (/)';
			case '/home':
				return 'Home (/home)';
			case '/tmp':
				return 'Temporary (/tmp)';
			case '/var':
				return 'System Data (/var)';
			case '/usr':
				return 'Programs (/usr)';
			case '/opt':
				return 'Optional Software (/opt)';
			default:
				// For other mount points
				if (mountpoint.startsWith('/mnt/')) {
					const name = mountpoint.substring(5); // Remove '/mnt/'
					return `${name.charAt(0).toUpperCase() + name.slice(1)} (${mountpoint})`;
				}
				if (mountpoint.startsWith('/media/')) {
					const name = mountpoint.substring(7); // Remove '/media/'
					const parts = name.split('/');
					const deviceName = parts[parts.length - 1];
					return `${deviceName.charAt(0).toUpperCase() + deviceName.slice(1)} (${mountpoint})`;
				}

				// For other cases, use the mount point name with device info if available
				if (device && !device.startsWith('/dev/loop')) {
					const deviceName = device.split('/').pop();
					return `${mountpoint} (${deviceName})`;
				}

				return mountpoint;
		}
	}

	async getBrowsePath(
		givenPath?: string
	): Promise<{ success: boolean; result: Record<string, any> }> {
		try {
			const requestedPath = givenPath;
			// If no path specified, return root drives list
			if (!requestedPath) {
				const drives = await this.getRootDrives();

				// Convert drives to items with proper timestamps
				const itemsWithStats = await Promise.all(
					drives.result.map(async (drive: any) => {
						try {
							const stats = await stat(drive.path);
							return {
								name: drive.name,
								path: drive.path,
								type: drive.type,
								isDirectory: drive.isDirectory,
								size: stats.isDirectory() ? 0 : stats.size,
								modifiedAt: stats.mtime,
								owner: stats.uid,
								permissions: this.formatPermissions(stats.mode),
							};
						} catch (error) {
							// If we can't stat the path, return without timestamp info
							return {
								name: drive.name,
								path: drive.path,
								type: drive.type,
								isDirectory: drive.isDirectory,
								size: 0,
								modifiedAt: new Date(0), // Epoch time as fallback
								owner: '',
								permissions: '',
							};
						}
					})
				);

				return {
					success: drives.success,
					result: {
						path: '/',
						items: itemsWithStats,
					},
				};
			}

			// ...existing code for handling specific paths...
			const formattedPath = requestedPath;
			const normalizedPath = formattedPath.match(/^[A-Za-z]:$/)
				? formattedPath + '\\'
				: formattedPath;

			const items = await readdir(normalizedPath, { withFileTypes: true });
			const contents = await Promise.all(
				items.map(async item => {
					try {
						const fullPath = path.join(formattedPath, item.name).split(path.sep).join('/');
						const stats = await stat(fullPath);

						return {
							name: item.name,
							path: fullPath,
							type: item.isDirectory() ? 'directory' : 'file',
							isDirectory: item.isDirectory(),
							size: stats.size,
							modifiedAt: stats.mtime,
							owner: stats.uid,
							permissions: this.formatPermissions(stats.mode),
						};
					} catch (error: any) {
						// Skip protected system directories/files
						return null;
					}
				})
			).then(results => results.filter(item => item !== null));

			const sortedContents = contents.sort((a, b) => {
				if (a.isDirectory && !b.isDirectory) return -1;
				if (!a.isDirectory && b.isDirectory) return 1;
				return a.name.localeCompare(b.name);
			});

			return {
				success: true,
				result: {
					path: requestedPath,
					items: sortedContents,
				},
			};
		} catch (error: any) {
			console.log('error :', error);
			return {
				success: false,
				result: error?.message || 'Failed to read directory contents',
			};
		}
	}
	private formatPermissions(mode: number): string {
		const permissions = [
			mode & 0o400 ? 'r' : '-',
			mode & 0o200 ? 'w' : '-',
			mode & 0o100 ? 'x' : '-',
			mode & 0o040 ? 'r' : '-',
			mode & 0o020 ? 'w' : '-',
			mode & 0o010 ? 'x' : '-',
			mode & 0o004 ? 'r' : '-',
			mode & 0o002 ? 'w' : '-',
			mode & 0o001 ? 'x' : '-',
		];

		// Add file type indicator
		const fileType = (mode & 0o170000) === 0o040000 ? 'd' : '-';
		return fileType + permissions.join('');
	}
	async getOSVersion(): Promise<{ success: boolean; result: string }> {
		const osInfo = await si.osInfo();
		const detailedOS = `${osInfo.distro} ${osInfo.release}`;
		return { success: true, result: detailedOS };
	}
	async updateRestic(): Promise<{ success: boolean; result: string }> {
		try {
			const newVersion = await this.executeUpdateScript('restic');
			return {
				success: true,
				result: newVersion,
			};
		} catch (error: any) {
			return {
				success: false,
				result: error?.message || 'Failed to update restic via script',
			};
		}
	}

	async updateRclone(): Promise<{ success: boolean; result: string }> {
		try {
			const newVersion = await this.executeUpdateScript('rclone');
			return {
				success: true,
				result: newVersion,
			};
		} catch (error: any) {
			return {
				success: false,
				result: error?.message || 'Failed to update rclone via script',
			};
		}
	}

	async createRemoteStorage(
		type: string,
		name: string,
		authType: string,
		credentials: Record<string, string>,
		settings?: Record<string, string>
	): Promise<{ success: boolean; result: string }> {
		return await this.storageManager.createRemote(type, name, authType, credentials, settings);
	}

	async updateRemoteStorage(
		storageName: string,
		settings: { old: Record<string, any>; new: Record<string, any> }
	) {
		const remoteResult = await this.storageManager.updateRemote(
			storageName,
			settings.new,
			settings.old
		);
		return remoteResult;
	}

	async removeRemoteStorage(storageName: string) {
		const remoteResult = await this.storageManager.deleteRemote(storageName);
		return remoteResult;
	}

	async updateSettings(
		deviceSettings: DeviceSettings
	): Promise<{ success: boolean; result: string }> {
		try {
			// Persist restic global settings to data/config/restic_global.json
			if (deviceSettings.restic) {
				saveResticGlobalSettings(deviceSettings.restic);
			}

			// Persist rclone global settings to data/config/rclone_global.json
			if (deviceSettings.rclone) {
				saveRcloneGlobalSettings(deviceSettings.rclone);
			}

			return {
				success: true,
				result: 'Global rclone/restic settings updated successfully!',
			};
		} catch (error: any) {
			return {
				success: false,
				result: error?.message || 'Failed to update global settings',
			};
		}
	}

	private async executeUpdateScript(binaryName: 'restic' | 'rclone'): Promise<string> {
		const workerBaseURL = 'https://dl.usepluton.com';
		const licenseKey = process.env.LICENSE_KEY || 'no-license'; // Assuming license key is in env

		// 1. Detect OS and set script details
		const isWindows = os.platform() === 'win32';
		const scriptName = isWindows ? `update-${binaryName}.ps1` : `update-${binaryName}.sh`;
		const shellCmd = isWindows ? 'powershell.exe' : '/bin/bash';
		const shellArgs = isWindows ? ['-ExecutionPolicy', 'Bypass', '-File'] : [];

		// 2. Construct the script URL
		const scriptURL = `${workerBaseURL}/dependencies/scripts/${scriptName}?license=${licenseKey}`;

		// 3. Download the script to a temporary file
		const tempDir = await mkdtemp(path.join(appPaths.getTempDir(), 'pluton-updater-'));
		const tempScriptPath = path.join(tempDir, scriptName);

		try {
			await new Promise<void>((resolve, reject) => {
				const file = createWriteStream(tempScriptPath);
				https
					.get(scriptURL, response => {
						if (response.statusCode !== 200) {
							reject(new Error(`Failed to download script: Status Code ${response.statusCode}`));
							return;
						}
						response.pipe(file);
						file.on('finish', () => {
							file.close();
							resolve();
						});
					})
					.on('error', err => {
						reject(new Error(`Failed to download script: ${err.message}`));
					});
			});

			// 4. Make the script executable on non-Windows systems
			if (!isWindows) {
				await chmod(tempScriptPath, 0o755);
			}

			// 5. Execute the script
			const commandArgs = [shellCmd, ...shellArgs, tempScriptPath];
			const output = await runCommand(commandArgs);

			// 6. Parse output for new version
			const match = output.match(/\[SUCCESS\] New version: (.*)/);
			if (match && match[1]) {
				return match[1].trim();
			}

			// Fallback to getting version directly if parsing fails
			return binaryName === 'restic' ? getResticVersion() : getRcloneVersion();
		} finally {
			// 7. Clean up the temporary directory and its contents
			await rm(tempDir, { recursive: true, force: true });
		}
	}

	async isServerEdition(osData: si.Systeminformation.OsData): Promise<boolean> {
		const osInfo = osData ? osData : await si.osInfo();
		const distro = osInfo.distro.toLowerCase();

		// Check Windows Server editions
		if (osInfo.platform === 'win32') {
			return distro.includes('server') || distro.includes('windows server');
		}

		// Check Linux server distributions
		if (osInfo.platform === 'linux') {
			return (
				distro.includes('server') ||
				distro.includes('enterprise') ||
				distro.includes('centos') ||
				distro.includes('redhat') ||
				distro.includes('ubuntu server') ||
				distro.includes('debian') ||
				distro.includes('fedora server')
			);
		}

		// Check macOS Server (though it's discontinued, some may still use it)
		if (osInfo.platform === 'darwin') {
			return distro.includes('server');
		}

		return false;
	}

	async getMountPoints(): Promise<{
		success: boolean;
		result: string | DiscoveredFilesystem[];
	}> {
		try {
			// Only Linux supports lsblk natively
			if (os.platform() !== 'linux') {
				return { success: false, result: 'lsblk is only supported on Linux systems' };
			}

			const { stdout, stderr } = await execAsync(
				'lsblk --json -o NAME,FSTYPE,LABEL,UUID,MOUNTPOINT,SIZE'
			);
			if (stderr) {
				return { success: false, result: `Error executing lsblk: ${stderr}` };
			}

			let dfData;
			try {
				// Try to get df output, but don't fail if it doesn't work
				const { stdout: dfOutput } = await execAsync('df -h');
				dfData = this.parseDfOutput(dfOutput);
			} catch {
				console.log('df output failed!');
			}

			const filesystems = await this.analyzeBlockDevices(stdout, dfData);

			// 			const dummyOutput =
			// 				'{"blockdevices":[{"name":"vda","fstype":null,"label":null,"uuid":null,"mountpoint":null,"size":"10G","children":[{"name":"vda1","fstype":null,"label":null,"uuid":null,"mountpoint":null,"size":"1M"},{"name":"vda2","fstype":"vfat","label":null,"uuid":"A893-0D16","mountpoint":"/boot/efi","size":"256M"},{"name":"vda3","fstype":"ext4","label":null,"uuid":"fc0fca72-9290-4996-b6c3-5b963959e146","mountpoint":"/boot","size":"800M"},{"name":"vda4","fstype":"ext4","label":null,"uuid":"cbdc5f51-f4b3-4772-9d61-86cb1e2b089c","mountpoint":"/","size":"9G"}]},{"name":"vdb","fstype":"ext4","label":"ephemeral0","uuid":"e8afea20-c269-4593-9347-2622cd524c1e","mountpoint":"/data","size":"300G"}]}';
			// 			const dummyDFOutput = `Filesystem      Size  Used Avail Use% Mounted on
			// tmpfs           1.2G  976K  1.2G   1% /run
			// efivarfs         56K   16K   36K  30% /sys/firmware/efi/efivars
			// /dev/vda4       8.8G  4.2G  4.2G  51% /
			// tmpfs           5.9G     0  5.9G   0% /dev/shm
			// tmpfs           5.0M     0  5.0M   0% /run/lock
			// /dev/vdb        295G  612M  279G   1% /data
			// /dev/vda3       770M   65M  650M  10% /boot
			// /dev/vda2       256M  6.1M  250M   3% /boot/efi
			// overlay         8.8G  4.2G  4.2G  51% /var/lib/docker/overlay2/233a3438f3732cb014fbb15261647c03877ffced00278e8a6abee4c27111acd7/merged
			// tmpfs           1.2G     0  1.2G   0% /run/user/0
			// overlay         8.8G  4.2G  4.2G  51% /var/lib/docker/overlay2/6d0db4005ad4a4cdee861888afc2fa886c7afdeaef68752944ffb18b5a04ac03/merged`;
			// 			const dfData = this.parseDfOutput(dummyDFOutput);
			// 			const filesystems = await this.analyzeBlockDevices(dummyOutput, dfData);

			return { success: true, result: filesystems };
		} catch {
			return { success: false, result: 'Error executing lsblk' };
		}
	}

	/**
	 * Parses the output of `df -h` command to extract usage information
	 * @param dfOutput The raw output from `df -h` command
	 * @returns A map of mountpoint to usage information
	 */
	private parseDfOutput(
		dfOutput: string
	): Map<string, { used: string; available: string; usePercent: string }> {
		const dfMap = new Map<string, { used: string; available: string; usePercent: string }>();

		const lines = dfOutput.trim().split('\n');
		// Skip the header line
		for (let i = 1; i < lines.length; i++) {
			const line = lines[i].trim();
			if (!line) continue;

			// Split by whitespace, but handle cases where filesystem name might be on previous line
			const parts = line.split(/\s+/);

			let mountpoint: string;
			let used: string;
			let available: string;
			let usePercent: string;

			if (parts.length >= 6) {
				// Normal case: filesystem size used avail use% mountpoint
				[, , used, available, usePercent, mountpoint] = parts;
			} else if (parts.length === 5) {
				// Case where filesystem name was on previous line: size used avail use% mountpoint
				[, used, available, usePercent, mountpoint] = parts;
			} else {
				continue; // Skip malformed lines
			}

			dfMap.set(mountpoint, {
				used,
				available,
				usePercent,
			});
		}

		return dfMap;
	}

	/**
	 * Parses the JSON output of the `lsblk` command to identify and categorize
	 * all mounted filesystems for a System Rescue backup.
	 *
	 * @param lsblkJsonOutput A string containing the raw JSON from `lsblk --json -o ...`.
	 * @returns A promise that resolves to an array of DiscoveredFilesystem objects.
	 * @throws An error if the input string is not valid JSON.
	 */
	async analyzeBlockDevices(
		lsblkJsonOutput: string,
		dfData?: Map<string, { used: string; available: string; usePercent: string }>
	): Promise<DiscoveredFilesystem[]> {
		const finalFilesystems: DiscoveredFilesystem[] = [];

		//format size to GB, MB, KB, TB
		const formatSize = (size: string) =>
			size.replace('G', ' GB').replace('M', ' MB').replace('K', ' KB').replace('T', ' TB');

		// A recursive helper function to traverse the device tree.
		const processDevices = (devices: LsblkDevice[]) => {
			for (const device of devices) {
				// We only care about devices that are formatted and actively mounted.
				// This automatically ignores swap, unformatted partitions, and the parent disk itself.
				if (device.mountpoint && device.fstype) {
					const usage = dfData ? dfData.get(device.mountpoint) : undefined;
					finalFilesystems.push({
						device: device.name,
						mountpoint: device.mountpoint,
						fstype: device.fstype,
						label: device.label,
						uuid: device.uuid,
						size: formatSize(device.size),
						used: usage?.used ? formatSize(usage.used) : undefined,
						isCritical: this.isCriticalMountpoint(device.mountpoint),
					});
				}

				// If the device has children (e.g., a disk with partitions), process them.
				if (device.children && device.children.length > 0) {
					processDevices(device.children);
				}
			}
		};

		try {
			const lsblkData: LsblkOutput = JSON.parse(lsblkJsonOutput);
			if (lsblkData.blockdevices) {
				processDevices(lsblkData.blockdevices);
			}
		} catch (error) {
			console.error('Failed to parse lsblk JSON output:', error);
			throw new Error('Invalid lsblk JSON provided. Cannot analyze filesystems.');
		}

		// Sort the results to ensure a consistent and logical order in the UI.
		return finalFilesystems.sort((a, b) => a.mountpoint.localeCompare(b.mountpoint));
	}

	/**
	 * Determines if a given mount point is critical for a bootable Linux system.
	 * @param mountpoint The filesystem mount point (e.g., "/", "/boot").
	 * @returns True if the mount point is considered essential for booting.
	 */
	isCriticalMountpoint(mountpoint: string): boolean {
		const criticalPaths = [
			'/', // The root filesystem is always critical.
			'/boot', // Contains the kernel and bootloader configs. Always critical if it exists.
			'/boot/efi', // The EFI System Partition (ESP) for UEFI systems. Always critical if it exists.
		];
		return criticalPaths.includes(mountpoint);
	}
}
