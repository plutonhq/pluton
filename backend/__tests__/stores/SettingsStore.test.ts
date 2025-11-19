import { SettingsStore } from '../../src/stores/SettingsStore';
import { DatabaseType } from '../../src/db';
import { NewSettings, Settings } from '../../src/db/schema/settings';
import { AppSettings } from '../../src/types/settings';
import { NotificationChannelResolver } from '#core-backend/notifications/channels/NotificationChannelResolver';

// Mock dependencies
jest.mock('#core-backend/notifications/channels/NotificationChannelResolver');
jest.mock('../../src/types/settings', () => {
	const originalModule = jest.requireActual('../../src/types/settings');
	return {
		...originalModule,
		INTEGRATIONS_AVAILABLE: {
			smtp: { name: 'SMTP', required: ['server', 'port', 'username', 'password', 'senderEmail'] },
			ntfy: { name: 'Ntfy', required: ['authType', 'authToken'] },
		},
	};
});

describe('SettingsStore', () => {
	let settingsStore: SettingsStore;
	let mockDb: any; // Using `any` for easier mocking

	// --- Mock Data ---
	const mockEncryptedPassword = 'encrypted_password_string';
	const mockDecryptedPassword = 'decrypted_password_string';

	const mockAppSettings: AppSettings = {
		title: 'Pluton Test App',
		description: 'A test instance',
		theme: 'dark',
		admin_email: 'admin@test.com',
		integration: {
			smtp: {
				server: 'smtp.test.com',
				port: 587,
				username: 'user',
				password: mockEncryptedPassword,
				senderEmail: 'sender@test.com',
				connected: true,
			},
		},
		reporting: {
			emails: [],
			time: '20:00',
			daily: { enabled: false },
			weekly: { enabled: false },
			monthly: { enabled: false },
		},
	};

	const mockSettingsRecord: Settings = {
		id: 1,
		settings: mockAppSettings,
		version: 1,
		updatedAt: new Date(),
		updatedBy: 'system',
	};

	beforeEach(() => {
		jest.clearAllMocks();

		// **FIX:** Create robust mocks for Drizzle's chained query builders
		const updateQueryBuilder = {
			set: jest.fn().mockReturnThis(),
			where: jest.fn().mockReturnThis(),
			returning: jest.fn(),
		};
		const deleteQueryBuilder = {
			where: jest.fn(),
		};

		mockDb = {
			query: {
				settings: {
					findFirst: jest.fn(),
				},
			},
			insert: jest.fn().mockReturnValue({
				values: jest.fn().mockReturnThis(),
				returning: jest.fn(),
			}),
			update: jest.fn().mockReturnValue(updateQueryBuilder),
			delete: jest.fn().mockReturnValue(deleteQueryBuilder),
		};

		// Mock the static methods of NotificationChannelResolver
		(NotificationChannelResolver.decryptSecrets as jest.Mock).mockImplementation(integration => {
			const decrypted = JSON.parse(JSON.stringify(integration));
			if (decrypted.smtp) {
				decrypted.smtp.password = mockDecryptedPassword;
			}
			return decrypted;
		});
		(NotificationChannelResolver.encryptSecrets as jest.Mock).mockImplementation(integration => {
			const encrypted = JSON.parse(JSON.stringify(integration));
			if (encrypted.smtp && encrypted.smtp.password !== mockEncryptedPassword) {
				encrypted.smtp.password = mockEncryptedPassword;
			}
			return encrypted;
		});

		settingsStore = new SettingsStore(mockDb as DatabaseType);
	});

	// ... (getFirst, getById, create tests remain the same and are correct) ...
	describe('getFirst', () => {
		it('should return the first settings record with decrypted secrets', async () => {
			// Arrange
			mockDb.query.settings.findFirst.mockResolvedValue(mockSettingsRecord);

			// Act
			const result = await settingsStore.getFirst();

			// Assert
			expect(mockDb.query.settings.findFirst).toHaveBeenCalled();
			expect(NotificationChannelResolver.decryptSecrets).toHaveBeenCalledWith(
				mockAppSettings.integration
			);
			expect(result).not.toBeNull();
			expect(result!.id).toBe(1);
			expect(result!.settings!.integration!.smtp!.password).toBe(mockDecryptedPassword);
		});

		it('should return null if no settings are found', async () => {
			// Arrange
			mockDb.query.settings.findFirst.mockResolvedValue(null);

			// Act
			const result = await settingsStore.getFirst();

			// Assert
			expect(result).toBeNull();
			expect(NotificationChannelResolver.decryptSecrets).not.toHaveBeenCalled();
		});
	});

	describe('getById', () => {
		it('should return a settings record by ID with decrypted secrets', async () => {
			// Arrange
			mockDb.query.settings.findFirst.mockResolvedValue(mockSettingsRecord);

			// Act
			const result = await settingsStore.getById(1);

			// Assert
			expect(mockDb.query.settings.findFirst).toHaveBeenCalledWith({ where: expect.any(Object) });
			expect(NotificationChannelResolver.decryptSecrets).toHaveBeenCalled();
			expect(result).not.toBeNull();
			expect(result!.settings!.integration!.smtp!.password).toBe(mockDecryptedPassword);
		});
	});

	describe('create', () => {
		it('should insert a new settings record and return it', async () => {
			// Arrange
			const newSettings: NewSettings = { settings: mockAppSettings };
			mockDb.insert().returning.mockResolvedValue([mockSettingsRecord]);

			// Act
			const result = await settingsStore.create(newSettings);

			// Assert
			expect(mockDb.insert).toHaveBeenCalled();
			expect(mockDb.insert().values).toHaveBeenCalledWith(newSettings);
			expect(result).toEqual(mockSettingsRecord);
		});
	});

	describe('update', () => {
		it('should encrypt secrets, set connection status, and update the record', async () => {
			// Arrange
			const updates: AppSettings = {
				...mockAppSettings,
				integration: {
					smtp: {
						...mockAppSettings.integration!.smtp!,
						password: mockDecryptedPassword,
					},
				},
			};
			const originalIntegrationState = JSON.parse(JSON.stringify(updates.integration));
			const expectedSettingsForDb = {
				...updates,
				integration: {
					smtp: {
						...updates.integration!.smtp!,
						password: mockEncryptedPassword,
						connected: true,
					},
				},
			};
			// **FIX:** Mock the final `returning` call of the update chain
			mockDb
				.update()
				.returning.mockResolvedValue([{ ...mockSettingsRecord, settings: expectedSettingsForDb }]);

			// Act
			const result = await settingsStore.update(1, updates);

			// Assert
			expect(NotificationChannelResolver.encryptSecrets).toHaveBeenCalledWith(
				originalIntegrationState
			);
			const setCallPayload = mockDb.update().set.mock.calls[0][0];
			expect(setCallPayload.settings.integration.smtp.password).toBe(mockEncryptedPassword);
			expect(setCallPayload.settings.integration.smtp.connected).toBe(true);
			expect(mockDb.update().where).toHaveBeenCalled();
			expect(result!.settings).toEqual(expectedSettingsForDb);
		});

		it('should set integration `connected` status to false if required fields are missing', async () => {
			// Arrange
			const incompleteUpdates: AppSettings = {
				...mockAppSettings,
				integration: {
					smtp: {
						server: 'smtp.test.com',
						port: 587,
						username: '',
						password: mockDecryptedPassword,
						senderEmail: 'sender@test.com',
						connected: true,
					},
				},
			};
			mockDb.update().returning.mockResolvedValue([mockSettingsRecord]);

			// Act
			await settingsStore.update(1, incompleteUpdates);

			// Assert
			const setCallPayload = mockDb.update().set.mock.calls[0][0];
			expect(setCallPayload.settings.integration.smtp.connected).toBe(false);
		});

		it('should set ntfy `connected` to true when required fields are present', async () => {
			// Arrange
			const ntfyUpdates: AppSettings = {
				...mockAppSettings,
				integration: {
					ntfy: { authType: 'token', authToken: 'some-token', connected: false },
				},
			};
			mockDb.update().returning.mockResolvedValue([mockSettingsRecord]);

			// Act
			await settingsStore.update(1, ntfyUpdates);

			// Assert
			const setCallPayload = mockDb.update().set.mock.calls[0][0];
			expect(setCallPayload.settings.integration.ntfy.connected).toBe(true);
		});
	});

	describe('delete', () => {
		it('should delete a record and return true on success', async () => {
			// Arrange
			// **FIX:** Mock the final `where` call of the delete chain
			mockDb.delete().where.mockResolvedValue({ changes: 1 });

			// Act
			const result = await settingsStore.delete(1);

			// Assert
			expect(mockDb.delete).toHaveBeenCalled();
			expect(mockDb.delete().where).toHaveBeenCalled();
			expect(result).toBe(true);
		});

		it('should return false if no record was deleted', async () => {
			// Arrange
			mockDb.delete().where.mockResolvedValue({ changes: 0 });

			// Act
			const result = await settingsStore.delete(99);

			// Assert
			expect(result).toBe(false);
		});
	});
});
