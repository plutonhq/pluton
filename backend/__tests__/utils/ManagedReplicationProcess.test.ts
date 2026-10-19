import { ManagedReplicationExecutor } from '../../src/utils/restic/ManagedReplicationExecutor';

// The real process boundary runs a disposable Node child, never Restic/storage.
jest.mock('../../src/utils/binaryPathResolver', () => ({ getBinaryPath: () => process.execPath }));

describe('Managed replication child process security', () => {
	it('retains stdout only and classifies provider errors without stderr secrets', async () => {
		const executor = new ManagedReplicationExecutor() as any;
		await expect(executor.command('rclone', ['-e', "process.stderr.write('synthetic-secret://private');process.exit(12)"], {})).rejects.toMatchObject({ code: 'wrong-password', message: 'Managed replication failed (wrong-password).' });
	});
	it.each([
		['SignatureDoesNotMatch synthetic-private-secret', 'storage-authentication-failed'],
		['InvalidAccessKeyId synthetic-private-secret', 'storage-authentication-failed'],
		['HTTP status 403 AccessDenied synthetic-private-secret', 'storage-access-denied'],
		['x509: certificate signed by unknown authority synthetic-private-secret', 'storage-tls-failed'],
		['Delete denied by retention policy synthetic-private-secret', 'retention-denied'],
	])('classifies sanitized provider failure %s', async (diagnostic, expected) => {
		const executor = new ManagedReplicationExecutor() as any;
		await expect(executor.command('rclone', ['-e', `process.stderr.write(${JSON.stringify(diagnostic)});process.exit(1)`], {})).rejects.toMatchObject({ code: expected, message: `Managed replication failed (${expected}).` });
	});
	it('bounds captured output without retaining arbitrary large provider data', async () => {
		const executor = new ManagedReplicationExecutor() as any;
		await expect(executor.command('rclone', ['-e', "process.stdout.write('x'.repeat(5*1024*1024))"], {})).rejects.toMatchObject({ code: process.platform === 'win32' ? 'execution-uncertain' : 'output-limit' });
	});
	it('waits for child shutdown on cancellation and does not claim a known Windows tree outcome', async () => {
		const executor = new ManagedReplicationExecutor() as any;
		const controller = new AbortController();
		const pending = executor.command('rclone', ['-e', 'setInterval(()=>{},1000)'], {}, controller.signal);
		const timer = setTimeout(() => controller.abort(), 100);
		try { await expect(pending).rejects.toMatchObject({ code: process.platform === 'win32' ? 'execution-uncertain' : 'cancelled' }); }
		finally { clearTimeout(timer); }
	});
	it('uses only the supplied environment, without inherited application secrets', async () => {
		const executor = new ManagedReplicationExecutor() as any;
		const original = process.env.PLUTON_TEST_PRIVATE_SECRET;
		process.env.PLUTON_TEST_PRIVATE_SECRET = 'synthetic-parent-secret';
		try {
			await expect(executor.command('rclone', ['-e', 'process.stdout.write(String(process.env.PLUTON_TEST_PRIVATE_SECRET === undefined))'], {})).resolves.toBe('true');
		} finally {
			if (original === undefined) delete process.env.PLUTON_TEST_PRIVATE_SECRET; else process.env.PLUTON_TEST_PRIVATE_SECRET = original;
		}
	});
	it('retains uncertainty when process group termination cannot be proved', async () => {
		const executor = new ManagedReplicationExecutor() as any;
		const kill = jest.spyOn(process, 'kill').mockImplementation(() => { throw Object.assign(new Error('unavailable'), { code: 'EPERM' }); });
		try { await expect(executor.stopDescendants(123)).resolves.toBe(false); }
		finally { kill.mockRestore(); }
	});
	it('accepts only confirmed absence of the process group', async () => {
		const executor = new ManagedReplicationExecutor() as any;
		const kill = jest.spyOn(process, 'kill').mockImplementation(() => { throw Object.assign(new Error('gone'), { code: 'ESRCH' }); });
		try { await expect(executor.stopDescendants(123)).resolves.toBe(true); }
		finally { kill.mockRestore(); }
	});
});
