import { SystemStrategy } from './SystemStrategy';
import { DeviceSettings, DiscoveredFilesystem } from '../../types/devices';
import { BaseSystemManager } from '../../managers/BaseSystemManager';

export class LocalStrategy implements SystemStrategy {
	constructor(protected localAgent: BaseSystemManager) {}

	async getMetrics(): Promise<{ success: boolean; result: Record<string, string | number> }> {
		return await this.localAgent.getMetrics();
	}

	async getVersions(): Promise<{ success: boolean; result: Record<string, string | number> }> {
		return await this.localAgent.getVersions();
	}

	async checkDiskSpace(): Promise<{ success: boolean; result: string | Record<string, any> }> {
		return await this.localAgent.checkDiskSpace();
	}

	async getBrowsePath(
		givenPath?: string
	): Promise<{ success: boolean; result: Record<string, string | number> }> {
		return await this.localAgent.getBrowsePath(givenPath);
	}

	async getMountPoints(): Promise<{ success: boolean; result: string | DiscoveredFilesystem[] }> {
		return await this.localAgent.getMountPoints();
	}

	async getRootDrives(): Promise<{ success: boolean; result: Record<string, string | number> }> {
		return await this.localAgent.getRootDrives();
	}

	async getOSVersion(): Promise<{ success: boolean; result: string }> {
		return await this.localAgent.getOSVersion();
	}

	async updateRestic(): Promise<{ success: boolean; result: string }> {
		return await this.localAgent.updateRestic();
	}

	async updateRclone(): Promise<{ success: boolean; result: string }> {
		return await this.localAgent.updateRclone();
	}

	async updateSettings(settings: DeviceSettings): Promise<{ success: boolean; result: string }> {
		return await this.localAgent.updateSettings(settings);
	}

	async createRemoteStorage(
		type: string,
		name: string,
		authType: string,
		credentials: Record<string, string>,
		settings?: Record<string, string>
	): Promise<{ success: boolean; result: string }> {
		return await this.localAgent.createRemoteStorage(type, name, authType, credentials, settings);
	}

	async updateRemoteStorage(
		storageName: string,
		settings: { old: Record<string, any>; new: Record<string, any> }
	): Promise<{ success: boolean; result: string }> {
		return await this.localAgent.updateRemoteStorage(storageName, settings);
	}
	async removeRemoteStorage(storageName: string): Promise<{ success: boolean; result: string }> {
		return await this.localAgent.removeRemoteStorage(storageName);
	}
}
