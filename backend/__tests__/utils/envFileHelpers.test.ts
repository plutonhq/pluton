import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';

jest.mock('child_process', () => ({
	execSync: jest.fn(),
}));

// We do NOT mock fs entirely — we use a real temp directory for integration-style tests.
// Only os.platform() and child_process are mocked where needed.

describe('envFileHelpers', () => {
	let tmpDir: string;
	const originalPlatform = process.platform;

	beforeEach(() => {
		jest.clearAllMocks();
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'envFileHelpers-'));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
		Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
	});

	// We need to re-import each time because the module caches nothing, but jest mocks may differ.
	function loadModule() {
		return require('../../src/utils/envFileHelpers') as typeof import('../../src/utils/envFileHelpers');
	}

	// ── getEncEnvFilePath ──────────────────────────────────────────────────────

	describe('getEncEnvFilePath', () => {
		it('should return the path to pluton.enc.env in the given directory', () => {
			const { getEncEnvFilePath } = loadModule();
			expect(getEncEnvFilePath('/some/dir')).toBe(path.join('/some/dir', 'pluton.enc.env'));
		});
	});

	// ── encEnvFileExists ───────────────────────────────────────────────────────

	describe('encEnvFileExists', () => {
		it('should return false when file does not exist', () => {
			const { encEnvFileExists } = loadModule();
			expect(encEnvFileExists(tmpDir)).toBe(false);
		});

		it('should return true when file exists', () => {
			fs.writeFileSync(path.join(tmpDir, 'pluton.enc.env'), 'ENCRYPTION_KEY=abc');
			const { encEnvFileExists } = loadModule();
			expect(encEnvFileExists(tmpDir)).toBe(true);
		});
	});

	// ── readEncryptionKeyFromEnvFile ───────────────────────────────────────────

	describe('readEncryptionKeyFromEnvFile', () => {
		it('should return null when file does not exist', () => {
			const { readEncryptionKeyFromEnvFile } = loadModule();
			expect(readEncryptionKeyFromEnvFile(tmpDir)).toBeNull();
		});

		it('should return null for an empty file', () => {
			fs.writeFileSync(path.join(tmpDir, 'pluton.enc.env'), '');
			const { readEncryptionKeyFromEnvFile } = loadModule();
			expect(readEncryptionKeyFromEnvFile(tmpDir)).toBeNull();
		});

		it('should return null for a file with only comments', () => {
			fs.writeFileSync(path.join(tmpDir, 'pluton.enc.env'), '# just a comment\n# another\n');
			const { readEncryptionKeyFromEnvFile } = loadModule();
			expect(readEncryptionKeyFromEnvFile(tmpDir)).toBeNull();
		});

		it('should parse ENCRYPTION_KEY', () => {
			fs.writeFileSync(
				path.join(tmpDir, 'pluton.enc.env'),
				'# comment\nENCRYPTION_KEY=my-secret-key-123\n'
			);
			const { readEncryptionKeyFromEnvFile } = loadModule();
			expect(readEncryptionKeyFromEnvFile(tmpDir)).toBe('my-secret-key-123');
		});

		it('should parse PLUTON_ENCRYPTION_KEY (prefixed variant)', () => {
			fs.writeFileSync(
				path.join(tmpDir, 'pluton.enc.env'),
				'PLUTON_ENCRYPTION_KEY=prefixed-key-456\n'
			);
			const { readEncryptionKeyFromEnvFile } = loadModule();
			expect(readEncryptionKeyFromEnvFile(tmpDir)).toBe('prefixed-key-456');
		});

		it('should return null when key has empty value', () => {
			fs.writeFileSync(path.join(tmpDir, 'pluton.enc.env'), 'ENCRYPTION_KEY=\n');
			const { readEncryptionKeyFromEnvFile } = loadModule();
			expect(readEncryptionKeyFromEnvFile(tmpDir)).toBeNull();
		});

		it('should ignore unrelated keys', () => {
			fs.writeFileSync(path.join(tmpDir, 'pluton.enc.env'), 'OTHER_KEY=value\nFOO=bar\n');
			const { readEncryptionKeyFromEnvFile } = loadModule();
			expect(readEncryptionKeyFromEnvFile(tmpDir)).toBeNull();
		});

		it('should handle lines without equals sign', () => {
			fs.writeFileSync(path.join(tmpDir, 'pluton.enc.env'), 'no-equals\nENCRYPTION_KEY=ok\n');
			const { readEncryptionKeyFromEnvFile } = loadModule();
			expect(readEncryptionKeyFromEnvFile(tmpDir)).toBe('ok');
		});

		it('should handle values containing equals signs', () => {
			fs.writeFileSync(path.join(tmpDir, 'pluton.enc.env'), 'ENCRYPTION_KEY=base64==value\n');
			const { readEncryptionKeyFromEnvFile } = loadModule();
			expect(readEncryptionKeyFromEnvFile(tmpDir)).toBe('base64==value');
		});
	});

	// ── writeEncryptionKeyToEnvFile ───────────────────────────────────────────

	describe('writeEncryptionKeyToEnvFile', () => {
		it('should create the file with the encryption key', () => {
			const { writeEncryptionKeyToEnvFile, readEncryptionKeyFromEnvFile } = loadModule();
			writeEncryptionKeyToEnvFile(tmpDir, 'write-test-key');

			const filePath = path.join(tmpDir, 'pluton.enc.env');
			expect(fs.existsSync(filePath)).toBe(true);

			const content = fs.readFileSync(filePath, 'utf-8');
			expect(content).toContain('ENCRYPTION_KEY=write-test-key');
			expect(content).toContain('# Pluton Encryption Key');

			// Round-trip: should be readable
			expect(readEncryptionKeyFromEnvFile(tmpDir)).toBe('write-test-key');
		});

		it('should create parent directories if they do not exist', () => {
			const { writeEncryptionKeyToEnvFile } = loadModule();
			const nested = path.join(tmpDir, 'sub', 'dir');
			writeEncryptionKeyToEnvFile(nested, 'nested-key');
			expect(fs.existsSync(path.join(nested, 'pluton.enc.env'))).toBe(true);
		});

		it('should overwrite an existing file', () => {
			const { writeEncryptionKeyToEnvFile, readEncryptionKeyFromEnvFile } = loadModule();
			writeEncryptionKeyToEnvFile(tmpDir, 'first-key');
			writeEncryptionKeyToEnvFile(tmpDir, 'second-key');
			expect(readEncryptionKeyFromEnvFile(tmpDir)).toBe('second-key');
		});
	});

	// ── applyStrictPermissions ────────────────────────────────────────────────

	describe('applyStrictPermissions', () => {
		it('should call chmodSync on non-Windows platforms', () => {
			const platformSpy = jest.spyOn(os, 'platform').mockReturnValue('linux' as any);
			jest.resetModules();
			const { applyStrictPermissions } = loadModule();

			const filePath = path.join(tmpDir, 'test-file');
			fs.writeFileSync(filePath, 'data');

			const chmodSpy = jest.spyOn(fs, 'chmodSync');
			applyStrictPermissions(filePath);
			expect(chmodSpy).toHaveBeenCalledWith(filePath, 0o600);
			chmodSpy.mockRestore();
			platformSpy.mockRestore();
		});

		it('should call icacls on Windows', () => {
			const platformSpy = jest.spyOn(os, 'platform').mockReturnValue('win32' as any);
			jest.resetModules();
			const { applyStrictPermissions } = loadModule();
			// After resetModules the re-loaded module gets a fresh child_process mock;
			// re-require it so we reference the same instance.
			const { execSync: freshExecSync } = require('child_process');

			const filePath = path.join(tmpDir, 'test-file');
			fs.writeFileSync(filePath, 'data');

			applyStrictPermissions(filePath);

			expect(freshExecSync).toHaveBeenCalledTimes(4);
			expect(freshExecSync).toHaveBeenCalledWith(
				expect.stringContaining('/inheritance:r'),
				expect.anything()
			);
			expect(freshExecSync).toHaveBeenCalledWith(
				expect.stringContaining('NT AUTHORITY\\SYSTEM'),
				expect.anything()
			);
			expect(freshExecSync).toHaveBeenCalledWith(
				expect.stringContaining('BUILTIN\\Administrators'),
				expect.anything()
			);
			platformSpy.mockRestore();
		});

		it('should not throw if chmod fails', () => {
			const platformSpy = jest.spyOn(os, 'platform').mockReturnValue('linux' as any);
			jest.resetModules();
			const { applyStrictPermissions } = loadModule();

			const chmodSpy = jest.spyOn(fs, 'chmodSync').mockImplementation(() => {
				throw new Error('Permission denied');
			});
			expect(() => applyStrictPermissions('/nonexistent')).not.toThrow();
			chmodSpy.mockRestore();
			platformSpy.mockRestore();
		});
	});

	// ── verifyFilePermissions ─────────────────────────────────────────────────

	describe('verifyFilePermissions', () => {
		it('should return true when file does not exist', () => {
			const { verifyFilePermissions } = loadModule();
			expect(verifyFilePermissions(path.join(tmpDir, 'nope'))).toBe(true);
		});

		it('should return true on Windows (no check performed)', () => {
			const platformSpy = jest.spyOn(os, 'platform').mockReturnValue('win32' as any);
			jest.resetModules();
			const { verifyFilePermissions } = loadModule();

			const filePath = path.join(tmpDir, 'win-file');
			fs.writeFileSync(filePath, 'data');
			expect(verifyFilePermissions(filePath)).toBe(true);
			platformSpy.mockRestore();
		});

		it('should return true when permissions are 600 on Unix', () => {
			const platformSpy = jest.spyOn(os, 'platform').mockReturnValue('linux' as any);
			jest.resetModules();
			const { verifyFilePermissions } = loadModule();

			const filePath = path.join(tmpDir, 'strict-file');
			fs.writeFileSync(filePath, 'data');

			const statSpy = jest.spyOn(fs, 'statSync').mockReturnValue({
				mode: 0o100600,
			} as any);

			expect(verifyFilePermissions(filePath)).toBe(true);
			statSpy.mockRestore();
			platformSpy.mockRestore();
		});

		it('should return false and warn when permissions are too open on Unix', () => {
			const platformSpy = jest.spyOn(os, 'platform').mockReturnValue('linux' as any);
			jest.resetModules();
			const { verifyFilePermissions } = loadModule();

			const filePath = path.join(tmpDir, 'open-file');
			fs.writeFileSync(filePath, 'data');

			const statSpy = jest.spyOn(fs, 'statSync').mockReturnValue({
				mode: 0o100644,
			} as any);
			const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

			expect(verifyFilePermissions(filePath)).toBe(false);
			expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('644'));
			statSpy.mockRestore();
			warnSpy.mockRestore();
			platformSpy.mockRestore();
		});
	});
});
