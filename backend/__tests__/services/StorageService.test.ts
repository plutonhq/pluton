import Cryptr from 'cryptr';
import { StorageService } from '../../src/services/StorageService';
import { StorageStore } from '../../src/stores/StorageStore';
import { PlanStore } from '../../src/stores/PlanStore';
import { BaseStorageManager } from '../../src/managers/BaseStorageManager';
import { BaseSystemManager } from '../../src/managers/BaseSystemManager';
import { LocalStrategy, RemoteStrategy } from '../../src/strategies/system';
import { AppError } from '../../src/utils/AppError';
import { NewStorage, Storage } from '../../src/db/schema/storages';
import { generateUID } from '../../src/utils/helpers';
import { runCommand } from '../../src/utils/runCommand';

jest.mock('../../src/utils/runCommand');

// Mock dependencies
jest.mock('../../src/stores/StorageStore');
jest.mock('../../src/stores/PlanStore');
jest.mock('../../src/managers/BaseStorageManager');
jest.mock('../../src/managers/BaseSystemManager');
jest.mock('../../src/strategies/system');
jest.mock('../../src/utils/rclone/rclone');
jest.mock('../../src/utils/helpers');
jest.mock('cryptr');

// Mock config service
jest.mock('../../src/services/ConfigService', () => ({
	configService: {
		config: {
			SECRET: 'a-very-secret-key-for-testing-purpose',
		},
	},
}));

const mockRunCommand = runCommand as jest.Mock;

