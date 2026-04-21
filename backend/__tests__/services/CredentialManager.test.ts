import fs from 'fs';
import os from 'os';
import path from 'path';
import bcrypt from 'bcryptjs';

// Mock AppPaths before importing anything that depends on it
let mockDataDir: string;

jest.mock('../../src/utils/AppPaths', () => ({
	appPaths: {
		getDataDir: () => mockDataDir,
	},
}));

// Mock child_process to prevent actual icacls calls
jest.mock('child_process', () => ({
	execSync: jest.fn(),
}));

describe('CredentialManager', () => {
	let tmpDir: string;
	let keysPath: string;

	beforeEach(() => {
		jest.clearAllMocks();
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'credmgr-'));
		mockDataDir = tmpDir;
		keysPath = path.join(tmpDir, 'keys.json');
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
		jest.resetModules();
	});

	function loadModule() {
		// Fresh import each time to pick up the new mockDataDir
		return require('../../src/services/CredentialManager') as typeof import('../../src/services/CredentialManager');
	}

	// ── constructor / getKeysPath ──────────────────────────────────────────────

	describe('constructor and getKeysPath', () => {
		it('should set keysPath to keys.json in data directory', () => {
			const { CredentialManager } = loadModule();
			const cm = new CredentialManager();
			expect(cm.getKeysPath()).toBe(path.join(tmpDir, 'keys.json'));
		});
	});

	// ── readKeysFile ───────────────────────────────────────────────────────────

	describe('readKeysFile', () => {
		it('should return empty object when file does not exist', () => {
			const { CredentialManager } = loadModule();
			const cm = new CredentialManager();
			expect(cm.readKeysFile()).toEqual({});
		});

		it('should return parsed JSON when file exists', () => {
			fs.writeFileSync(keysPath, JSON.stringify({ SECRET: 'abc', APIKEY: 'xyz' }));
			const { CredentialManager } = loadModule();
			const cm = new CredentialManager();
			expect(cm.readKeysFile()).toEqual({ SECRET: 'abc', APIKEY: 'xyz' });
		});

		it('should return empty object when file contains invalid JSON', () => {
			fs.writeFileSync(keysPath, 'not valid json!!!');
			const { CredentialManager } = loadModule();
			const cm = new CredentialManager();
			expect(cm.readKeysFile()).toEqual({});
		});
	});

	// ── writeKeysFile ──────────────────────────────────────────────────────────

	describe('writeKeysFile', () => {
		it('should write JSON to keys.json', () => {
			const { CredentialManager } = loadModule();
			const cm = new CredentialManager();
			cm.writeKeysFile({ SECRET: 'test-secret', APIKEY: 'test-api' });

			const content = JSON.parse(fs.readFileSync(keysPath, 'utf-8'));
			expect(content).toEqual({ SECRET: 'test-secret', APIKEY: 'test-api' });
		});

		it('should create parent directories if needed', () => {
			const nested = path.join(tmpDir, 'sub', 'dir');
			mockDataDir = nested;
			jest.resetModules();
			const { CredentialManager } = loadModule();
			const cm = new CredentialManager();
			cm.writeKeysFile({ FOO: 'bar' });

			const nestedKeysPath = path.join(nested, 'keys.json');
			expect(fs.existsSync(nestedKeysPath)).toBe(true);
		});

		it('should overwrite existing content', () => {
			fs.writeFileSync(keysPath, JSON.stringify({ OLD: 'data' }));
			const { CredentialManager } = loadModule();
			const cm = new CredentialManager();
			cm.writeKeysFile({ NEW: 'data' });

			const content = JSON.parse(fs.readFileSync(keysPath, 'utf-8'));
			expect(content).toEqual({ NEW: 'data' });
		});
	});

	// ── loadOrGenerateSecrets ──────────────────────────────────────────────────

	describe('loadOrGenerateSecrets', () => {
		it('should use env-provided secret and apikey', () => {
			const { CredentialManager } = loadModule();
			const cm = new CredentialManager();
			const result = cm.loadOrGenerateSecrets('env-secret', 'env-apikey');
			expect(result).toEqual({ SECRET: 'env-secret', APIKEY: 'env-apikey' });

			// Should be persisted to keys.json
			const content = JSON.parse(fs.readFileSync(keysPath, 'utf-8'));
			expect(content.SECRET).toBe('env-secret');
			expect(content.APIKEY).toBe('env-apikey');
		});

		it('should use existing values from keys.json when no env values provided', () => {
			fs.writeFileSync(keysPath, JSON.stringify({ SECRET: 'file-secret', APIKEY: 'file-apikey' }));
			const { CredentialManager } = loadModule();
			const cm = new CredentialManager();
			const result = cm.loadOrGenerateSecrets();
			expect(result).toEqual({ SECRET: 'file-secret', APIKEY: 'file-apikey' });
		});

		it('should generate random secrets when nothing is provided', () => {
			const { CredentialManager } = loadModule();
			const cm = new CredentialManager();
			const result = cm.loadOrGenerateSecrets();
			expect(result.SECRET).toBeDefined();
			expect(result.SECRET.length).toBeGreaterThan(0);
			expect(result.APIKEY).toBeDefined();
			expect(result.APIKEY.length).toBeGreaterThan(0);
		});

		it('should prefer env over file values', () => {
			fs.writeFileSync(keysPath, JSON.stringify({ SECRET: 'file', APIKEY: 'file' }));
			const { CredentialManager } = loadModule();
			const cm = new CredentialManager();
			const result = cm.loadOrGenerateSecrets('env', undefined);
			expect(result.SECRET).toBe('env');
			expect(result.APIKEY).toBe('file');
		});

		it('should not rewrite keys.json if values have not changed', () => {
			fs.writeFileSync(keysPath, JSON.stringify({ SECRET: 'same', APIKEY: 'same' }));
			const mtimeBefore = fs.statSync(keysPath).mtimeMs;

			const { CredentialManager } = loadModule();
			const cm = new CredentialManager();
			cm.loadOrGenerateSecrets('same', 'same');

			const mtimeAfter = fs.statSync(keysPath).mtimeMs;
			expect(mtimeAfter).toBe(mtimeBefore);
		});

		it('should preserve other fields in keys.json when updating', () => {
			fs.writeFileSync(keysPath, JSON.stringify({ PASSWORD_HASH: 'existing-hash', SECRET: 'old' }));
			const { CredentialManager } = loadModule();
			const cm = new CredentialManager();
			cm.loadOrGenerateSecrets('new-secret', 'new-api');

			const content = JSON.parse(fs.readFileSync(keysPath, 'utf-8'));
			expect(content.PASSWORD_HASH).toBe('existing-hash');
			expect(content.SECRET).toBe('new-secret');
			expect(content.APIKEY).toBe('new-api');
		});
	});

	// ── hashPasswordIfNeeded ───────────────────────────────────────────────────

	describe('hashPasswordIfNeeded', () => {
		it('should return undefined when no password and no stored hash', () => {
			const { CredentialManager } = loadModule();
			const cm = new CredentialManager();
			expect(cm.hashPasswordIfNeeded()).toBeUndefined();
		});

		it('should return existing hash from keys.json when no password provided', () => {
			fs.writeFileSync(keysPath, JSON.stringify({ PASSWORD_HASH: '$2a$10$existinghash' }));
			const { CredentialManager } = loadModule();
			const cm = new CredentialManager();
			expect(cm.hashPasswordIfNeeded()).toBe('$2a$10$existinghash');
		});

		it('should hash and store a new password', () => {
			const { CredentialManager } = loadModule();
			const cm = new CredentialManager();
			const hash = cm.hashPasswordIfNeeded('mypassword');

			expect(hash).toBeDefined();
			expect(bcrypt.compareSync('mypassword', hash!)).toBe(true);

			// Verify stored in keys.json
			const content = JSON.parse(fs.readFileSync(keysPath, 'utf-8'));
			expect(content.PASSWORD_HASH).toBe(hash);
		});

		it('should return existing hash if password matches (avoids re-hash)', () => {
			const existingHash = bcrypt.hashSync('samepassword', 10);
			fs.writeFileSync(keysPath, JSON.stringify({ PASSWORD_HASH: existingHash }));

			const { CredentialManager } = loadModule();
			const cm = new CredentialManager();
			const result = cm.hashPasswordIfNeeded('samepassword');
			expect(result).toBe(existingHash);
		});

		it('should re-hash if password does not match existing hash', () => {
			const oldHash = bcrypt.hashSync('oldpassword', 10);
			fs.writeFileSync(keysPath, JSON.stringify({ PASSWORD_HASH: oldHash }));

			const { CredentialManager } = loadModule();
			const cm = new CredentialManager();
			const newHash = cm.hashPasswordIfNeeded('newpassword');
			expect(newHash).not.toBe(oldHash);
			expect(bcrypt.compareSync('newpassword', newHash!)).toBe(true);
		});

		it('should re-hash if stored hash is corrupted', () => {
			fs.writeFileSync(keysPath, JSON.stringify({ PASSWORD_HASH: 'not-a-valid-bcrypt-hash' }));

			const { CredentialManager } = loadModule();
			const cm = new CredentialManager();
			const hash = cm.hashPasswordIfNeeded('somepassword');
			expect(hash).toBeDefined();
			expect(bcrypt.compareSync('somepassword', hash!)).toBe(true);
		});
	});

	// ── hashAndStorePassword ───────────────────────────────────────────────────

	describe('hashAndStorePassword', () => {
		it('should hash password and store in keys.json', () => {
			const { CredentialManager } = loadModule();
			const cm = new CredentialManager();
			const hash = cm.hashAndStorePassword('testpass');

			expect(bcrypt.compareSync('testpass', hash)).toBe(true);
			const content = JSON.parse(fs.readFileSync(keysPath, 'utf-8'));
			expect(content.PASSWORD_HASH).toBe(hash);
		});

		it('should store userName when provided', () => {
			const { CredentialManager } = loadModule();
			const cm = new CredentialManager();
			cm.hashAndStorePassword('testpass', 'admin');

			const content = JSON.parse(fs.readFileSync(keysPath, 'utf-8'));
			expect(content.USER_NAME).toBe('admin');
			expect(content.PASSWORD_HASH).toBeDefined();
		});

		it('should not overwrite userName field when not provided', () => {
			fs.writeFileSync(keysPath, JSON.stringify({ USER_NAME: 'existing-user' }));

			const { CredentialManager } = loadModule();
			const cm = new CredentialManager();
			cm.hashAndStorePassword('testpass');

			const content = JSON.parse(fs.readFileSync(keysPath, 'utf-8'));
			expect(content.USER_NAME).toBe('existing-user');
		});

		it('should preserve existing keys in keys.json', () => {
			fs.writeFileSync(keysPath, JSON.stringify({ SECRET: 'keep-me', APIKEY: 'also-keep' }));

			const { CredentialManager } = loadModule();
			const cm = new CredentialManager();
			cm.hashAndStorePassword('pass', 'user');

			const content = JSON.parse(fs.readFileSync(keysPath, 'utf-8'));
			expect(content.SECRET).toBe('keep-me');
			expect(content.APIKEY).toBe('also-keep');
			expect(content.USER_NAME).toBe('user');
			expect(content.PASSWORD_HASH).toBeDefined();
		});
	});

	// ── verifyPassword ─────────────────────────────────────────────────────────

	describe('verifyPassword', () => {
		it('should return true for matching password and hash', () => {
			const { CredentialManager } = loadModule();
			const cm = new CredentialManager();
			const hash = bcrypt.hashSync('correct', 10);
			expect(cm.verifyPassword('correct', hash)).toBe(true);
		});

		it('should return false for non-matching password', () => {
			const { CredentialManager } = loadModule();
			const cm = new CredentialManager();
			const hash = bcrypt.hashSync('correct', 10);
			expect(cm.verifyPassword('wrong', hash)).toBe(false);
		});

		it('should return false when storedHash is empty', () => {
			const { CredentialManager } = loadModule();
			const cm = new CredentialManager();
			expect(cm.verifyPassword('anything', '')).toBe(false);
		});

		it('should return false when storedHash is falsy', () => {
			const { CredentialManager } = loadModule();
			const cm = new CredentialManager();
			expect(cm.verifyPassword('anything', undefined as any)).toBe(false);
			expect(cm.verifyPassword('anything', null as any)).toBe(false);
		});
	});
});
