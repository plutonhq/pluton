import { createReadStream, constants, ReadStream } from 'fs';
import path from 'path';
import { readFile, access } from 'fs/promises';
import { SettingsService } from '../../src/services/SettingsService';
import { SettingsStore } from '../../src/stores/SettingsStore';
import { AppSettings } from '../../src/types/settings';
import { AppError, NotFoundError } from '../../src/utils/AppError';
import { NotificationChannelResolver } from '../../src/notifications/channels/NotificationChannelResolver';
import { SMTPChannel } from '../../src/notifications/channels/SMTPChannel';
import { Settings } from '../../src/db/schema/settings';

// Mock all dependencies
jest.mock('../../src/db/index', () => ({
	db: {
		select: jest.fn(),
		insert: jest.fn(),
		update: jest.fn(),
		delete: jest.fn(),
	},
}));

jest.mock('../../src/stores/SettingsStore');
jest.mock('../../src/notifications/channels/NotificationChannelResolver');
jest.mock('../../src/notifications/templates/email/test-email/TestEmailNotification');
jest.mock('../../src/notifications/channels/SMTPChannel');
jest.mock('fs/promises');
jest.mock('fs');

// Mock config service as it's used in notifications
jest.mock('../../src/services/ConfigService', () => ({
	configService: {
		config: {
			APP_TITLE: 'Pluton Test',
			APP_URL: 'http://localhost:3000',
		},
	},
}));

// Create typed mock references for fs modules
const mockedReadFile = readFile as jest.Mock;
const mockedAccess = access as jest.Mock;
const mockedCreateReadStream = createReadStream as jest.Mock;

// Get a typed reference to the mocked class
const MockedNotificationChannelResolver = NotificationChannelResolver as jest.MockedClass<
	typeof NotificationChannelResolver
>;

