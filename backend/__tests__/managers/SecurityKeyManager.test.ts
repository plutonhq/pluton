import crypto from 'crypto';

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

describe('SecurityKeyManager', () => {
	let securityKeyManager: any;

	// Per-device signing key used for all tests
	const testSigningKey = 'per-device-test-signing-key-abc123';

	/** Helper: compute the expected HMAC-SHA256 for given parts joined by newline. */
	const expectedHMAC = (...parts: string[]): string => {
		const hmac = crypto.createHmac('sha256', testSigningKey);
		hmac.update(parts.join('\n'));
		return hmac.digest('base64');
	};

	beforeAll(async () => {
		const module = await import('../../src/managers/SecurityKeyManager');
		securityKeyManager = module.securityKeyManager;
	});

	beforeEach(() => {
		jest.clearAllMocks();
	});

	it('should be a singleton', async () => {
		const module = await import('../../src/managers/SecurityKeyManager');
		expect(module.securityKeyManager).toBe(securityKeyManager);
	});

	// ========================================================================
	// setupInitialKeys & getPublicKey
	// ========================================================================

	describe('setupInitialKeys', () => {
		it('should be a no-op that resolves without error', async () => {
			const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
			await securityKeyManager.setupInitialKeys();
			expect(consoleSpy).toHaveBeenCalledWith(
				expect.stringContaining('HMAC-SHA256')
			);
			consoleSpy.mockRestore();
		});
	});

	describe('getPublicKey', () => {
		it('should return null (no Ed25519 keys)', () => {
			expect(securityKeyManager.getPublicKey()).toBeNull();
		});
	});

	// ========================================================================
	// Command Signing & Verification (Server → Agent)
	// ========================================================================

	describe('signCommand / verifyCommand', () => {
		const timestamp = '1700000000000';
		const commandID = 'cmd-abc-123';
		const commandType = 'backup:PERFORM_BACKUP';
		const payloadJSON = JSON.stringify({ planId: 'plan-1', backupId: 'bk-1' });

		it('should return a base64 HMAC-SHA256 signature for a command', () => {
			const sig = securityKeyManager.signCommand(testSigningKey, timestamp, commandID, commandType, payloadJSON);
			expect(sig).toBe(expectedHMAC(timestamp, commandID, commandType, payloadJSON));
			// Must be valid base64
			expect(() => Buffer.from(sig, 'base64')).not.toThrow();
		});

		it('should verify a valid command signature', () => {
			const sig = securityKeyManager.signCommand(testSigningKey, timestamp, commandID, commandType, payloadJSON);
			const isValid = securityKeyManager.verifyCommand(testSigningKey, sig, timestamp, commandID, commandType, payloadJSON);
			expect(isValid).toBe(true);
		});

		it('should reject a tampered command signature', () => {
			const sig = securityKeyManager.signCommand(testSigningKey, timestamp, commandID, commandType, payloadJSON);
			const isValid = securityKeyManager.verifyCommand(testSigningKey, sig, timestamp, commandID, 'backup:DELETE_BACKUP', payloadJSON);
			expect(isValid).toBe(false);
		});

		it('should reject a completely invalid signature', () => {
			const isValid = securityKeyManager.verifyCommand(testSigningKey, 'bm90LXZhbGlk', timestamp, commandID, commandType, payloadJSON);
			expect(isValid).toBe(false);
		});

		it('should produce different signatures for different payloads', () => {
			const sig1 = securityKeyManager.signCommand(testSigningKey, timestamp, commandID, commandType, '{"a":1}');
			const sig2 = securityKeyManager.signCommand(testSigningKey, timestamp, commandID, commandType, '{"a":2}');
			expect(sig1).not.toBe(sig2);
		});

		it('should produce different signatures for different signing keys', () => {
			const sig1 = securityKeyManager.signCommand('device-key-1', timestamp, commandID, commandType, payloadJSON);
			const sig2 = securityKeyManager.signCommand('device-key-2', timestamp, commandID, commandType, payloadJSON);
			expect(sig1).not.toBe(sig2);
		});

		it('should not verify with a different signing key', () => {
			const sig = securityKeyManager.signCommand('device-key-1', timestamp, commandID, commandType, payloadJSON);
			const isValid = securityKeyManager.verifyCommand('device-key-2', sig, timestamp, commandID, commandType, payloadJSON);
			expect(isValid).toBe(false);
		});
	});

	// ========================================================================
	// Request Verification (Agent → Server)
	// ========================================================================

	describe('verifyRequest', () => {
		const timestamp = '1700000000000';
		const method = 'POST';
		const path = '/api/agent/events';
		const body = JSON.stringify({ status: 'ok' });

		it('should verify a correctly signed request', () => {
			const sig = expectedHMAC(timestamp, method, path, body);
			expect(securityKeyManager.verifyRequest(testSigningKey, sig, timestamp, method, path, body)).toBe(true);
		});

		it('should reject a request with wrong method', () => {
			const sig = expectedHMAC(timestamp, method, path, body);
			expect(securityKeyManager.verifyRequest(testSigningKey, sig, timestamp, 'GET', path, body)).toBe(false);
		});

		it('should reject a request with wrong path', () => {
			const sig = expectedHMAC(timestamp, method, path, body);
			expect(securityKeyManager.verifyRequest(testSigningKey, sig, timestamp, method, '/api/other', body)).toBe(false);
		});

		it('should reject a request with tampered body', () => {
			const sig = expectedHMAC(timestamp, method, path, body);
			expect(securityKeyManager.verifyRequest(testSigningKey, sig, timestamp, method, path, '{"status":"hacked"}')).toBe(false);
		});

		it('should handle empty body for GET requests', () => {
			const sig = expectedHMAC(timestamp, 'GET', '/api/agent/poll', '');
			expect(securityKeyManager.verifyRequest(testSigningKey, sig, timestamp, 'GET', '/api/agent/poll', '')).toBe(true);
		});

		it('should reject verification with wrong signing key', () => {
			const sig = expectedHMAC(timestamp, method, path, body);
			expect(securityKeyManager.verifyRequest('wrong-key', sig, timestamp, method, path, body)).toBe(false);
		});
	});

	// ========================================================================
	// Timestamp Validation
	// ========================================================================

	describe('validateTimestamp', () => {
		it('should return null for a timestamp within the skew window', () => {
			const now = Date.now().toString();
			expect(securityKeyManager.validateTimestamp(now)).toBeNull();
		});

		it('should return null for a timestamp slightly in the past (< 5 min)', () => {
			const fourMinAgo = (Date.now() - 4 * 60 * 1000).toString();
			expect(securityKeyManager.validateTimestamp(fourMinAgo)).toBeNull();
		});

		it('should return an error string for a timestamp too far in the past (> 5 min)', () => {
			const sixMinAgo = (Date.now() - 6 * 60 * 1000).toString();
			const result = securityKeyManager.validateTimestamp(sixMinAgo);
			expect(result).not.toBeNull();
			expect(result).toContain('skew');
		});

		it('should return an error string for a timestamp too far in the future', () => {
			const sixMinAhead = (Date.now() + 6 * 60 * 1000).toString();
			const result = securityKeyManager.validateTimestamp(sixMinAhead);
			expect(result).not.toBeNull();
			expect(result).toContain('skew');
		});

		it('should return an error for non-numeric timestamp', () => {
			const result = securityKeyManager.validateTimestamp('not-a-number');
			expect(result).toBe('Invalid timestamp format');
		});

		it('should return an error for empty string', () => {
			const result = securityKeyManager.validateTimestamp('');
			expect(result).toBe('Invalid timestamp format');
		});
	});

	// ========================================================================
	// Legacy Compatibility
	// ========================================================================

	describe('signPayload (deprecated)', () => {
		it('should return empty string and warn', () => {
			const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
			const payload = { data: 'sign this' };
			const sig = securityKeyManager.signPayload(payload);
			expect(sig).toBe('');
			expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('deprecated'));
			warnSpy.mockRestore();
		});
	});

	describe('verifyPayload (deprecated)', () => {
		it('should always return false', () => {
			const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
			const isValid = securityKeyManager.verifyPayload({ data: 'test' }, 'signature', 'publicKey');
			expect(isValid).toBe(false);
			expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('deprecated'));
			warnSpy.mockRestore();
		});
	});
});