describe('StorageService', () => {
	let storageService: StorageService;
	let mockStorageStore: jest.Mocked<StorageStore>;
	let mockPlanStore: jest.Mocked<PlanStore>;
	let mockStorageManager: jest.Mocked<BaseStorageManager>;
	let mockSystemManager: jest.Mocked<BaseSystemManager>;
	let mockLocalStrategy: jest.Mocked<LocalStrategy>;
	let mockRemoteStrategy: jest.Mocked<RemoteStrategy>;
	let mockCryptr: jest.Mocked<Cryptr>;

	beforeEach(() => {
		// Clear all mocks before each test
		jest.clearAllMocks();

		// Instantiate mocks
		mockStorageStore = new StorageStore(null as any) as jest.Mocked<StorageStore>;
		mockPlanStore = new PlanStore(null as any) as jest.Mocked<PlanStore>;
		mockStorageManager = new BaseStorageManager() as jest.Mocked<BaseStorageManager>;
		mockSystemManager = new BaseSystemManager() as jest.Mocked<BaseSystemManager>;

		// Mock strategy constructors and instances
		mockLocalStrategy = new LocalStrategy(mockSystemManager) as jest.Mocked<LocalStrategy>;
		mockRemoteStrategy = new RemoteStrategy('remote-device') as jest.Mocked<RemoteStrategy>;
		(LocalStrategy as jest.Mock).mockReturnValue(mockLocalStrategy);
		(RemoteStrategy as jest.Mock).mockReturnValue(mockRemoteStrategy);

		// Mock utilities
		(generateUID as jest.Mock).mockReturnValue('mock-uid-123');

		// Mock Cryptr
		mockCryptr = {
			encrypt: jest.fn(val => `encrypted(${val})`),
			decrypt: jest.fn(val => val.replace('encrypted(', '').replace(')', '')),
		} as any;
		(Cryptr as unknown as jest.Mock).mockImplementation(() => mockCryptr);

		// Instantiate the service with mocked dependencies
		storageService = new StorageService(
			mockStorageManager,
			mockSystemManager,
			mockStorageStore,
			mockPlanStore
		);
	});

	// ----------------------------------------
	// getSystemStrategy
	// ----------------------------------------
	describe('getSystemStrategy', () => {
		it('should return a LocalStrategy for deviceId "main"', () => {
			const strategy = storageService.getSystemStrategy('main');
			expect(strategy).toBeInstanceOf(LocalStrategy);
		});

		it('should return a RemoteStrategy for any other deviceId', () => {
			const strategy = storageService.getSystemStrategy('remote-device-1');
			expect(strategy).toBeInstanceOf(RemoteStrategy);
		});
	});

	// ----------------------------------------
	// getStorages
	// ----------------------------------------
	describe('getStorages', () => {
		it('should call storageStore.getAll and return a list of storages', async () => {
			const mockStorages = [{ id: 'storage-1', name: 'Test Storage' }] as Storage[];
			mockStorageStore.getAll.mockResolvedValue(mockStorages);

			const result = await storageService.getStorages();

			expect(mockStorageStore.getAll).toHaveBeenCalledWith(true, true);
			expect(result).toEqual(mockStorages);
		});

		it('should return null if the store returns null', async () => {
			mockStorageStore.getAll.mockResolvedValue(null);
			const result = await storageService.getStorages();
			expect(result).toBeNull();
		});
	});

	// ----------------------------------------
	// getStorage
	// ----------------------------------------
	describe('getStorage', () => {
		const storageId = 'storage-123';
		const mockStorage: Storage = {
			id: storageId,
			name: 'My S3',
			type: 's3',
			credentials: { accessKey: 'encrypted(abc)' },
		} as any;

		it('should retrieve a storage and decrypt its credentials', async () => {
			mockStorageStore.getById.mockResolvedValue(mockStorage);

			const result = await storageService.getStorage(storageId);

			expect(mockStorageStore.getById).toHaveBeenCalledWith(storageId);
			expect(mockCryptr.decrypt).toHaveBeenCalledWith('encrypted(abc)');
			expect(result.credentials).toEqual({ accessKey: 'abc' });
			expect(result.name).toBe('My S3');
		});

		it('should throw NotFoundError if storage does not exist', async () => {
			mockStorageStore.getById.mockResolvedValue(null);

			await expect(storageService.getStorage(storageId)).rejects.toThrow('Storage not found');
			await expect(storageService.getStorage(storageId)).rejects.toHaveProperty('statusCode', 404);
		});

		it('should throw an AppError if credential decryption fails', async () => {
			mockStorageStore.getById.mockResolvedValue(mockStorage);
			mockCryptr.decrypt.mockImplementation(() => {
				throw new Error('Decryption failed');
			});

			await expect(storageService.getStorage(storageId)).rejects.toThrow(AppError);
			await expect(storageService.getStorage(storageId)).rejects.toThrow(
				'Could not decrypt your Storage Credentials Settings'
			);
		});
	});

	// ----------------------------------------
	// createStorage
	// ----------------------------------------
	describe('createStorage', () => {
		const storagePayload: Partial<NewStorage> = {
			name: 'New B2 Storage',
			type: 'b2',
			authType: 'client',
			credentials: { account: 'test-account', key: 'test-key' },
			settings: { hard_delete: 'false' },
		};

		it('should successfully create a remote, encrypt credentials, and save to DB', async () => {
			mockStorageManager.createRemote.mockResolvedValue({ success: true, result: 'OK' });
			mockStorageStore.create.mockImplementation(data => Promise.resolve(data as Storage));

			const result = await storageService.createStorage(storagePayload);

			expect(mockStorageManager.createRemote).toHaveBeenCalledWith(
				'b2',
				'New B2 Storage',
				'client',
				{ account: 'test-account', key: 'test-key' },
				{ hard_delete: 'false' }
			);
			expect(mockCryptr.encrypt).toHaveBeenCalledWith('test-account');
			expect(mockCryptr.encrypt).toHaveBeenCalledWith('test-key');
			expect(mockStorageStore.create).toHaveBeenCalledWith(
				expect.objectContaining({
					id: 'mock-uid-123',
					name: 'New B2 Storage',
					credentials: {
						account: 'encrypted(test-account)',
						key: 'encrypted(test-key)',
					},
				})
			);
			expect(result?.id).toBe('mock-uid-123');
		});
		describe('createStorage', () => {
			const storagePayload: Partial<NewStorage> = {
				name: 'New B2 Storage',
				type: 'b2',
				authType: 'client',
				credentials: { account: 'test-account', key: 'test-key' },
				settings: { hard_delete: 'false' },
			};

			it('should successfully create a remote, encrypt credentials, and save to DB', async () => {
				mockStorageManager.createRemote.mockResolvedValue({ success: true, result: 'OK' });
				mockStorageStore.create.mockImplementation(data => Promise.resolve(data as Storage));

				const result = await storageService.createStorage(storagePayload);

				expect(mockStorageManager.createRemote).toHaveBeenCalledWith(
					'b2',
					'New B2 Storage',
					'client',
					{ account: 'test-account', key: 'test-key' },
					{ hard_delete: 'false' }
				);
				expect(mockCryptr.encrypt).toHaveBeenCalledWith('test-account');
				expect(mockCryptr.encrypt).toHaveBeenCalledWith('test-key');
				expect(mockStorageStore.create).toHaveBeenCalledWith(
					expect.objectContaining({
						id: 'mock-uid-123',
						name: 'New B2 Storage',
						credentials: {
							account: 'encrypted(test-account)',
							key: 'encrypted(test-key)',
						},
					})
				);
				expect(result?.id).toBe('mock-uid-123');
			});

			it('should throw an AppError if remote creation fails', async () => {
				mockStorageManager.createRemote.mockResolvedValue({
					success: false,
					result: 'Remote connection failed',
				});

				await expect(storageService.createStorage(storagePayload)).rejects.toThrow(AppError);
				await expect(storageService.createStorage(storagePayload)).rejects.toThrow(
					'Remote connection failed'
				);
				expect(mockStorageStore.create).not.toHaveBeenCalled();
			});

			it('should throw an AppError if payload validation fails', async () => {
				const invalidPayload = { ...storagePayload, name: undefined }; // 'name' is required

				// Temporarily mock console.error to prevent logging expected errors during this test
				const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

				await expect(storageService.createStorage(invalidPayload)).rejects.toThrow(
					'Invalid storage configuration provided. Check required fields.'
				);
				expect(mockStorageManager.createRemote).not.toHaveBeenCalled();

				// Restore the original console.error function
				consoleErrorSpy.mockRestore();
			});
		});

		// ----------------------------------------
		// deleteStorage
		// ----------------------------------------
		describe('deleteStorage', () => {
			const storageId = 'storage-to-delete';
			const mockStorage = { id: storageId, name: 'Old Storage' } as Storage;

			it('should delete remote and DB entry if no plans are dependent', async () => {
				mockStorageStore.getById.mockResolvedValue(mockStorage);
				mockPlanStore.getStoragePlans.mockResolvedValue([]); // No dependent plans
				mockStorageManager.deleteRemote.mockResolvedValue({ success: true, result: 'Deleted' });
				mockStorageStore.delete.mockResolvedValue(true);

				const result = await storageService.deleteStorage(storageId);

				expect(mockPlanStore.getStoragePlans).toHaveBeenCalledWith(storageId);
				expect(mockStorageManager.deleteRemote).toHaveBeenCalledWith('Old Storage');
				expect(mockStorageStore.delete).toHaveBeenCalledWith(storageId);
				expect(result).toBe(true);
			});

			it('should throw NotFoundError if storage does not exist', async () => {
				mockStorageStore.getById.mockResolvedValue(null);
				await expect(storageService.deleteStorage(storageId)).rejects.toThrow('Storage not found');
				await expect(storageService.deleteStorage(storageId)).rejects.toHaveProperty(
					'statusCode',
					404
				);
			});

			it('should throw AppError if plans are dependent on the storage', async () => {
				mockStorageStore.getById.mockResolvedValue(mockStorage);
				mockPlanStore.getStoragePlans.mockResolvedValue([{} as any]); // One dependent plan

				await expect(storageService.deleteStorage(storageId)).rejects.toThrow(AppError);
				await expect(storageService.deleteStorage(storageId)).rejects.toThrow(
					'There are Backup Plans dependent on this Storage. Please remove them before deleting the Storage.'
				);
				expect(mockStorageManager.deleteRemote).not.toHaveBeenCalled();
			});

			it('should throw AppError if remote deletion fails', async () => {
				mockStorageStore.getById.mockResolvedValue(mockStorage);
				mockPlanStore.getStoragePlans.mockResolvedValue([]);
				mockStorageManager.deleteRemote.mockResolvedValue({
					success: false,
					result: 'Permission denied',
				});

				await expect(storageService.deleteStorage(storageId)).rejects.toThrow('Permission denied');
				expect(mockStorageStore.delete).not.toHaveBeenCalled();
			});
		});

		// ----------------------------------------
		// verifyStorage
		// ----------------------------------------
		describe('verifyStorage', () => {
			const storageId = 'storage-to-verify';
			const mockStorage = { id: storageId, name: 'VerifyMe' } as Storage;

			it('should successfully verify a storage connection', async () => {
				mockStorageStore.getById.mockResolvedValue(mockStorage);
				mockStorageManager.verifyRemote.mockResolvedValue({
					success: true,
					result: 'Connection OK',
				});

				const result = await storageService.verifyStorage(storageId);

				expect(mockStorageManager.verifyRemote).toHaveBeenCalledWith('VerifyMe');
				expect(result).toBe('Connection OK');
			});

			it('should throw NotFoundError if storage does not exist', async () => {
				mockStorageStore.getById.mockResolvedValue(null);
				await expect(storageService.deleteStorage(storageId)).rejects.toThrow('Storage not found');
				await expect(storageService.deleteStorage(storageId)).rejects.toHaveProperty(
					'statusCode',
					404
				);
			});

			it('should throw AppError if verification fails', async () => {
				mockStorageStore.getById.mockResolvedValue(mockStorage);
				mockStorageManager.verifyRemote.mockResolvedValue({
					success: false,
					result: 'Invalid credentials',
				});

				await expect(storageService.verifyStorage(storageId)).rejects.toThrow(AppError);
				await expect(storageService.verifyStorage(storageId)).rejects.toThrow(
					'Invalid credentials'
				);
			});
		});

		// ----------------------------------------
		// authorizeStorage
		// ----------------------------------------
		describe('authorizeStorage', () => {
			it('should call rclone authorize and return the token', async () => {
				const mockToken = { access_token: 'xyz', expiry: '2025-10-26T10:00:00Z' };
				const rcloneOutput = `--->\n\n${JSON.stringify(mockToken)}\n\n<---`;
				mockRunCommand.mockResolvedValue(rcloneOutput); // Use the direct mock reference

				const result = await storageService.authorizeStorage('drive');

				expect(mockRunCommand).toHaveBeenCalledWith(
					['rclone', 'authorize', 'drive', '--auth-no-open-browser'],
					undefined,
					expect.any(Function)
				);
				expect(result).toEqual(mockToken);
			});

			it('should throw an AppError if rclone command fails', async () => {
				mockRunCommand.mockRejectedValue(new Error('Command failed')); // Use the direct mock reference

				await expect(storageService.authorizeStorage('drive')).rejects.toThrow(AppError);
				await expect(storageService.authorizeStorage('drive')).rejects.toThrow(
					'Failed to authorize drive: Command failed'
				);
			});

			it('should throw an AppError if token cannot be extracted', async () => {
				mockRunCommand.mockResolvedValue('Some unexpected output'); // Use the direct mock reference

				await expect(storageService.authorizeStorage('drive')).rejects.toThrow(
					'Could not extract drive token from output'
				);
			});
		});
	});
});
