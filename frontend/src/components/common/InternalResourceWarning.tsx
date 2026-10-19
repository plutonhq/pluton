import type { RecoveryPreparation } from '../../@types/recoveryTests';
import type { ResourceSafety } from '../../utils/internalResourceSafety';
import { formatBytes } from '../../utils/helpers';
import classes from './InternalResourceWarning.module.scss';

/** Stable inline content, not a popup, polling hook or a percentage estimate. */
export default function InternalResourceWarning({
   id,
   safety,
   resources,
   workloadBusy,
}: {
   id: string;
   safety: ResourceSafety;
   resources: RecoveryPreparation['resources'];
   workloadBusy: boolean;
}) {
   const sample = resources.sample;
   const label = { ready: 'Ready', warning: 'Warning', blocked: 'Blocked', checking: 'Checking' }[safety.state];
   return (
      <section id={id} className={classes.panel} aria-label="Internal database resource safety" data-resource-state={safety.state}>
         <h4>Internal database resource warning</h4>
         <p className={classes.status} role="status" aria-live="polite" aria-atomic="true">
            <strong>{label}:</strong> {safety.message}
         </p>
         <p>
            Database recovery can consume substantial CPU, RAM, disk and temporary storage. A successful backup does not prove a native SQL import
            will fit.
         </p>
         <dl className={classes.metrics}>
            <dt>Detected engine</dt>
            <dd>{safety.engine}</dd>
            <dt>SQL artifact / configured import limit</dt>
            <dd>
               {formatBytes(safety.bytes)} / {formatBytes(safety.maxSqlBytes)}
            </dd>
            <dt>Measured host available RAM</dt>
            <dd>{sample ? `${formatBytes(sample.available)} / ${formatBytes(sample.total)} total` : 'Not verified'}</dd>
            <dt>Operator/cgroup available RAM</dt>
            <dd>
               {sample?.operatorAvailable !== undefined
                  ? `${formatBytes(sample.operatorAvailable)} / ${formatBytes(sample.operatorTotal || 0)} envelope`
                  : 'Not reported by this operator'}
            </dd>
            <dt>Required measured available RAM</dt>
            <dd>{safety.engine === 'mysql' ? '2,944 MiB (includes worker headroom)' : '2,560 MiB'}</dd>
            <dt>CPU capacity / current server memory</dt>
            <dd>
               {sample ? `${sample.cpuAvailable ?? 'Unknown'} CPU · ${formatBytes(sample.used)} / ${formatBytes(sample.limit)}` : 'Not verified'}
            </dd>
            <dt>Memory pressure / swap</dt>
            <dd>
               {sample
                  ? `${sample.pressure}% avg10 · host ${formatBytes(sample.swapUsed)} · cgroup ${formatBytes(sample.cgroupSwap)}`
                  : 'Not verified'}
            </dd>
            <dt>Free staging / host recovery storage</dt>
            <dd>
               {sample
                  ? `${formatBytes(sample.diskAvailable)} / ${sample.operatorDiskAvailable !== undefined ? formatBytes(sample.operatorDiskAvailable) : 'Not reported'}`
                  : 'Not verified'}
            </dd>
            <dt>Enforced database container limits</dt>
            <dd>2 GiB RAM · 1 CPU · 128 PIDs · 128 MiB temporary filesystem</dd>
            <dt>Fixed database storage quota</dt>
            <dd>2 GiB ext4; preallocated and owner-verified, not unbounded storage</dd>
            {safety.engine === 'mysql' && (
               <>
                  <dt>Separate Oracle worker limits</dt>
                  <dd>384 MiB RAM · 0.5 CPU · 64 PIDs · 160 MiB temporary filesystem</dd>
               </>
            )}
            <dt>Current workload reservation</dt>
            <dd>{workloadBusy ? 'Busy — blocked by other work' : 'No competing workload reported; reserved again at execution'}</dd>
            <dt>Internal execution allowed now</dt>
            <dd>{safety.allowed ? 'Yes, subject to fresh backend/root checks and explicit acknowledgement' : 'No — confirmation disabled'}</dd>
         </dl>
         <p>
            Limits are mandatory. Acknowledgement cannot override a refusal. Resource alarms never authorize deletion of an already validated retained
            database or control unrelated workloads.
         </p>
      </section>
   );
}
