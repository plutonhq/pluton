import path from 'path';
import { Device } from '../db/schema/devices';
import { BaseSystemManager } from '../managers/BaseSystemManager';
import { DeviceStore } from '../stores/DeviceStore';
import { PlanStore } from '../stores/PlanStore';
import { DeviceDependencyVersions, DeviceMetrics } from '../types/devices';
import { DeviceLogger } from '../utils/logger';
import { LocalStrategy, RemoteStrategy, SystemStrategy } from '../strategies/system';
import { StorageStore } from '../stores/StorageStore';
import { providers } from '../utils/providers';
import { configService } from './ConfigService';
import { AppError } from '../utils/AppError';

export class DeviceService {
	protected connectedDeviceIds: Set<string> | undefined;

	constructor(
		protected localSystemManager: BaseSystemManager,
		protected deviceStore: DeviceStore,
		protected planStore: PlanStore,
		protected storageStore: StorageStore
	) {}

	getSystemStrategy(deviceId: string): SystemStrategy {
		const isRemote = deviceId !== 'main';
		return isRemote ? new RemoteStrategy(deviceId) : new LocalStrategy(this.localSystemManager);
	}

	/**
	 * Retrieves all devices.
	 */
	async getDevices(): Promise<(Device & { connected: boolean })[] | null> {
		const allDevices = await this.deviceStore.getAll();

		return (
			allDevices?.map(device => ({
				...device,
				connected: this.connectedDeviceIds?.has(device.id) || false,
			})) || null
		);
	}

	/**
	 * Retrieves a device by its ID.
	 */
	async getDevice(
		id: string,
		getMetrics: boolean
	): Promise<{
		device: (Device & { connected: boolean }) | null;
		metrics: DeviceMetrics | null;
		plans: Record<string, any>[];
	}> {
		const deviceRaw = await this.deviceStore.getById(id);
		if (!deviceRaw) {
			throw new Error('Device not found.');
		}

		const device = {
			...deviceRaw,
			connected: this.connectedDeviceIds?.has(deviceRaw.id) || false,
		};

		// Get Device Plans
		const plans = await this.planStore.getDevicePlans(id);
		const devicePlans =
			(plans &&
				plans.map(plan => ({
					id: plan.id,
					title: plan.title,
					method: plan.method,
					createdAt: plan.createdAt,
					isActive: plan.isActive,
					sourceConfig: plan.sourceConfig,
					storage: {
						id: plan.storageId,
						path: plan.storagePath,
						name: '',
						type: '',
						typeName: '',
						size: 0,
					},
					size: plan.stats?.size || 0,
				}))) ||
			[];

		// Get Storage Details
		const storageIds = devicePlans.map(p => p.storage.id).filter(i => i !== null);
		if (storageIds.length > 0) {
			const storages = await this.storageStore.getByIds(storageIds);
			if (storages && storages.length > 0) {
				devicePlans.forEach(p => {
					const theStorage = storages.find(s => s.id === p.storage.id);
					if (theStorage) {
						p.storage.name = theStorage.name;
						p.storage.type = theStorage.type || '';
						p.storage.typeName = theStorage.type
							? theStorage.type in providers
								? providers[theStorage.type].name
								: theStorage.type
							: '';
					}
				});
			}
		}

		if (!getMetrics) {
			return { device, metrics: null, plans: devicePlans };
		} else {
			try {
				const strategy = this.getSystemStrategy(id);
				const metricsResp = await strategy.getMetrics();
				const fetchedMetrics =
					metricsResp.result &&
					metricsResp.success &&
					typeof metricsResp.result !== 'string' &&
					metricsResp.result.system;

				return {
					device,
					metrics: fetchedMetrics ? metricsResp.result : null,
					plans: devicePlans,
				};
			} catch (error: any) {
				console.log('🎃Error fetching device metrics:', error);
				DeviceLogger(id).error(
					`Error fetching device data for #${id}. Reason : ${error?.message.toString() || 'Unknown Error'}`
				);
				return { device, metrics: null, plans: [] };
			}
		}
	}

	/**
	 * Updates a device.
	 */
	async updateDevice(
		id: string,
		data: { name?: string; settings?: any; tags?: string[] }
	): Promise<Device | null> {
		const existingDevice = await this.deviceStore.getById(id);

		if (!existingDevice) {
			throw new Error('Device not found.');
		}

		const updatedObj: { name?: string; settings?: any; tags?: string[] } = {};
		if (data.name) {
			updatedObj.name = data.name;
		}

		if (data.settings) {
			updatedObj.settings = data.settings;
		}

		if (data.tags) {
			updatedObj.tags = data.tags;
		}

		// TODO: set the restic and rclone settings values as env variables from the device settings
		if (data.settings) {
			if (existingDevice.id !== 'main') {
				try {
					const strategy = this.getSystemStrategy(id);
					const updateResp = await strategy.updateSettings(data.settings);
					if (!updateResp.success) {
						throw new Error('Failed to update device settings');
					}
				} catch (error: any) {
					throw new Error('Failed to update device settings');
				}
			}
		}

		const device = await this.deviceStore.update(id, updatedObj);
		return device;
	}

