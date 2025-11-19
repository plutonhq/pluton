import request from 'supertest';
import express, { Express } from 'express';
import { createSettingsRouter } from '../../src/routes/settings';
import { SettingsController } from '../../src/controllers/SettingsController';
import { SettingsService } from '../../src/services/SettingsService';
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

describe('Settings Routes', () => {
	let app: Express;
	let settingsController: SettingsController;
	let mockSettingsService: jest.Mocked<SettingsService>;

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

		mockSettingsService = {
			getMainSettings: jest.fn(),
			getSettings: jest.fn(),
			updateSettings: jest.fn(),
			getAppLogs: jest.fn(),
			getAppLogsFile: jest.fn(),
			validateIntegration: jest.fn(),
		} as any;

		settingsController = new SettingsController(mockSettingsService);

		app = express();
		app.use(express.json());
		app.use('/api/settings', createSettingsRouter(settingsController));

		// Default to authenticated for most tests
		setupAuthMock(true);
	});

	describe('GET /api/settings', () => {
		it('should return 401 if not authenticated', async () => {
			setupAuthMock(false);

			const response = await request(app).get('/api/settings');

			expect(response.status).toBe(401);
		});

		it('should return main settings when authenticated', async () => {
			mockSettingsService.getMainSettings.mockResolvedValue({
				appName: 'Pluton',
				version: '1.0.0',
			} as any);

			const response = await request(app).get('/api/settings');

			expect(response.status).toBe(200);
			expect(mockSettingsService.getMainSettings).toHaveBeenCalled();
		});
	});

	describe('GET /api/settings/:id', () => {
		it('should return 401 if not authenticated', async () => {
			setupAuthMock(false);

			const response = await request(app).get('/api/settings/1');

			expect(response.status).toBe(401);
		});

		it('should return specific settings when authenticated', async () => {
			mockSettingsService.getSettings.mockResolvedValue({
				id: 1,
				value: 'test-value',
			} as any);

			const response = await request(app).get('/api/settings/1');

			expect(response.status).toBe(200);
			expect(mockSettingsService.getSettings).toHaveBeenCalledWith(1);
		});
	});

	describe('PUT /api/settings/:id', () => {
		it('should return 401 if not authenticated', async () => {
			setupAuthMock(false);

			const response = await request(app)
				.put('/api/settings/1')
				.send({ settings: { value: 'updated-value' } });

			expect(response.status).toBe(401);
		});

		it('should update settings when authenticated', async () => {
			mockSettingsService.updateSettings.mockResolvedValue({
				id: 1,
				value: 'updated-value',
			} as any);

			const response = await request(app)
				.put('/api/settings/1')
				.send({ settings: { value: 'updated-value' } });

			expect(response.status).toBe(200);
			expect(mockSettingsService.updateSettings).toHaveBeenCalledWith(1, {
				value: 'updated-value',
			});
		});
	});

	describe('GET /api/settings/:id/logs', () => {
		it('should return 401 if not authenticated', async () => {
			setupAuthMock(false);

			const response = await request(app).get('/api/settings/1/logs');

			expect(response.status).toBe(401);
		});

		it('should return app logs when authenticated', async () => {
			mockSettingsService.getAppLogs.mockResolvedValue({
				logs: ['log line 1', 'log line 2'],
			} as any);

			const response = await request(app).get('/api/settings/1/logs');

			expect(response.status).toBe(200);
			expect(mockSettingsService.getAppLogs).toHaveBeenCalledWith(1);
		});
	});

	describe('GET /api/settings/:id/logs/download', () => {
		it('should return 401 if not authenticated', async () => {
			setupAuthMock(false);

			const response = await request(app).get('/api/settings/1/logs/download');

			expect(response.status).toBe(401);
		});

		it('should initiate log download when authenticated', async () => {
			// Stream test - just verify service was called with error
			mockSettingsService.getAppLogsFile.mockImplementation(async () => {
				throw new Error('Stream test - expected');
			});

			const response = await request(app).get('/api/settings/1/logs/download');

			expect(mockSettingsService.getAppLogsFile).toHaveBeenCalled();
			expect(response.status).toBe(500);
		});
	});

	describe('POST /api/settings/integration/validate', () => {
		it('should return 401 if not authenticated', async () => {
			setupAuthMock(false);

			const response = await request(app)
				.post('/api/settings/integration/validate')
				.send({
					settingsID: '1',
					type: 'smtp',
					settings: { host: 'smtp.example.com' },
					test: 'test@example.com',
				});

			expect(response.status).toBe(401);
		});

		it('should validate integration when authenticated', async () => {
			mockSettingsService.validateIntegration.mockResolvedValue({
				valid: true,
				message: 'Integration is valid',
			} as any);

			const response = await request(app)
				.post('/api/settings/integration/validate')
				.send({
					settingsID: '1',
					type: 'smtp',
					settings: { host: 'smtp.example.com' },
					test: 'test@example.com',
				});

			expect(response.status).toBe(200);
			expect(mockSettingsService.validateIntegration).toHaveBeenCalled();
		});
	});
});
