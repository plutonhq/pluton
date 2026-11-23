import { readLogPage, streamLogFiles } from '../../src/utils/logging/LogReader';
import { listLogFiles } from '../../src/utils/logging/logFiles';
import { SettingsService } from '../../src/services/SettingsService';
import type { SelfBackupService } from '../../src/services/SelfBackupService';
import { SettingsStore } from '../../src/stores/SettingsStore';
import { AppSettings } from '../../src/types/settings';
import { AppError } from '../../src/utils/AppError';
import { NotificationChannelResolver } from '../../src/notifications/channels/NotificationChannelResolver';
import { SMTPChannel } from '../../src/notifications/channels/SMTPChannel';
import { NtfyChannel } from '../../src/notifications/channels/NtfyChannel';
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
jest.mock('../../src/notifications/templates/push/test-ntfy/TestNtfyNotification');
jest.mock('../../src/notifications/channels/SMTPChannel');
jest.mock('../../src/notifications/channels/NtfyChannel');
jest.mock('fs/promises');
jest.mock('fs');
jest.mock('../../src/utils/logging/LogReader');
jest.mock('../../src/utils/logging/logFiles');

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
const mockedReadLogPage = readLogPage as jest.Mock;
const mockedStreamLogFiles = streamLogFiles as jest.Mock;
const mockedListLogFiles = listLogFiles as jest.Mock;

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

		settingsService = new SettingsService(mockSettingsStore, {} as SelfBackupService);
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

		describe('2FA data', () => {
			const storedTotp = { enabled: true, secret: 'stored-secret', recoveryCodes: ['hash1'] };

			beforeEach(() => {
				mockSettingsStore.update.mockImplementation(
					async (id, settings) => ({ id, settings }) as any
				);
			});

			it('should keep the stored secret and recovery codes when the request has fake values', async () => {
				mockSettingsStore.getById.mockResolvedValue({ id: 1, settings: { totp: storedTotp } } as any);

				await settingsService.updateSettings(settingsId, {
					title: 'T',
					totp: { enabled: true, secret: 'attacker-secret', recoveryCodes: ['attacker-hash'] },
				} as AppSettings);

				expect(mockSettingsStore.update.mock.calls[0][1].totp).toEqual(storedTotp);
			});

			it('should keep the stored 2FA data when the request has no totp block', async () => {
				mockSettingsStore.getById.mockResolvedValue({ id: 1, settings: { totp: storedTotp } } as any);

				await settingsService.updateSettings(settingsId, { title: 'T' } as AppSettings);

				expect(mockSettingsStore.update.mock.calls[0][1].totp).toEqual(storedTotp);
			});

			it('should ignore the requested enabled value', async () => {
				mockSettingsStore.getById.mockResolvedValue({ id: 1, settings: { totp: storedTotp } } as any);
				await settingsService.updateSettings(settingsId, {
					totp: { enabled: false, configured: true },
				} as any);
				expect(mockSettingsStore.update.mock.calls[0][1].totp).toEqual(storedTotp);

				const disabledTotp = { ...storedTotp, enabled: false };
				mockSettingsStore.getById.mockResolvedValue({ id: 1, settings: { totp: disabledTotp } } as any);
				await settingsService.updateSettings(settingsId, {
					totp: { enabled: true, configured: true },
				} as any);
				expect(mockSettingsStore.update.mock.calls[1][1].totp).toEqual(disabledTotp);
			});

			it('should not enable 2FA when no secret is stored', async () => {
				mockSettingsStore.getById.mockResolvedValue({ id: 1, settings: {} } as any);

				await settingsService.updateSettings(settingsId, {
					totp: { enabled: true, secret: 'attacker-secret', recoveryCodes: [] },
				} as any);

				expect(mockSettingsStore.update.mock.calls[0][1].totp).toEqual({
					enabled: false,
					secret: '',
					recoveryCodes: [],
				});
			});
		});

		it('should throw an AppError if the store fails to update', async () => {
			mockSettingsStore.update.mockResolvedValue(null);

			await expect(settingsService.updateSettings(settingsId, updateData)).rejects.toThrow(
				'Failed to update settings'
			);
		});
	});

	// ----------------------------------------
	// disableTwoFactorAuth
	// ----------------------------------------
	describe('disableTwoFactorAuth', () => {
		it('should remove the secret and recovery codes and keep other settings', async () => {
			mockSettingsStore.getById.mockResolvedValue({
				id: 1,
				settings: { title: 'T', totp: { enabled: true, secret: 's', recoveryCodes: ['h1'] } },
			} as any);
			mockSettingsStore.update.mockResolvedValue({ id: 1 } as any);

			await settingsService.disableTwoFactorAuth(1);

			expect(mockSettingsStore.update).toHaveBeenCalledWith(1, {
				title: 'T',
				totp: { enabled: false, secret: '', recoveryCodes: [] },
			});
		});

		it('should throw if the settings record does not exist', async () => {
			mockSettingsStore.getById.mockResolvedValue(null);

			await expect(settingsService.disableTwoFactorAuth(1)).rejects.toThrow('Settings not found');
			expect(mockSettingsStore.update).not.toHaveBeenCalled();
		});

		it('should throw if the store fails to update', async () => {
			mockSettingsStore.getById.mockResolvedValue({ id: 1, settings: { title: 'T' } } as any);
			mockSettingsStore.update.mockResolvedValue(null);

			await expect(settingsService.disableTwoFactorAuth(1)).rejects.toThrow('Failed to disable 2FA');
		});
	});

	// ----------------------------------------
	// consumeRecoveryCode
	// ----------------------------------------
	describe('consumeRecoveryCode', () => {
		const { createHash } = jest.requireActual('crypto');
		const hash = (code: string) => createHash('sha256').update(code).digest('hex');
		const row = () =>
			({
				id: 1,
				settings: {
					title: 'T',
					totp: { enabled: true, secret: 's', recoveryCodes: [hash('AAAAA11111'), hash('BBBBB22222')] },
				},
			}) as any;

		it('should accept a stored code and remove it', async () => {
			mockSettingsStore.getFirst.mockResolvedValue(row());

			const result = await settingsService.consumeRecoveryCode(' aaaaa11111 ');

			expect(result).toBe(true);
			expect(mockSettingsStore.update).toHaveBeenCalledWith(1, {
				title: 'T',
				totp: { enabled: true, secret: 's', recoveryCodes: [hash('BBBBB22222')] },
			});
		});

		it('should reject an unknown code without updating', async () => {
			mockSettingsStore.getFirst.mockResolvedValue(row());

			expect(await settingsService.consumeRecoveryCode('CCCCC33333')).toBe(false);
			expect(mockSettingsStore.update).not.toHaveBeenCalled();
		});
	});

	// ----------------------------------------
	// validateIntegration
	// ----------------------------------------
	describe('validateIntegration', () => {
		const settingsId = 1;
		const testPayload = { email: 'test@example.com' };
		const mockIntegrationSettings = {
			smtp: { server: 'smtp.example.com', connected: false },
		} as AppSettings['integration'];
		const mockReturnedAppSettings = {
			title: 'Pluton',
			integration: { smtp: { server: 'smtp.example.com', connected: false } },
		} as AppSettings;
		// The settings already persisted in the DB, which the validate flow must preserve.
		const mockStoredAppSettings = {
			title: 'My Backup Server',
			description: 'Pluton backup for your data.',
			theme: 'dark',
			admin_email: 'admin@example.com',
			integration: {},
			totp: { enabled: true, secret: 'encrypted-secret', recoveryCodes: ['abc123'] },
			reporting: {
				emails: ['reports@example.com'],
				time: '23:00',
				daily: { enabled: true },
				weekly: { enabled: false },
				monthly: { enabled: false },
			},
		} as AppSettings;

		beforeEach(() => {
			mockSettingsStore.getById.mockResolvedValue({
				id: settingsId,
				settings: mockStoredAppSettings,
			} as any);
		});

		it('should validate, send email, and update connection status to true', async () => {
			// First update returns the settings, second one confirms connection status update
			mockSettingsStore.update
				.mockResolvedValueOnce({ id: 1, settings: mockReturnedAppSettings } as any)
				.mockResolvedValueOnce({ id: 1, settings: mockReturnedAppSettings } as any);
			mockSmtpChannel.send.mockResolvedValue({ success: true, result: 'Email sent' });

			const result = await settingsService.validateIntegration(
				settingsId,
				'smtp',
				testPayload,
				mockIntegrationSettings
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
			mockSettingsStore.update.mockResolvedValue({
				id: 1,
				settings: mockReturnedAppSettings,
			} as any);
			mockSmtpChannel.send.mockResolvedValue({ success: false, result: 'Auth failed' });

			const promise = settingsService.validateIntegration(settingsId, 'smtp', testPayload, {
				...mockIntegrationSettings,
			});

			await expect(promise).rejects.toThrow(AppError);
			await expect(promise).rejects.toThrow(
				'Failed to send test notification using smtp. Reason: Auth failed'
			);

			// Ensure the second update to set `connected: true` was NOT called
			expect(mockSettingsStore.update).toHaveBeenCalledTimes(1);
		});

		it('should throw an AppError if the initial settings update fails', async () => {
			mockSettingsStore.update.mockResolvedValue(null); // Simulate DB update failure

			await expect(
				settingsService.validateIntegration(settingsId, 'smtp', testPayload, {
					...mockIntegrationSettings,
				})
			).rejects.toThrow('Failed to update settings');

			// Ensure no email was attempted
			expect(mockSmtpChannel.send).not.toHaveBeenCalled();
		});

		it('should preserve all other settings fields when writing the integration', async () => {
			mockSettingsStore.update.mockResolvedValue({
				id: settingsId,
				settings: mockReturnedAppSettings,
			} as any);
			mockSmtpChannel.send.mockResolvedValue({ success: true, result: 'Email sent' });

			await settingsService.validateIntegration(settingsId, 'smtp', testPayload, {
				...mockIntegrationSettings,
			});

			// `update` replaces the whole blob, so the first write must carry the stored fields
			// through — otherwise testing an integration silently wipes 2FA, reporting, etc.
			const [, firstWrite] = mockSettingsStore.update.mock.calls[0];
			expect(firstWrite).toMatchObject({
				title: 'My Backup Server',
				description: 'Pluton backup for your data.',
				theme: 'dark',
				admin_email: 'admin@example.com',
				totp: { enabled: true, secret: 'encrypted-secret', recoveryCodes: ['abc123'] },
				reporting: {
					emails: ['reports@example.com'],
					time: '23:00',
					daily: { enabled: true },
				},
			});
			// ...while still applying the integration under test
			expect(firstWrite.integration.smtp).toMatchObject({ server: 'smtp.example.com' });
		});

		it('should preserve integrations other than the one being tested', async () => {
			mockSettingsStore.getById.mockResolvedValue({
				id: settingsId,
				settings: {
					...mockStoredAppSettings,
					integration: {
						ntfy: { authType: 'token', authToken: 'existing-token', connected: true },
					},
				},
			} as any);
			mockSettingsStore.update.mockResolvedValue({
				id: settingsId,
				settings: mockReturnedAppSettings,
			} as any);
			mockSmtpChannel.send.mockResolvedValue({ success: true, result: 'Email sent' });

			await settingsService.validateIntegration(settingsId, 'smtp', testPayload, {
				...mockIntegrationSettings,
			});

			const [, firstWrite] = mockSettingsStore.update.mock.calls[0];
			expect(firstWrite.integration.ntfy).toMatchObject({ authToken: 'existing-token' });
			expect(firstWrite.integration.smtp).toMatchObject({ server: 'smtp.example.com' });
		});

		it('should throw if the settings record does not exist', async () => {
			mockSettingsStore.getById.mockResolvedValue(null);

			await expect(
				settingsService.validateIntegration(settingsId, 'smtp', testPayload, {
					...mockIntegrationSettings,
				})
			).rejects.toThrow('Settings not found');

			expect(mockSettingsStore.update).not.toHaveBeenCalled();
			expect(mockSmtpChannel.send).not.toHaveBeenCalled();
		});

		// Ntfy integration validation tests
		describe('ntfy', () => {
			const ntfyTestPayload = { url: 'https://ntfy.sh/testtopic' };
			const mockNtfyIntegrationSettings = {
				ntfy: { authType: 'token', authToken: 'tk_test', connected: false },
			} as AppSettings['integration'];
			const mockNtfyReturnedAppSettings = {
				title: 'Pluton',
				integration: { ntfy: { authType: 'token', authToken: 'tk_test', connected: false } },
			} as AppSettings;
			let mockNtfyChannel: jest.Mocked<NtfyChannel>;

			beforeEach(() => {
				mockNtfyChannel = new NtfyChannel({} as any) as jest.Mocked<NtfyChannel>;
				(MockedNotificationChannelResolver.getChannel as jest.Mock).mockResolvedValue(
					mockNtfyChannel
				);
			});

			it('should validate ntfy, send push notification, and update connection status', async () => {
				mockSettingsStore.update
					.mockResolvedValueOnce({ id: 1, settings: mockNtfyReturnedAppSettings } as any)
					.mockResolvedValueOnce({ id: 1, settings: mockNtfyReturnedAppSettings } as any);
				mockNtfyChannel.send.mockResolvedValue({
					success: true,
					result: 'Ntfy notification sent',
				});

				const result = await settingsService.validateIntegration(
					settingsId,
					'ntfy',
					ntfyTestPayload,
					{ ...mockNtfyIntegrationSettings }
				);

				expect(MockedNotificationChannelResolver.encryptSecrets).toHaveBeenCalled();
				expect(mockSettingsStore.update).toHaveBeenCalledTimes(2);
				expect(mockNtfyChannel.send).toHaveBeenCalledWith(
					expect.anything(),
					expect.objectContaining({ url: 'https://ntfy.sh/testtopic' })
				);
				expect(mockSettingsStore.update).toHaveBeenLastCalledWith(
					settingsId,
					expect.objectContaining({
						integration: expect.objectContaining({
							ntfy: expect.objectContaining({ connected: true }),
						}),
					})
				);
				expect(result).toBe(true);
			});

			it('should throw an AppError if sending the ntfy notification fails', async () => {
				mockSettingsStore.update.mockResolvedValue({
					id: 1,
					settings: mockNtfyReturnedAppSettings,
				} as any);
				mockNtfyChannel.send.mockResolvedValue({
					success: false,
					result: 'Ntfy returned 401: unauthorized',
				});

				const promise = settingsService.validateIntegration(settingsId, 'ntfy', ntfyTestPayload, {
					...mockNtfyIntegrationSettings,
				});

				await expect(promise).rejects.toThrow(AppError);
				await expect(promise).rejects.toThrow(
					'Failed to send test notification using ntfy. Reason: Ntfy returned 401: unauthorized'
				);

				expect(mockSettingsStore.update).toHaveBeenCalledTimes(1);
			});

			it('should throw an AppError if the initial ntfy settings update fails', async () => {
				mockSettingsStore.update.mockResolvedValue(null);

				await expect(
					settingsService.validateIntegration(settingsId, 'ntfy', ntfyTestPayload, {
						...mockNtfyIntegrationSettings,
					})
				).rejects.toThrow('Failed to update settings');

				expect(mockNtfyChannel.send).not.toHaveBeenCalled();
			});
		});
	});

	// ----------------------------------------
	// getAppLogs / downloadAppLogs
	// ----------------------------------------
	describe('App Logs', () => {
		const settingsId = 1;

		describe('getAppLogs', () => {
			it('reads one page of the app logs with the query', async () => {
				const page = { items: [], nextCursor: null, scannedTo: null, modules: [] };
				mockedReadLogPage.mockResolvedValue(page);

				const result = await settingsService.getAppLogs(settingsId, {
					cursor: 'c1',
					levels: ['error'],
				});

				expect(mockedReadLogPage).toHaveBeenCalledWith({
					prefix: 'app',
					cursor: 'c1',
					levels: ['error'],
				});
				expect(result).toBe(page);
			});
		});

		describe('downloadAppLogs', () => {
			it('should return a stream of the log files in the range', async () => {
				const mockStream = 'mock-stream' as any;
				mockedListLogFiles.mockReturnValue([{ name: 'app-2026-11.log' }]);
				mockedStreamLogFiles.mockReturnValue(mockStream);

				const result = await settingsService.getAppLogsFile(100, 200);

				expect(mockedStreamLogFiles).toHaveBeenCalledWith('app', 100, 200);
				expect(result).toBe(mockStream);
			});

			it('should throw NotFoundError if there are no log files', async () => {
				mockedListLogFiles.mockReturnValue([]);
				await expect(settingsService.getAppLogsFile()).rejects.toThrow('Log file not found');
				await expect(settingsService.getAppLogsFile()).rejects.toHaveProperty('statusCode', 404);
			});
		});
	});
});
