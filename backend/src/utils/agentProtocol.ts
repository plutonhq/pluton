import crypto from 'crypto';

/**
 * HMAC canonical forms used exclusively by the independently implemented
 * public agent control plane. A body hash avoids ambiguities from JSON parsing.
 */
export function hashAgentBody(body: string): string {
	return crypto.createHash('sha256').update(body).digest('base64url');
}

export function signAgentRequest(
	secret: string,
	timestamp: string,
	nonce: string,
	method: string,
	path: string,
	body: string
): string {
	const canonical = [timestamp, nonce, method.toUpperCase(), path, hashAgentBody(body)].join('\n');
	return crypto.createHmac('sha256', secret).update(canonical).digest('base64');
}

export function verifyAgentSignature(expected: string, actual: string): boolean {
	try {
		const expectedBuffer = Buffer.from(expected, 'base64');
		const actualBuffer = Buffer.from(actual, 'base64');
		return expectedBuffer.length === actualBuffer.length && crypto.timingSafeEqual(expectedBuffer, actualBuffer);
	} catch {
		return false;
	}
}

export function signAgentCommand(
	secret: string,
	timestamp: string,
	command: {
		id: string;
		type: string;
		payload: Record<string, unknown>;
		idempotencyKey: string;
		leaseExpiresAt: Date | null;
	},
	leaseToken: string
): string {
	const canonical = [
		'command',
		timestamp,
		command.id,
		command.type,
		JSON.stringify(command.payload),
		command.idempotencyKey,
		leaseToken,
		command.leaseExpiresAt?.getTime().toString() || '',
	].join('\n');
	return crypto.createHmac('sha256', secret).update(canonical).digest('base64');
}
