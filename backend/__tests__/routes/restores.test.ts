import request from 'supertest';
import express, { Express } from 'express';
import { createRestoreRouter } from '../../src/routes/restores';
import { RestoreController } from '../../src/controllers/RestoreController';
import { RestoreService } from '../../src/services/RestoreService';
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

describe('Restore Routes', () => {
	let app: Express;
	let restoreController: RestoreController;
	let mockRestoreService: jest.Mocked<RestoreService>;

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

		mockRestoreService = {
			getAllRestores: jest.fn(),
			getRestore: jest.fn(),
			getRestoreStats: jest.fn(),
			deleteRestore: jest.fn(),
			getRestoreProgress: jest.fn(),
			cancelRestore: jest.fn(),
			dryRestoreBackup: jest.fn(),
			restoreBackup: jest.fn(),
		} as any;

		restoreController = new RestoreController(mockRestoreService);

		app = express();
		app.use(express.json());
		app.use('/api/restores', createRestoreRouter(restoreController));

		// Default to authenticated for most tests
		setupAuthMock(true);
	});

	describe('GET /api/restores', () => {
		it('should return 401 if not authenticated', async () => {
			setupAuthMock(false);

			const response = await request(app).get('/api/restores');

			expect(response.status).toBe(401);
		});

		it('should return list of restores when authenticated', async () => {
			mockRestoreService.getAllRestores.mockResolvedValue([
				{ id: '1', name: 'Restore 1' },
				{ id: '2', name: 'Restore 2' },
			] as any);

			const response = await request(app).get('/api/restores');

			expect(response.status).toBe(200);
			expect(mockRestoreService.getAllRestores).toHaveBeenCalled();
		});
	});

	describe('GET /api/restores/:id', () => {
		it('should return 401 if not authenticated', async () => {
			setupAuthMock(false);

			const response = await request(app).get('/api/restores/restore-1');

			expect(response.status).toBe(401);
		});

		it('should return a specific restore when authenticated', async () => {
			mockRestoreService.getRestore.mockResolvedValue({
				id: 'restore-1',
				name: 'Test Restore',
			} as any);

			const response = await request(app).get('/api/restores/restore-1');

			expect(response.status).toBe(200);
			expect(mockRestoreService.getRestore).toHaveBeenCalledWith('restore-1');
		});
	});

	describe('GET /api/restores/:id/stats', () => {
		it('should return 401 if not authenticated', async () => {
			setupAuthMock(false);

			const response = await request(app).get('/api/restores/restore-1/stats');

			expect(response.status).toBe(401);
		});

		it('should return restore stats when authenticated', async () => {
			mockRestoreService.getRestoreStats.mockResolvedValue({
				success: true,
				result: { filesRestored: 100, bytesRestored: 1024000 },
			} as any);

			const response = await request(app).get('/api/restores/restore-1/stats');

			expect(response.status).toBe(200);
			expect(mockRestoreService.getRestoreStats).toHaveBeenCalledWith('restore-1');
		});
	});

	describe('DELETE /api/restores/:id', () => {
		it('should return 401 if not authenticated', async () => {
			setupAuthMock(false);

			const response = await request(app).delete('/api/restores/restore-1');

			expect(response.status).toBe(401);
		});

		it('should delete a restore when authenticated', async () => {
			mockRestoreService.deleteRestore.mockResolvedValue(undefined);

			const response = await request(app).delete('/api/restores/restore-1');

			expect(response.status).toBe(200);
			expect(mockRestoreService.deleteRestore).toHaveBeenCalledWith('restore-1');
		});
	});

	describe('GET /api/restores/:id/progress', () => {
		it('should return 401 if not authenticated', async () => {
			setupAuthMock(false);

			const response = await request(app)
				.get('/api/restores/restore-1/progress')
				.query({ sourceId: 'device-1', sourceType: 'device', planId: 'plan-1' });

			expect(response.status).toBe(401);
		});

		it('should return restore progress when authenticated', async () => {
			mockRestoreService.getRestoreProgress.mockResolvedValue({
				percent: 50,
				filesProcessed: 50,
			} as any);

			const response = await request(app)
				.get('/api/restores/restore-1/progress')
				.query({ sourceId: 'device-1', sourceType: 'device', planId: 'plan-1' });

			expect(response.status).toBe(200);
			expect(mockRestoreService.getRestoreProgress).toHaveBeenCalledWith('restore-1');
		});
	});

	describe('POST /api/restores/:id/action/cancel', () => {
		it('should return 401 if not authenticated', async () => {
			setupAuthMock(false);

			const response = await request(app).post('/api/restores/restore-1/action/cancel');

			expect(response.status).toBe(401);
		});

		it('should cancel a restore when authenticated', async () => {
			mockRestoreService.cancelRestore.mockResolvedValue({ success: true } as any);

			const response = await request(app).post('/api/restores/restore-1/action/cancel');

			expect(response.status).toBe(200);
			expect(mockRestoreService.cancelRestore).toHaveBeenCalledWith('restore-1');
		});
	});

	describe('POST /api/restores/action/dryrestore', () => {
		it('should return 401 if not authenticated', async () => {
			setupAuthMock(false);

			const response = await request(app)
				.post('/api/restores/action/dryrestore')
				.send({ backupId: 'backup-1', planId: 'plan-1', target: '/restore/path' });

			expect(response.status).toBe(401);
		});

		it('should perform dry restore when authenticated', async () => {
			mockRestoreService.dryRestoreBackup.mockResolvedValue({
				success: true,
				filesCount: 100,
			} as any);

			const response = await request(app)
				.post('/api/restores/action/dryrestore')
				.send({ backupId: 'backup-1', planId: 'plan-1', target: '/restore/path' });

			expect(response.status).toBe(200);
			expect(mockRestoreService.dryRestoreBackup).toHaveBeenCalled();
		});
	});

	describe('POST /api/restores/action/restore', () => {
		it('should return 401 if not authenticated', async () => {
			setupAuthMock(false);

			const response = await request(app)
				.post('/api/restores/action/restore')
				.send({ backupId: 'backup-1', planId: 'plan-1', target: '/restore/path' });

			expect(response.status).toBe(401);
		});

		it('should perform restore when authenticated', async () => {
			mockRestoreService.restoreBackup.mockResolvedValue({
				success: true,
				restoreId: 'restore-123',
			} as any);

			const response = await request(app)
				.post('/api/restores/action/restore')
				.send({ backupId: 'backup-1', planId: 'plan-1', target: '/restore/path' });

			expect(response.status).toBe(200);
			expect(mockRestoreService.restoreBackup).toHaveBeenCalled();
		});
	});
});
