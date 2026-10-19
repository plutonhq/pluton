import fs from 'fs/promises';
import { RecoveryTestError, checkRecoveryCancellation } from './recoveryValidation';

/** One observation at a time, only for an in-flight import. This never knows a
 * PID, container, executable, target or SQL. Cancellation uses the existing
 * operation's AbortSignal; cleanup and validated retained targets are not watched. */
export async function withRecoveryResourceGuard<T>(
	parent: AbortSignal,
	check: () => Promise<void>,
	operation: (signal: AbortSignal) => Promise<T>,
	intervalMs = 2000
): Promise<T> {
	checkRecoveryCancellation(parent);
	const controller = new AbortController();
	let stopped = false,
		timer: ReturnType<typeof setTimeout> | undefined;
	let failure: RecoveryTestError | undefined;
	const abort = () => controller.abort();
	parent.addEventListener('abort', abort, { once: true });
	const observe = async () => {
		let deadline: ReturnType<typeof setTimeout> | undefined;
		try {
			await Promise.race([
				check(),
				new Promise<never>((_, reject) => {
					deadline = setTimeout(
						() =>
							reject(new RecoveryTestError('database-import', 'internal-resources-insufficient')),
						1500
					);
				}),
			]);
		} catch (error) {
			if (!stopped) {
				failure =
					error instanceof RecoveryTestError
						? error
						: new RecoveryTestError('database-import', 'internal-resources-insufficient');
				controller.abort();
			}
		} finally {
			clearTimeout(deadline);
		}
	};
	const schedule = () => {
		timer = setTimeout(() => {
			void observe().then(() => {
				if (!stopped && !failure && !controller.signal.aborted) schedule();
			});
		}, intervalMs);
	};
	try {
		await observe();
		if (failure) throw failure;
		checkRecoveryCancellation(parent);
		schedule();
		try {
			const result = await operation(controller.signal);
			if (failure) throw failure;
			checkRecoveryCancellation(parent);
			return result;
		} catch (error) {
			throw failure || error;
		}
	} finally {
		stopped = true;
		clearTimeout(timer);
		parent.removeEventListener('abort', abort);
	}
}

/** The worker can observe only its own cgroup, never host Docker or other
 * processes. A vanished worker is still Unavailable, not an invented OOM proof. */
export async function assertMysqlWorkerResources(directory: string) {
	try {
		const read = async (name: string) =>
			(await fs.readFile('/sys/fs/cgroup/' + name, 'utf8')).trim();
		const memory = await Promise.all(
			['memory.max', 'memory.current', 'memory.swap.current'].map(read)
		);
		if (memory.some(value => !/^\d+$/.test(value))) throw new Error();
		const [limit, used, swap] = memory.map(Number);
		const cpu = (await read('cpu.max')).split(/\s+/);
		const disk = await fs.statfs(directory);
		if (
			!Number.isFinite(limit) ||
			!Number.isFinite(used) ||
			!Number.isFinite(swap) ||
			limit < 384 * 1024 ** 2 ||
			used < 0 ||
			used > limit * 0.85 ||
			swap !== 0 ||
			cpu.length !== 2 ||
			!/^\d+$/.test(cpu[1]) ||
			Number(cpu[1]) <= 0 ||
			(cpu[0] !== 'max' && (!/^\d+$/.test(cpu[0]) || Number(cpu[0]) / Number(cpu[1]) < 0.5))
		)
			throw new Error();
		if (
			!Number.isFinite(disk.bavail) ||
			!Number.isFinite(disk.bsize) ||
			disk.bavail < 0 ||
			disk.bsize <= 0
		)
			throw new Error();
		if (disk.bavail * disk.bsize < 8 * 1024 ** 2)
			throw new RecoveryTestError('database-import', 'database-storage-full');
	} catch (error) {
		if (error instanceof RecoveryTestError) throw error;
		throw new RecoveryTestError('database-import', 'mysql-worker-resource-limit');
	}
}
