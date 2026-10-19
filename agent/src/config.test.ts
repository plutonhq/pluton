import assert from 'node:assert/strict';
import test from 'node:test';
import { createAgentConfig, parseAllowedRoots } from './config.js';

test('rejects insecure HTTP unless explicitly enabled', () => {
	assert.throws(() => createAgentConfig({ serverUrl: 'http://192.0.2.10:5173', allowInsecureHttp: false }), /HTTP is disabled/);
	assert.equal(createAgentConfig({ serverUrl: 'http://192.0.2.10:5173', allowInsecureHttp: true }).serverUrl.protocol, 'http:');
});

test('accepts HTTPS and parses generic allowed roots', () => {
	const config = createAgentConfig({ serverUrl: 'https://pluton.example.internal', allowedRoots: '/srv/example-app,\n/var/lib/example' });
	assert.equal(config.serverUrl.protocol, 'https:');
	assert.deepEqual(parseAllowedRoots('/srv/example-app,\n/var/lib/example'), ['/srv/example-app', '/var/lib/example']);
});
