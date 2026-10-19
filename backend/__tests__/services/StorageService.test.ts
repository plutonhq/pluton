import Cryptr from 'cryptr';
import { StorageService } from '../../src/services/StorageService';
import { StorageStore } from '../../src/stores/StorageStore';
import { PlanStore } from '../../src/stores/PlanStore';
import { SettingsStore } from '../../src/stores/SettingsStore';
import { BaseStorageManager } from '../../src/managers/BaseStorageManager';
import { BaseSystemManager } from '../../src/managers/BaseSystemManager';
import { LocalStrategy, RemoteStrategy } from '../../src/strategies/system';
import { AppError } from '../../src/utils/AppError';
import { NewStorage, Storage } from '../../src/db/schema/storages';
import { generateUID } from '../../src/utils/helpers';
import { spawnRcloneAuthorize } from '../../src/utils/rclone/helpers';

jest.mock('../../src/utils/rclone/helpers');

// Mock dependencies
jest.mock('../../src/stores/StorageStore');
jest.mock('../../src/stores/PlanStore');
jest.mock('../../src/stores/SettingsStore');
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

const mockSpawnRcloneAuthorize = spawnRcloneAuthorize as jest.Mock;

describe('StorageService', () => {
	let storageService: StorageService;
	let mockStorageStore: jest.Mocked<StorageStore>;
	let mockPlanStore: jest.Mocked<PlanStore>;
	let mockSettingsStore: jest.Mocked<SettingsStore>;
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
		mockSettingsStore = new SettingsStore(null as any) as jest.Mocked<SettingsStore>;
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
			mockPlanStore,
			mockSettingsStore
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
	// updateStorage
	// ----------------------------------------
	describe('updateStorage', () => {
		const storageId = 'storage-to-update';
		const existingStorage = {
			id: storageId,
			name: 'My SFTP',
			type: 'sftp',
			settings: { idle_timeout: '1m0s' },
			credentials: { host: 'encrypted(example.com)', port: 'encrypted(22)' },
		} as unknown as Storage;

		const payload: Partial<Storage> = {
			type: 'sftp',
			authType: 'password',
			settings: { idle_timeout: '1m0s' },
			credentials: { host: 'example.com', port: '2222' },
			tags: [],
		};

		beforeEach(() => {
			mockStorageStore.getById.mockResolvedValue(existingStorage);
			mockStorageStore.update.mockImplementation((id, data) =>
				Promise.resolve({ id, ...data } as Storage)
			);
			mockPlanStore.getStoragePlans.mockResolvedValue([]);
			mockStorageStore.getReplicationPlanSources = jest.fn().mockResolvedValue([]);
			mockLocalStrategy.updateRemoteStorage = jest
				.fn()
				.mockResolvedValue({ success: true, result: 'OK' });
			mockRemoteStrategy.updateRemoteStorage = jest
				.fn()
				.mockResolvedValue({ success: true, result: 'OK' });
		});

		it('pushes the config to main even when no plan uses the storage', async () => {
			await storageService.updateStorage(storageId, payload);

			expect(LocalStrategy).toHaveBeenCalled();
			expect(mockLocalStrategy.updateRemoteStorage).toHaveBeenCalledWith(
				'My SFTP',
				expect.objectContaining({
					new: expect.objectContaining({ port: '2222' }),
				})
			);
		});

		it('pushes the config to the device that owns a plan', async () => {
			mockPlanStore.getStoragePlans.mockResolvedValue([{ sourceId: 'device-2' } as any]);

			await storageService.updateStorage(storageId, payload);

			expect(RemoteStrategy).toHaveBeenCalledWith('device-2');
			expect(mockRemoteStrategy.updateRemoteStorage).toHaveBeenCalledTimes(1);
			expect(mockLocalStrategy.updateRemoteStorage).toHaveBeenCalledTimes(1);
		});

		it('pushes the config to the device that replicates to the storage', async () => {
			mockStorageStore.getReplicationPlanSources = jest.fn().mockResolvedValue(['device-3']);

			await storageService.updateStorage(storageId, payload);

			expect(mockStorageStore.getReplicationPlanSources).toHaveBeenCalledWith(storageId);
			expect(RemoteStrategy).toHaveBeenCalledWith('device-3');
			expect(mockRemoteStrategy.updateRemoteStorage).toHaveBeenCalledTimes(1);
		});

		it('lists a device once when it owns a plan and replicates to the storage', async () => {
			mockPlanStore.getStoragePlans.mockResolvedValue([{ sourceId: 'device-2' } as any]);
			mockStorageStore.getReplicationPlanSources = jest.fn().mockResolvedValue(['device-2']);

			await storageService.updateStorage(storageId, payload);

			expect(mockRemoteStrategy.updateRemoteStorage).toHaveBeenCalledTimes(1);
		});

		it('sends the old values so a failed update can be reverted', async () => {
			await storageService.updateStorage(storageId, payload);

			expect(mockLocalStrategy.updateRemoteStorage).toHaveBeenCalledWith(
				'My SFTP',
				expect.objectContaining({
					old: expect.objectContaining({ host: 'example.com', port: '22' }),
				})
			);
		});

		it('does not resend the credentials when they did not change', async () => {
			const samePayload = {
				...payload,
				credentials: { host: 'example.com', port: '22' },
			};

			await storageService.updateStorage(storageId, samePayload);

			const sent = (mockLocalStrategy.updateRemoteStorage as jest.Mock).mock.calls[0][1];
			expect(sent.new).toEqual({ idle_timeout: '1m0s' });
		});

		it('writes the encrypted credentials to the database', async () => {
			await storageService.updateStorage(storageId, payload);

			expect(mockStorageStore.update).toHaveBeenCalledWith(
				storageId,
				expect.objectContaining({
					credentials: { host: 'encrypted(example.com)', port: 'encrypted(2222)' },
				})
			);
		});

		it('throws NotFoundError if the storage does not exist', async () => {
			mockStorageStore.getById.mockResolvedValue(null);

			await expect(storageService.updateStorage(storageId, payload)).rejects.toThrow(
				'Storage not found'
			);
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
			mockStorageStore.getReplicationPlans = jest.fn().mockResolvedValue([]);
			mockPlanStore.getDevicePlans.mockResolvedValue([]);
			mockStorageManager.deleteRemote.mockResolvedValue({ success: true, result: 'Deleted' });
			mockStorageStore.delete.mockResolvedValue(true);

			const result = await storageService.deleteStorage(storageId);

			expect(mockPlanStore.getStoragePlans).toHaveBeenCalledWith(storageId);
			expect(mockStorageManager.deleteRemote).toHaveBeenCalledWith('Old Storage');
			expect(mockStorageStore.delete).toHaveBeenCalledWith(storageId);
			expect(result).toBe(true);
		});

		it('should still succeed when getDevicePlans returns null', async () => {
			mockStorageStore.getById.mockResolvedValue(mockStorage);
			mockPlanStore.getStoragePlans.mockResolvedValue([]);
			mockStorageStore.getReplicationPlans = jest.fn().mockResolvedValue([]);
			mockPlanStore.getDevicePlans.mockResolvedValue(null);
			mockStorageManager.deleteRemote.mockResolvedValue({ success: true, result: 'Deleted' });
			mockStorageStore.delete.mockResolvedValue(true);

			const result = await storageService.deleteStorage(storageId);

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
			mockPlanStore.getStoragePlans.mockResolvedValue([{ title: 'Plan A' } as any]); // One dependent plan
			mockStorageStore.getReplicationPlans = jest.fn().mockResolvedValue([]);

			await expect(storageService.deleteStorage(storageId)).rejects.toThrow(AppError);
			await expect(storageService.deleteStorage(storageId)).rejects.toThrow(
				'There are Backup Plans dependent on this Storage: Plan A. Please remove them before deleting the Storage.'
			);
		});

		it('should throw AppError if replication plans are dependent on the storage', async () => {
			mockStorageStore.getById.mockResolvedValue(mockStorage);
			mockPlanStore.getStoragePlans.mockResolvedValue([]);
			mockStorageStore.getReplicationPlans = jest.fn().mockResolvedValue([{ title: 'Plan B' }]);

			await expect(storageService.deleteStorage(storageId)).rejects.toThrow(AppError);
			await expect(storageService.deleteStorage(storageId)).rejects.toThrow(
				'This Storage is used as a replication target by the following plans: Plan B. Please remove it from their replication settings before deleting the storage.'
			);
		});

		it('should throw AppError if the storage is used as a plan source', async () => {
			mockStorageStore.getById.mockResolvedValue(mockStorage);
			mockPlanStore.getStoragePlans.mockResolvedValue([]);
			mockStorageStore.getReplicationPlans = jest.fn().mockResolvedValue([]);
			mockPlanStore.getDevicePlans.mockResolvedValue([{ title: 'Sync Plan C' } as any]);

			await expect(storageService.deleteStorage(storageId)).rejects.toThrow(AppError);
			await expect(storageService.deleteStorage(storageId)).rejects.toThrow(
				'This Storage is used as a backup source by the following plans: Sync Plan C. Please remove them before deleting the Storage.'
			);
			expect(mockStorageManager.deleteRemote).not.toHaveBeenCalled();
		});

		it('should throw AppError if an active self-backup uses the storage', async () => {
			mockStorageStore.getById.mockResolvedValue(mockStorage);
			mockPlanStore.getStoragePlans.mockResolvedValue([]);
			mockStorageStore.getReplicationPlans = jest.fn().mockResolvedValue([]);
			mockSettingsStore.getFirst.mockResolvedValue({
				settings: { selfBackup: { enabled: true, storageId } },
			} as any);

			await expect(storageService.deleteStorage(storageId)).rejects.toThrow(AppError);
			await expect(storageService.deleteStorage(storageId)).rejects.toThrow(
				"This Storage is used by Pluton's self-backup. Please disable self-backup or choose a different storage before deleting it."
			);
			expect(mockStorageManager.deleteRemote).not.toHaveBeenCalled();
		});

		it('should allow deletion when self-backup is disabled or uses a different storage', async () => {
			mockStorageStore.getById.mockResolvedValue(mockStorage);
			mockPlanStore.getStoragePlans.mockResolvedValue([]);
			mockStorageStore.getReplicationPlans = jest.fn().mockResolvedValue([]);
			mockSettingsStore.getFirst.mockResolvedValue({
				settings: { selfBackup: { enabled: true, storageId: 'a-different-storage' } },
			} as any);
			mockStorageManager.deleteRemote.mockResolvedValue({ success: true, result: 'Deleted' });
			mockStorageStore.delete.mockResolvedValue(true);

			const result = await storageService.deleteStorage(storageId);

			expect(result).toBe(true);
			expect(mockStorageManager.deleteRemote).toHaveBeenCalledWith('Old Storage');
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

			expect(mockStorageManager.verifyRemote).toHaveBeenCalledWith('VerifyMe', undefined);
			expect(result).toBe('Connection OK');
		});

		it('should throw NotFoundError if storage does not exist', async () => {
			mockStorageStore.getById.mockResolvedValue(null);
			await expect(storageService.verifyStorage(storageId)).rejects.toThrow('Storage not found');
			await expect(storageService.verifyStorage(storageId)).rejects.toHaveProperty(
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
			await expect(storageService.verifyStorage(storageId)).rejects.toThrow('Invalid credentials');
		});
	});

	// ----------------------------------------
	// startAuthorize
	// ----------------------------------------
	describe('startAuthorize', () => {
		it('should return a session ID for a valid OAuth storage type', () => {
			const sessionId = storageService.startAuthorize('drive');

			expect(sessionId).toBe('mock-uid-123');
			expect(mockSpawnRcloneAuthorize).toHaveBeenCalledWith(
				expect.objectContaining({
					id: 'mock-uid-123',
					storageType: 'drive',
					status: 'pending',
				}),
				expect.any(Number)
			);
		});

		it('should throw 400 for unknown storage type', () => {
			expect(() => storageService.startAuthorize('nonexistent')).toThrow(AppError);
			expect(() => storageService.startAuthorize('nonexistent')).toThrow(
				'Unknown storage type: nonexistent'
			);
		});

		it('should throw 400 for storage type that does not support OAuth', () => {
			// 'local' does not have oauth in authTypes
			expect(() => storageService.startAuthorize('local')).toThrow(AppError);
			expect(() => storageService.startAuthorize('local')).toThrow('does not support OAuth');
		});

		it('should throw 409 if a session is already pending', () => {
			storageService.startAuthorize('drive');
			(generateUID as jest.Mock).mockReturnValue('mock-uid-456');

			expect(() => storageService.startAuthorize('drive')).toThrow(AppError);
			expect(() => storageService.startAuthorize('drive')).toThrow('already in progress');
		});
	});

	// ----------------------------------------
	// getAuthorizeStatus
	// ----------------------------------------
	describe('getAuthorizeStatus', () => {
		it('should return pending status for an active session', () => {
			const sessionId = storageService.startAuthorize('drive');
			const status = storageService.getAuthorizeStatus(sessionId);

			expect(status).toEqual({ status: 'pending' });
		});

		it('should throw 404 for unknown session ID', () => {
			expect(() => storageService.getAuthorizeStatus('nonexistent')).toThrow(AppError);
			expect(() => storageService.getAuthorizeStatus('nonexistent')).toThrow('session not found');
		});

		it('should clean up completed sessions after reading', () => {
			// Manipulate session via spawnRcloneAuthorize mock
			mockSpawnRcloneAuthorize.mockImplementation(session => {
				session.status = 'success';
				session.token = '{"access_token":"xyz"}';
			});

			const sessionId = storageService.startAuthorize('drive');
			const status = storageService.getAuthorizeStatus(sessionId);

			expect(status.status).toBe('success');
			expect(status.token).toBe('{"access_token":"xyz"}');

			// Second read should throw 404
			expect(() => storageService.getAuthorizeStatus(sessionId)).toThrow('session not found');
		});

		it('should include authUrl when available', () => {
			mockSpawnRcloneAuthorize.mockImplementation(session => {
				session.authUrl = 'http://127.0.0.1:53682/auth';
			});

			const sessionId = storageService.startAuthorize('drive');
			const status = storageService.getAuthorizeStatus(sessionId);

			expect(status.authUrl).toBe('http://127.0.0.1:53682/auth');
		});

		it('should include error when available', () => {
			mockSpawnRcloneAuthorize.mockImplementation(session => {
				session.status = 'error';
				session.error = 'Authorization timed out';
			});

			const sessionId = storageService.startAuthorize('drive');
			const status = storageService.getAuthorizeStatus(sessionId);

			expect(status.status).toBe('error');
			expect(status.error).toBe('Authorization timed out');
		});
	});

	// ----------------------------------------
	// cancelAuthorize
	// ----------------------------------------
	describe('HCP protected credentials', () => {
		const credentials = {
			endpoint: 'https://tenant.example.internal',
			bucket: 'fixture-bucket',
			access_key_id: 'synthetic-access',
			secret_access_key: 'synthetic-secret',
		};
		it('encrypts session/SSE-C settings and never returns stored secrets to the browser', async () => {
			mockStorageStore.getAll.mockResolvedValue([]);
			mockStorageManager.createRemote.mockResolvedValue({ success: true, result: 'verified' });
			mockStorageStore.create.mockImplementation(async data => data as Storage);
			const result = await storageService.createStorage({
				type: 's3compatible',
				name: 'mirror_01',
				authType: 'client',
				credentials,
				settings: {
					hcp_mode: true,
					session_token: 'synthetic-token',
					sse_customer_key: 'synthetic-sse',
				},
			});
			const saved = mockStorageStore.create.mock.calls[0][0];
			expect(saved.settings).toEqual({ hcp_mode: true });
			expect(saved.credentials).toMatchObject({
				session_token: 'encrypted(synthetic-token)',
				sse_customer_key: 'encrypted(synthetic-sse)',
			});
			expect(result?.credentials).toEqual({
				endpoint: credentials.endpoint,
				bucket: credentials.bucket,
			});
			expect((result as any).credentialsConfigured).toContain('secret_access_key');
			expect(JSON.stringify(result)).not.toContain('synthetic-secret');
		});
		it.each(['s3compatible', 's3'])('retains configured %s secret values and provider identity on blank protected edits', async type => {
			const existing = {
				id: 'mirror-01',
				type,
				name: 'mirror_01',
				credentials: Object.fromEntries(
					Object.entries(credentials).map(([key, value]) => [key, `encrypted(${value})`])
				),
				settings: { hcp_mode: true },
			} as any;
			mockStorageStore.getById.mockResolvedValue(existing);
			mockPlanStore.getStoragePlans.mockResolvedValue([]);
			mockStorageStore.getReplicationPlanSources.mockResolvedValue([]);
			mockLocalStrategy.updateRemoteStorage.mockResolvedValue({
				success: true,
				result: 'verified',
			});
			mockStorageStore.update.mockImplementation(async (_id, data) => ({ ...existing, ...data }));
			const result = await storageService.updateStorage('mirror-01', {
				credentials: {
					endpoint: credentials.endpoint,
					bucket: credentials.bucket,
					access_key_id: '',
					secret_access_key: '',
				},
				settings: { hcp_mode: true },
			});
			expect(mockStorageStore.update.mock.calls[0][1].credentials).toMatchObject({
				access_key_id: 'encrypted(synthetic-access)',
				secret_access_key: 'encrypted(synthetic-secret)',
			});
			expect(mockLocalStrategy.updateRemoteStorage).toHaveBeenCalledWith('mirror_01', expect.objectContaining({
				new: expect.objectContaining({ _pluton_storage_type: type }),
				old: expect.objectContaining({ _pluton_storage_type: type }),
			}));
			expect(result.storage?.credentials).toEqual({
				endpoint: credentials.endpoint,
				bucket: credentials.bucket,
			});
			await expect(
				storageService.updateStorage('mirror-01', {
					credentials: {},
					settings: { hcp_mode: false },
				})
			).rejects.toHaveProperty('statusCode', 409);
		});
		it('rejects duplicate HCP remote aliases before touching the shared remote configuration', async () => {
			mockStorageStore.getAll.mockResolvedValue([{ name: 'MIRROR_01' } as Storage]);
			await expect(
				storageService.createStorage({
					type: 's3compatible',
					name: 'mirror_01',
					authType: 'client',
					credentials,
					settings: { hcp_mode: true },
				})
			).rejects.toHaveProperty('statusCode', 409);
			expect(mockStorageManager.createRemote).not.toHaveBeenCalled();
		});
	});

	describe('cancelAuthorize', () => {
		it('should kill the process and remove the session', () => {
			const mockKill = jest.fn();
			mockSpawnRcloneAuthorize.mockImplementation(session => {
				session.process = { killed: false, kill: mockKill } as any;
			});

			const sessionId = storageService.startAuthorize('drive');
			storageService.cancelAuthorize(sessionId);

			expect(mockKill).toHaveBeenCalled();
			// Session should be gone
			expect(() => storageService.getAuthorizeStatus(sessionId)).toThrow('session not found');
		});

		it('should throw 404 for unknown session ID', () => {
			expect(() => storageService.cancelAuthorize('nonexistent')).toThrow(AppError);
			expect(() => storageService.cancelAuthorize('nonexistent')).toThrow('session not found');
		});

		it('should handle session without a process reference', () => {
			// Don't set process in mock
			const sessionId = storageService.startAuthorize('drive');
			expect(() => storageService.cancelAuthorize(sessionId)).not.toThrow();
		});
	});
});
