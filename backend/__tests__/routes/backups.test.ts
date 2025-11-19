import request from 'supertest';
import express, { Express } from 'express';
import { createBackupRouter } from '../../src/routes/backups';
import { BackupController } from '../../src/controllers/BackupController';
import { BackupService } from '../../src/services/BackupServices';
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

describe('Backup Routes', () => {
	let app: Express;
	let backupController: BackupController;
	let mockBackupService: jest.Mocked<BackupService>;

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

		mockBackupService = {
			deleteBackup: jest.fn(),
			getSnapshotFiles: jest.fn(),
			getBackupProgress: jest.fn(),
			cancelBackup: jest.fn(),
			getBackupDownload: jest.fn(),
			generateBackupDownload: jest.fn(),
			cancelBackupDownload: jest.fn(),
		} as any;

		backupController = new BackupController(mockBackupService);

		app = express();
		app.use(express.json());
		app.use('/api/backups', createBackupRouter(backupController));

		// Default to authenticated
		setupAuthMock(true);
	});

	describe('DELETE /api/backups/:id', () => {
		it('should return 401 if not authenticated', async () => {
			setupAuthMock(false);

			const response = await request(app).delete('/api/backups/backup-1');

			expect(response.status).toBe(401);
		});

		it('should delete a backup when authenticated', async () => {
			mockBackupService.deleteBackup.mockResolvedValue({ success: true, result: true } as any);

			const response = await request(app)
				.delete('/api/backups/backup-1')
				.set('Cookie', ['token=valid-token']);

			expect(response.status).toBe(200);
			expect(mockBackupService.deleteBackup).toHaveBeenCalledWith('backup-1', true);
		});
	});

	describe('GET /api/backups/:id/files', () => {
		it('should return 401 if not authenticated', async () => {
			setupAuthMock(false);

			const response = await request(app).get('/api/backups/backup-1/files');

			expect(response.status).toBe(401);
		});

		it('should return snapshot files when authenticated', async () => {
			mockBackupService.getSnapshotFiles.mockResolvedValue([
				{ name: 'file1.txt', size: 100 },
				{ name: 'file2.txt', size: 200 },
			] as any);

			const response = await request(app)
				.get('/api/backups/backup-1/files')
				.set('Cookie', ['token=valid-token']);

			expect(response.status).toBe(200);
			expect(mockBackupService.getSnapshotFiles).toHaveBeenCalledWith('backup-1');
		});
	});

	describe('GET /api/backups/:id/progress', () => {
		it('should return 401 if not authenticated', async () => {
			setupAuthMock(false);

			const response = await request(app)
				.get('/api/backups/backup-1/progress')
				.query({ sourceId: 'device-1', sourceType: 'device' });

			expect(response.status).toBe(401);
		});

		it('should return backup progress when authenticated', async () => {
			mockBackupService.getBackupProgress.mockResolvedValue({
				percent: 50,
				filesProcessed: 100,
			} as any);

			const response = await request(app)
				.get('/api/backups/backup-1/progress')
				.query({ sourceId: 'device-1', sourceType: 'device' })
				.set('Cookie', ['token=valid-token']);

			expect(response.status).toBe(200);
			expect(mockBackupService.getBackupProgress).toHaveBeenCalledWith('backup-1');
		});
	});

	describe('POST /api/backups/:id/action/cancel', () => {
		it('should return 401 if not authenticated', async () => {
			setupAuthMock(false);

			const response = await request(app)
				.post('/api/backups/backup-1/action/cancel')
				.query({ planId: 'plan-1' });

			expect(response.status).toBe(401);
		});

		it('should cancel a backup when authenticated', async () => {
			mockBackupService.cancelBackup.mockResolvedValue({ success: true } as any);

			const response = await request(app)
				.post('/api/backups/backup-1/action/cancel')
				.query({ planId: 'plan-1' })
				.set('Cookie', ['token=valid-token']);

			expect(response.status).toBe(200);
			expect(mockBackupService.cancelBackup).toHaveBeenCalledWith('plan-1', 'backup-1');
		});
	});

	describe('GET /api/backups/:id/action/download', () => {
		it('should return 401 if not authenticated', async () => {
			setupAuthMock(false);

			const response = await request(app).get('/api/backups/backup-1/action/download');

			expect(response.status).toBe(401);
		});

		it('should initiate backup download when authenticated', async () => {
			// For streaming responses, we just verify the service was called
			// The actual streaming is handled by the controller
			mockBackupService.getBackupDownload.mockImplementation(async () => {
				throw new Error('Stream test - expected');
			});

			const response = await request(app)
				.get('/api/backups/backup-1/action/download')
				.set('Cookie', ['token=valid-token']);

			expect(mockBackupService.getBackupDownload).toHaveBeenCalledWith('backup-1');
			expect(response.status).toBe(500); // Error because we threw in mock
		});
	});

	describe('POST /api/backups/:id/action/download', () => {
		it('should return 401 if not authenticated', async () => {
			setupAuthMock(false);

			const response = await request(app).post('/api/backups/backup-1/action/download');

			expect(response.status).toBe(401);
		});

		it('should generate backup download when authenticated', async () => {
			setupAuthMock(true);
			mockBackupService.generateBackupDownload.mockResolvedValue({
				downloadUrl: 'http://example.com/download',
			} as any);

			const response = await request(app)
				.post('/api/backups/backup-1/action/download')
				.send({ files: ['file1.txt', 'file2.txt'] });

			expect(response.status).toBe(200);
			expect(mockBackupService.generateBackupDownload).toHaveBeenCalledWith('backup-1');
		});
	});

	describe('DELETE /api/backups/:id/action/download', () => {
		it('should return 401 if not authenticated', async () => {
			setupAuthMock(false);

			const response = await request(app)
				.delete('/api/backups/backup-1/action/download')
				.query({ planId: 'plan-1' });

			expect(response.status).toBe(401);
		});

		it('should cancel backup download when authenticated', async () => {
			mockBackupService.cancelBackupDownload.mockResolvedValue({ success: true } as any);

			const response = await request(app)
				.delete('/api/backups/backup-1/action/download')
				.query({ planId: 'plan-1' })
				.set('Cookie', ['token=valid-token']);

			expect(response.status).toBe(200);
			expect(mockBackupService.cancelBackupDownload).toHaveBeenCalledWith('plan-1', 'backup-1');
		});
	});
});
