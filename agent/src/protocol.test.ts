import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { verifyCommand, verifyCommandDetailed } from './protocol.js';

const secret = 'agent-protocol-test-secret';
const timestamp = '1700000000000';
const command = {
	id: 'command-1',
	type: 'PING' as const,
	payload: {},
	idempotencyKey: 'idempotency-1',
	leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
	leaseToken: 'a'.repeat(32),
	signatureTimestamp: timestamp,
	signature: '',
};

function sign(): string {
	return crypto
		.createHmac('sha256', secret)
		.update(['command', timestamp, command.id, command.type, JSON.stringify(command.payload), command.idempotencyKey, command.leaseToken, new Date(command.leaseExpiresAt).getTime().toString()].join('\n'))
		.digest('base64');
}

test('verifies a signed server command and rejects a modified payload', () => {
	command.signature = sign();
	assert.equal(verifyCommand(secret, command), true);
	assert.equal(verifyCommand(secret, { ...command, payload: { unexpected: true } }), false);
	assert.equal(verifyCommand(secret, { ...command, leaseToken: 'b'.repeat(32) }), false);
});

test('reports a safely actionable reason for an expired command lease', () => {
	const expired = { ...command, leaseExpiresAt: new Date(Date.now() - 1_000).toISOString() };
	const result = verifyCommandDetailed(secret, expired);
	assert.deepEqual(result, { valid: false, reason: 'command lease has expired; check clock synchronization' });
});
