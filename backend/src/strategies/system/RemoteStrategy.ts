import { DeviceSettings, DiscoveredFilesystem } from '../../types/devices';
import { SystemStrategy } from './SystemStrategy';

export class RemoteStrategy implements SystemStrategy {
	protected deviceId: string;

	constructor(deviceId: string) {
		this.deviceId = deviceId;
	}

	async getMetrics(): Promise<{ success: boolean; result: Record<string, string | number> }> {
		return await this.publishCommand('GET_METRICS', {});
	}

	async getVersions(): Promise<{ success: boolean; result: Record<string, string | number> }> {
		return await this.publishCommand('GET_VERSIONS', {});
	}

	async checkDiskSpace(): Promise<{ success: boolean; result: Record<string, string | number> }> {
		return await this.publishCommand('CHECK_DISKSPACE', {});
	}

	async getBrowsePath(
		givenPath?: string
	): Promise<{ success: boolean; result: Record<string, string | number> }> {
		return await this.publishCommand('GET_BROWSE_PATH', { givenPath: givenPath });
	}

	async getRootDrives(): Promise<{ success: boolean; result: Record<string, string | number> }> {
		return await this.publishCommand('GET_ROOTDRIVES', {});
	}

	async getMountPoints(): Promise<{ success: boolean; result: string | DiscoveredFilesystem[] }> {
		return await this.publishCommand('GET_MOUNT_POINTS', {});
	}

	async getOSVersion(): Promise<{ success: boolean; result: string }> {
		return await this.publishCommand('GET_OS_VERSION', {});
	}

	async updateRestic(): Promise<{ success: boolean; result: string }> {
		return await this.publishCommand('UPDATE_RESTIC', {});
	}

	async updateRclone(): Promise<{ success: boolean; result: string }> {
		return await this.publishCommand('UPDATE_RCLONE', {});
	}

	async updateSettings(settings: DeviceSettings): Promise<{ success: boolean; result: string }> {
		return await this.publishCommand('UPDATE_SETTINGS', { settings });
	}

	async createRemoteStorage(
		type: string,
		name: string,
		authType: string,
		credentials: Record<string, string>,
		settings?: Record<string, string>
	): Promise<{ success: boolean; result: string }> {
		return await this.publishCommand('CREATE_REMOTE_STORAGE', {
			type,
			name,
			authType,
			credentials,
			settings,
		});
	}

	async updateRemoteStorage(
		storageName: string,
		settings: { old: Record<string, any>; new: Record<string, any> }
	): Promise<{ success: boolean; result: string }> {
		console.log('UPDATE_REMOTE_STORAGE :', storageName, settings);
		return await this.publishCommand('UPDATE_REMOTE_STORAGE', { storageName, settings });
	}
	async removeRemoteStorage(storageName: string): Promise<{ success: boolean; result: string }> {
		return await this.publishCommand('REMOVE_REMOTE_STORAGE', { storageName });
	}

	protected publishCommand(
		action: string,
		payload: any
	): Promise<{ success: boolean; result: any }> {
		console.log(
			'[MQTT] Publishing command:',
			this.deviceId,
			`command/system/${this.deviceId}/${action}`
		);
		return new Promise((resolve, reject) => {
			resolve({ success: true, result: null });
		});
	}
}
