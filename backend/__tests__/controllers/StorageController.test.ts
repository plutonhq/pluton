import { Request, Response } from 'express';
import { StorageController } from '../../src/controllers/StorageController';
import { StorageService } from '../../src/services/StorageService';

jest.mock('../../src/services/StorageService');

describe('StorageController', () => {
	let storageController: StorageController;
	let mockStorageService: jest.Mocked<StorageService>;
	let mockRequest: Partial<Request>;
	let mockResponse: Partial<Response>;
	let mockJson: jest.Mock;
	let mockStatus: jest.Mock;

	beforeEach(() => {
		jest.clearAllMocks();

		mockStorageService = new StorageService(
			null as any,
			null as any,
			null as any,
			null as any
		) as jest.Mocked<StorageService>;

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

		storageController = new StorageController(mockStorageService);
	});

	describe('listStorages', () => {
		it('should successfully get all storages', async () => {
			const mockStorages = [
				{ id: 'storage-1', name: 'Storage 1', type: 's3' },
				{ id: 'storage-2', name: 'Storage 2', type: 'local' },
			];
			mockStorageService.getStorages.mockResolvedValue(mockStorages as any);

			await storageController.listStorages(mockRequest as Request, mockResponse as Response);

			expect(mockStorageService.getStorages).toHaveBeenCalled();
			expect(mockJson).toHaveBeenCalledWith({
				success: true,
				result: mockStorages,
			});
		});

		it('should return 500 if service throws an error', async () => {
			mockStorageService.getStorages.mockRejectedValue(new Error('Database error'));

			await storageController.listStorages(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(500);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Failed to fetch storages',
			});
		});
	});

	describe('listAvailableStorageTypes', () => {
		it('should successfully get available storage types', async () => {
			const mockTypes = ['s3', 'gcs', 'azure', 'local'];
			mockStorageService.getAvailableStorageTypes.mockResolvedValue(mockTypes as any);

			await storageController.listAvailableStorageTypes(
				mockRequest as Request,
				mockResponse as Response
			);

			expect(mockStorageService.getAvailableStorageTypes).toHaveBeenCalled();
			expect(mockJson).toHaveBeenCalledWith({
				success: true,
				result: mockTypes,
			});
		});

		it('should return 500 if service throws an error', async () => {
			mockStorageService.getAvailableStorageTypes.mockRejectedValue(new Error('Fetch failed'));

			await storageController.listAvailableStorageTypes(
				mockRequest as Request,
				mockResponse as Response
			);

			expect(mockStatus).toHaveBeenCalledWith(500);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Failed to fetch available storages',
			});
		});
	});

	describe('getStorage', () => {
		it('should return 400 if storage ID is missing', async () => {
			mockRequest.params = {};

			await storageController.getStorage(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(400);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Storage ID is required',
			});
		});

		it('should successfully get a storage', async () => {
			const mockStorage = { id: 'storage-1', name: 'Storage 1', type: 's3' };
			mockRequest.params = { id: 'storage-1' };
			mockStorageService.getStorage.mockResolvedValue(mockStorage as any);

			await storageController.getStorage(mockRequest as Request, mockResponse as Response);

			expect(mockStorageService.getStorage).toHaveBeenCalledWith('storage-1');
			expect(mockJson).toHaveBeenCalledWith({
				success: true,
				result: mockStorage,
			});
		});

		it('should return 404 if storage not found', async () => {
			mockRequest.params = { id: 'storage-1' };
			mockStorageService.getStorage.mockRejectedValue(new Error('Storage not found'));

			await storageController.getStorage(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(404);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Storage not found',
			});
		});

		it('should return 500 for other errors', async () => {
			mockRequest.params = { id: 'storage-1' };
			mockStorageService.getStorage.mockRejectedValue(new Error('Database error'));

			await storageController.getStorage(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(500);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Database error',
			});
		});
	});

	describe('createStorage', () => {
		it('should return 400 if required fields are missing', async () => {
			mockRequest.body = { name: 'Test Storage' };

			await storageController.createStorage(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(400);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Name, type, credentials and settings are required',
			});
		});

		it('should successfully create storage', async () => {
			const storageData = {
				name: 'Test Storage',
				type: 's3',
				settings: { bucket: 'test-bucket' },
				credentials: { accessKey: 'key', secretKey: 'secret' },
			};
			const createdStorage = { id: 'storage-1', ...storageData };
			mockRequest.body = storageData;
			mockStorageService.createStorage.mockResolvedValue(createdStorage as any);

			await storageController.createStorage(mockRequest as Request, mockResponse as Response);

			expect(mockStorageService.createStorage).toHaveBeenCalledWith(storageData);
			expect(mockStatus).toHaveBeenCalledWith(201);
			expect(mockJson).toHaveBeenCalledWith({
				success: true,
				result: createdStorage,
			});
		});

		it('should return 500 if service throws an error', async () => {
			mockRequest.body = {
				name: 'Test Storage',
				type: 's3',
				settings: {},
				credentials: {},
			};
			mockStorageService.createStorage.mockRejectedValue(new Error('Creation failed'));

			await storageController.createStorage(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(500);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Creation failed',
			});
		});
	});

	describe('updateStorage', () => {
		it('should return 400 if storage ID is missing', async () => {
			mockRequest.params = {};

			await storageController.updateStorage(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(400);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Storage ID is required',
			});
		});

		it('should successfully update storage', async () => {
			const updateData = { name: 'Updated Storage' };
			const updatedStorage = { id: 'storage-1', ...updateData };
			mockRequest.params = { id: 'storage-1' };
			mockRequest.body = updateData;
			mockStorageService.updateStorage.mockResolvedValue(updatedStorage as any);

			await storageController.updateStorage(mockRequest as Request, mockResponse as Response);

			expect(mockStorageService.updateStorage).toHaveBeenCalledWith('storage-1', updateData);
			expect(mockJson).toHaveBeenCalledWith({
				success: true,
				result: updatedStorage,
			});
		});

		it('should return 500 if service throws an error', async () => {
			mockRequest.params = { id: 'storage-1' };
			mockRequest.body = { name: 'Updated Storage' };
			mockStorageService.updateStorage.mockRejectedValue(new Error('Update failed'));

			await storageController.updateStorage(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(500);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Failed to update storage',
			});
		});
	});

	describe('deleteStorage', () => {
		it('should return 400 if storage ID is missing', async () => {
			mockRequest.params = {};

			await storageController.deleteStorage(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(400);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Storage ID is required',
			});
		});

		it('should successfully delete storage', async () => {
			mockRequest.params = { id: 'storage-1' };
			mockStorageService.deleteStorage.mockResolvedValue(true);

			await storageController.deleteStorage(mockRequest as Request, mockResponse as Response);

			expect(mockStorageService.deleteStorage).toHaveBeenCalledWith('storage-1');
			expect(mockJson).toHaveBeenCalledWith({ success: true });
		});

		it('should return 500 if service throws an error', async () => {
			mockRequest.params = { id: 'storage-1' };
			mockStorageService.deleteStorage.mockRejectedValue(new Error('Delete failed'));

			await storageController.deleteStorage(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(500);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Failed to delete storage',
			});
		});
	});

	describe('verifyStorage', () => {
		it('should return 400 if storage ID is missing', async () => {
			mockRequest.params = {};

			await storageController.verifyStorage(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(400);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Storage ID is required',
			});
		});

		it('should successfully verify storage', async () => {
			const verifyResult = { success: true, message: 'Storage is accessible' };
			mockRequest.params = { id: 'storage-1' };
			mockStorageService.verifyStorage.mockResolvedValue(verifyResult as any);

			await storageController.verifyStorage(mockRequest as Request, mockResponse as Response);

			expect(mockStorageService.verifyStorage).toHaveBeenCalledWith('storage-1');
			expect(mockJson).toHaveBeenCalledWith({
				success: true,
				result: verifyResult,
			});
		});

		it('should return 500 if service throws an error', async () => {
			mockRequest.params = { id: 'storage-1' };
			mockStorageService.verifyStorage.mockRejectedValue(new Error('Verification failed'));

			await storageController.verifyStorage(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(500);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Failed to verify storage',
			});
		});
	});

	describe('authorizeStorage', () => {
		it('should return 400 if storage type is missing', async () => {
			mockRequest.query = {};

			await storageController.authorizeStorage(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(400);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Storage type is required',
			});
		});

		it('should successfully authorize storage', async () => {
			const authResult = { authUrl: 'https://auth.example.com', token: 'auth-token' };
			mockRequest.query = { type: 'gdrive' };
			mockStorageService.authorizeStorage.mockResolvedValue(authResult as any);

			await storageController.authorizeStorage(mockRequest as Request, mockResponse as Response);

			expect(mockStorageService.authorizeStorage).toHaveBeenCalledWith('gdrive');
			expect(mockStatus).toHaveBeenCalledWith(200);
			expect(mockJson).toHaveBeenCalledWith({
				success: true,
				result: authResult,
			});
		});

		it('should return 500 if service throws an error', async () => {
			mockRequest.query = { type: 'gdrive' };
			mockStorageService.authorizeStorage.mockRejectedValue(new Error('Authorization failed'));

			await storageController.authorizeStorage(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(500);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Failed to authorize storage',
			});
		});
	});
});
