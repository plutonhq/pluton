import { NotificationChannelResolver } from '../../src/notifications/channels/NotificationChannelResolver';
import { SMTPChannel } from '../../src/notifications/channels/SMTPChannel';
import { db } from '../../src/db/index';
import { SettingsStore } from '../../src/stores/SettingsStore';
import { configService } from '../../src/services/ConfigService';
import Cryptr from 'cryptr';

// Mock dependencies
jest.mock('../../src/db/index', () => ({
	db: {},
}));
jest.mock('../../src/stores/SettingsStore');
jest.mock('../../src/services/ConfigService', () => ({
	configService: {
		config: {
			SECRET: 'test-secret-key-123',
		},
	},
}));
jest.mock('cryptr');

describe('NotificationChannelResolver', () => {
	let mockSettingsStore: jest.Mocked<SettingsStore>;
	let mockCryptr: jest.Mocked<Cryptr>;

	beforeEach(() => {
		jest.clearAllMocks();

		mockSettingsStore = {
			getFirst: jest.fn(),
		} as any;

		mockCryptr = {
			encrypt: jest.fn((value: string) => `encrypted_${value}`),
			decrypt: jest.fn((value: string) => value.replace('encrypted_', '')),
		} as any;

		(SettingsStore as jest.Mock).mockImplementation(() => mockSettingsStore);
		(Cryptr as jest.Mock).mockImplementation(() => mockCryptr);
	});

	describe('getChannel', () => {
		it('should return SMTPChannel for smtp type', async () => {
			const mockSettings = {
				settings: {
					integration: {
						smtp: {
							server: 'smtp.test.com',
							port: 587,
							username: 'user',
							password: 'pass',
							senderEmail: 'test@test.com',
							connected: true,
						},
					},
				},
			};

			mockSettingsStore.getFirst.mockResolvedValue(mockSettings as any);

			const channel = await NotificationChannelResolver.getChannel('smtp');

			expect(channel).toBeInstanceOf(SMTPChannel);
			expect(SettingsStore).toHaveBeenCalledWith(db);
		});

		it('should throw error when configuration is not available', async () => {
			mockSettingsStore.getFirst.mockResolvedValue(null);

			await expect(NotificationChannelResolver.getChannel('smtp')).rejects.toThrow(
				'smtp configuration is not available'
			);
		});

		it('should throw error when integration settings are missing', async () => {
			const mockSettings = {
				settings: {},
			};

			mockSettingsStore.getFirst.mockResolvedValue(mockSettings as any);

			await expect(NotificationChannelResolver.getChannel('smtp')).rejects.toThrow(
				'smtp configuration is not available'
			);
		});

		it('should throw error when specific channel config is missing', async () => {
			const mockSettings = {
				settings: {
					integration: {
						// smtp is missing
					},
				},
			};

			mockSettingsStore.getFirst.mockResolvedValue(mockSettings as any);

			await expect(NotificationChannelResolver.getChannel('smtp')).rejects.toThrow(
				'smtp configuration is not available'
			);
		});

		it('should use default smtp type when type not provided', async () => {
			const mockSettings = {
				settings: {
					integration: {
						smtp: {
							server: 'smtp.test.com',
							port: 587,
							username: 'user',
							password: 'pass',
							senderEmail: 'test@test.com',
							connected: true,
						},
					},
				},
			};

			mockSettingsStore.getFirst.mockResolvedValue(mockSettings as any);

			const channel = await NotificationChannelResolver.getChannel();

			expect(channel).toBeInstanceOf(SMTPChannel);
		});
	});

	describe('encryptSecrets', () => {
		it('should not encrypt already encrypted values', () => {
			mockCryptr.decrypt.mockReturnValue('decrypted_value');

			const integration = {
				smtp: {
					server: 'smtp.test.com',
					port: 587,
					username: 'user',
					password: 'already_encrypted',
					senderEmail: 'test@test.com',
					connected: true,
				},
			};

			const encrypted = NotificationChannelResolver.encryptSecrets(integration);

			expect(mockCryptr.encrypt).not.toHaveBeenCalled();
			expect(encrypted.smtp?.password).toBe('already_encrypted');
		});

		it('should handle missing password field', () => {
			const integration = {
				smtp: {
					server: 'smtp.test.com',
					port: 587,
					username: 'user',
					senderEmail: 'test@test.com',
					connected: true,
				},
			};

			const encrypted = NotificationChannelResolver.encryptSecrets(integration as any);

			expect(mockCryptr.encrypt).not.toHaveBeenCalled();
		});

		it('should not modify original object', () => {
			const integration = {
				smtp: {
					server: 'smtp.test.com',
					port: 587,
					username: 'user',
					password: 'plaintext_password',
					senderEmail: 'test@test.com',
					connected: true,
				},
			};

			const original = JSON.stringify(integration);
			NotificationChannelResolver.encryptSecrets(integration);

			expect(JSON.stringify(integration)).toBe(original);
		});

		it('should handle empty integration object', () => {
			const integration = {};

			const encrypted = NotificationChannelResolver.encryptSecrets(integration);

			expect(encrypted).toEqual({});
		});
	});

	describe('decryptSecrets', () => {
		it('should decrypt smtp password', () => {
			const integration = {
				smtp: {
					server: 'smtp.test.com',
					port: 587,
					username: 'user',
					password: 'encrypted_password',
					senderEmail: 'test@test.com',
					connected: true,
				},
			};

			mockCryptr.decrypt.mockReturnValue('decrypted_password');

			const decrypted = NotificationChannelResolver.decryptSecrets(integration);

			expect(mockCryptr.decrypt).toHaveBeenCalledWith('encrypted_password');
			expect(decrypted.smtp?.password).toBe('decrypted_password');
		});

		it('should handle decryption errors gracefully', () => {
			const integration = {
				smtp: {
					server: 'smtp.test.com',
					port: 587,
					username: 'user',
					password: 'invalid_encrypted_value',
					senderEmail: 'test@test.com',
					connected: true,
				},
			};

			mockCryptr.decrypt.mockImplementation(() => {
				throw new Error('Decryption failed');
			});

			const decrypted = NotificationChannelResolver.decryptSecrets(integration);

			expect(decrypted.smtp?.password).toBe('invalid_encrypted_value');
		});

		it('should handle missing password field', () => {
			const integration = {
				smtp: {
					server: 'smtp.test.com',
					port: 587,
					username: 'user',
					senderEmail: 'test@test.com',
					connected: true,
				},
			};

			const decrypted = NotificationChannelResolver.decryptSecrets(integration as any);

			expect(mockCryptr.decrypt).not.toHaveBeenCalled();
		});

		it('should not modify original object', () => {
			const integration = {
				smtp: {
					server: 'smtp.test.com',
					port: 587,
					username: 'user',
					password: 'encrypted_password',
					senderEmail: 'test@test.com',
					connected: true,
				},
			};

			mockCryptr.decrypt.mockReturnValue('decrypted_password');

			const original = JSON.stringify(integration);
			NotificationChannelResolver.decryptSecrets(integration);

			expect(JSON.stringify(integration)).toBe(original);
		});

		it('should handle empty integration object', () => {
			const integration = {};

			const decrypted = NotificationChannelResolver.decryptSecrets(integration);

			expect(decrypted).toEqual({});
		});
	});

	describe('secret fields configuration', () => {
		it('should have smtp.password in secretFields', () => {
			expect(NotificationChannelResolver.secretFields).toContain('smtp.password');
		});
	});

	describe('integration with Cryptr', () => {
		it('should use configService SECRET for encryption', () => {
			const integration = {
				smtp: {
					server: 'smtp.test.com',
					port: 587,
					username: 'user',
					password: 'password',
					senderEmail: 'test@test.com',
					connected: true,
				},
			};

			NotificationChannelResolver.encryptSecrets(integration);

			expect(Cryptr).toHaveBeenCalledWith('test-secret-key-123');
		});

		it('should use same Cryptr instance for decryption', () => {
			const integration = {
				smtp: {
					server: 'smtp.test.com',
					port: 587,
					username: 'user',
					password: 'encrypted_password',
					senderEmail: 'test@test.com',
					connected: true,
				},
			};

			NotificationChannelResolver.decryptSecrets(integration);

			expect(Cryptr).toHaveBeenCalledWith('test-secret-key-123');
		});
	});
});
