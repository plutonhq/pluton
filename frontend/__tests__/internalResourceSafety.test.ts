import test from 'node:test';
import assert from 'node:assert/strict';
import { internalResourceSafety } from '../src/utils/internalResourceSafety.ts';

const MiB = 1024 ** 2;
const input = (): any => ({
   engine: 'mysql',
   bytes: MiB,
   maxSqlBytes: 128 * MiB,
   automatic: true,
   available: true,
   workloadBusy: false,
   resources: {
      status: 'measured',
      sample: {
         total: 8 * 1024 * MiB,
         available: 4096 * MiB,
         swapUsed: 0,
         pressure: 0,
         limit: 1024 * MiB,
         used: 128 * MiB,
         cgroupSwap: 0,
         cpuAvailable: 1,
         diskAvailable: 10 * 1024 * MiB,
         operatorTotal: 8 * 1024 * MiB,
         operatorAvailable: 4096 * MiB,
         operatorCpuAvailable: 4,
         operatorDiskAvailable: 10 * 1024 * MiB,
         operatorObservedAt: 1,
         operatorSwapUsed: 0,
         operatorCgroupSwap: 0,
         operatorPressure: 0,
      },
   },
});

test('resource warning is truthful: Ready, Warning, Blocked and Checking; no acknowledgement bypass', () => {
   const value = input();
   assert.equal(internalResourceSafety(value).state, 'ready');
   assert.equal(internalResourceSafety({ ...value, bytes: 16 * MiB }).state, 'warning');
   assert.equal(internalResourceSafety({ ...value, checking: true }).allowed, false);
   assert.equal(internalResourceSafety({ ...value, workloadBusy: true }).state, 'blocked');
   assert.equal(internalResourceSafety({ ...value, available: false }).allowed, false);
   assert.equal(internalResourceSafety({ ...value, bytes: 129 * MiB, maxSqlBytes: 448 * MiB, acknowledged: true } as any).allowed, false);
});

test('4 GiB is not unconditionally refused; 8 GiB or an ancestor cgroup can still lack headroom', () => {
   const value = input();
   Object.assign(value.resources.sample, { total: 4096 * MiB, operatorTotal: 4096 * MiB, available: 3000 * MiB, operatorAvailable: 3000 * MiB });
   assert.equal(internalResourceSafety(value).allowed, true);
   for (const bytes of [MiB, 16 * MiB, 96 * MiB]) {
      const constrained = input();
      Object.assign(constrained.resources.sample, { operatorTotal: 4096 * MiB, operatorAvailable: 2800 * MiB });
      assert.equal(internalResourceSafety({ ...constrained, bytes }).allowed, false);
      assert.match(internalResourceSafety({ ...constrained, bytes }).message, /operator cgroup/);
   }
   value.resources.sample.total = 8192 * MiB;
   value.resources.sample.available = 2800 * MiB;
   assert.equal(internalResourceSafety(value).allowed, false);
});

test('unknown, malformed, missing, CPU, pressure, storage and authoritative refusal all block', () => {
   for (const change of [
      { operatorObservedAt: 0 },
      { cpuAvailable: 0.5 },
      { operatorCpuAvailable: 1 },
      { pressure: 2 },
      { operatorPressure: 2 },
      { used: 900 * MiB },
      { cgroupSwap: 1 },
      { operatorCgroupSwap: 1 },
      { diskAvailable: 1024 },
      { operatorDiskAvailable: 2 * 1024 * MiB },
      { available: NaN },
   ]) {
      const value = input();
      Object.assign(value.resources.sample, change);
      assert.equal(internalResourceSafety(value).allowed, false, JSON.stringify(change));
   }
   const missing = input();
   delete missing.resources.sample.available;
   assert.equal(internalResourceSafety(missing).allowed, false);
   assert.equal(internalResourceSafety({ ...input(), admission: { status: 'refused', reason: 'operator-disk-reserve' } }).allowed, false);
   assert.equal(internalResourceSafety({ ...input(), resources: { status: 'unknown', sample: null } }).allowed, false);
});
