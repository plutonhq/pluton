import { Request, Response } from 'express';
import { SettingsController } from '../../src/controllers/SettingsController';
import { SettingsService } from '../../src/services/SettingsService';
import { AppSettings } from '../../src/types/settings';

jest.mock('../../src/services/ConfigService', () => ({
	configService: {
		get: jest.fn().mockReturnValue(undefined),
		getAll: jest.fn().mockReturnValue({}),
	},
	ConfigService: {
		getInstance: jest.fn().mockReturnValue({
			get: jest.fn().mockReturnValue(undefined),
			getAll: jest.fn().mockReturnValue({}),
		}),
	},
}));

jest.mock('../../src/services/SettingsService');

describe('SettingsController', () => {
	let settingsController: SettingsController;
	let mockSettingsService: jest.Mocked<SettingsService>;
	let mockRequest: Partial<Request>;
	let mockResponse: Partial<Response>;
	let mockJson: jest.Mock;
	let mockStatus: jest.Mock;
	let mockSetHeader: jest.Mock;
	let mockPipe: jest.Mock;

	beforeEach(() => {
		jest.clearAllMocks();

		mockSettingsService = new SettingsService(null as any) as jest.Mocked<SettingsService>;

		mockJson = jest.fn().mockReturnThis();
		mockStatus = jest.fn().mockReturnValue({ json: mockJson });
		mockSetHeader = jest.fn();
		mockPipe = jest.fn();

		mockResponse = {
			json: mockJson,
			status: mockStatus,
			setHeader: mockSetHeader,
		};

		mockRequest = {
			params: {},
			query: {},
			body: {},
		};

		settingsController = new SettingsController(mockSettingsService);
	});

	describe('getMainSettings', () => {
		it('should successfully get main settings', async () => {
			const mockSettings = {
				id: 1,
				settings: { notifications: { enabled: true } } as any,
				updatedAt: null,
				updatedBy: null,
				version: 1,
			};
			mockSettingsService.getMainSettings.mockResolvedValue(mockSettings as any);

			await settingsController.getMainSettings(mockRequest as Request, mockResponse as Response);

			expect(mockSettingsService.getMainSettings).toHaveBeenCalled();
			expect(mockStatus).toHaveBeenCalledWith(200);
			expect(mockJson).toHaveBeenCalledWith({
				success: true,
				result: mockSettings,
			});
		});

		it('should return 404 if settings not found', async () => {
			mockSettingsService.getMainSettings.mockResolvedValue(null);

			await settingsController.getMainSettings(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(404);
		});

		it('should return 500 if service throws an error', async () => {
			mockSettingsService.getMainSettings.mockRejectedValue(new Error('Database error'));

			await settingsController.getMainSettings(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(500);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: "couldn't Retrieve App settings.",
			});
		});
	});

	describe('getSettings', () => {
		it('should return 400 if settings ID is missing', async () => {
			mockRequest.params = {};

			await settingsController.getSettings(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(400);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Settings ID is required',
			});
		});

		it('should successfully get settings by ID', async () => {
			const mockSettings = {
				id: 1,
				settings: { notifications: { enabled: true } } as any,
				updatedAt: null,
				updatedBy: null,
				version: 1,
			};
			mockRequest.params = { id: '1' };
			mockSettingsService.getSettings.mockResolvedValue(mockSettings as any);

			await settingsController.getSettings(mockRequest as Request, mockResponse as Response);

			expect(mockSettingsService.getSettings).toHaveBeenCalledWith(1);
			expect(mockStatus).toHaveBeenCalledWith(200);
			expect(mockJson).toHaveBeenCalledWith({
				success: true,
				result: mockSettings,
			});
		});

		it('should return 404 if settings not found', async () => {
			mockRequest.params = { id: '1' };
			mockSettingsService.getSettings.mockResolvedValue(null);

			await settingsController.getSettings(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(404);
		});

		it('should return 500 if service throws an error', async () => {
			mockRequest.params = { id: '1' };
			mockSettingsService.getSettings.mockRejectedValue(new Error('Database error'));

			await settingsController.getSettings(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(500);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: "couldn't Retrieve settings for the given ID.",
			});
		});
	});

	describe('updateSettings', () => {
		it('should return 400 if settings ID is missing', async () => {
			mockRequest.params = {};
			mockRequest.body = { settings: {} };

			await settingsController.updateSettings(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(400);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Settings ID or Settings Data Missing',
			});
		});

		it('should return 400 if settings data is missing', async () => {
			mockRequest.params = { id: '1' };
			mockRequest.body = {};

			await settingsController.updateSettings(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(400);
		});

		it('should successfully update settings', async () => {
			const settingsData = { notifications: { enabled: true } } as any;
			const updatedSettings = {
				id: 1,
				settings: settingsData,
				updatedAt: new Date(),
				updatedBy: null,
				version: 1,
			};
			mockRequest.params = { id: '1' };
			mockRequest.body = { settings: settingsData };
			mockSettingsService.updateSettings.mockResolvedValue(updatedSettings as any);

			await settingsController.updateSettings(mockRequest as Request, mockResponse as Response);

			expect(mockSettingsService.updateSettings).toHaveBeenCalledWith(1, settingsData);
			expect(mockStatus).toHaveBeenCalledWith(200);
			expect(mockJson).toHaveBeenCalledWith({
				success: true,
				result: updatedSettings,
			});
		});

		it('should return 404 if settings not found', async () => {
			const settingsData = { notifications: { enabled: true } } as any;
			mockRequest.params = { id: '1' };
			mockRequest.body = { settings: settingsData };
			mockSettingsService.updateSettings.mockResolvedValue(null);

			await settingsController.updateSettings(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(404);
		});

		it('should return 500 if service throws an error', async () => {
			const settingsData = { notifications: { enabled: true } } as any;
			mockRequest.params = { id: '1' };
			mockRequest.body = { settings: settingsData };
			mockSettingsService.updateSettings.mockRejectedValue(new Error('Update failed'));

			await settingsController.updateSettings(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(500);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Update failed',
			});
		});
	});

	describe('validateIntegration', () => {
		it('should return 400 if required fields are missing', async () => {
			mockRequest.body = {};

			await settingsController.validateIntegration(
				mockRequest as Request,
				mockResponse as Response
			);

			expect(mockStatus).toHaveBeenCalledWith(400);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Integration Payload Missing.',
			});
		});

		it('should successfully validate integration', async () => {
			mockRequest.body = {
				settingsID: '1',
				type: 'smtp',
				settings: { smtp: { host: 'smtp.example.com' } },
				test: true,
			};
			mockSettingsService.validateIntegration.mockResolvedValue(true);

			await settingsController.validateIntegration(
				mockRequest as Request,
				mockResponse as Response
			);

			expect(mockSettingsService.validateIntegration).toHaveBeenCalledWith(
				1,
				'smtp',
				true,
				mockRequest.body.settings
			);
			expect(mockStatus).toHaveBeenCalledWith(200);
			expect(mockJson).toHaveBeenCalledWith({
				success: true,
				result: 'Email Sent Successfully',
			});
		});

		it('should return 500 if service throws an error', async () => {
			mockRequest.body = {
				settingsID: '1',
				type: 'smtp',
				settings: { smtp: { host: 'smtp.example.com' } },
				test: true,
			};
			mockSettingsService.validateIntegration.mockRejectedValue(
				new Error('SMTP connection failed')
			);

			await settingsController.validateIntegration(
				mockRequest as Request,
				mockResponse as Response
			);

			expect(mockStatus).toHaveBeenCalledWith(500);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'SMTP connection failed',
			});
		});
	});

	describe('getAppLogs', () => {
		it('should return 400 if settings ID is missing', async () => {
			mockRequest.params = {};

			await settingsController.getAppLogs(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(400);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Settings ID is required',
			});
		});

		it('should successfully get app logs', async () => {
			const mockLogs = [
				{ timestamp: new Date(), level: 'info', message: 'log line 1' },
				{ timestamp: new Date(), level: 'info', message: 'log line 2' },
			];
			mockRequest.params = { id: '1' };
			mockSettingsService.getAppLogs.mockResolvedValue(mockLogs as any);

			await settingsController.getAppLogs(mockRequest as Request, mockResponse as Response);

			expect(mockSettingsService.getAppLogs).toHaveBeenCalledWith(1);
			expect(mockStatus).toHaveBeenCalledWith(200);
			expect(mockJson).toHaveBeenCalledWith({
				success: true,
				result: mockLogs,
			});
		});

		it('should return 500 if service throws an error', async () => {
			mockRequest.params = { id: '1' };
			mockSettingsService.getAppLogs.mockRejectedValue(new Error('Log read failed'));

			await settingsController.getAppLogs(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(500);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Failed to get logs: Log read failed',
			});
		});
	});

	describe('downloadAppLogs', () => {
		it('should return 400 if settings ID is missing', async () => {
			mockRequest.params = {};

			await settingsController.downloadAppLogs(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(400);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Settings ID is required',
			});
		});

		it('should successfully stream log file', async () => {
			const mockFileStream = { pipe: mockPipe };
			mockRequest.params = { id: '1' };
			mockSettingsService.getAppLogsFile.mockResolvedValue(mockFileStream as any);

			await settingsController.downloadAppLogs(mockRequest as Request, mockResponse as Response);

			expect(mockSettingsService.getAppLogsFile).toHaveBeenCalled();
			expect(mockSetHeader).toHaveBeenCalledWith('Content-Type', 'text/plain');
			expect(mockSetHeader).toHaveBeenCalledWith(
				'Content-Disposition',
				'attachment; filename="app.log"'
			);
			expect(mockPipe).toHaveBeenCalledWith(mockResponse);
		});

		it('should return 500 if service throws an error', async () => {
			mockRequest.params = { id: '1' };
			mockSettingsService.getAppLogsFile.mockRejectedValue(new Error('File not found'));

			await settingsController.downloadAppLogs(mockRequest as Request, mockResponse as Response);

			expect(mockStatus).toHaveBeenCalledWith(500);
			expect(mockJson).toHaveBeenCalledWith({
				success: false,
				error: 'Failed to download logs: File not found',
			});
		});
	});
});