describe('SettingsService', () => {
	let settingsService: SettingsService;
	let mockSettingsStore: jest.Mocked<SettingsStore>;
	let mockSmtpChannel: jest.Mocked<SMTPChannel>;

	beforeEach(() => {
		jest.clearAllMocks();

		mockSettingsStore = new SettingsStore(null as any) as jest.Mocked<SettingsStore>;
		mockSmtpChannel = new SMTPChannel({} as any) as jest.Mocked<SMTPChannel>;

		// --- FIX: Explicitly cast the static methods to jest.Mock ---
		(MockedNotificationChannelResolver.getChannel as jest.Mock).mockResolvedValue(mockSmtpChannel);
		(MockedNotificationChannelResolver.encryptSecrets as jest.Mock).mockImplementation(
			integration => integration
		);

		settingsService = new SettingsService(mockSettingsStore);
	});

	// ----------------------------------------
	// getMainSettings
	// ----------------------------------------
	describe('getMainSettings', () => {
		it('should return the main settings from the store', async () => {
			const mockSettings = { id: 1, settings: { title: 'Main Settings' } } as Settings;
			mockSettingsStore.getFirst.mockResolvedValue(mockSettings);

			const result = await settingsService.getMainSettings();

			expect(mockSettingsStore.getFirst).toHaveBeenCalled();
			expect(result).toEqual(mockSettings);
		});
	});

	// ----------------------------------------
	// getSettings
	// ----------------------------------------
	describe('getSettings', () => {
		it('should return settings for a given ID', async () => {
			const mockSettings = { id: 1, settings: { title: 'Specific Settings' } } as Settings;
			mockSettingsStore.getById.mockResolvedValue(mockSettings);

			const result = await settingsService.getSettings(1);

			expect(mockSettingsStore.getById).toHaveBeenCalledWith(1);
			expect(result).toEqual(mockSettings);
		});
	});

	// ----------------------------------------
	// updateSettings
	// ----------------------------------------
	describe('updateSettings', () => {
		const settingsId = 1;
		const updateData = { title: 'Updated Title' } as AppSettings;

		it('should successfully update the settings', async () => {
			mockSettingsStore.update.mockResolvedValue({ id: settingsId, settings: updateData } as any);

			const result = await settingsService.updateSettings(settingsId, updateData);

			expect(mockSettingsStore.update).toHaveBeenCalledWith(settingsId, updateData);
			expect(result?.settings?.title).toBe('Updated Title');
		});

		// it('should throw an AppError for invalid settings data', async () => {
		// 	const invalidData = { title: 123 } as any; // Invalid type

		// 	await expect(settingsService.updateSettings(settingsId, invalidData)).rejects.toThrow(
		// 		AppError
		// 	);
		// 	await expect(settingsService.updateSettings(settingsId, invalidData)).rejects.toThrow(
		// 		'Invalid settings data provided'
		// 	);
		// });

		it('should throw an AppError if the store fails to update', async () => {
			mockSettingsStore.update.mockResolvedValue(null);

			await expect(settingsService.updateSettings(settingsId, updateData)).rejects.toThrow(
				'Failed to update settings'
			);
		});
	});

	// ----------------------------------------
	// validateIntegration
	// ----------------------------------------
	describe('validateIntegration', () => {
		const settingsId = 1;
		const testPayload = { email: 'test@example.com' };
		const mockAppSettings = {
			title: 'Pluton',
			integration: { smtp: { server: 'smtp.example.com', connected: false } },
		} as AppSettings;

		it('should validate, send email, and update connection status to true', async () => {
			// First update returns the settings, second one confirms connection status update
			mockSettingsStore.update
				.mockResolvedValueOnce({ id: 1, settings: mockAppSettings } as any)
				.mockResolvedValueOnce({ id: 1, settings: mockAppSettings } as any);
			mockSmtpChannel.send.mockResolvedValue({ success: true, result: 'Email sent' });

			const result = await settingsService.validateIntegration(
				settingsId,
				'smtp',
				testPayload,
				mockAppSettings
			);

			expect(MockedNotificationChannelResolver.encryptSecrets).toHaveBeenCalled();
			expect(mockSettingsStore.update).toHaveBeenCalledTimes(2);
			expect(mockSmtpChannel.send).toHaveBeenCalled();
			// Check that the second update call sets connected to true
			expect(mockSettingsStore.update).toHaveBeenLastCalledWith(
				settingsId,
				expect.objectContaining({
					integration: expect.objectContaining({
						smtp: expect.objectContaining({ connected: true }),
					}),
				})
			);
			expect(result).toBe(true);
		});

		it('should throw an AppError if sending the email fails', async () => {
			mockSettingsStore.update.mockResolvedValue({ id: 1, settings: mockAppSettings } as any);
			mockSmtpChannel.send.mockResolvedValue({ success: false, result: 'Auth failed' });

			const promise = settingsService.validateIntegration(
				settingsId,
				'smtp',
				testPayload,
				mockAppSettings
			);

			await expect(promise).rejects.toThrow(AppError);
			await expect(promise).rejects.toThrow(
				'Failed to send test email using smtp. Reason: Auth failed'
			);

			// Ensure the second update to set `connected: true` was NOT called
			expect(mockSettingsStore.update).toHaveBeenCalledTimes(1);
		});

		it('should throw an AppError if the initial settings update fails', async () => {
			mockSettingsStore.update.mockResolvedValue(null); // Simulate DB update failure

			await expect(
				settingsService.validateIntegration(settingsId, 'smtp', testPayload, mockAppSettings)
			).rejects.toThrow('Failed to update settings');

			// Ensure no email was attempted
			expect(mockSmtpChannel.send).not.toHaveBeenCalled();
		});
	});

	// ----------------------------------------
	// getAppLogs / downloadAppLogs
	// ----------------------------------------
	describe('App Logs', () => {
		const settingsId = 1;
		const logContent =
			'{"level":30,"time":1672531200000,"msg":"Log message 1"}\n{"level":40,"time":1672531260000,"msg":"Log message 2"}';

		describe('getAppLogs', () => {
			it('should read and parse the log file', async () => {
				mockedReadFile.mockResolvedValue(logContent);

				const logs = await settingsService.getAppLogs(settingsId);

				expect(mockedReadFile).toHaveBeenCalledWith(expect.stringContaining('app.log'), 'utf-8');
				expect(logs).toHaveLength(2);
				expect(logs[0].msg).toBe('Log message 1');
				expect(logs[1].level).toBe(40);
			});

			it('should throw NotFoundError if the log file does not exist', async () => {
				mockedReadFile.mockRejectedValue({ code: 'ENOENT' });

				await expect(settingsService.getAppLogs(settingsId)).rejects.toThrow(
					'No logs found for this plan'
				);
				await expect(settingsService.getAppLogs(settingsId)).rejects.toHaveProperty(
					'statusCode',
					404
				);
			});
		});

		describe('downloadAppLogs', () => {
			it('should return a readable stream for the log file', async () => {
				const mockStream = 'mock-stream' as any;
				mockedAccess.mockResolvedValue(undefined); // File exists
				mockedCreateReadStream.mockReturnValue(mockStream);

				const result = await settingsService.getAppLogsFile();

				expect(mockedAccess).toHaveBeenCalledWith(
					expect.stringContaining('app.log'),
					constants.F_OK
				);
				expect(mockedCreateReadStream).toHaveBeenCalledWith(expect.stringContaining('app.log'));
				expect(result).toBe(mockStream);
			});

			it('should throw NotFoundError if log file does not exist for download', async () => {
				mockedAccess.mockRejectedValue({ code: 'ENOENT' });
				await expect(settingsService.getAppLogsFile()).rejects.toThrow('Log file not found');
				await expect(settingsService.getAppLogsFile()).rejects.toHaveProperty('statusCode', 404);
			});
		});
	});
});
