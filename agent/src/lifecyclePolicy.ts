import {
  accessSync,
  constants,
  lstatSync,
  realpathSync,
  readdirSync,
} from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export type DatabaseEngine = "mysql" | "mariadb" | "postgresql";
export type DatabaseBackup = {
  databaseId?: string;
  engine: DatabaseEngine;
  host: string;
  port: number;
  database: string;
  tls: "verify-identity" | "local";
  username: string;
  password: string;
  dumpFilename: string;
  timeoutSeconds: number;
  maxDumpBytes: number;
  includeRoutines: boolean;
  includeEvents: boolean;
};
export type LifecycleHook = {
  id: string;
  args: string[];
  timeoutSeconds: number;
};
export type BackupLifecycle = {
  version: 1 | 2;
  database?: DatabaseBackup;
  databases?: DatabaseBackup[];
  preHook?: LifecycleHook;
  postHook?: LifecycleHook;
};
export type LifecycleStage =
  | "lifecycle-validation"
  | "workspace-creation"
  | "pre-backup"
  | "database-dump"
  | "database-dump-validation"
  | "snapshot-confirmation"
  | "post-backup";
export type LifecycleFailureCode =
  | "lifecycle-invalid"
  | "workspace-failed"
  | "database-tool-unavailable"
  | "database-client-missing"
  | "database-client-incompatible"
  | "database-tls-verification-failed"
  | "database-output-empty"
  | "database-auth-failed"
  | "database-insufficient-privileges"
  | "database-unavailable"
  | "database-invalid-configuration"
  | "database-dump-failed"
  | "database-dump-timeout"
  | "database-dump-output-limit"
  | "database-dump-invalid"
  | "hook-invalid"
  | "hook-failed"
  | "hook-timeout"
  | "hook-output-limit"
  | "snapshot-confirmation-failed";
export type LifecycleWarning = {
  stage: "post-backup" | "cleanup";
  code:
    | "hook-invalid"
    | "hook-failed"
    | "hook-timeout"
    | "hook-output-limit"
    | "cleanup-failed";
};
export type LifecycleReport = {
  warnings: LifecycleWarning[];
  database?: { path: string; bytes: number; sha256: string };
  databases?: DatabaseArtifact[];
};
export type DatabaseArtifact = {
  databaseId: string;
  engine: DatabaseEngine;
  database: string;
  path: string;
  bytes: number;
  sha256: string;
};
export type DatabaseCheckpoint = {
  databaseId?: string;
  engine: DatabaseEngine;
  ordinal: number;
  count: number;
};

export function lifecycleDatabases(
  lifecycle: BackupLifecycle,
): DatabaseBackup[] {
  return lifecycle.version === 2
    ? lifecycle.databases || []
    : lifecycle.database
      ? [lifecycle.database]
      : [];
}
export type LifecycleCheckpoint =
  | "pre-backup-started"
  | "database-dump-started"
  | "database-dump-completed"
  | "backup-started"
  | "backup-completed"
  | "post-backup-started"
  | "cleanup-completed"
  | "cleanup-warning";

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid lifecycle configuration.");
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new Error("Invalid lifecycle configuration.");
}
function text(value: unknown, pattern: RegExp, max: number): string {
  if (typeof value !== "string" || value.length > max || !pattern.test(value))
    throw new Error("Invalid lifecycle configuration.");
  return value;
}
function integer(value: unknown, min: number, max: number): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  )
    throw new Error("Invalid lifecycle configuration.");
  return value;
}
function bool(value: unknown): boolean {
  if (typeof value !== "boolean")
    throw new Error("Invalid lifecycle configuration.");
  return value;
}
function hook(value: unknown): LifecycleHook {
  const input = record(value);
  keys(input, ["id", "args", "timeoutSeconds"]);
  if (!Array.isArray(input.args) || input.args.length > 16)
    throw new Error("Invalid lifecycle configuration.");
  return {
    id: text(input.id, /^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/, 100),
    args: input.args.map((value) => {
      const arg = text(value, /^[A-Za-z0-9_.,:@/+ =-]*$/, 128);
      if (
        arg.startsWith("-") ||
        arg.startsWith("/") ||
        arg.split("/").includes("..")
      )
        throw new Error("Invalid hook argument.");
      return arg;
    }),
    timeoutSeconds: integer(input.timeoutSeconds, 1, 300),
  };
}

