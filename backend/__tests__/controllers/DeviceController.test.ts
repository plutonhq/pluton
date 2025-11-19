import { Request, Response } from 'express';
import { DeviceController } from '../../src/controllers/DeviceController';
import { DeviceService } from '../../src/services/DeviceService';

jest.mock('../../src/services/DeviceService');

describe('DeviceController', () => {
	let deviceController: DeviceController;
	let mockDeviceService: jest.Mocked<DeviceService>;
	let mockRequest: Partial<Request>;
	let mockResponse: Partial<Response>;
	let mockJson: jest.Mock;
	let mockStatus: jest.Mock;

	beforeEach(() => {
		jest.clearAllMocks();

		mockDeviceService = new DeviceService(
			null as any,
			null as any,
			null as any,
			null as any
		) as jest.Mocked<DeviceService>;

		mockJson = jest.fn().mockReturnThis();
		mockStatus = jest.fn().mockReturnValue({ json: mockJson });

		mockResponse = {
			json: mockJson,
			status: mockStatus,
		};

		mockRequest = {
			params: {},
			query: {},
			body: {},
		};

		deviceController = new DeviceController(mockDeviceService);
	});

	describe('getDevices', () => {
		it('should successfully get all devices', async () => {
			const mockDevices = [
				{ id: 'device-1', name: 'Device 1' },
				{ id: 'device-2', name: 'Device 2' },
			];
			mockDeviceService.getDevices.mockResolvedValue(mockDevices as any);

			await deviceController.getDevices(mockRequest as Request, mockResponse as Response);

			expect(mockDeviceService.getDevices).toHaveBeenCalled();
			expect(mockJson).toHaveBeenCalledWith({
				success: true,
				result: mockDevices,
			});
		});

		it('should return 500 if service throws an error', async () => {
			mockDeviceService.getDevices.mockRejectedValue(new Error('Database error'));

			await deviceController.getDevices(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(500);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Failed to fetch devices',
			});
		});
	});

	describe('getDevice', () => {
		it('should return 400 if device ID is missing', async () => {
			mockRequest.params = {};

			await deviceController.getDevice(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(400);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Device ID is required',
			});
		});

		it('should successfully get device without metrics', async () => {
			const mockDevice = { device: { id: 'device-1', name: 'Device 1' } };
			mockRequest.params = { id: 'device-1' };
			mockRequest.query = {};
			mockDeviceService.getDevice.mockResolvedValue(mockDevice as any);

			await deviceController.getDevice(mockRequest as Request, mockResponse as Response);

			expect(mockDeviceService.getDevice).toHaveBeenCalledWith('device-1', false);
			expect(mockStatus).toHaveBeenCalledWith(200);
			expect(mockJson).toHaveBeenCalledWith({
				success: true,
				result: mockDevice,
			});
		});

		it('should successfully get device with metrics', async () => {
			const mockDevice = { device: { id: 'device-1', name: 'Device 1' }, metrics: {} };
			mockRequest.params = { id: 'device-1' };
			mockRequest.query = { metrics: 'true' };
			mockDeviceService.getDevice.mockResolvedValue(mockDevice as any);

			await deviceController.getDevice(mockRequest as Request, mockResponse as Response);

			expect(mockDeviceService.getDevice).toHaveBeenCalledWith('device-1', true);
			expect(mockStatus).toHaveBeenCalledWith(200);
		});

		it('should return 404 if device not found', async () => {
			mockRequest.params = { id: 'device-1' };
			mockDeviceService.getDevice.mockResolvedValue({ device: null } as any);

			await deviceController.getDevice(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(404);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Device not found',
			});
		});

		it('should return 404 if service throws not found error', async () => {
			mockRequest.params = { id: 'device-1' };
			mockDeviceService.getDevice.mockRejectedValue(new Error('Device not found'));

			await deviceController.getDevice(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(404);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Failed to fetch device',
			});
		});

		it('should return 500 for other errors', async () => {
			mockRequest.params = { id: 'device-1' };
			mockDeviceService.getDevice.mockRejectedValue(new Error('Database error'));

			await deviceController.getDevice(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(500);
		});
	});

	describe('updateDevice', () => {
		it('should return 400 if device ID is missing', async () => {
			mockRequest.params = {};

			await deviceController.updateDevice(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(400);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Device ID is required',
			});
		});

		it('should successfully update device', async () => {
			const updateData = { name: 'Updated Device', settings: {}, tags: [] };
			const updatedDevice = { id: 'device-1', ...updateData };
			mockRequest.params = { id: 'device-1' };
			mockRequest.body = updateData;
			mockDeviceService.updateDevice.mockResolvedValue(updatedDevice as any);

			await deviceController.updateDevice(mockRequest as Request, mockResponse as Response);

			expect(mockDeviceService.updateDevice).toHaveBeenCalledWith('device-1', updateData);
			expect(mockJson).toHaveBeenCalledWith({
				success: true,
				result: updatedDevice,
			});
		});

		it('should return 500 if service throws an error', async () => {
			mockRequest.params = { id: 'device-1' };
			mockRequest.body = { name: 'Updated Device' };
			mockDeviceService.updateDevice.mockRejectedValue(new Error('Update failed'));

			await deviceController.updateDevice(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(500);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Update failed',
			});
		});
	});

	describe('getMetrics', () => {
		it('should return 400 if device ID is missing', async () => {
			mockRequest.params = {};

			await deviceController.getMetrics(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(400);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Device ID is missing',
			});
		});

		it('should successfully get metrics', async () => {
			const mockMetrics = { cpu: 50, memory: 70 };
			mockRequest.params = { id: 'device-1' };
			mockDeviceService.getMetrics.mockResolvedValue(mockMetrics as any);

			await deviceController.getMetrics(mockRequest as Request, mockResponse as Response);

			expect(mockDeviceService.getMetrics).toHaveBeenCalledWith('device-1');
			expect(mockJson).toHaveBeenCalledWith({
				success: true,
				result: mockMetrics,
			});
		});

		it('should return 500 if service throws an error', async () => {
			mockRequest.params = { id: 'device-1' };
			mockDeviceService.getMetrics.mockRejectedValue(new Error('Metrics failed'));

			await deviceController.getMetrics(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(500);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Metrics failed',
			});
		});
	});

	describe('getBrowsePath', () => {
		it('should return 400 if device ID is missing', async () => {
			mockRequest.params = {};

			await deviceController.getBrowsePath(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(400);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Device ID is missing',
			});
		});

		it('should successfully browse path with default empty path', async () => {
			const mockContents = { files: [], directories: [] };
			mockRequest.params = { id: 'device-1' };
			mockRequest.query = {};
			mockDeviceService.getBrowsePath.mockResolvedValue(mockContents as any);

			await deviceController.getBrowsePath(mockRequest as Request, mockResponse as Response);

			expect(mockDeviceService.getBrowsePath).toHaveBeenCalledWith('device-1', '');
			expect(mockJson).toHaveBeenCalledWith(mockContents);
		});

		it('should successfully browse path with specified path', async () => {
			const mockContents = { files: [], directories: [] };
			mockRequest.params = { id: 'device-1' };
			mockRequest.query = { path: encodeURIComponent('/home/user') };
			mockDeviceService.getBrowsePath.mockResolvedValue(mockContents as any);

			await deviceController.getBrowsePath(mockRequest as Request, mockResponse as Response);

			expect(mockDeviceService.getBrowsePath).toHaveBeenCalledWith('device-1', '/home/user');
			expect(mockJson).toHaveBeenCalledWith(mockContents);
		});

		it('should return 500 if service throws an error', async () => {
			mockRequest.params = { id: 'device-1' };
			mockDeviceService.getBrowsePath.mockRejectedValue(new Error('Path not found'));

			await deviceController.getBrowsePath(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(500);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Path not found',
			});
		});
	});

	describe('updateRestic', () => {
		it('should return 400 if device ID or version is missing', async () => {
			mockRequest.params = { id: 'device-1' };
			mockRequest.query = {};

			await deviceController.updateRestic(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(400);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Device ID and Restic version is required',
			});
		});

		it('should successfully update restic', async () => {
			mockRequest.params = { id: 'device-1' };
			mockRequest.query = { version: '0.16.0' };
			mockDeviceService.updateRestic.mockResolvedValue('0.16.0');

			await deviceController.updateRestic(mockRequest as Request, mockResponse as Response);

			expect(mockDeviceService.updateRestic).toHaveBeenCalledWith('device-1', '0.16.0');
			expect(mockJson).toHaveBeenCalledWith({
				success: true,
				result: '0.16.0',
			});
		});

		it('should return 500 if service throws an error', async () => {
			mockRequest.params = { id: 'device-1' };
			mockRequest.query = { version: '0.16.0' };
			mockDeviceService.updateRestic.mockRejectedValue(new Error('Update failed'));

			await deviceController.updateRestic(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(500);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Update failed',
			});
		});
	});

	describe('updateRclone', () => {
		it('should return 400 if device ID or version is missing', async () => {
			mockRequest.params = { id: 'device-1' };
			mockRequest.query = {};

			await deviceController.updateRclone(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(400);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Device ID and Rclone version is required',
			});
		});

		it('should successfully update rclone', async () => {
			mockRequest.params = { id: 'device-1' };
			mockRequest.query = { version: '1.65.0' };
			mockDeviceService.updateRclone.mockResolvedValue('1.65.0');

			await deviceController.updateRclone(mockRequest as Request, mockResponse as Response);

			expect(mockDeviceService.updateRclone).toHaveBeenCalledWith('device-1', '1.65.0');
			expect(mockJson).toHaveBeenCalledWith({
				success: true,
				result: '1.65.0',
			});
		});

		it('should return 500 if service throws an error', async () => {
			mockRequest.params = { id: 'device-1' };
			mockRequest.query = { version: '1.65.0' };
			mockDeviceService.updateRclone.mockRejectedValue(new Error('Update failed'));

			await deviceController.updateRclone(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(500);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Update failed',
			});
		});
	});
});
