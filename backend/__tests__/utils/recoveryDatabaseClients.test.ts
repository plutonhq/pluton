import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
	detectRecoveryClient,
	assertRecoveryClientPath,
} from '../../src/utils/recoveryDatabaseClients';
describe('Recovery client administrator ownership and platform boundary', () => {
	const linux = process.platform === 'linux' && process.getuid?.() !== 0;
	(linux ? it.skip : it)(
		'refuses imports on Windows or root runtime before invoking a client',
		() => {
			expect(() => detectRecoveryClient('mariadb')).toThrow('recovery-target-unsafe');
		}
	);
	(linux ? it : it.skip)(
		'rejects user-writable executable/parent and never trusts PATH overrides',
		async () => {
			const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'unsafe-client-'));
			try {
				const fake = path.join(scratch, 'mariadb');
				await fs.writeFile(fake, 'untrusted executable', { mode: 0o755 });
				expect(() => assertRecoveryClientPath(fake)).toThrow();
			} finally {
				await fs.rm(scratch, { recursive: true, force: true });
			}
		}
	);
	(linux && process.env.PLUTON_RECOVERY_NATIVE_FIXTURE === '1' ? it : it.skip)(
		'preflights the isolated fixture clients, never mistaking its MariaDB alias for genuine MySQL',
		() => {
			expect(detectRecoveryClient('mariadb')).toMatch(/^\/usr\//);
			expect(detectRecoveryClient('postgresql')).toMatch(/^\/usr\//);
			expect(() => detectRecoveryClient('mysql')).toThrow('database-client-incompatible');
		}
	);
});
