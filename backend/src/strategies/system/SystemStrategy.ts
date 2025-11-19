import { StrategyMethodTypes } from '../../types/strategy';
import { DeviceSettings, DiscoveredFilesystem } from '../../types/devices';

export interface SystemStrategy {
	getMetrics(): Promise<{ success: boolean; result: any }>;
	getVersions(): Promise<{ success: boolean; result: Record<string, string | number> }>;
	checkDiskSpace(): Promise<{ success: boolean; result: string | Record<string, any> }>;
	getBrowsePath(
		givenPath?: string
	): Promise<{ success: boolean; result: Record<string, string | number> }>;
	getRootDrives(): Promise<{ success: boolean; result: Record<string, string | number> }>;
	getOSVersion(): Promise<{ success: boolean; result: string }>;
	updateRestic(): Promise<{ success: boolean; result: string }>;
	updateRclone(): Promise<{ success: boolean; result: string }>;
	updateAgent?(): Promise<{ success: boolean; result: string }>;
	updateSettings(settings: DeviceSettings): Promise<{ success: boolean; result: string }>;
	createRemoteStorage(
		type: string,
		name: string,
		authType: string,
		credentials: Record<string, string>,
		settings?: Record<string, string>
	): Promise<{ success: boolean; result: string }>;
	updateRemoteStorage(
		storageName: string,
		settings: { old: Record<string, any>; new: Record<string, any> }
	): Promise<{ success: boolean; result: string }>;
	removeRemoteStorage(storageName: string): Promise<{ success: boolean; result: string }>;
	getMountPoints(): Promise<{ success: boolean; result: string | DiscoveredFilesystem[] }>;
	getAgentVersion?(): Promise<{ success: boolean; result: string }>;
}

export type SystemStrategyTypes = StrategyMethodTypes<SystemStrategy>;
