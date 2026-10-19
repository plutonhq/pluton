import type { RemoteBackupLifecycle, RemoteDatabaseBackup } from '../@types/plans';

export function lifecycleDatabases(value?: RemoteBackupLifecycle): RemoteDatabaseBackup[] {
   return value?.version === 2 ? value.databases || [] : value?.database ? [value.database] : [];
}

/** Reordering moves whole entries, including their stable server ID and unsaved password. */
export function reorderLifecycleDatabase(value: RemoteBackupLifecycle, from: number, to: number): RemoteBackupLifecycle {
   const databases = [...lifecycleDatabases(value)];
   if (from < 0 || to < 0 || from >= databases.length || to >= databases.length) return value;
   databases.splice(to, 0, databases.splice(from, 1)[0]);
   return { version: 2, databases, preHook: value.preHook, postHook: value.postHook };
}

/** UX only; server and agent enforce independent, stricter execution boundaries. */
export function remoteLifecycleValidation(value?: RemoteBackupLifecycle): string | undefined {
   if (!value) return;
   const databases = lifecycleDatabases(value);
   if (databases.length > 8) return 'A plan supports at most 8 databases.';
   const filenames = databases.map((db) => db.dumpFilename.normalize('NFKC').toLowerCase());
   const ids = databases.flatMap((db) => (db.databaseId ? [db.databaseId] : []));
   if (new Set(filenames).size !== filenames.length || new Set(ids).size !== ids.length)
      return 'Every database needs a unique entry identity and dump filename (case-insensitive).';
   for (const db of databases) {
      if (!db.host || !db.database || !db.username || (!db.password && !db.passwordConfigured))
         return 'Database host, name, username and password are required.';
      if (!/^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$/.test(db.database) || !/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,95}\.sql$/.test(db.dumpFilename))
         return 'Use a safe database name and a simple .sql filename (no directories).';
      if (db.tls === 'local' && !['localhost', '127.0.0.1', '::1'].includes(db.host))
         return 'Unencrypted database transport is limited to loopback hosts.';
      if (
         !Number.isInteger(db.port) ||
         db.port < 1 ||
         db.port > 65535 ||
         !Number.isInteger(db.timeoutSeconds) ||
         db.timeoutSeconds < 1 ||
         db.timeoutSeconds > 3600 ||
         db.maxDumpBytes < 1024 ||
         db.maxDumpBytes > 100 * 1024 ** 3
      )
         return 'Database port, timeout or dump size limit is invalid.';
      if (
         db.engine === 'postgresql' &&
         (db.database.length > 63 || db.username.length > 63 || db.includeRoutines || db.includeEvents || /[\r\n\0]/.test(db.password || ''))
      )
         return 'PostgreSQL needs simple identifiers, a single-line password and no MySQL-only options.';
   }
   for (const hook of [value.preHook, value.postHook]) {
      if (!hook) continue;
      if (
         !/^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,99}$/.test(hook.id) ||
         hook.timeoutSeconds < 1 ||
         hook.timeoutSeconds > 300 ||
         hook.args.length > 16 ||
         hook.args.some(
            (arg) => !/^[A-Za-z0-9_.,:@/+ =-]{0,128}$/.test(arg) || arg.startsWith('-') || arg.startsWith('/') || arg.split('/').includes('..'),
         )
      )
         return 'Use a deployed hook identifier, safe fixed arguments and a timeout of 1–300 seconds.';
   }
}
