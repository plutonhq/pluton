import type { RemoteBackupLifecycle, RemoteDatabaseBackup, RemoteLifecycleHook } from '../../../@types/plans';
import { useRef } from 'react';
import { lifecycleDatabases, reorderLifecycleDatabase } from '../../../utils/remoteLifecycle';
import { createTemporaryId } from '../../../utils/temporaryId';
import classes from './PlanSettings.module.scss';
import styles from './PlanRemoteLifecycleSettings.module.scss';

const defaultDatabase: RemoteDatabaseBackup = {
   engine: 'mariadb',
   host: 'localhost',
   port: 3306,
   tls: 'verify-identity',
   database: '',
   username: '',
   dumpFilename: 'app.sql',
   timeoutSeconds: 900,
   maxDumpBytes: 10 * 1024 ** 3,
   includeRoutines: false,
   includeEvents: false,
};

export default function PlanRemoteLifecycleSettings({
   value = { version: 2, databases: [] },
   onUpdate,
}: {
   value?: RemoteBackupLifecycle;
   onUpdate: (value: RemoteBackupLifecycle) => void;
}) {
   const databases = lifecycleDatabases(value);
   const uiKeys = useRef(new WeakMap<RemoteDatabaseBackup, string>());
   const cardKey = (db: RemoteDatabaseBackup) => {
      if (db.databaseId) return db.databaseId;
      if (!uiKeys.current.has(db)) uiKeys.current.set(db, createTemporaryId());
      return uiKeys.current.get(db)!;
   };
   const updateDatabases = (entries: RemoteDatabaseBackup[]) =>
      onUpdate({ version: 2, databases: entries, preHook: value.preHook, postHook: value.postHook });
   const addDatabase = () => {
      let ordinal = 1;
      const filename = () => (ordinal === 1 ? 'app.sql' : `app-${ordinal}.sql`);
      while (databases.some((db) => db.dumpFilename.toLowerCase() === filename())) ordinal++;
      updateDatabases([...databases, { ...defaultDatabase, dumpFilename: filename() }]);
   };
   const updateDatabase = (index: number, patch: Partial<RemoteDatabaseBackup>) => {
      const next = { ...databases[index], ...patch };
      uiKeys.current.set(next, cardKey(databases[index]));
      updateDatabases(databases.map((db, ordinal) => (ordinal === index ? next : db)));
   };
   const updateHook = (key: 'preHook' | 'postHook', patch?: Partial<RemoteLifecycleHook>) =>
      onUpdate({
         version: 2,
         databases,
         preHook: value.preHook,
         postHook: value.postHook,
         [key]: patch === undefined ? undefined : { id: '', args: [], timeoutSeconds: 60, ...value[key], ...patch },
      });
   return (
      <div className={styles.lifecycle}>
         <h3>Database Backup</h3>
         <p>
            One plan represents one application/workload. All database dumps and application files share one snapshot. Dumps run sequentially, not as
            a distributed transaction.
         </p>
         <label>
            <input type="checkbox" checked={databases.length > 0} onChange={(e) => (e.target.checked ? addDatabase() : updateDatabases([]))} /> Enable
            database backup
         </label>
         {databases.map((db, index) => {
            const update = (patch: Partial<RemoteDatabaseBackup>) => updateDatabase(index, patch);
            return (
               <section className={styles.card} key={cardKey(db)}>
                  <h4>
                     Database {index + 1}: {db.engine} — {db.database || 'New database'}
                  </h4>
                  <div className={styles.actions}>
                     <button type="button" disabled={index === 0} onClick={() => onUpdate(reorderLifecycleDatabase(value, index, index - 1))}>
                        Move up
                     </button>
                     <button
                        type="button"
                        disabled={index === databases.length - 1}
                        onClick={() => onUpdate(reorderLifecycleDatabase(value, index, index + 1))}
                     >
                        Move down
                     </button>
                     <button type="button" onClick={() => updateDatabases(databases.filter((_entry, ordinal) => ordinal !== index))}>
                        Remove database
                     </button>
                  </div>
                  <div className={styles.grid}>
                     <label>
                        Engine
                        <select
                           value={db.engine}
                           onChange={(e) => {
                              const engine = e.target.value as RemoteDatabaseBackup['engine'];
                              update({
                                 engine,
                                 port: engine === 'postgresql' ? 5432 : 3306,
                                 ...(engine === 'postgresql' ? { includeRoutines: false, includeEvents: false } : {}),
                              });
                           }}
                        >
                           <option value="mariadb">MariaDB (mariadb-dump)</option>
                           <option value="mysql">MySQL (mysqldump)</option>
                           <option value="postgresql">PostgreSQL (pg_dump)</option>
                        </select>
                     </label>
                     <label>
                        Host
                        <input value={db.host} onChange={(e) => update({ host: e.target.value })} />
                     </label>
                     <label>
                        Port
                        <input type="number" min={1} max={65535} value={db.port} onChange={(e) => update({ port: Number(e.target.value) })} />
                     </label>
                     <label>
                        Database
                        <input value={db.database} autoComplete="off" onChange={(e) => update({ database: e.target.value })} />
                     </label>
                     <label>
                        Username
                        <input value={db.username} autoComplete="off" onChange={(e) => update({ username: e.target.value })} />
                     </label>
                     <label>
                        {db.passwordConfigured ? 'Replace password (blank keeps saved secret)' : 'Password'}
                        <input
                           type="password"
                           autoComplete="new-password"
                           value={db.password || ''}
                           placeholder={db.passwordConfigured ? 'Password saved — never displayed' : 'Required'}
                           onChange={(e) => update({ password: e.target.value || undefined })}
                        />
                     </label>
                     <label>
                        Dump filename
                        <input value={db.dumpFilename} onChange={(e) => update({ dumpFilename: e.target.value })} />
                     </label>
                     <label>
                        Dump timeout (seconds)
                        <input
                           type="number"
                           min={1}
                           max={3600}
                           value={db.timeoutSeconds}
                           onChange={(e) => update({ timeoutSeconds: Number(e.target.value) })}
                        />
                     </label>
                     <label>
                        Maximum dump size (GiB)
                        <input
                           type="number"
                           min={1}
                           max={100}
                           value={db.maxDumpBytes / 1024 ** 3}
                           onChange={(e) => update({ maxDumpBytes: Number(e.target.value) * 1024 ** 3 })}
                        />
                     </label>
                     <label>
                        Database transport
                        <select value={db.tls} onChange={(e) => update({ tls: e.target.value as RemoteDatabaseBackup['tls'] })}>
                           <option value="verify-identity">TLS: verify certificate and hostname</option>
                           <option value="local">Loopback-only TCP (localhost / 127.0.0.1 / ::1)</option>
                        </select>
                     </label>
                     {db.engine !== 'postgresql' && (
                        <label>
                           <input type="checkbox" checked={db.includeRoutines} onChange={(e) => update({ includeRoutines: e.target.checked })} />{' '}
                           Include routines (extra DB privileges)
                        </label>
                     )}
                     {db.engine !== 'postgresql' && (
                        <label>
                           <input type="checkbox" checked={db.includeEvents} onChange={(e) => update({ includeEvents: e.target.checked })} /> Include
                           events (extra DB privileges)
                        </label>
                     )}
                  </div>
                  <p className={classes.fieldNotice}>
                     Snapshot path: /pluton/database/{db.dumpFilename}.
                     {db.engine === 'postgresql'
                        ? ' Remote TLS requires a trusted system CA and pg_dump compatible with the server major version.'
                        : ' Single-transaction consistency requires InnoDB and no concurrent schema changes.'}
                  </p>
               </section>
            );
         })}
         {databases.length > 0 && (
            <button type="button" disabled={databases.length >= 8} onClick={addDatabase}>
               + Add database ({databases.length}/8)
            </button>
         )}
         <h3>Lifecycle Hooks</h3>
         <p>
            Optional administrator-deployed executables in /etc/pluton-agent/hooks. No inline shell, sudo, secret arguments, or arbitrary executable
            paths. Hooks run as the agent in its private job workspace.
         </p>
         {(['preHook', 'postHook'] as const).map((key) => (
            <div key={key} className={styles.hook}>
               <label>
                  <input type="checkbox" checked={!!value[key]} onChange={(e) => updateHook(key, e.target.checked ? {} : undefined)} />{' '}
                  {key === 'preHook' ? 'Pre-backup hook (failure blocks backup)' : 'Post-backup hook (always attempted; failures are warnings)'}
               </label>
               {value[key] && (
                  <div className={styles.grid}>
                     <label>
                        Hook identifier
                        <input value={value[key].id} placeholder="prepare-app" onChange={(e) => updateHook(key, { id: e.target.value })} />
                     </label>
                     <label>
                        Fixed non-secret arguments (one per line)
                        <textarea
                           value={value[key].args.join('\n')}
                           onChange={(e) => updateHook(key, { args: e.target.value ? e.target.value.split('\n') : [] })}
                        />
                     </label>
                     <label>
                        Timeout (seconds)
                        <input
                           type="number"
                           min={1}
                           max={300}
                           value={value[key].timeoutSeconds}
                           onChange={(e) => updateHook(key, { timeoutSeconds: Number(e.target.value) })}
                        />
                     </label>
                  </div>
               )}
            </div>
         ))}
         <p>
            Pre and post output is discarded. Post runs after success, failure, or cancellation. Cleanup warnings do not change a completed snapshot
            into a failed backup.
         </p>
      </div>
   );
}
