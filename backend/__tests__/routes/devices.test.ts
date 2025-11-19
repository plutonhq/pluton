import request from 'supertest';
import express, { Express } from 'express';
import { createDeviceRouter } from '../../src/routes/devices';
import { DeviceController } from '../../src/controllers/DeviceController';
import { DeviceService } from '../../src/services/DeviceService';
import jwt from 'jsonwebtoken';
import Cookies from 'cookies';

jest.mock('jsonwebtoken');
jest.mock('cookies');
jest.mock('../../src/services/ConfigService', () => ({
	configService: {
		config: {
			SECRET: 'test-secret',
		},
	},
}));

describe('Device Routes', () => {
	let app: Express;
	let deviceController: DeviceController;
	let mockDeviceService: jest.Mocked<DeviceService>;

	// Helper function to setup auth mocking
	const setupAuthMock = (authenticated: boolean) => {
		if (authenticated) {
			(Cookies as jest.MockedClass<typeof Cookies>).mockImplementation(
				() =>
					({
						get: jest.fn().mockReturnValue('valid-token'),
					}) as any
			);
			(jwt.verify as jest.Mock).mockImplementation((token, secret, callback) => {
				callback(null, { user: 'testuser' });
			});
		} else {
			(Cookies as jest.MockedClass<typeof Cookies>).mockImplementation(
				() =>
					({
						get: jest.fn().mockReturnValue(null),
					}) as any
			);
		}
	};

	beforeEach(() => {
		jest.clearAllMocks();

		mockDeviceService = {
			getDevices: jest.fn(),
			getDevice: jest.fn(),
			updateDevice: jest.fn(),
			getMetrics: jest.fn(),
			getBrowsePath: jest.fn(),
			updateRestic: jest.fn(),
			updateRclone: jest.fn(),
		} as any;

		deviceController = new DeviceController(mockDeviceService);

		app = express();
		app.use(express.json());
		app.use('/api/devices', createDeviceRouter(deviceController));

		// Default to authenticated for most tests
		setupAuthMock(true);
	});

	describe('GET /api/devices', () => {
		it('should return 401 if not authenticated', async () => {
			setupAuthMock(false);

			const response = await request(app).get('/api/devices');

			expect(response.status).toBe(401);
		});

		it('should return list of devices when authenticated', async () => {
			mockDeviceService.getDevices.mockResolvedValue([
				{ id: '1', name: 'Device 1' },
				{ id: '2', name: 'Device 2' },
			] as any);

			const response = await request(app).get('/api/devices');

			expect(response.status).toBe(200);
			expect(mockDeviceService.getDevices).toHaveBeenCalled();
		});
	});

	describe('GET /api/devices/:id', () => {
		it('should return 401 if not authenticated', async () => {
			setupAuthMock(false);

			const response = await request(app).get('/api/devices/device-1');

			expect(response.status).toBe(401);
		});

		it('should return a specific device when authenticated', async () => {
			mockDeviceService.getDevice.mockResolvedValue({
				device: { id: 'device-1', name: 'Test Device' },
			} as any);

			const response = await request(app).get('/api/devices/device-1');

			expect(response.status).toBe(200);
			expect(mockDeviceService.getDevice).toHaveBeenCalledWith('device-1', false);
		});
	});

	describe('PUT /api/devices/:id', () => {
		it('should return 401 if not authenticated', async () => {
			setupAuthMock(false);

			const response = await request(app)
				.put('/api/devices/device-1')
				.send({ name: 'Updated Device' });

			expect(response.status).toBe(401);
		});

		it('should update a device when authenticated', async () => {
			mockDeviceService.updateDevice.mockResolvedValue({
				id: 'device-1',
				name: 'Updated Device',
			} as any);

			const response = await request(app)
				.put('/api/devices/device-1')
				.send({ name: 'Updated Device' });

			expect(response.status).toBe(200);
			expect(mockDeviceService.updateDevice).toHaveBeenCalledWith('device-1', {
				name: 'Updated Device',
			});
		});
	});

	describe('GET /api/devices/:id/metrics', () => {
		it('should return 401 if not authenticated', async () => {
			setupAuthMock(false);

			const response = await request(app).get('/api/devices/device-1/metrics');

			expect(response.status).toBe(401);
		});

		it('should return device metrics when authenticated', async () => {
			mockDeviceService.getMetrics.mockResolvedValue({
				cpu: 50,
				memory: 75,
			} as any);

			const response = await request(app).get('/api/devices/device-1/metrics');

			expect(response.status).toBe(200);
			expect(mockDeviceService.getMetrics).toHaveBeenCalledWith('device-1');
		});
	});

	describe('GET /api/devices/:id/browse', () => {
		it('should return 401 if not authenticated', async () => {
			setupAuthMock(false);

			const response = await request(app).get('/api/devices/device-1/browse');

			expect(response.status).toBe(401);
		});

		it('should return browse path results when authenticated', async () => {
			mockDeviceService.getBrowsePath.mockResolvedValue({
				files: ['file1.txt', 'file2.txt'],
			} as any);

			const response = await request(app)
				.get('/api/devices/device-1/browse')
				.query({ path: '/home/user' });

			expect(response.status).toBe(200);
			expect(mockDeviceService.getBrowsePath).toHaveBeenCalled();
		});
	});

	describe('POST /api/devices/:id/action/update/restic', () => {
		it('should return 401 if not authenticated', async () => {
			setupAuthMock(false);

			const response = await request(app)
				.post('/api/devices/device-1/action/update/restic')
				.query({ version: '0.16.0' });

			expect(response.status).toBe(401);
		});

		it('should update restic when authenticated', async () => {
			mockDeviceService.updateRestic.mockResolvedValue({ success: true } as any);

			const response = await request(app)
				.post('/api/devices/device-1/action/update/restic')
				.query({ version: '0.16.0' });

			expect(response.status).toBe(200);
			expect(mockDeviceService.updateRestic).toHaveBeenCalledWith('device-1', '0.16.0');
		});
	});

	describe('POST /api/devices/:id/action/update/rclone', () => {
		it('should return 401 if not authenticated', async () => {
			setupAuthMock(false);

			const response = await request(app)
				.post('/api/devices/device-1/action/update/rclone')
				.query({ version: '1.60.0' });

			expect(response.status).toBe(401);
		});

		it('should update rclone when authenticated', async () => {
			mockDeviceService.updateRclone.mockResolvedValue({ success: true } as any);

			const response = await request(app)
				.post('/api/devices/device-1/action/update/rclone')
				.query({ version: '1.60.0' });

			expect(response.status).toBe(200);
			expect(mockDeviceService.updateRclone).toHaveBeenCalledWith('device-1', '1.60.0');
		});
	});
});
