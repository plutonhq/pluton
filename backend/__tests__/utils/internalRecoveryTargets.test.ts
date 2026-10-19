import {
	assertInternalResources,
	internalResourceReason,
	InternalRecoveryTargets,
	mysqlWorkerReadiness,
} from '../../src/utils/internalRecoveryTargets';
import { recoveryPolicySchema } from '../../src/utils/recoveryTestPolicy';
const MiB = 1024 ** 2;
const healthy = {
	cpuAvailable: 1,
	total: 8192 * MiB,
	available: 4096 * MiB,
	swapUsed: 0,
	pressure: 0,
	limit: 2048 * MiB,
	used: 512 * MiB,
	cgroupSwap: 0,
	diskAvailable: 10240 * MiB,
};
describe('internal recovery admission and safe public configuration', () => {
	it('returns measured safe counters or Unknown; unknown cannot approve capacity', async () => {
		expect(
			(await new InternalRecoveryTargets(async () => healthy).resourceView('/fixture')).sample
		).toEqual(healthy);
		expect(
			(
				await new InternalRecoveryTargets(async () => {
					throw new Error('synthetic-private-value');
				}).resourceView('/fixture')
			).status
		).toBe('unknown');
		expect(
			(
				await new InternalRecoveryTargets(async () => ({
					...healthy,
					available: NaN,
				})).resourceView('/fixture')
			).sample
		).toBeNull();
	});
	it('explains resource refusal with closed categories, without raising the operator SQL budget', () => {
		expect(internalResourceReason(healthy, 272 * MiB, 128 * MiB)).toBe('operator-sql-budget');
		expect(internalResourceReason({ ...healthy, available: 2048 * MiB }, 10 * MiB, 128 * MiB)).toBe(
			'host-memory-headroom'
		);
		expect(internalResourceReason({ ...healthy, pressure: 2 }, 10 * MiB, 128 * MiB)).toBe(
			'memory-pressure'
		);
		expect(internalResourceReason({ ...healthy, diskAvailable: MiB }, 10 * MiB, 128 * MiB)).toBe(
			'staging-capacity'
		);
	});
	it('admits a bounded artifact only with measured host/server headroom', () => {
		expect(() => assertInternalResources(healthy, 272 * MiB, 384 * MiB)).not.toThrow();
	});
	it('reserves additional MySQL worker memory without changing native MariaDB/PostgreSQL admission', () => {
		const sample = { ...healthy, available: 2800 * MiB };
		expect(internalResourceReason(sample, MiB, 128 * MiB, 'mysql')).toBe('host-memory-headroom');
		for (const engine of ['mariadb', 'postgresql'] as const)
			expect(internalResourceReason(sample, MiB, 128 * MiB, engine)).toBeNull();
		expect(
			internalResourceReason({ ...sample, available: 2944 * MiB }, MiB, 128 * MiB, 'mysql')
		).toBeNull();
	});
	for (const change of [
		{ cpuAvailable: 0.5 },
		{ total: 3072 * MiB },
		{ available: 2048 * MiB },
		{ swapUsed: 129 * MiB },
		{ pressure: 1.1 },
		{ cgroupSwap: 1 },
		{ limit: 512 * MiB },
		{ limit: 0 },
		{ used: 1900 * MiB },
		{ diskAvailable: 1024 * MiB },
		{ available: NaN },
		{ pressure: -1 },
	]) {
		it(`refuses insufficient or unknown ${Object.keys(change)[0]}`, () => {
			expect(() =>
				assertInternalResources({ ...healthy, ...change }, 272 * MiB, 384 * MiB, 'mariadb')
			).toThrow('internal-resources-insufficient');
		});
	}
	it('4 GiB can pass with actual headroom; 8 GiB and constrained ancestor cgroups can still refuse', () => {
		expect(
			internalResourceReason(
				{ ...healthy, total: 4096 * MiB, available: 3000 * MiB },
				MiB,
				128 * MiB,
				'mysql'
			)
		).toBeNull();
		expect(
			internalResourceReason(
				{ ...healthy, total: 8192 * MiB, available: 2800 * MiB },
				MiB,
				128 * MiB,
				'mysql'
			)
		).toBe('host-memory-headroom');
		for (const bytes of [MiB, 16 * MiB, 96 * MiB])
			expect(
				internalResourceReason(
					{ ...healthy, operatorTotal: 4096 * MiB, operatorAvailable: 2800 * MiB },
					bytes,
					128 * MiB,
					'mysql'
				)
			).toBe('operator-memory-headroom');
		expect(
			internalResourceReason(
				{ ...healthy, operatorAvailable: 2800 * MiB },
				129 * MiB,
				128 * MiB,
				'mysql'
			)
		).toBe('operator-sql-budget');
	});
	it('rejects missing counters, CPU, pressure and disk reserve without applying root policy to Custom', () => {
		expect(internalResourceReason({} as any, MiB, 128 * MiB, 'mysql')).toBe('capacity-unknown');
		expect(
			internalResourceReason({ ...healthy, cpuAvailable: undefined }, MiB, 128 * MiB, 'mysql')
		).toBe('capacity-unknown');
		expect(
			internalResourceReason({ ...healthy, operatorCpuAvailable: 1 }, MiB, 128 * MiB, 'mysql')
		).toBe('operator-cpu-headroom');
		expect(
			internalResourceReason({ ...healthy, operatorPressure: 2 }, MiB, 128 * MiB, 'mysql')
		).toBe('memory-pressure');
		expect(
			internalResourceReason(
				{ ...healthy, operatorDiskAvailable: 2 * 1024 ** 3 },
				MiB,
				128 * MiB,
				'mysql',
				'provision'
			)
		).toBe('operator-disk-reserve');
		expect(
			internalResourceReason(
				{ ...healthy, operatorDiskAvailable: 2 * 1024 ** 3 },
				MiB,
				128 * MiB,
				'mysql',
				'import'
			)
		).toBeNull();
		expect(
			internalResourceReason(
				{ ...healthy, operatorAvailable: 1, operatorCpuAvailable: 0, operatorDiskAvailable: 0 },
				MiB,
				128 * MiB
			)
		).toBeNull();
	});
	it('MySQL refuses missing root capacity while old native engines remain compatible', async () => {
		const automatic: any = {
			capacity: async () => null,
			capability: async () => ({ available: true, maxSqlBytes: 128 * MiB }),
		};
		const targets = new InternalRecoveryTargets(async () => healthy, undefined, automatic);
		const entries: any = [{ bytes: MiB }];
		await expect(targets.preflight('mysql', entries, '/fixture')).rejects.toMatchObject({
			code: 'internal-resources-insufficient',
		});
		await expect(targets.preflight('mariadb', entries, '/fixture')).resolves.toBeUndefined();
		automatic.capacity = async () => ({
			total: 4096 * MiB,
			available: 2800 * MiB,
			swapUsed: 0,
			cgroupSwap: 0,
			pressure: 0,
			cpuAvailable: 4,
			diskAvailable: 10 * 1024 ** 3,
			observedAt: Date.now(),
		});
		expect((await targets.admission('mysql', entries, '/fixture')).reason).toBe(
			'operator-memory-headroom'
		);
	});
	for (const [bytes, cap] of [
		[0, 128],
		[-1, 128],
		[129 * MiB, 128 * MiB],
		[449 * MiB, 512 * MiB],
		[1.5, 128 * MiB],
	])
		it(`rejects invalid/oversized SQL budget ${bytes}`, () => {
			expect(() => assertInternalResources(healthy, bytes, cap)).toThrow(
				'internal-resources-insufficient'
			);
		});
	it('defaults to Custom; explicit MySQL Internal is valid policy, not provisioning approval', () => {
		expect(
			recoveryPolicySchema.parse({ enabled: false, databaseImport: 'required' }).targetModes
		).toBeUndefined();
		expect(
			recoveryPolicySchema.safeParse({
				enabled: false,
				databaseImport: 'required',
				targetModes: { mysql: 'internal' },
			}).success
		).toBe(true);
		expect(
			recoveryPolicySchema.safeParse({
				enabled: false,
				databaseImport: 'required',
				targetModes: { mariadb: 'internal', postgresql: 'custom' },
			}).success
		).toBe(true);
	});
	it('rechecks immediately before the durable provisioning request; stale earlier readiness cannot allocate', async () => {
		const automatic: any = {
			capability: async () => ({ available: true, maxSqlBytes: 128 * MiB }),
			capacity: async () => null,
			testing: jest.fn(),
			waitReady: jest.fn(),
		};
		const sample = jest.fn(async () => ({ ...healthy, available: 1 }));
		const targets = new InternalRecoveryTargets(sample, undefined, automatic);
		await expect(
			targets.prepare('mariadb', [{ bytes: MiB, engine: 'mariadb' } as any], {
				directory: '/fixture',
				testId: 'a'.repeat(24),
				snapshotId: 'b'.repeat(64),
				createdAt: Date.now(),
				signal: new AbortController().signal,
				stage: jest.fn(),
			})
		).rejects.toMatchObject({ code: 'internal-resources-insufficient' });
		expect(sample).toHaveBeenCalledTimes(1);
		expect(automatic.testing).not.toHaveBeenCalled();
		expect(automatic.waitReady).not.toHaveBeenCalled();
	});
	it('does not silently impose Internal CPU reservations on the separate Custom admission contract', () => {
		expect(internalResourceReason({ ...healthy, cpuAvailable: 0.5 }, MiB, 128 * MiB)).toBeNull();
		expect(internalResourceReason({ ...healthy, cpuAvailable: 0.5 }, MiB, 128 * MiB, 'mysql')).toBe(
			'cpu-headroom'
		);
	});
	it('missing administrator provisioning returns no credentials and never probes resources', async () => {
		const sample = jest.fn(),
			probe = jest.fn();
		const result = await new InternalRecoveryTargets(sample, probe).readiness();
		expect(result).toEqual(
			['mariadb', 'postgresql', 'mysql'].map(engine => ({
				engine,
				status: 'not_provisioned',
				mode: 'operator-managed',
			}))
		);
		expect(sample).not.toHaveBeenCalled();
		expect(probe).not.toHaveBeenCalled();
	});
	it('worker unavailable is explicit and independent of ordinary backups', async () => {
		const old = process.env.PLUTON_MYSQL_WORKER;
		delete process.env.PLUTON_MYSQL_WORKER;
		try {
			expect(await mysqlWorkerReadiness()).toBe('unavailable');
		} finally {
			if (old) process.env.PLUTON_MYSQL_WORKER = old;
		}
	});
});