/** Independent agent boundary: signed payloads still cannot choose commands/options. */
export function parseBackupLifecycle(value: unknown): BackupLifecycle {
  const input = record(value);
  if (input.version !== 1 && input.version !== 2)
    throw new Error("Invalid lifecycle version.");
  keys(
    input,
    input.version === 1
      ? ["version", "database", "preHook", "postHook"]
      : ["version", "databases", "preHook", "postHook"],
  );
  if (
    input.version === 2 &&
    (!Array.isArray(input.databases) || input.databases.length > 8)
  )
    throw new Error("Invalid database collection.");
  const output: BackupLifecycle = { version: input.version };
  const entries =
    input.version === 2
      ? (input.databases as unknown[])
      : input.database === undefined
        ? []
        : [input.database];
  const databases: DatabaseBackup[] = [];
  for (const entry of entries) {
    const db = record(entry);
    keys(db, [
      ...(input.version === 2 ? ["databaseId"] : []),
      "engine",
      "host",
      "port",
      "tls",
      "database",
      "username",
      "password",
      "dumpFilename",
      "timeoutSeconds",
      "maxDumpBytes",
      "includeRoutines",
      "includeEvents",
    ]);
    if (
      db.engine !== "mysql" &&
      db.engine !== "mariadb" &&
      !(input.version === 2 && db.engine === "postgresql")
    )
      throw new Error("Invalid database engine.");
    if (db.tls !== "verify-identity" && db.tls !== "local")
      throw new Error("Invalid database TLS policy.");
    if (
      db.tls === "local" &&
      !["localhost", "127.0.0.1", "::1"].includes(String(db.host))
    )
      throw new Error("Plaintext database transport is loopback-only.");
    const password = text(db.password, /^[^\0]+$/, 1024);
    if (
      db.engine === "postgresql" &&
      (/[\r\n]/.test(password) ||
        db.includeEvents !== false ||
        db.includeRoutines !== false)
    )
      throw new Error("Invalid PostgreSQL configuration.");
    databases.push({
      ...(input.version === 2
        ? { databaseId: text(db.databaseId, /^db_[A-Za-z0-9_-]+$/, 67) }
        : {}),
      engine: db.engine,
      password,
      tls: db.tls,
      host: text(db.host, /^(?:[A-Za-z0-9][A-Za-z0-9.:-]*|::1)$/, 253),
      port: integer(db.port, 1, 65535),
      database: text(
        db.database,
        /^[A-Za-z0-9_][A-Za-z0-9_-]*$/,
        db.engine === "postgresql" ? 63 : 64,
      ),
      username: text(
        db.username,
        /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/,
        db.engine === "postgresql" ? 63 : 80,
      ),
      dumpFilename: text(
        db.dumpFilename,
        /^[A-Za-z0-9_][A-Za-z0-9_.-]*\.sql$/,
        100,
      ),
      timeoutSeconds: integer(db.timeoutSeconds, 1, 3600),
      maxDumpBytes: integer(db.maxDumpBytes, 1024, 100 * 1024 ** 3),
      includeRoutines: bool(db.includeRoutines),
      includeEvents: bool(db.includeEvents),
    });
  }
  const filenames = databases.map((db) =>
    db.dumpFilename.normalize("NFKC").toLowerCase(),
  );
  const ids = databases.map((db) => db.databaseId);
  if (
    new Set(filenames).size !== filenames.length ||
    new Set(ids).size !== ids.length
  )
    throw new Error("Duplicate database artifact or identity.");
  if (input.version === 2) output.databases = databases;
  else output.database = databases[0];
  if (input.preHook !== undefined) output.preHook = hook(input.preHook);
  if (input.postHook !== undefined) output.postHook = hook(input.postHook);
  return output;
}

