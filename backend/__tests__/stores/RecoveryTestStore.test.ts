import { execFileSync } from 'child_process';
import path from 'path';
describe('Phase 6 actual additive migration and transactional persistence', () => {
	for (const scenario of [
		'migration',
		'migration-rollback',
		'persistence',
		'transaction',
		'ownership',
		'automation',
		'cascade',
		'restart',
		'cancellation',
		'concurrency',
		'workload-admission',
		'cleanup-ownership',
		'history',
		'internal',
	]) {
		it(
			scenario,
			() => {
				const output = execFileSync(
					process.execPath,
					[
						require.resolve('tsx/cli'),
						path.join(__dirname, '../integration/phase6Persistence.smoke.ts'),
						scenario,
					],
					{ cwd: process.cwd(), encoding: 'utf8', timeout: 20_000, maxBuffer: 4096 }
				);
				expect(output.trim()).toBe(`PASS ${scenario}`);
			},
			25_000
		);
	}
});
