import request from 'supertest';
import express, { Express } from 'express';
import { createBackupRouter } from '../../src/routes/backups';
import { BackupController } from '../../src/controllers/BackupController';
import { BackupService } from '../../src/services/BackupServices';
import jwt from 'jsonwebtoken';
import Cookies from 'cookies';
import { RetainedRestoreDependencyError } from '../../src/utils/retainedRestoreDependency';
import http from 'http';
import { AddressInfo } from 'net';
import { ManagedRepositoryAccessError } from '../../src/utils/restic/ManagedSftpRepositorySession';

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
		it('returns the retained database dependency code with HTTP 409', async () => {
			mockBackupService.deleteBackup.mockRejectedValue(new RetainedRestoreDependencyError());
			const response = await request(app).delete('/api/backups/backup-1');
			expect(response.status).toBe(409);
			expect(response.body).toMatchObject({
				success: false,
				code: 'RETAINED_DATABASE_RESTORE_DEPENDENCY',
			});
			expect(response.body.error).toContain('/database-restores');
		});
		it('should return 401 if not authenticated', async () => {
			setupAuthMock(false);

			const response = await request(app).delete('/api/backups/backup-1');

			expect(response.status).toBe(401);
			expect(mockBackupService.getBackupDownload).not.toHaveBeenCalled();
			expect(mockBackupService.generateBackupDownload).not.toHaveBeenCalled();
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
			expect(mockBackupService.getBackupDownload).not.toHaveBeenCalled();
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
		it('streams the remote TAR with safe attachment/cache headers and no JSON envelope', async () => {
			const bytes = Buffer.from([0, 255, 1, 2, 0]);
			mockBackupService.getBackupDownload.mockResolvedValue({
				fileName: 'backup-backup-01.tar',
				streamTo: async (destination: any, signal: AbortSignal, ready: () => void) => {
					expect(signal.aborted).toBe(false);
					ready();
					destination.write(bytes);
				},
			});
			const response = await request(app)
				.get('/api/backups/backup-01/action/download')
				.buffer(true)
				.parse((response, done) => {
					const chunks: Buffer[] = [];
					response.on('data', chunk => chunks.push(chunk));
					response.on('end', () => done(null, Buffer.concat(chunks)));
				});
			expect(response.status).toBe(200);
			expect(response.headers['content-type']).toBe('application/x-tar');
			expect(response.headers['content-disposition']).toBe(
				'attachment; filename="backup-backup-01.tar"'
			);
			expect(response.headers['cache-control']).toBe('private, no-store');
			expect(response.body).toEqual(bytes);
		});
		it.each(['wrong-password', 'execution-failed'] as const)(
			'returns sanitized %s before stream headers',
			async code => {
				mockBackupService.getBackupDownload.mockResolvedValue({
					fileName: 'backup-backup-01.tar',
					streamTo: async () => {
						throw new ManagedRepositoryAccessError(code);
					},
				});
				const response = await request(app).get('/api/backups/backup-01/action/download');
				expect(response.status).toBe(502);
				expect(response.headers['content-disposition']).toBeUndefined();
				expect(response.body).toEqual({
					success: false,
					error: `Managed repository access failed (${code}).`,
				});
			}
		);
		it('never exposes a raw provider error in an early HTTP failure', async () => {
			mockBackupService.getBackupDownload.mockResolvedValue({
				fileName: 'backup-backup-01.tar',
				streamTo: async () => {
					throw new Error('synthetic-password raw credential config');
				},
			});
			const response = await request(app).get('/api/backups/backup-01/action/download');
			expect(response.status).toBe(502);
			expect(response.body).toEqual({ success: false, error: 'Remote download failed.' });
		});
	});
	describe('remote Download HTTP disconnect', () => {
		async function listening() {
			const server = http.createServer(app);
			await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
			return {
				server,
				url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/backups/backup-01/action/download`,
			};
		}
		async function close(server: http.Server) {
			server.closeAllConnections();
			await new Promise<void>(resolve => server.close(() => resolve()));
		}
		it('aborts an active GET and awaits session cleanup when the browser disconnects', async () => {
			let activeSignal: AbortSignal | undefined;
			let cleaned = false;
			let finish: () => void;
			const cleanup = new Promise<void>(resolve => {
				finish = resolve;
			});
			mockBackupService.getBackupDownload.mockResolvedValue({
				fileName: 'backup-backup-01.tar',
				streamTo: async (destination: any, signal: AbortSignal, ready: () => void) => {
					activeSignal = signal;
					ready();
					destination.write('partial-tar');
					await new Promise<void>(resolve =>
						signal.addEventListener('abort', () => resolve(), { once: true })
					);
					cleaned = true;
					finish();
					throw new ManagedRepositoryAccessError('cancelled');
				},
			});
			const { server, url } = await listening();
			try {
				const client = http.get(url, response => response.once('data', () => client.destroy()));
				client.on('error', () => undefined);
				await cleanup;
				expect(activeSignal?.aborted).toBe(true);
				expect(cleaned).toBe(true);
			} finally {
				await close(server);
			}
		});
		it('aborts the POST repository preflight on disconnect', async () => {
			let entered: () => void;
			let finished: () => void;
			let activeSignal: AbortSignal | undefined;
			const started = new Promise<void>(resolve => {
				entered = resolve;
			});
			const cleanup = new Promise<void>(resolve => {
				finished = resolve;
			});
			mockBackupService.generateBackupDownload.mockImplementation(async (_, __, signal) => {
				activeSignal = signal;
				entered();
				await new Promise<void>(resolve =>
					signal!.addEventListener('abort', () => resolve(), { once: true })
				);
				finished();
				throw new ManagedRepositoryAccessError('cancelled');
			});
			const { server, url } = await listening();
			try {
				const client = http.request(url, { method: 'POST' });
				client.on('error', () => undefined);
				client.end();
				await started;
				client.destroy();
				await cleanup;
				expect(activeSignal?.aborted).toBe(true);
			} finally {
				await close(server);
			}
		});
		it('terminates a partial response on late failure instead of appending errors/secrets', async () => {
			mockBackupService.getBackupDownload.mockResolvedValue({
				fileName: 'backup-backup-01.tar',
				streamTo: async (destination: any, _: AbortSignal, ready: () => void) => {
					ready();
					destination.write('partial-tar');
					await new Promise<void>(resolve => setImmediate(resolve));
					throw new Error('synthetic-password raw credential config');
				},
			});
			const { server, url } = await listening();
			try {
				let received = '';
				let aborted = false;
				await new Promise<void>((resolve, reject) => {
					const client = http.get(url, response => {
						response.on('data', chunk => {
							received += chunk.toString();
						});
						response.once('aborted', () => {
							aborted = true;
							resolve();
						});
						response.once('end', resolve);
						response.on('error', () => undefined);
					});
					client.on('error', reject);
				});
				expect(aborted).toBe(true);
				expect(received).toBe('partial-tar');
				expect(received).not.toMatch(/synthetic-password|error|success/);
			} finally {
				await close(server);
			}
		});
	});

	describe('POST /api/backups/:id/action/download', () => {
		it('should return 401 if not authenticated', async () => {
			setupAuthMock(false);

			const response = await request(app).post('/api/backups/backup-1/action/download');

			expect(response.status).toBe(401);
			expect(mockBackupService.generateBackupDownload).not.toHaveBeenCalled();
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
			expect(mockBackupService.generateBackupDownload).toHaveBeenCalledWith(
				'backup-1',
				undefined,
				expect.any(AbortSignal)
			);
		});
		it('rejects client credentials/repository URLs/options before any repository access', async () => {
			mockBackupService.generateBackupDownload.mockResolvedValue({ streaming: true });
			const response = await request(app)
				.post('/api/backups/backup-01/action/download')
				.send({
					password: 'synthetic-client-password',
					repository: 'sftp:arbitrary',
					options: { ssh: 'arbitrary-command' },
				});
			expect(response.status).toBe(400);
			expect(response.body).toEqual({ success: false, error: 'Invalid download request.' });
			expect(mockBackupService.generateBackupDownload).not.toHaveBeenCalled();
			expect(response.text).not.toMatch(/password|sftp|ssh/);
		});
		it('rejects a client repository override on GET before service lookup', async () => {
			const response = await request(app)
				.get('/api/backups/backup-01/action/download')
				.query({ repository: 'sftp:arbitrary', password: 'synthetic-client-password' });
			expect(response.status).toBe(400);
			expect(response.body).toEqual({ success: false, error: 'Invalid download request.' });
			expect(mockBackupService.getBackupDownload).not.toHaveBeenCalled();
		});
		it('remote Download remains full-snapshot only, never client-controlled selection', async () => {
			mockBackupService.generateBackupDownload.mockResolvedValue({ streaming: true });
			const response = await request(app)
				.post('/api/backups/backup-01/action/download')
				.send({ files: ['/srv/example-app/index.txt'] });
			expect(response.status).toBe(400);
			expect(response.body).toEqual({
				success: false,
				error: 'Remote downloads support only the complete exact snapshot.',
			});
		});
		it('valid remote preflight exposes only the streaming discriminator', async () => {
			mockBackupService.generateBackupDownload.mockResolvedValue({ streaming: true });
			const response = await request(app).post('/api/backups/backup-01/action/download');
			expect(response.status).toBe(200);
			expect(response.body).toEqual({ success: true, result: { streaming: true } });
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