/** Reject writable/replaceable executables and every mutable ancestor. */
export function assertRootOwnedPath(
  candidate: string,
  directory = false,
  readableFile = false,
): string {
  if (process.platform !== "linux" || !path.isAbsolute(candidate))
    throw new Error("Linux administrator-owned path required.");
  const resolved = path.resolve(candidate);
  let current = resolved;
  for (;;) {
    const info = lstatSync(current);
    if (
      info.isSymbolicLink() ||
      info.uid !== 0 ||
      (info.mode & 0o022) !== 0 ||
      (current === resolved && !directory && (info.mode & 0o6000) !== 0) ||
      (current === resolved
        ? directory
          ? !info.isDirectory()
          : !info.isFile()
        : !info.isDirectory())
    ) {
      throw new Error(
        "Executable path is not administrator-owned and immutable.",
      );
    }
    if (current === path.dirname(current)) break;
    current = path.dirname(current);
  }
  accessSync(
    resolved,
    directory
      ? constants.R_OK | constants.X_OK
      : readableFile
        ? constants.R_OK
        : constants.X_OK,
  );
  return resolved;
}

export function validateHookExecutable(
  root: string,
  value: LifecycleHook,
): string {
  // Flat identifiers only; neither symlinks nor arbitrary interpreter selection.
  assertRootOwnedPath(root, true);
  const validated = hook(value);
  return assertRootOwnedPath(path.join(root, validated.id));
}

/** Client selection never searches an untrusted PATH or accepts a UI executable. */
function postgresPackageBinDirs(): string[] {
  try {
    // Debian/Ubuntu /usr/bin/pg_dump resolves to pg_wrapper, which cannot be
    // invoked under that canonical name. Use the actual packaged executable,
    // not a wrapper that selects user cluster/environment defaults.
    const root = assertRootOwnedPath("/usr/lib/postgresql", true);
    return readdirSync(root)
      .filter((version) => /^(?:[1-9][0-9])$/.test(version))
      .sort((a, b) => Number(b) - Number(a))
      .slice(0, 8)
      .map((version) => path.join(root, version, "bin"));
  } catch {
    return [];
  }
}

export function detectDatabaseBinary(
  engine: DatabaseEngine,
  binDirs?: string[],
): string | undefined {
  if (process.platform !== "linux") return undefined;
  const names =
    engine === "mariadb"
      ? ["mariadb-dump", "mysqldump"]
      : engine === "postgresql"
        ? ["pg_dump"]
        : ["mysqldump"];
  for (const name of names)
    for (const directory of binDirs || [
      "/usr/bin",
      "/usr/local/bin",
      ...(engine === "postgresql" ? postgresPackageBinDirs() : []),
    ]) {
      try {
        const binary = assertRootOwnedPath(
          realpathSync(path.join(directory, name)),
        );
        const version = spawnSync(
          binary,
          engine === "postgresql"
            ? ["--version"]
            : ["--no-defaults", "--version"],
          {
            shell: false,
            timeout: 2000,
            maxBuffer: 4096,
            env: {
              PATH: "/usr/bin:/bin",
              LANG: "C",
              LC_ALL: "C",
              HOME: "/nonexistent",
            },
            encoding: "utf8",
          },
        );
        if (version.status !== 0 || version.error) continue;
        const isMaria = /MariaDB/i.test(version.stdout);
        if (
          (engine === "mariadb" && isMaria) ||
          (engine === "postgresql" &&
            /^pg_dump \(PostgreSQL\) \d+(?:\.\d+)*\b/.test(
              version.stdout.trim(),
            )) ||
          (engine === "mysql" &&
            !isMaria &&
            /mysqldump.*(?:Ver|Distrib)\s+\d/i.test(version.stdout))
        )
          return binary;
      } catch {
        /* Missing or unsafe client: not advertised. */
      }
    }
  return undefined;
}
