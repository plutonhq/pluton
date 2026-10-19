import { getEventListeners } from 'events';
import fs from 'fs/promises';
import {
	withRecoveryResourceGuard,
	assertMysqlWorkerResources,
} from '../../src/utils/recoveryResourceGuard';
import { RecoveryTestError } from '../../src/utils/recoveryValidation';

describe('operation-scoped resource observation, never a host process controller', () => {
	beforeEach(() => jest.useFakeTimers());
	afterEach(() => {
		jest.useRealTimers();
		jest.restoreAllMocks();
	});
	it('refuses before executing and never exposes a sampler exception', async () => {
		const work = jest.fn();
		await expect(
			withRecoveryResourceGuard(
				new AbortController().signal,
				async () => {
					throw new Error('private sample canary');
				},
				work
			)
		).rejects.toMatchObject({ code: 'internal-resources-insufficient' });
		expect(work).not.toHaveBeenCalled();
		expect(jest.getTimerCount()).toBe(0);
	});
	it('aborts only its import, awaits native settlement and keeps the resource failure instead of Cancelled', async () => {
		const parent = new AbortController();
		let checks = 0,
			settled = false;
		const result = withRecoveryResourceGuard(
			parent.signal,
			async () => {
				if (++checks === 2)
					throw new RecoveryTestError('database-import', 'internal-resources-insufficient');
			},
			signal =>
				new Promise<void>((_, reject) =>
					signal.addEventListener(
						'abort',
						() => {
							setTimeout(() => {
								settled = true;
								reject(new RecoveryTestError('database-import', 'cancelled'));
							}, 50);
						},
						{ once: true }
					)
				)
		);
		const refusal = expect(result).rejects.toMatchObject({
			code: 'internal-resources-insufficient',
		});
		await jest.advanceTimersByTimeAsync(2051);
		await refusal;
		expect(settled).toBe(true);
		expect(parent.signal.aborted).toBe(false);
		expect(getEventListeners(parent.signal, 'abort')).toHaveLength(0);
		expect(jest.getTimerCount()).toBe(0);
	});
	it('preserves explicit cancellation without an automatic import retry', async () => {
		const parent = new AbortController(),
			work = jest.fn(
				(signal: AbortSignal) =>
					new Promise<void>((_, reject) =>
						signal.addEventListener(
							'abort',
							() => reject(new RecoveryTestError('database-import', 'cancelled')),
							{ once: true }
						)
					)
			);
		const result = withRecoveryResourceGuard(parent.signal, async () => {}, work);
		const refusal = expect(result).rejects.toMatchObject({ code: 'cancelled' });
		await jest.advanceTimersByTimeAsync(0);
		parent.abort();
		await refusal;
		expect(work).toHaveBeenCalledTimes(1);
		expect(jest.getTimerCount()).toBe(0);
	});
	it('bounds a stalled observation and never overlaps another sample', async () => {
		let checks = 0;
		const result = withRecoveryResourceGuard(
			new AbortController().signal,
			async () => {
				if (++checks > 1) await new Promise<void>(() => {});
			},
			signal =>
				new Promise<void>((_, reject) =>
					signal.addEventListener('abort', () => reject(new Error('native settled')), {
						once: true,
					})
				)
		);
		const refusal = expect(result).rejects.toMatchObject({
			code: 'internal-resources-insufficient',
		});
		await jest.advanceTimersByTimeAsync(3501);
		await refusal;
		expect(checks).toBe(2);
		expect(jest.getTimerCount()).toBe(0);
	});
	it('late observations cannot cancel a completed retained restore or leave a polling loop', async () => {
		let checks = 0,
			finish!: () => void,
			rejectSample!: (error: Error) => void,
			child!: AbortSignal;
		const parent = new AbortController();
		const result = withRecoveryResourceGuard(
			parent.signal,
			async () => {
				if (++checks > 1)
					await new Promise<void>((_, reject) => {
						rejectSample = reject;
					});
			},
			signal => {
				child = signal;
				return new Promise<string>(resolve => {
					finish = () => resolve('validated');
				});
			}
		);
		await jest.advanceTimersByTimeAsync(2000);
		finish();
		await expect(result).resolves.toBe('validated');
		rejectSample(new Error('late private result'));
		await jest.advanceTimersByTimeAsync(10000);
		expect(child.aborted).toBe(false);
		expect(parent.signal.aborted).toBe(false);
		expect(checks).toBe(2);
		expect(getEventListeners(parent.signal, 'abort')).toHaveLength(0);
		expect(jest.getTimerCount()).toBe(0);
	});
});

describe('worker can observe only its own bounded cgroup and private staging', () => {
	const MiB = 1024 ** 2;
	afterEach(() => jest.restoreAllMocks());
	const configure = (override: Record<string, string> = {}, available = 32 * MiB) => {
		const files: Record<string, string> = {
			'memory.max': String(384 * MiB),
			'memory.current': String(200 * MiB),
			'memory.swap.current': '0',
			'cpu.max': '50000 100000',
			...override,
		};
		jest.spyOn(fs, 'readFile').mockImplementation(async file => {
			expect(String(file)).toMatch(
				/^\/sys\/fs\/cgroup\/(?:memory\.(?:max|current|swap.current)|cpu.max)$/
			);
			return files[String(file).split('/').at(-1)!] as any;
		});
		jest.spyOn(fs, 'statfs').mockResolvedValue({ bavail: available, bsize: 1 } as any);
	};
	it('accepts the reviewed 384 MiB / 0.5 CPU envelope with measured headroom', async () => {
		configure();
		await expect(assertMysqlWorkerResources('/tmp/private-fixture')).resolves.toBeUndefined();
	});
	it.each([
		{ 'memory.max': 'max' },
		{ 'memory.max': String(128 * MiB) },
		{ 'memory.current': String(350 * MiB) },
		{ 'memory.swap.current': '1' },
		{ 'cpu.max': '10000 100000' },
		{ 'cpu.max': 'invalid 100000' },
	])('refuses insufficient/unknown worker bounds without native output %o', async change => {
		configure(change);
		await expect(assertMysqlWorkerResources('/tmp/private-fixture')).rejects.toMatchObject({
			code: 'mysql-worker-resource-limit',
		});
	});
	it('reports private tmpfs exhaustion without exposing its path', async () => {
		configure({}, MiB);
		await expect(assertMysqlWorkerResources('/tmp/private-fixture')).rejects.toMatchObject({
			code: 'database-storage-full',
		});
	});
});
