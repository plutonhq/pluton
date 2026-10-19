import assert from 'node:assert/strict';
import test from 'node:test';
import { readEnrollmentToken } from './enrollmentToken.js';

test('reads an inline enrollment token for the quick installer path', async () => {
	const token = await readEnrollmentToken(['--token', 'example-token-value']);
	assert.equal(token, 'example-token-value');
});

test('reads an enrollment token from standard input without an argument', async () => {
	const token = await readEnrollmentToken(['--token-stdin'], async () => 'example-token-value\n');
	assert.equal(token, 'example-token-value');
});

test('does not allow inline and standard-input enrollment tokens together', async () => {
	await assert.rejects(
		() => readEnrollmentToken(['--token', 'example-token-value', '--token-stdin'], async () => 'other-token'),
		/Choose either --token or --token-stdin/
	);
});

test('rejects whitespace in an inline enrollment token', async () => {
	await assert.rejects(
		() => readEnrollmentToken(['--token', 'not a token']),
		/Enrollment token is required/
	);
});