	async getMetrics(id: string): Promise<DeviceMetrics | null> {
		const device = await this.deviceStore.getById(id);
		if (!device) {
			throw new Error('Device not found.');
		}

		const strategy = this.getSystemStrategy(id);
		const response = await strategy.getMetrics();
		if (!response.success) {
			throw new Error('Failed to get Device metrics');
		}
		const fetchedMetrics =
			typeof response.result !== 'string' && response.success && response.result?.system;

		if (fetchedMetrics) {
			const metrics = response.result as DeviceMetrics & {
				versions: DeviceDependencyVersions;
			};
			// const detailedOS = `${osInfo.distro} ${osInfo.release}`;
			const payload: Partial<Device> = {
				metrics: metrics,
				lastSeen: new Date(),
				status: 'active',
			};
			payload.versions = device.versions || { restic: '', rclone: '', agent: '' };
			if (metrics.versions?.restic) {
				payload.versions.restic = metrics.versions.restic;
			}
			if (metrics.versions?.rclone) {
				payload.versions.rclone = metrics.versions.rclone;
			}
			if (metrics.versions?.agent) {
				payload.versions.agent = metrics.versions.agent;
			}
			if (metrics.os.hostname && metrics.os.hostname !== 'unknown') {
				payload.hostname = metrics.os.hostname;
			}
			if (metrics.os.platform && metrics.os.platform !== 'unknown') {
				payload.platform = metrics.os.platform;
			}
			if (metrics.os.platform && metrics.os.platform !== 'unknown') {
				const detailedOS = `${metrics.os.distro} ${metrics.os.release}`;
				payload.os = detailedOS;
			}

			await this.deviceStore.update(id, payload);
		}
		return response.result;
	}

	async getBrowsePath(id: string, reqPath: string): Promise<any> {
		const device = await this.deviceStore.getById(id);
		if (!device) {
			throw new AppError(404, 'Device not found.');
		}

		if (configService.config.ALLOW_FILE_BROWSER === false) {
			throw new AppError(403, 'File browser is disabled');
		}

		const browserRoot = configService.config.FILE_BROWSER_ROOT;
		if (browserRoot && reqPath) {
			const resolved = path.resolve(reqPath);
			const resolvedRoot = path.resolve(browserRoot);
			if (!resolved.startsWith(resolvedRoot)) {
				throw new AppError(403, 'Access denied: path outside allowed root');
			}
		}

		const strategy = this.getSystemStrategy(id);
		const response = await strategy.getBrowsePath(reqPath);
		return response;
	}

	async getMountPoints(id: string): Promise<any> {
		const device = await this.deviceStore.getById(id);
		if (!device) {
			throw new AppError(404, 'Device not found.');
		}

		const strategy = this.getSystemStrategy(id);
		const response = await strategy.getMountPoints();
		return response;
	}

	async updateRestic(id: string, version: string): Promise<string> {
		const device = await this.deviceStore.getById(id);
		if (!device) {
			throw new AppError(404, 'Device not found.');
		}

		const strategy = this.getSystemStrategy(id);
		const response = await strategy.updateRestic();
		const updatedVersion = response.result;
		if (!response.success) {
			throw new AppError(500, 'Failed to update restic');
		}

		try {
			const versions = device.versions || { restic: '', rclone: '', agent: '' };
			if (updatedVersion) {
				versions.restic = updatedVersion;
			}
			await this.deviceStore.update(id, { versions });
		} catch (error) {
			console.error('[updateRestic] Error updating device store:', error);
		}

		return response.result;
	}

	async updateRclone(id: string, version: string): Promise<string> {
		const device = await this.deviceStore.getById(id);
		if (!device) {
			throw new AppError(404, 'Device not found.');
		}

		const strategy = this.getSystemStrategy(id);
		const response = await strategy.updateRclone();
		const updatedVersion = response.result;

		if (!response.success) {
			throw new AppError(500, 'Failed to update rclone');
		}
		try {
			const versions = device.versions || { restic: '', rclone: '', agent: '' };
			if (updatedVersion) {
				versions.rclone = updatedVersion;
			}
			await this.deviceStore.update(id, { versions });
		} catch (error) {
			console.error('[updateRclone] Error updating device store:', error);
		}

		return response.result;
	}
}
