import { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import type { RecoveryEngine, RecoveryPolicy, RecoveryTarget } from '../../../@types/recoveryTests';
import { useRecoveryConfiguration, useRecoveryTests, useSaveRecoveryPolicy, useSaveRecoveryTarget } from '../../../services/recoveryTests';
import { recoveryTargetChoices, recoveryTargetMode, internalStatus } from '../../../utils/recoveryTargetModes';
import classes from './RecoveryTesting.module.scss';

function TargetEditor({ engine, saved, planId }: { engine: RecoveryEngine; saved?: RecoveryTarget; planId: string }) {
   const [target, setTarget] = useState(
      saved || {
         engine,
         host: '',
         port: engine === 'postgresql' ? 5432 : 3306,
         username: '',
         tls: 'verify-identity' as const,
         enabled: false,
         dedicated: true as const,
         passwordConfigured: false,
      },
   );
   const [password, setPassword] = useState('');
   const [confirmed, setConfirmed] = useState(!!saved);
   const save = useSaveRecoveryTarget(planId);
   useEffect(() => {
      if (saved) setTarget(saved);
   }, [saved]);
   const submit = () => {
      const { passwordConfigured: _passwordConfigured, ...config } = target;
      save.mutate(
         { ...config, ...(password ? { password } : {}) },
         {
            onSuccess: () => {
               setPassword('');
               toast.success('Separate recovery target saved.');
            },
            onError: (error) => toast.error(error.message),
         },
      );
   };
   return (
      <div className={classes.card}>
         <h4>{engine} recovery-only target</h4>
         <label>
            <input type="checkbox" checked={target.enabled} onChange={(e) => setTarget({ ...target, enabled: e.target.checked })} /> Enable this
            recovery target
         </label>
         <div className={classes.grid}>
            <label>
               Host
               <input value={target.host} onChange={(e) => setTarget({ ...target, host: e.target.value })} autoComplete="off" />
            </label>
            <label>
               Port
               <input
                  type="number"
                  min="1"
                  max="65535"
                  value={target.port}
                  onChange={(e) => setTarget({ ...target, port: Number(e.target.value) })}
               />
            </label>
            <label>
               Recovery username
               <input value={target.username} onChange={(e) => setTarget({ ...target, username: e.target.value })} autoComplete="off" />
            </label>
            <label>
               Write-only recovery password {target.passwordConfigured ? '(saved)' : '(required)'}
               <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
            </label>
            <label>
               Transport
               <select value={target.tls} onChange={(e) => setTarget({ ...target, tls: e.target.value as RecoveryTarget['tls'] })}>
                  <option value="verify-identity">Verified TLS (remote)</option>
                  <option value="local">Explicit loopback local target</option>
               </select>
            </label>
         </div>
         <label>
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> I confirm this is dedicated recovery
            infrastructure, not production, with the required recovery-only marker and restricted grants.
         </label>
         <button type="button" onClick={submit} disabled={!confirmed || !target.host || !target.username || save.isPending}>
            Save {engine} recovery target
         </button>
      </div>
   );
}

export default function RecoverySettings({ planId }: { planId?: string }) {
   const configuration = useRecoveryConfiguration(planId);
   const save = useSaveRecoveryPolicy(planId || '');
   const history = useRecoveryTests(planId || '', !!planId);
   const [policy, setPolicy] = useState<RecoveryPolicy>(() => configuration.data?.policy || { enabled: false, databaseImport: 'disabled' });
   useEffect(() => {
      if (configuration.data) setPolicy(configuration.data.policy);
   }, [configuration.data]);
   const automatic = configuration.data?.internalTargets?.some((target) => target.mode === 'automatic') === true;
   if (!planId) return <p>Save the managed plan first, then configure Recovery Testing here.</p>;
   return (
      <div className={classes.panel}>
         <h3>Recovery Testing</h3>
         <p>
            Snapshot → private server staging → validation → cleanup. No source agent contact or production restore. Settings below save separately
            from the plan form.
         </p>
         {configuration.isLoading ? (
            <p>Loading…</p>
         ) : configuration.error ? (
            <p role="alert">{configuration.error.message}</p>
         ) : (
            <>
               <label>
                  <input type="checkbox" checked={policy.enabled} onChange={(e) => setPolicy({ ...policy, enabled: e.target.checked })} /> After every
                  successful backup (opt-in)
               </label>
               <p>Filesystem validation is mandatory. SQL artifact size and SHA-256 checks run whenever completion metadata exists.</p>
               <label>
                  Database import validation
                  <select
                     value={policy.databaseImport}
                     onChange={(e) => setPolicy({ ...policy, databaseImport: e.target.value as RecoveryPolicy['databaseImport'] })}
                  >
                     <option value="disabled">Disabled — artifact-only validation, with warning</option>
                     <option value="required">Required — all databases must import</option>
                  </select>
               </label>
               <button
                  type="button"
                  disabled={save.isPending}
                  onClick={() =>
                     save.mutate(
                        { enabled: policy.enabled, databaseImport: policy.databaseImport, targetModes: policy.targetModes },
                        { onSuccess: () => toast.success('Recovery policy saved.'), onError: (error) => toast.error(error.message) },
                     )
                  }
               >
                  Save recovery policy
               </button>
               <p>
                  Recovery credentials are separate from backup credentials. Administrator-installed clients and a database-side{' '}
                  <code>pluton_recovery_guard</code> marker are required. MariaDB/MySQL keep the original logical name and refuse an existing
                  database; PostgreSQL uses a fresh database. See <code>docs/PHASE6_RECOVERY_TESTING.md</code> before provisioning.
               </p>
               {Object.values(policy.targetModes || {}).includes('internal') && (
                  <p role="status">
                     {automatic
                        ? 'Internal targets use the automatic host operator.'
                        : 'Internal targets require manual operator activation/deactivation.'}{' '}
                     Turn off after-backup automation and save the policy. Only one Internal engine/test can run; other engines must remain Custom.
                  </p>
               )}
               {(['mariadb', 'mysql', 'postgresql'] as const).map((engine) => (
                  <div key={engine} className={classes.card}>
                     <h4>{engine} Recovery Target</h4>
                     {engine === 'mysql' && !automatic ? (
                        <p>
                           Custom only · Oracle MySQL worker:{' '}
                           {configuration.data?.mysqlWorker === 'ready' ? 'Ready (target preflight required)' : 'Unavailable'}
                        </p>
                     ) : (
                        <label>
                           Recovery Target
                           <select
                              value={recoveryTargetMode(policy, engine)}
                              onChange={(e) =>
                                 setPolicy({ ...policy, targetModes: { ...policy.targetModes, [engine]: e.target.value as 'internal' | 'custom' } })
                              }
                           >
                              {recoveryTargetChoices(engine, automatic).map((mode) => (
                                 <option key={mode} value={mode}>
                                    {mode === 'internal' ? 'Internal' : 'Custom'}
                                 </option>
                              ))}
                           </select>
                        </label>
                     )}
                     {recoveryTargetMode(policy, engine) === 'custom' ? (
                        <TargetEditor
                           engine={engine}
                           planId={planId}
                           saved={configuration.data?.targets.find((target) => target.engine === engine)}
                        />
                     ) : (
                        <>
                           <p role="status">
                              {internalStatus(
                                 configuration.data?.internalTargets?.find((target) => target.engine === engine),
                                 history.data?.find((test) => test.result?.internalEngine === engine),
                              )}
                           </p>
                           {history.data?.find((test) => test.result?.internalEngine === engine)?.failureCode ===
                              'internal-resources-insufficient' && (
                              <p>
                                 Last admission: Insufficient Resources. No SQL was imported. Any pending container cleanup still requires operator
                                 action.
                              </p>
                           )}
                           <p>
                              {automatic
                                 ? 'The host operator provisions a disposable target after admission and removes it after owned SQL cleanup.'
                                 : `Operator-managed Compose, not automatic container startup/shutdown. Activate the approved ${engine} target before Run Recovery Test; deactivate it after testing.`}{' '}
                              SQL integrity, verified TLS, dedicated marker, restricted permissions and resource preflight are mandatory. The result
                              cannot be Passed until cleanup is confirmed.
                           </p>
                           <p>
                              Provisioning: <code>docs/MANAGED_INTERNAL_RECOVERY_TESTING_REPORT.md</code>. No administrator credentials are stored in
                              this form.
                           </p>
                           <button type="button" onClick={() => void configuration.refetch()}>
                              Refresh target readiness
                           </button>
                        </>
                     )}
                  </div>
               ))}
            </>
         )}
      </div>
   );
}
