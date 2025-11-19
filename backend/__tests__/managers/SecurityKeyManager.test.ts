import path from 'path';
import { promises as fs } from 'fs';
import crypto from 'crypto';
import Cryptr from 'cryptr';

const mockDataDir = path.join('/tmp', 'pluton-test-data');
const mockConfigDir = path.join('/tmp', 'pluton-test-config');

// Mock AppPaths BEFORE any imports that depend on it
jest.mock('../../src/utils/AppPaths', () => ({
	appPaths: {
		getDataDir: jest.fn(() => mockDataDir),
		getConfigDir: jest.fn(() => mockConfigDir),
		getBaseDir: jest.fn(),
		getDbDir: jest.fn(),
		getSchedulesPath: jest.fn(),
		getLogsDir: jest.fn(),
		getProgressDir: jest.fn(),
		getStatsDir: jest.fn(),
		getTempDir: jest.fn(),
		getDownloadsDir: jest.fn(),
		getRestoresDir: jest.fn(),
		getSyncDir: jest.fn(),
		getRescueDir: jest.fn(),
	},
}));

// Mock ConfigService BEFORE any imports that depend on it
jest.mock('../../src/services/ConfigService', () => ({
	configService: {
		config: {
			SECRET: 'test-secret-key',
			NODE_ENV: 'test' as const,
			SERVER_PORT: 5173,
			APP_URL: 'http://localhost:5173',
			APP_TITLE: 'Test App',
			MAX_CONCURRENT_BACKUPS: 2,
			ENCRYPTION_KEY: 'test-encryption-key',
			APIKEY: 'test-api-key',
			USER_NAME: 'test',
			USER_PASSWORD: 'test',
			SESSION_DURATION: 7,
		},
		isDevelopment: jest.fn().mockReturnValue(false),
	},
}));

// IMPORTANT: mock 'fs' (not 'fs/promises') to match the implementation import
jest.mock('fs', () => ({
	promises: {
		readFile: jest.fn(),
		writeFile: jest.fn(),
		access: jest.fn(),
	},
}));

// Mock crypto and cryptr
jest.mock('crypto');
jest.mock('cryptr');

