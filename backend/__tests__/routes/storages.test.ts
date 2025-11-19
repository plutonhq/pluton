import request from 'supertest';
import express, { Express } from 'express';
import { createStorageRouter } from '../../src/routes/storages';
import { StorageController } from '../../src/controllers/StorageController';
import { StorageService } from '../../src/services/StorageService';
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

describe('Storage Routes', () => {
	let app: Express;
	let storageController: StorageController;
	let mockStorageService: jest.Mocked<StorageService>;

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

		mockStorageService = {
			createStorage: jest.fn(),
			getStorages: jest.fn(),
			getAvailableStorageTypes: jest.fn(),
			getStorage: jest.fn(),
			updateStorage: jest.fn(),
			deleteStorage: jest.fn(),
			verifyStorage: jest.fn(),
		} as any;

		storageController = new StorageController(mockStorageService);

		app = express();
		app.use(express.json());
		app.use('/api/storages', createStorageRouter(storageController));

		// Default to authenticated for most tests
		setupAuthMock(true);
	});

	describe('POST /api/storages', () => {
		it('should return 401 if not authenticated', async () => {
			setupAuthMock(false);

			const response = await request(app)
				.post('/api/storages')
				.send({ type: 'local', settings: {}, credentials: {}, name: 'New Storage' });

			expect(response.status).toBe(401);
		});

		it('should create a new storage when authenticated', async () => {
			const newStorage = { id: 'storage-1', name: 'New Storage', type: 'local' };
			mockStorageService.createStorage.mockResolvedValue(newStorage as any);

			const response = await request(app)
				.post('/api/storages')
				.send({ type: 'local', settings: {}, credentials: {}, name: 'New Storage' });

			expect(response.status).toBe(201);
			expect(mockStorageService.createStorage).toHaveBeenCalled();
		});
	});

	describe('GET /api/storages', () => {
		it('should return 401 if not authenticated', async () => {
			setupAuthMock(false);

			const response = await request(app).get('/api/storages');

			expect(response.status).toBe(401);
		});

		it('should return list of storages when authenticated', async () => {
			mockStorageService.getStorages.mockResolvedValue([
				{ id: '1', name: 'Storage 1' },
				{ id: '2', name: 'Storage 2' },
			] as any);

			const response = await request(app).get('/api/storages');

			expect(response.status).toBe(200);
			expect(mockStorageService.getStorages).toHaveBeenCalled();
		});
	});

	describe('GET /api/storages/available', () => {
		it('should return 401 if not authenticated', async () => {
			setupAuthMock(false);

			const response = await request(app).get('/api/storages/available');

			expect(response.status).toBe(401);
		});

		it('should return available storage types when authenticated', async () => {
			mockStorageService.getAvailableStorageTypes.mockResolvedValue([
				{ type: 'local', name: 'Local Storage' },
				{ type: 's3', name: 'Amazon S3' },
			] as any);

			const response = await request(app).get('/api/storages/available');

			expect(response.status).toBe(200);
			expect(mockStorageService.getAvailableStorageTypes).toHaveBeenCalled();
		});
	});

	describe('GET /api/storages/:id', () => {
		it('should return 401 if not authenticated', async () => {
			setupAuthMock(false);

			const response = await request(app).get('/api/storages/storage-1');

			expect(response.status).toBe(401);
		});

		it('should return a specific storage when authenticated', async () => {
			mockStorageService.getStorage.mockResolvedValue({
				id: 'storage-1',
				name: 'Test Storage',
			} as any);

			const response = await request(app).get('/api/storages/storage-1');

			expect(response.status).toBe(200);
			expect(mockStorageService.getStorage).toHaveBeenCalledWith('storage-1');
		});
	});

	describe('PUT /api/storages/:id', () => {
		it('should return 401 if not authenticated', async () => {
			setupAuthMock(false);

			const response = await request(app)
				.put('/api/storages/storage-1')
				.send({ name: 'Updated Storage' });

			expect(response.status).toBe(401);
		});

		it('should update a storage when authenticated', async () => {
			mockStorageService.updateStorage.mockResolvedValue({
				id: 'storage-1',
				name: 'Updated Storage',
			} as any);

			const response = await request(app)
				.put('/api/storages/storage-1')
				.send({ name: 'Updated Storage' });

			expect(response.status).toBe(200);
			expect(mockStorageService.updateStorage).toHaveBeenCalledWith('storage-1', {
				name: 'Updated Storage',
			});
		});
	});

	describe('DELETE /api/storages/:id', () => {
		it('should return 401 if not authenticated', async () => {
			setupAuthMock(false);

			const response = await request(app).delete('/api/storages/storage-1');

			expect(response.status).toBe(401);
		});

		it('should delete a storage when authenticated', async () => {
			mockStorageService.deleteStorage.mockResolvedValue(true);

			const response = await request(app).delete('/api/storages/storage-1');

			expect(response.status).toBe(200);
			expect(mockStorageService.deleteStorage).toHaveBeenCalledWith('storage-1');
		});
	});

	describe('POST /api/storages/verify/:id', () => {
		it('should return 401 if not authenticated', async () => {
			setupAuthMock(false);

			const response = await request(app).post('/api/storages/verify/storage-1');

			expect(response.status).toBe(401);
		});

		it('should verify storage when authenticated', async () => {
			mockStorageService.verifyStorage.mockResolvedValue({
				valid: true,
				message: 'Storage is valid',
			} as any);

			const response = await request(app).post('/api/storages/verify/storage-1');

			expect(response.status).toBe(200);
			expect(mockStorageService.verifyStorage).toHaveBeenCalledWith('storage-1');
		});
	});
});
