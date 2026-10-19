import type { RecoveryEngine, RecoveryPreparation } from '../@types/recoveryTests';

export type ResourceSafety = {
   state: 'ready' | 'warning' | 'blocked' | 'checking';
   allowed: boolean;
   message: string;
   engine: RecoveryEngine;
   bytes: number;
   maxSqlBytes: number;
};
const MiB = 1024 ** 2;
export const resourceReasonMessage = (reason?: string) =>
   (
      ({
         'capacity-unknown': 'Capacity could not be verified. Refresh the checks or ask the host operator.',
         'operator-capacity-unknown': 'Fresh host-operator resource measurements are unavailable. Ask the operator to check the lifecycle service.',
         'cpu-headroom': 'The Pluton cgroup needs at least 1 CPU. Ask the operator to review its CPU limit.',
         'operator-cpu-headroom': 'The host/operator cgroup needs at least 2 CPUs of capacity.',
         'operator-sql-budget':
            'SQL exceeds the configured Internal import limit. Use an independently approved recovery workflow; acknowledgement cannot raise this limit.',
         'host-memory-total': 'Effective memory capacity does not satisfy the established minimum.',
         'host-memory-headroom':
            'Available RAM is below the required headroom. Wait for other work to finish or ask the operator to review capacity.',
         'operator-memory-total': 'The host-operator cgroup memory envelope is below the established minimum.',
         'operator-memory-headroom':
            'Available memory in the host-operator cgroup is below the required headroom, even if the physical host has free RAM.',
         'swap-in-use': 'Swap usage exceeds policy. Wait for pressure to settle or ask the operator to review memory capacity.',
         'memory-pressure': 'Measured memory pressure exceeds policy. No import will start until it settles.',
         'server-cgroup-headroom': 'The Pluton container has insufficient memory headroom. Ask the operator to review its limit and current usage.',
         'staging-capacity': 'Free staging storage is below the required reserve. Ask the operator to review available disk space.',
         'operator-disk-reserve':
            'The host recovery-storage reserve is insufficient. Provisioning requires 3 GiB free before allocating the fixed 2 GiB image.',
         'workload-busy': 'Another backup, restore or recovery operation holds the shared workload reservation. Retry when it finishes.',
         'target-unavailable': 'The approved Internal operator/worker is unavailable. No manual or Custom fallback will be selected automatically.',
      }) as Record<string, string>
   )[reason || 'capacity-unknown'] ||
   'A mandatory resource or operator requirement is not satisfied. Refresh the checks; acknowledgement cannot bypass it.';

export function internalResourceSafety(input: {
   engine: RecoveryEngine;
   bytes: number;
   maxSqlBytes: number;
   resources: RecoveryPreparation['resources'];
   automatic: boolean;
   available: boolean;
   workloadBusy: boolean;
   checking?: boolean;
   admission?: { status: 'admitted' | 'refused'; reason?: string };
}): ResourceSafety {
   const max = input.engine === 'mysql' ? Math.min(input.maxSqlBytes, 128 * MiB) : input.maxSqlBytes;
   const result = (state: ResourceSafety['state'], message: string): ResourceSafety => ({
      state,
      allowed: state === 'ready' || state === 'warning',
      message,
      engine: input.engine,
      bytes: input.bytes,
      maxSqlBytes: max,
   });
   if (input.checking) return result('checking', 'Verifying current resources. Confirmation remains disabled while checks run.');
   const blocked = (reason?: string) => result('blocked', resourceReasonMessage(reason));
   if (!Number.isSafeInteger(input.bytes) || input.bytes <= 0 || !Number.isSafeInteger(max) || max <= 0 || input.bytes > max)
      return blocked('operator-sql-budget');
   if (!input.available) return blocked('target-unavailable');
   if (input.workloadBusy) return blocked('workload-busy');
   const sample = input.resources.sample;
   if (
      input.resources.status !== 'measured' ||
      !sample ||
      ['total', 'available', 'swapUsed', 'pressure', 'limit', 'used', 'cgroupSwap', 'diskAvailable'].some(
         (key) => !Number.isFinite(sample[key as keyof typeof sample]) || sample[key as keyof typeof sample]! < 0,
      ) ||
      Object.values(sample).some((n) => !Number.isFinite(n) || n < 0)
   )
      return blocked('capacity-unknown');
   if (input.engine === 'mysql' && (!input.automatic || !sample.operatorObservedAt)) return blocked('operator-capacity-unknown');
   if (sample.cpuAvailable === undefined || sample.cpuAvailable < 1) return blocked('cpu-headroom');
   if (sample.operatorCpuAvailable !== undefined && sample.operatorCpuAvailable < 2) return blocked('operator-cpu-headroom');
   if (sample.total < 3800 * MiB) return blocked('host-memory-total');
   if (sample.operatorTotal !== undefined && sample.operatorTotal < 3800 * MiB) return blocked('operator-memory-total');
   const headroom = (input.engine === 'mysql' ? 2944 : 2560) * MiB;
   if (sample.available < headroom) return blocked('host-memory-headroom');
   if (sample.operatorAvailable !== undefined && sample.operatorAvailable < headroom) return blocked('operator-memory-headroom');
   if (sample.swapUsed > 128 * MiB || sample.cgroupSwap > 0 || (sample.operatorSwapUsed || 0) > 128 * MiB || (sample.operatorCgroupSwap || 0) > 0)
      return blocked('swap-in-use');
   if (sample.pressure > 1 || (sample.operatorPressure || 0) > 1) return blocked('memory-pressure');
   if (sample.limit < 768 * MiB || sample.used > sample.limit * 0.85) return blocked('server-cgroup-headroom');
   if (sample.diskAvailable < input.bytes + 2 * 1024 ** 3) return blocked('staging-capacity');
   if (sample.operatorDiskAvailable !== undefined && sample.operatorDiskAvailable < 3 * 1024 ** 3) return blocked('operator-disk-reserve');
   if (input.admission?.status === 'refused') return blocked(input.admission.reason);
   if (input.bytes >= 8 * MiB || Math.min(sample.available, sample.operatorAvailable ?? sample.available) < headroom + 512 * MiB)
      return result(
         'warning',
         'Current measurements satisfy admission, but this workload may be resource-intensive. Hard limits remain enforced before and during import.',
      );
   return result('ready', 'Current measured resources satisfy admission. The backend and host operator will recheck before execution.');
}