describe('SecurityKeyManager', () => {
	const keysFilePath = path.join(mockDataDir, 'keys.json');
	const fakeKeyPair = {
		publicKey: '---BEGIN FAKE PUBLIC KEY---',
		privateKey: '---BEGIN FAKE PRIVATE KEY---',
	};

	let mockFileSystem: Record<string, string>;
	let securityKeyManager: any;

	const applyFsMocks = () => {
		(fs.readFile as jest.Mock).mockImplementation(async (filePath: string, encoding?: string) => {
			if (mockFileSystem[filePath]) return mockFileSystem[filePath];
			const error = new Error(`ENOENT: no such file or directory`);
			(error as any).code = 'ENOENT';
			throw error;
		});

		(fs.writeFile as jest.Mock).mockImplementation(async (filePath: string, data: string) => {
			mockFileSystem[filePath] = data;
		});

		(fs.access as jest.Mock).mockImplementation(async (filePath: string) => {
			if (!mockFileSystem[filePath]) {
				const error = new Error('File not found');
				(error as any).code = 'ENOENT';
				throw error;
			}
			// If it exists, resolve with no error
			return;
		});
	};

	beforeAll(async () => {
		// Import SecurityKeyManager after setting up module mocks
		const module = await import('../../src/managers/SecurityKeyManager');
		securityKeyManager = module.securityKeyManager;

		// Allow async constructor loadKeys to settle (it will fail silently with no keys)
		await new Promise(resolve => setImmediate(resolve));
	});

	beforeEach(() => {
		jest.clearAllMocks();
		mockFileSystem = {};

		// Re-apply fs mocks after clearing
		applyFsMocks();

		// Re-apply Cryptr mock after clearing
		(Cryptr as unknown as jest.Mock).mockImplementation(() => ({
			encrypt: jest.fn((data: string) => `encrypted-${data}`),
			decrypt: jest.fn((data: string) => data.replace('encrypted-', '')),
		}));

		// Re-apply crypto mocks after clearing
		(crypto.generateKeyPairSync as unknown as jest.Mock).mockReturnValue(fakeKeyPair);
		(crypto.sign as unknown as jest.Mock).mockReturnValue(Buffer.from('fake-signature'));
		(crypto.verify as unknown as jest.Mock).mockReturnValue(true);

		// Reset internal state on the singleton
		(securityKeyManager as any).keyData = null;
		(securityKeyManager as any).decryptedPrivateKey = null;
	});

	it('should be a singleton', async () => {
		const module = await import('../../src/managers/SecurityKeyManager');
		expect(module.securityKeyManager).toBe(securityKeyManager);
	});

	describe('setupInitialKeys', () => {
		it('should generate, encrypt, and save keys if keys.json does not exist', async () => {
			await securityKeyManager.setupInitialKeys();

			expect(crypto.generateKeyPairSync).toHaveBeenCalledWith('ed25519', expect.any(Object));
			expect(Cryptr).toHaveBeenCalledWith('test-secret-key');
			expect(fs.writeFile).toHaveBeenCalledTimes(1);
			expect(fs.writeFile).toHaveBeenCalledWith(
				keysFilePath,
				expect.stringContaining(fakeKeyPair.publicKey),
				{ mode: 0o600 }
			);
			expect(securityKeyManager.getPublicKey()).toBe(fakeKeyPair.publicKey);
		});

		it('should not write keys if keys.json already exists', async () => {
			// Pretend the file already exists
			mockFileSystem[keysFilePath] = JSON.stringify({ publicKey: 'existing' });
			// Access should succeed
			(fs.access as jest.Mock).mockResolvedValue(undefined);

			await securityKeyManager.setupInitialKeys();

			expect(crypto.generateKeyPairSync).toHaveBeenCalledWith('ed25519', expect.any(Object));
			expect(fs.writeFile).not.toHaveBeenCalled();
		});
	});

	describe('Key Loading and Retrieval', () => {
		it('should load keys from file on initialization', async () => {
			mockFileSystem[keysFilePath] = JSON.stringify({
				publicKey: 'loaded-public-key',
				encryptedPrivateKey: 'encrypted-loaded-private-key',
			});

			// Manually call loadKeys to simulate fresh initialization
			await (securityKeyManager as any).loadKeys();

			expect(fs.readFile).toHaveBeenCalledWith(keysFilePath, 'utf-8');
			expect(securityKeyManager.getPublicKey()).toBe('loaded-public-key');
		});

		it('should decrypt and cache the private key on first request', async () => {
			mockFileSystem[keysFilePath] = JSON.stringify({
				publicKey: 'loaded-public-key',
				encryptedPrivateKey: 'encrypted-loaded-private-key',
			});

			await (securityKeyManager as any).loadKeys();

			const privateKey1 = (securityKeyManager as any).getPrivateKey();
			const privateKey2 = (securityKeyManager as any).getPrivateKey();

			expect(Cryptr).toHaveBeenCalledWith('test-secret-key');
			expect(privateKey1).toBe('loaded-private-key');
			expect(privateKey2).toBe('loaded-private-key');
		});
	});

	describe('Crypto Operations', () => {
		beforeEach(async () => {
			mockFileSystem[keysFilePath] = JSON.stringify({
				publicKey: fakeKeyPair.publicKey,
				encryptedPrivateKey: `encrypted-${fakeKeyPair.privateKey}`,
			});
			await (securityKeyManager as any).loadKeys();
		});

		it('should sign a payload using the decrypted private key', () => {
			const payload = { data: 'sign this' };
			const signature = securityKeyManager.signPayload(payload);

			expect(crypto.sign).toHaveBeenCalledTimes(1);
			expect(crypto.sign).toHaveBeenCalledWith(
				null,
				Buffer.from(JSON.stringify(payload)),
				fakeKeyPair.privateKey
			);
			expect(signature).toBe(Buffer.from('fake-signature').toString('base64'));
		});

		it('should verify a payload signature', () => {
			const payload = { data: 'verify this' };
			const signature = 'base64-signature';
			const publicKey = 'some-public-key';

			const isValid = securityKeyManager.verifyPayload(payload, signature, publicKey);

			expect(crypto.verify).toHaveBeenCalledTimes(1);
			expect(crypto.verify).toHaveBeenCalledWith(
				null,
				Buffer.from(JSON.stringify(payload)),
				publicKey,
				Buffer.from(signature, 'base64')
			);
			expect(isValid).toBe(true);
		});
	});
});
