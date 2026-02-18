import { DeviceService } from '../../src/services/DeviceService';
import { DeviceStore } from '../../src/stores/DeviceStore';
import { PlanStore } from '../../src/stores/PlanStore';
import { StorageStore } from '../../src/stores/StorageStore';
import { BaseSystemManager } from '../../src/managers/BaseSystemManager';
import { LocalStrategy, RemoteStrategy } from '../../src/strategies/system';
import { Device } from '../../src/db/schema/devices';
import { Plan } from '../../src/db/schema/plans';
import { Storage } from '../../src/db/schema/storages';
import { DeviceMetrics } from '../../src/types/devices';

// Mock dependencies
jest.mock('../../src/stores/DeviceStore');
jest.mock('../../src/stores/PlanStore');
jest.mock('../../src/stores/StorageStore');
jest.mock('../../src/managers/BaseSystemManager');
jest.mock('../../src/strategies/system');

describe('DeviceService', () => {
	let deviceService: DeviceService;
	let mockDeviceStore: jest.Mocked<DeviceStore>;
	let mockPlanStore: jest.Mocked<PlanStore>;
	let mockStorageStore: jest.Mocked<StorageStore>;
	let mockSystemManager: jest.Mocked<BaseSystemManager>;
	let mockLocalStrategy: jest.Mocked<LocalStrategy>;
	let mockRemoteStrategy: jest.Mocked<RemoteStrategy>;

	beforeEach(() => {
		jest.clearAllMocks();

		// Instantiate mocks
		mockDeviceStore = new DeviceStore(null as any) as jest.Mocked<DeviceStore>;
		mockPlanStore = new PlanStore(null as any) as jest.Mocked<PlanStore>;
		mockStorageStore = new StorageStore(null as any) as jest.Mocked<StorageStore>;
		mockSystemManager = new BaseSystemManager() as jest.Mocked<BaseSystemManager>;

		// Mock strategy constructors and instances
		mockLocalStrategy = new LocalStrategy(mockSystemManager) as jest.Mocked<LocalStrategy>;
		mockRemoteStrategy = new RemoteStrategy('remote-device') as jest.Mocked<RemoteStrategy>;
		(LocalStrategy as jest.Mock).mockReturnValue(mockLocalStrategy);
		(RemoteStrategy as jest.Mock).mockReturnValue(mockRemoteStrategy);

		// Instantiate the service with mocked dependencies
		deviceService = new DeviceService(
			mockSystemManager,
			mockDeviceStore,
			mockPlanStore,
			mockStorageStore
		);

		// Set a mock for connected devices
		(deviceService as any).connectedDeviceIds = new Set(['main', 'remote-1']);
	});

	// ----------------------------------------
	// getSystemStrategy
	// ----------------------------------------
	describe('getSystemStrategy', () => {
		it('should return a LocalStrategy for deviceId "main"', () => {
			const strategy = deviceService.getSystemStrategy('main');
			expect(strategy).toBeInstanceOf(LocalStrategy);
		});

		it('should return a RemoteStrategy for any other deviceId', () => {
			const strategy = deviceService.getSystemStrategy('remote-device-1');
			expect(strategy).toBeInstanceOf(RemoteStrategy);
		});
	});

	// ----------------------------------------
	// getDevices
	// ----------------------------------------
	describe('getDevices', () => {
		it('should return a list of devices with connection status', async () => {
			const mockDevices = [
				{ id: 'main', name: 'Main Server' },
				{ id: 'remote-1', name: 'Remote Server 1' },
				{ id: 'remote-2', name: 'Offline Server' },
			] as Device[];
			mockDeviceStore.getAll.mockResolvedValue(mockDevices);

			const result = await deviceService.getDevices();

			expect(mockDeviceStore.getAll).toHaveBeenCalled();
			expect(result).toEqual([
				{ id: 'main', name: 'Main Server', connected: true },
				{ id: 'remote-1', name: 'Remote Server 1', connected: true },
				{ id: 'remote-2', name: 'Offline Server', connected: false },
			]);
		});

		it('should return null if the store returns null', async () => {
			mockDeviceStore.getAll.mockResolvedValue(null);
			const result = await deviceService.getDevices();
			expect(result).toBeNull();
		});
	});

	// ----------------------------------------
	// getDevice
	// ----------------------------------------
	describe('getDevice', () => {
		const deviceId = 'main';
		const mockDevice = { id: deviceId, name: 'Main Server' } as Device;
		const mockPlans = [
			{ id: 'plan-1', storageId: 'storage-1' },
			{ id: 'plan-2', storageId: 'storage-2' },
		] as Partial<Plan>[];
		const mockStorages = [
			{ id: 'storage-1', name: 'B2 Storage', type: 'b2' },
			{ id: 'storage-2', name: 'Local', type: 'local' },
		] as Storage[];

		it('should return device and plans without metrics if getMetrics is false', async () => {
			mockDeviceStore.getById.mockResolvedValue(mockDevice);
			mockPlanStore.getDevicePlans.mockResolvedValue(mockPlans as Plan[]);
			mockStorageStore.getByIds.mockResolvedValue(mockStorages);

			const result = await deviceService.getDevice(deviceId, false);

			expect(mockDeviceStore.getById).toHaveBeenCalledWith(deviceId);
			expect(mockPlanStore.getDevicePlans).toHaveBeenCalledWith(deviceId);
			expect(mockStorageStore.getByIds).toHaveBeenCalledWith(['storage-1', 'storage-2']);
			expect(result.device?.connected).toBe(true);
			expect(result.metrics).toBeNull();
			expect(result.plans).toHaveLength(2);
			expect(result.plans[0].storage.name).toBe('B2 Storage');
		});

		it('should return device, plans, and metrics if getMetrics is true', async () => {
			const mockMetrics = { system: { manufacturer: 'Dell' } } as DeviceMetrics;
			mockDeviceStore.getById.mockResolvedValue(mockDevice);
			mockPlanStore.getDevicePlans.mockResolvedValue(mockPlans as Plan[]);
			mockStorageStore.getByIds.mockResolvedValue(mockStorages);
			mockLocalStrategy.getMetrics.mockResolvedValue({ success: true, result: mockMetrics as any });

			const result = await deviceService.getDevice(deviceId, true);

			expect(mockLocalStrategy.getMetrics).toHaveBeenCalled();
			expect(result.device?.name).toBe('Main Server');
			expect(result.metrics).toEqual(mockMetrics);
		});

		it('should throw an error if the device is not found', async () => {
			mockDeviceStore.getById.mockResolvedValue(null);
			await expect(deviceService.getDevice(deviceId, false)).rejects.toThrow('Device not found.');
		});

		it('should return null for metrics if the strategy fails', async () => {
			mockDeviceStore.getById.mockResolvedValue(mockDevice);
			mockPlanStore.getDevicePlans.mockResolvedValue([]);
			mockLocalStrategy.getMetrics.mockResolvedValue({ success: false, result: 'Failed' as any });

			const result = await deviceService.getDevice(deviceId, true);

			expect(result.metrics).toBeNull();
			expect(result.device).toBeDefined();
		});
	});

	// ----------------------------------------
	// updateDevice
	// ----------------------------------------
	describe('updateDevice', () => {
		const deviceId = 'remote-1';
		const mockDevice = { id: deviceId, name: 'Old Name' } as Device;
		const updateData = { name: 'New Name', tags: ['updated'] };

		it('should update a device in the store', async () => {
			mockDeviceStore.getById.mockResolvedValue(mockDevice);
			mockDeviceStore.update.mockResolvedValue({ ...mockDevice, ...updateData });

			const result = await deviceService.updateDevice(deviceId, updateData);

			expect(mockDeviceStore.getById).toHaveBeenCalledWith(deviceId);
			expect(mockDeviceStore.update).toHaveBeenCalledWith(deviceId, updateData);
			expect(result?.name).toBe('New Name');
		});

		it('should call updateSettings on the strategy for a remote device', async () => {
			const settingsUpdate = { settings: { tempDir: '/new/temp' } };
			mockDeviceStore.getById.mockResolvedValue(mockDevice);
			mockRemoteStrategy.updateSettings.mockResolvedValue({ success: true, result: 'Updated' });

			await deviceService.updateDevice(deviceId, settingsUpdate);

			expect(mockRemoteStrategy.updateSettings).toHaveBeenCalledWith(settingsUpdate.settings);
			expect(mockDeviceStore.update).toHaveBeenCalledWith(
				deviceId,
				expect.objectContaining({ settings: settingsUpdate.settings })
			);
		});

		it('should throw an error if device is not found', async () => {
			mockDeviceStore.getById.mockResolvedValue(null);
			await expect(deviceService.updateDevice(deviceId, updateData)).rejects.toThrow(
				'Device not found.'
			);
		});

		it('should throw an error if updating settings on a remote device fails', async () => {
			const settingsUpdate = { settings: { tempDir: '/new/temp' } };
			mockDeviceStore.getById.mockResolvedValue(mockDevice);
			mockRemoteStrategy.updateSettings.mockResolvedValue({
				success: false,
				result: 'Failed',
			});

			await expect(deviceService.updateDevice(deviceId, settingsUpdate)).rejects.toThrow(
				'Failed to update device settings'
			);
		});
	});

	// ----------------------------------------
	// updateRestic & updateRclone
	// ----------------------------------------
	describe.each([
		['Restic', 'updateRestic', 'restic'],
		['Rclone', 'updateRclone', 'rclone'],
	])('update%s', (name, methodName, versionKey) => {
		const method = methodName as 'updateRestic' | 'updateRclone';
		const deviceId = 'remote-1';
		const mockDevice = { id: deviceId, versions: { restic: '0.15.0', rclone: '1.60.0' } } as Device;
		const newVersion = '1.99.0';

		it(`should call the remote strategy to update ${name} and update the store`, async () => {
			const strategyMethod = jest
				.spyOn(mockRemoteStrategy, method)
				.mockResolvedValue({ success: true, result: newVersion });
			mockDeviceStore.getById.mockResolvedValue(mockDevice);

			const result = await (deviceService[method] as any)(deviceId, newVersion);

			expect(strategyMethod).toHaveBeenCalled();
			expect(mockDeviceStore.update).toHaveBeenCalledWith(
				deviceId,
				expect.objectContaining({
					versions: expect.objectContaining({ [versionKey]: newVersion }),
				})
			);
			expect(result).toBe(newVersion);
		});

		it(`should throw an error if the ${name} update strategy fails`, async () => {
			const strategyMethod = jest
				.spyOn(mockRemoteStrategy, method)
				.mockResolvedValue({ success: false, result: 'Failed' });
			mockDeviceStore.getById.mockResolvedValue(mockDevice);

			await expect((deviceService[method] as any)(deviceId, newVersion)).rejects.toThrow(
				`Failed to update ${name.toLowerCase()}`
			);
			expect(mockDeviceStore.update).not.toHaveBeenCalled();
		});

		it(`should throw an error if the device is not found`, async () => {
			mockDeviceStore.getById.mockResolvedValue(null);
			await expect((deviceService[method] as any)(deviceId, newVersion)).rejects.toThrow(
				'Device not found.'
			);
		});
	});
});
