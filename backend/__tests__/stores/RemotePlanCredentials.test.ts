import { execFileSync } from 'node:child_process';
import path from 'node:path';

// better-sqlite3 caches native state across Jest VM realms. Run the real store
// and migrations in an isolated Node process, including actual SQLite errors,
// rather than letting another suite's native error constructor affect rollback.
describe('Phase 5 additive credential migration / transactional plan store', () => {
	for (const [scenario, title] of [
		[
			'persistence',
			'persists secret separately, replaces atomically and erases only its credential on deletion',
		],
		['plan-write-failure', 'does not create orphan credentials on failed plan writes'],
		['credential-write-failure', 'rolls back the plan when its credential insertion fails'],
		['phase4', 'preserves existing Phase 4 plan rows without a credential'],
		[
			'multi-persistence',
			'reorders without re-binding, updates/deletes only the selected secret, and cascades plan deletion',
		],
		['multi-ownership', 'rejects cross-plan IDs and orphan credential bindings atomically'],
		['multi-update-rollback', 'rolls back all plan and credential updates if database B fails'],
		[
			'multi-create-rollback',
			'rolls back a multi-DB plan and database A when database B insertion fails',
		],
		[
			'multi-migration',
			'upgrades old settings and preserves ciphertext byte-for-byte without password re-entry; replay is idempotent',
		],
		[
			'multi-migration-rollback',
			'failed additive migration preserves old settings/secret and can be rerun',
		],
	]) {
		it(title, () => {
			const output = execFileSync(
				process.execPath,
				[
					require.resolve('tsx/cli'),
					path.join(__dirname, '../integration/phase5Credentials.smoke.ts'),
					scenario,
				],
				{ cwd: process.cwd(), encoding: 'utf8', timeout: 15_000, maxBuffer: 4096 }
			);
			expect(output.trim()).toBe(`PASS ${scenario}`);
		});
	}
});
