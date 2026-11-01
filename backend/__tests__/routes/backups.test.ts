import request from 'supertest';
import express, { Express } from 'express';
import { createBackupRouter } from '../../src/routes/backups';
import { BackupController } from '../../src/controllers/BackupController';
import { BackupService } from '../../src/services/BackupServices';
import { AppError } from '../../src/utils/AppError';
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
			startSnapshotIndex: jest.fn(),
			getSnapshotIndexStatus: jest.fn(),
			getSnapshotIndexEntries: jest.fn(),
			getSnapshotIndexDirs: jest.fn(),
			getSnapshotIndexSelection: jest.fn(),
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
			expect(mockBackupService.getSnapshotFiles).toHaveBeenCalledWith('backup-1', undefined);
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
			expect(mockBackupService.generateBackupDownload).toHaveBeenCalledWith('backup-1', undefined);
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

	describe('Snapshot index routes', () => {
		const ready = {
			state: 'ready',
			snapshotId: 'abc',
			builtAt: 1000,
			stats: { entries: 2, files: 1, dirs: 1, bytes: 5 },
		};

		it.each([
			['post', '/api/backups/backup-1/index'],
			['get', '/api/backups/backup-1/index/status'],
			['get', '/api/backups/backup-1/index/entries'],
			['get', '/api/backups/backup-1/index/dirs'],
			['post', '/api/backups/backup-1/index/selection'],
		] as const)('should return 401 for %s %s if not authenticated', async (method, url) => {
			setupAuthMock(false);

			const response = await request(app)[method](url);

			expect(response.status).toBe(401);
		});

		it('should start the index for a mirror and wrap the status', async () => {
			mockBackupService.startSnapshotIndex.mockResolvedValue({
				state: 'building',
				stage: 'queued',
				entries: 0,
			});

			const response = await request(app).post('/api/backups/backup-1/index?replicationId=repl-1');

			expect(response.status).toBe(200);
			expect(response.body).toEqual({
				success: true,
				result: { state: 'building', stage: 'queued', entries: 0 },
			});
			expect(mockBackupService.startSnapshotIndex).toHaveBeenCalledWith('backup-1', 'repl-1');
		});

		it('should return the index status for primary storage', async () => {
			mockBackupService.getSnapshotIndexStatus.mockResolvedValue(ready as any);

			const response = await request(app).get('/api/backups/backup-1/index/status');

			expect(response.body).toEqual({ success: true, result: ready });
			expect(mockBackupService.getSnapshotIndexStatus).toHaveBeenCalledWith('backup-1', undefined);
		});

		it('should pass the entries query and wrap the page', async () => {
			const page = { rows: [{ name: 'a.txt', path: '/data/a.txt' }], total: 1 };
			mockBackupService.getSnapshotIndexEntries.mockResolvedValue(page as any);

			const response = await request(app).get('/api/backups/backup-1/index/entries').query({
				dir: '/data',
				sort: 'size',
				order: 'desc',
				offset: 1000,
				limit: 500,
				q: 'report',
				replicationId: 'repl-1',
			});

			expect(response.body).toEqual({ success: true, result: page });
			expect(mockBackupService.getSnapshotIndexEntries).toHaveBeenCalledWith('backup-1', 'repl-1', {
				dir: '/data',
				sort: 'size',
				order: 'desc',
				offset: 1000,
				limit: 500,
				q: 'report',
			});
		});

		it('should list the root when the entries query has no folder', async () => {
			mockBackupService.getSnapshotIndexEntries.mockResolvedValue({ rows: [], total: 0 });

			await request(app).get('/api/backups/backup-1/index/entries');

			expect(mockBackupService.getSnapshotIndexEntries).toHaveBeenCalledWith('backup-1', undefined, {
				dir: undefined,
				sort: undefined,
				order: undefined,
				offset: 0,
				limit: undefined,
				q: undefined,
			});
		});

		it('should pass the dirs query and wrap the page', async () => {
			const page = { dirs: [{ path: '/data', subDirs: 2, items: 10, bytes: 50 }], total: 1 };
			mockBackupService.getSnapshotIndexDirs.mockResolvedValue(page);

			const response = await request(app)
				.get('/api/backups/backup-1/index/dirs')
				.query({ parent: '/', depth: 2, offset: 1000, limit: 1000 });

			expect(response.body).toEqual({ success: true, result: page });
			expect(mockBackupService.getSnapshotIndexDirs).toHaveBeenCalledWith('backup-1', undefined, {
				parent: '/',
				depth: 2,
				offset: 1000,
				limit: 1000,
			});
		});

		it('should pass the selection lists', async () => {
			const result = {
				selected: { items: 1, bytes: 5 },
				total: { items: 2, bytes: 5 },
				normalized: { includes: ['/data/a.txt'], excludes: [] },
			};
			mockBackupService.getSnapshotIndexSelection.mockResolvedValue(result);

			const response = await request(app)
				.post('/api/backups/backup-1/index/selection')
				.send({ includes: ['/data/a.txt'], excludes: ['/'] });

			expect(response.body).toEqual({ success: true, result });
			expect(mockBackupService.getSnapshotIndexSelection).toHaveBeenCalledWith(
				'backup-1',
				undefined,
				['/data/a.txt'],
				['/']
			);
		});

		it('should return 400 if a selection list is missing', async () => {
			const response = await request(app)
				.post('/api/backups/backup-1/index/selection')
				.send({ includes: [] });

			expect(response.status).toBe(400);
			expect(mockBackupService.getSnapshotIndexSelection).not.toHaveBeenCalled();
		});

		it.each([
			['/entries', 'getSnapshotIndexEntries'],
			['/dirs', 'getSnapshotIndexDirs'],
		] as const)('should return 409 index_not_ready from %s', async (path, method) => {
			mockBackupService[method].mockRejectedValue(new AppError(409, 'index_not_ready'));

			const response = await request(app).get(`/api/backups/backup-1/index${path}`);

			expect(response.status).toBe(409);
			expect(response.body).toEqual({ success: false, error: 'index_not_ready' });
		});
	});
});
