import assert from 'node:assert/strict';
import test from 'node:test';
import { AgentOperationError, atAgentStage, formatAgentFailure } from './errors.js';

test('reports a lifecycle stage without including a sensitive upstream error message', async () => {
	const sensitiveValue = 'secret-value-that-must-not-be-logged';
	await assert.rejects(
		() => atAgentStage('poll', () => Promise.reject(new Error(`request failed: ${sensitiveValue}`))),
		error => {
			assert.ok(error instanceof AgentOperationError);
			const output = formatAgentFailure(error);
			assert.equal(output, 'poll failed: operation failed.');
			assert.equal(output.includes(sensitiveValue), false);
			return true;
		}
	);
});

test('preserves the safe command-verification diagnostic and its stage', () => {
	const output = formatAgentFailure(
		new AgentOperationError('verify-command', 'command lease has expired; check clock synchronization')
	);
	assert.equal(output, 'verify-command failed: command lease has expired; check clock synchronization.');
});
