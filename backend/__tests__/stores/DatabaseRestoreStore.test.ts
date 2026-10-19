import { execFileSync } from 'child_process';
import path from 'path';
describe('Persistent restore additive migration, purpose isolation and durable lifecycle', () => {
	for (const scenario of [
		'migration',
		'operator-fingerprint',
		'concurrency',
		'limit',
		'delete-idempotent',
		'stopped-expiry',
		'source',
		'policy',
		'restart',
		'import-retains',
		'binding',
		'digest',
		'expiry',
		'operator-cleanup',
		'unprovisioned',
		'resources',
	]) {
		it(
			scenario,
			() => {
				const output = execFileSync(
					process.execPath,
					[
						require.resolve('tsx/cli'),
						path.join(__dirname, '../integration/persistentRestore.smoke.ts'),
						scenario,
					],
					{ cwd: process.cwd(), encoding: 'utf8', timeout: 20000, maxBuffer: 4096 }
				);
				expect(output.trim()).toBe('PASS ' + scenario);
			},
			25000
		);
	}
});
