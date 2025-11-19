import { DeviceStore } from '../../src/stores/DeviceStore';
import { DatabaseType } from '../../src/db';
import { NewDevice, Device } from '../../src/db/schema/devices';
import { eq, sql } from 'drizzle-orm';

describe('DeviceStore', () => {
	let deviceStore: DeviceStore;
	let mockDb: any; // Using `any` for easier mocking of the complex Drizzle type

	// Mock data for tests
	const mockDevices: Device[] = [
		{
			id: 'device-1',
			name: 'Main Server',
			type: 'device',
			ip: '192.168.1.10',
			agentId: 'agent-1',
			versions: { restic: '0.15.0', rclone: '1.60.0', agent: '1.0.0' },
			hostname: 'main-server-host',
			os: 'Ubuntu 22.04',
			platform: 'linux',
			status: 'active',
			lastSeen: new Date(),
			createdAt: new Date(),
			updatedAt: null,
			host: null,
			port: null,
			key: null,
			metrics: null,
			tags: null,
			settings: null,
		},
		{
			id: 'device-2',
			name: 'Secondary Server',
			type: 'device',
			ip: '192.168.1.11',
			agentId: 'agent-2',
			versions: { restic: '0.14.0', rclone: '1.59.0', agent: '0.9.0' },
			hostname: 'secondary-server-host',
			os: 'Windows Server 2022',
			platform: 'win32',
			status: 'inactive',
			lastSeen: new Date(Date.now() - 86400000), // 1 day ago
			createdAt: new Date(),
			updatedAt: null,
			host: null,
			port: null,
			key: null,
			metrics: null,
			tags: null,
			settings: null,
		},
	];

	beforeEach(() => {
		jest.clearAllMocks();

		// Set up mocks for Drizzle's chained query builders
		const updateQueryBuilder = {
			set: jest.fn().mockReturnThis(),
			where: jest.fn().mockReturnThis(),
			returning: jest.fn(),
		};
		const deleteQueryBuilder = {
			where: jest.fn(),
		};

		mockDb = {
			query: {
				devices: {
					findMany: jest.fn(),
					findFirst: jest.fn(),
				},
			},
			insert: jest.fn().mockReturnValue({
				values: jest.fn().mockReturnThis(),
				returning: jest.fn(),
			}),
			update: jest.fn().mockReturnValue(updateQueryBuilder),
			delete: jest.fn().mockReturnValue(deleteQueryBuilder),
		};

		deviceStore = new DeviceStore(mockDb as DatabaseType);
	});

	describe('getAll', () => {
		it('should return all devices with their associated plans', async () => {
			// Arrange
			mockDb.query.devices.findMany.mockResolvedValue(mockDevices);

			// Act
			const result = await deviceStore.getAll();

			// Assert
			expect(mockDb.query.devices.findMany).toHaveBeenCalledWith({
				with: {
					plans: {
						columns: {
							id: true,
							title: true,
							createdAt: true,
							isActive: true,
							stats: true,
							method: true,
						},
					},
				},
			});
			expect(result).toEqual(mockDevices);
		});

		it('should return null if the database query returns nothing', async () => {
			// Arrange
			mockDb.query.devices.findMany.mockResolvedValue(null);

			// Act
			const result = await deviceStore.getAll();

			// Assert
			expect(result).toBeNull();
		});
	});

	describe('getById', () => {
		it('should return a single device by its ID', async () => {
			// Arrange
			mockDb.query.devices.findFirst.mockResolvedValue(mockDevices);

			// Act
			const result = await deviceStore.getById('device-1');

			// Assert
			expect(mockDb.query.devices.findFirst).toHaveBeenCalledWith({
				where: expect.any(Object), // We trust drizzle's `eq` to work
			});
			expect(result).toEqual(mockDevices);
		});

		it('should return null for a non-existent ID', async () => {
			// Arrange
			mockDb.query.devices.findFirst.mockResolvedValue(null);

			// Act
			const result = await deviceStore.getById('non-existent-id');

			// Assert
			expect(result).toBeNull();
		});
	});

	describe('create', () => {
		it('should insert a new device and return it', async () => {
			// Arrange
			const newDeviceData: NewDevice = {
				id: 'device-3',
				name: 'New Laptop',
				type: 'device',
			};
			mockDb.insert().returning.mockResolvedValue([newDeviceData]);

			// Act
			const result = await deviceStore.create(newDeviceData);

			// Assert
			expect(mockDb.insert).toHaveBeenCalled();
			expect(mockDb.insert().values).toHaveBeenCalledWith(newDeviceData);
			expect(result).toEqual(newDeviceData);
		});
	});

	describe('update', () => {
		it('should update a device and return the updated data', async () => {
			// Arrange
			const deviceId = 'device-1';
			const updates = { name: 'Main Server (Updated)', status: 'inactive' };
			const updatedDevice = { ...mockDevices, ...updates };
			mockDb.update().returning.mockResolvedValue([updatedDevice]);

			// Act
			const result = await deviceStore.update(deviceId, updates);

			// Assert
			expect(mockDb.update).toHaveBeenCalled();
			expect(mockDb.update().set).toHaveBeenCalledWith(
				expect.objectContaining({
					...updates,
					updatedAt: expect.any(Object), // Expecting a Drizzle sql object
				})
			);
			expect(mockDb.update().where).toHaveBeenCalled();
			expect(result).toEqual(updatedDevice);
		});
	});

	describe('delete', () => {
		it('should delete a device and return true on success', async () => {
			// Arrange
			mockDb.delete().where.mockResolvedValue({ changes: 1 });

			// Act
			const result = await deviceStore.delete('device-1');

			// Assert
			expect(mockDb.delete).toHaveBeenCalled();
			expect(mockDb.delete().where).toHaveBeenCalled();
			expect(result).toBe(true);
		});

		it('should return false if no device was deleted', async () => {
			// Arrange
			mockDb.delete().where.mockResolvedValue({ changes: 0 });

			// Act
			const result = await deviceStore.delete('non-existent-id');

			// Assert
			expect(result).toBe(false);
		});
	});
});
