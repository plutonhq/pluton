import crypto from 'crypto';

/**
 * SecurityKeyManager provides HMAC-SHA256 based signing and verification
 * for bidirectional command integrity between server and agent.
 *
 * Each device has its own unique signing key (stored encrypted in the DB).
 * All signing/verification methods require the caller to provide the
 * per-device signing key, ensuring key isolation between agents.
 *
 * Canonical message format (parts joined by newline):
 * - Server→Agent commands: timestamp + commandID + type + payloadJSON
 * - Agent→Server requests: timestamp + method + path + body
 */
class SecurityKeyManager {
	private static instance: SecurityKeyManager;

	private constructor() {}

	public static getInstance(): SecurityKeyManager {
		if (!SecurityKeyManager.instance) {
			SecurityKeyManager.instance = new SecurityKeyManager();
		}
		return SecurityKeyManager.instance;
	}

	/**
	 * No-op for backward compatibility.
	 */
	public async setupInitialKeys(): Promise<void> {
		console.log('[SecurityKeyManager] Using HMAC-SHA256 signing with per-device keys.');
	}

	// ========================================================================
	// Core HMAC-SHA256 Operations
	// ========================================================================

	/**
	 * Compute HMAC-SHA256 over parts joined by newline separator.
	 * Returns base64-encoded signature.
	 * @param signingKey - The per-device signing key to use
	 */
	private computeHMAC(signingKey: string, ...parts: string[]): string {
		const message = parts.join('\n');
		const hmac = crypto.createHmac('sha256', signingKey);
		hmac.update(message);
		return hmac.digest('base64');
	}

	/**
	 * Verify an HMAC-SHA256 signature using constant-time comparison.
	 * @param signingKey - The per-device signing key to use
	 */
	private verifyHMAC(signingKey: string, signature: string, ...parts: string[]): boolean {
		const expected = this.computeHMAC(signingKey, ...parts);
		const sigBuf = Buffer.from(signature, 'base64');
		const expectedBuf = Buffer.from(expected, 'base64');
		if (sigBuf.length !== expectedBuf.length) return false;
		return crypto.timingSafeEqual(sigBuf, expectedBuf);
	}

	// ========================================================================
	// Command Signing (Server → Agent)
	// ========================================================================

	/**
	 * Sign a command being sent to an agent.
	 * @param signingKey - The per-device signing key
	 * @param timestamp - Unix milliseconds as string
	 * @param commandID - Unique command identifier
	 * @param commandType - Command type (e.g., "backup:PERFORM_BACKUP")
	 * @param payloadJSON - JSON string of the command payload
	 * @returns base64-encoded HMAC-SHA256 signature
	 */
	public signCommand(
		signingKey: string,
		timestamp: string,
		commandID: string,
		commandType: string,
		payloadJSON: string
	): string {
		return this.computeHMAC(signingKey, timestamp, commandID, commandType, payloadJSON);
	}

	/**
	 * Verify a command signature.
	 * @param signingKey - The per-device signing key
	 */
	public verifyCommand(
		signingKey: string,
		signature: string,
		timestamp: string,
		commandID: string,
		commandType: string,
		payloadJSON: string
	): boolean {
		return this.verifyHMAC(signingKey, signature, timestamp, commandID, commandType, payloadJSON);
	}

	// ========================================================================
	// Request Signing (Agent → Server)
	// ========================================================================

	/**
	 * Verify a signed request from an agent.
	 * @param signingKey - The per-device signing key
	 * @param signature - base64-encoded HMAC-SHA256 from X-Signature header
	 * @param timestamp - Unix milliseconds string from X-Signature-Timestamp header
	 * @param method - HTTP method (GET, POST, etc.)
	 * @param path - Request path (e.g., "/api/agent/events")
	 * @param body - Request body as string (empty string for GET/no-body requests)
	 * @returns true if signature is valid
	 */
	public verifyRequest(
		signingKey: string,
		signature: string,
		timestamp: string,
		method: string,
		path: string,
		body: string
	): boolean {
		return this.verifyHMAC(signingKey, signature, timestamp, method, path, body);
	}

	/**
	 * Validate that a timestamp is within the acceptable skew window (±5 minutes).
	 * @param timestampStr - Unix milliseconds as string
	 * @returns null if valid, error message string if invalid
	 */
	public validateTimestamp(timestampStr: string): string | null {
		const ts = parseInt(timestampStr, 10);
		if (isNaN(ts)) {
			return 'Invalid timestamp format';
		}
		const skew = Math.abs(Date.now() - ts);
		const maxSkewMs = 5 * 60 * 1000; // 5 minutes
		if (skew > maxSkewMs) {
			return `Timestamp skew ${skew}ms exceeds maximum ${maxSkewMs}ms`;
		}
		return null;
	}
}

export const securityKeyManager = SecurityKeyManager.getInstance();
