import crypto from 'node:crypto';
import type { AgentCommandEnvelope } from './types.js';

export type CommandVerificationResult =
	| { valid: true }
	| {
			valid: false;
			reason: 'command lease timestamp is invalid' | 'command lease has expired; check clock synchronization' | 'command signature does not match';
	  };

function bodyHash(body: string): string {
	return crypto.createHash('sha256').update(body).digest('base64url');
}

export function signRequest(
	secret: string,
	timestamp: string,
	nonce: string,
	method: string,
	path: string,
	body: string
): string {
	return crypto
		.createHmac('sha256', secret)
		.update([timestamp, nonce, method.toUpperCase(), path, bodyHash(body)].join('\n'))
		.digest('base64');
}

export function verifyCommandDetailed(secret: string, command: AgentCommandEnvelope): CommandVerificationResult {
	const leaseExpiresAt = command.leaseExpiresAt ? Date.parse(command.leaseExpiresAt) : Number.NaN;
	if (!Number.isFinite(leaseExpiresAt)) return { valid: false, reason: 'command lease timestamp is invalid' };
	if (leaseExpiresAt <= Date.now()) {
		return { valid: false, reason: 'command lease has expired; check clock synchronization' };
	}
	const canonical = [
		'command',
		command.signatureTimestamp,
		command.id,
		command.type,
		JSON.stringify(command.payload),
		command.idempotencyKey,
		command.leaseToken,
		leaseExpiresAt.toString(),
	].join('\n');
	const expected = crypto.createHmac('sha256', secret).update(canonical).digest('base64');
	try {
		const expectedBuffer = Buffer.from(expected, 'base64');
		const actualBuffer = Buffer.from(command.signature, 'base64');
		return expectedBuffer.length === actualBuffer.length && crypto.timingSafeEqual(expectedBuffer, actualBuffer)
			? { valid: true }
			: { valid: false, reason: 'command signature does not match' };
	} catch {
		return { valid: false, reason: 'command signature does not match' };
	}
}

export function verifyCommand(secret: string, command: AgentCommandEnvelope): boolean {
	return verifyCommandDetailed(secret, command).valid;
}
