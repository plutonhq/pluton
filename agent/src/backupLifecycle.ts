import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { realpathSync } from "node:fs";
import {
  assertRootOwnedPath,
  detectDatabaseBinary,
  lifecycleDatabases,
  validateHookExecutable,
  type BackupLifecycle,
  type DatabaseBackup,
  type DatabaseCheckpoint,
  type LifecycleCheckpoint,
  type LifecycleFailureCode,
  type LifecycleHook,
  type LifecycleReport,
  type LifecycleStage,
} from "./lifecyclePolicy.js";
import {
  LifecycleProcessError,
  runLifecycleProcess,
} from "./lifecycleProcess.js";
import type { AgentConfig } from "./types.js";

export class BackupLifecycleError extends Error {
  constructor(
    readonly stage: LifecycleStage,
    readonly code: LifecycleFailureCode | "cancelled",
    readonly databaseId?: string,
    readonly engine?: DatabaseBackup["engine"],
  ) {
    super("Remote backup lifecycle failed.");
    this.name = "BackupLifecycleError";
  }
}

// libpq escapes both separators and backslashes. No wildcard/connection string
// inputs are allowed; newline-bearing PostgreSQL passwords are rejected upstream.
export function postgresPasswordFile(db: DatabaseBackup): string {
  const escape = (value: string) =>
    value.replace(/\\/g, "\\\\").replace(/:/g, "\\:");
  return (
    [db.host, String(db.port), db.database, db.username, db.password]
      .map(escape)
      .join(":") + "\n"
  );
}

function postgresTrustFile(): string {
  return assertRootOwnedPath(
    realpathSync("/etc/ssl/certs/ca-certificates.crt"),
    false,
    true,
  );
}

function defaultsValue(value: string): string {
  return (
    '"' +
    value
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\n/g, "\\n")
      .replace(/\r/g, "\\r")
      .replace(/\t/g, "\\t")
      .replace(/\x08/g, "\\b") +
    '"'
  );
}

export class BackupLifecycleJob {
  readonly report: LifecycleReport = { warnings: [] };
  private constructor(
    readonly workspace: string,
    readonly lifecycle: BackupLifecycle,
    private readonly config: AgentConfig,
    private readonly shouldCancel: () => Promise<boolean>,
    private readonly stageEvent: (
      stage: LifecycleCheckpoint,
      database?: DatabaseCheckpoint,
    ) => Promise<void>,
  ) {}

  static async create(
    config: AgentConfig,
    lifecycle: BackupLifecycle,
    shouldCancel: () => Promise<boolean>,
    stageEvent: (
      stage: LifecycleCheckpoint,
      database?: DatabaseCheckpoint,
    ) => Promise<void>,
  ): Promise<BackupLifecycleJob> {
    if (process.platform !== "linux" || process.getuid?.() === 0)
      throw new BackupLifecycleError(
        "lifecycle-validation",
        "lifecycle-invalid",
      );
    // Validate both hooks before any pre-work or backup mutation.
    for (const hook of [lifecycle.preHook, lifecycle.postHook])
      if (hook) {
        try {
          validateHookExecutable(
            config.hookRoot || "/etc/pluton-agent/hooks",
            hook,
          );
        } catch {
          throw new BackupLifecycleError(
            "lifecycle-validation",
            "hook-invalid",
          );
        }
      }
    for (const db of lifecycleDatabases(lifecycle)) {
      if (!detectDatabaseBinary(db.engine, config.databaseBinDirs))
        throw new BackupLifecycleError(
          "lifecycle-validation",
          lifecycle.version === 1
            ? "database-tool-unavailable"
            : "database-client-missing",
          db.databaseId,
          db.engine,
        );
      if (db.engine === "postgresql" && db.tls === "verify-identity") {
        try {
          postgresTrustFile();
        } catch {
          throw new BackupLifecycleError(
            "lifecycle-validation",
            "database-tls-verification-failed",
            db.databaseId,
            db.engine,
          );
        }
      }
    }
    try {
      const jobs = path.join(config.dataDir, "jobs");
      await mkdir(jobs, { recursive: true, mode: 0o700 });
      const info = await lstat(jobs);
      if (
        !info.isDirectory() ||
        info.isSymbolicLink() ||
        info.uid !== process.getuid?.() ||
        (await realpath(jobs)) !==
          path.join(await realpath(config.dataDir), "jobs")
      )
        throw new Error("Unsafe job root.");
      await chmod(jobs, 0o700);
      const workspace = await mkdtemp(path.join(jobs, "job-"));
      await chmod(workspace, 0o700);
      return new BackupLifecycleJob(
        workspace,
        lifecycle,
        config,
        shouldCancel,
        stageEvent,
      );
    } catch {
      throw new BackupLifecycleError("workspace-creation", "workspace-failed");
    }
  }

  async runHook(
    value: LifecycleHook,
    stage: "pre-backup" | "post-backup",
    cleanup = false,
  ): Promise<void> {
    await this.stageEvent(
      stage === "pre-backup" ? "pre-backup-started" : "post-backup-started",
    );
    try {
      const binary = validateHookExecutable(
        this.config.hookRoot || "/etc/pluton-agent/hooks",
        value,
      );
      await runLifecycleProcess({
        binary,
        args: value.args,
        cwd: this.workspace,
        timeoutSeconds: value.timeoutSeconds,
        shouldCancel: cleanup
          ? async () => {
              // Status polling also refreshes the 60-second command lease.
              // Post cleanup ignores cancellation, not lease renewal, and a
              // transient control-plane failure cannot undo snapshot success.
              try {
                await this.shouldCancel();
              } catch {
                /* The hook deadline remains enforced. */
              }
              return false;
            }
          : this.shouldCancel,
        env: {
          PATH: "/usr/bin:/bin",
          LANG: "C",
          LC_ALL: "C",
          HOME: this.workspace,
          TMPDIR: this.workspace,
          PLUTON_JOB_WORKSPACE: this.workspace,
        },
      });
    } catch (error) {
      const code =
        error instanceof LifecycleProcessError ? error.code : "invalid";
      throw new BackupLifecycleError(
        stage,
        code === "cancelled"
          ? "cancelled"
          : code === "timeout"
            ? "hook-timeout"
            : code === "output-limit"
              ? "hook-output-limit"
              : code === "invalid"
                ? "hook-invalid"
                : "hook-failed",
      );
    }
  }

  async prepare(): Promise<string[]> {
    if (this.lifecycle.preHook)
      await this.runHook(this.lifecycle.preHook, "pre-backup");
    const databases = lifecycleDatabases(this.lifecycle);
    if (!databases.length) return [];
    const artifacts: string[] = [];
    const directory = path.join(this.workspace, "pluton", "database");
    await mkdir(path.dirname(directory), { mode: 0o700 });
    await mkdir(directory, { mode: 0o700 });
    if (this.lifecycle.version === 2) this.report.databases = [];
    for (let ordinal = 0; ordinal < databases.length; ordinal++) {
      const db = databases[ordinal];
      artifacts.push(
        await this.dumpDatabase(db, ordinal + 1, databases.length, directory),
      );
    }
    if (databases.length === 1 && this.report.databases?.[0]) {
      const { path: artifactPath, bytes, sha256 } = this.report.databases[0];
      this.report.database = { path: artifactPath, bytes, sha256 };
    }
    return artifacts;
  }

  private async dumpDatabase(
    db: DatabaseBackup,
    ordinal: number,
    count: number,
    directory: string,
  ): Promise<string> {
    const checkpoint = {
      databaseId: db.databaseId,
      engine: db.engine,
      ordinal,
      count,
    };
    await this.stageEvent("database-dump-started", checkpoint);
    const credentials = path.join(
      this.workspace,
      `database-${ordinal}.${db.engine === "postgresql" ? "pgpass" : "cnf"}`,
    );
    try {
      const clientHome = path.join(this.workspace, `client-home-${ordinal}`);
      await mkdir(clientHome, { mode: 0o700 });
      await writeFile(
        credentials,
        db.engine === "postgresql"
          ? postgresPasswordFile(db)
          : "[client]\nprotocol=tcp\n" +
              `host=${defaultsValue(db.host)}\nport=${db.port}\nuser=${defaultsValue(db.username)}\npassword=${defaultsValue(db.password)}\n` +
              (db.tls === "verify-identity"
                ? db.engine === "mysql"
                  ? "ssl-mode=VERIFY_IDENTITY\n"
                  : "ssl=ON\nssl-verify-server-cert=ON\n"
                : ""),
        { mode: 0o600, flag: "wx" },
      );
      await chmod(credentials, 0o600);
      const binary = detectDatabaseBinary(
        db.engine,
        this.config.databaseBinDirs,
      );
      if (!binary)
        throw new BackupLifecycleError(
          "database-dump",
          this.lifecycle.version === 1
            ? "database-tool-unavailable"
            : "database-client-missing",
          db.databaseId,
          db.engine,
        );
      const args =
        db.engine === "postgresql"
          ? [
              "--format=plain",
              "--no-password",
              "--host",
              db.host,
              "--port",
              String(db.port),
              "--username",
              db.username,
              "--dbname",
              db.database,
            ]
          : [
              `--defaults-file=${credentials}`,
              "--single-transaction",
              "--quick",
              "--skip-lock-tables",
              "--hex-blob",
            ];
      if (db.engine === "mysql")
        args.push("--set-gtid-purged=OFF", "--no-tablespaces");
      if (db.engine !== "postgresql") {
        if (db.includeRoutines) args.push("--routines");
        if (db.includeEvents) args.push("--events");
        args.push("--databases", db.database);
      }
      const relative = `pluton/database/${db.dumpFilename}`;
      const output = await runLifecycleProcess({
        binary,
        args,
        cwd: this.workspace,
        timeoutSeconds: db.timeoutSeconds,
        shouldCancel: this.shouldCancel,
        env: {
          PATH: "/usr/bin:/bin",
          LANG: "C",
          LC_ALL: "C",
          HOME: clientHome,
          TMPDIR: this.workspace,
          ...(db.engine === "postgresql"
            ? {
                PGPASSFILE: credentials,
                PGSSLMODE:
                  db.tls === "verify-identity" ? "verify-full" : "disable",
                // Do not let GSS encryption skip the requested certificate verification.
                PGGSSENCMODE: "disable",
                ...(db.tls === "verify-identity"
                  ? { PGSSLROOTCERT: postgresTrustFile() }
                  : {}),
              }
            : { MYSQL_TEST_LOGIN_FILE: path.join(clientHome, ".mylogin.cnf") }),
        },
        output: {
          file: path.join(directory, db.dumpFilename),
          maxBytes: db.maxDumpBytes,
        },
      });
      const info = await lstat(path.join(directory, db.dumpFilename));
      if (
        !info.isFile() ||
        info.isSymbolicLink() ||
        !info.size ||
        (info.mode & 0o777) !== 0o600 ||
        info.uid !== process.getuid?.()
      ) {
        throw new BackupLifecycleError(
          "database-dump-validation",
          "database-dump-invalid",
          db.databaseId,
          db.engine,
        );
      }
      if (this.lifecycle.version === 2)
        this.report.databases!.push({
          databaseId: db.databaseId!,
          engine: db.engine,
          database: db.database,
          path: "/" + relative,
          ...output,
        });
      else this.report.database = { path: "/" + relative, ...output };
      await this.stageEvent("database-dump-completed", checkpoint);
      return relative;
    } catch (error) {
      if (error instanceof BackupLifecycleError) throw error;
      const code =
        error instanceof LifecycleProcessError ? error.code : "failed";
      throw new BackupLifecycleError(
        "database-dump",
        code === "cancelled"
          ? "cancelled"
          : code === "client-incompatible"
            ? "database-client-incompatible"
            : code === "tls-verification-failed"
              ? "database-tls-verification-failed"
              : code === "output-empty" && this.lifecycle.version === 2
                ? "database-output-empty"
                : code === "auth-failed"
                  ? "database-auth-failed"
                  : code === "insufficient-privileges"
                    ? "database-insufficient-privileges"
                    : code === "invalid-configuration"
                      ? "database-invalid-configuration"
                      : code === "unavailable"
                        ? "database-unavailable"
                        : code === "timeout"
                          ? "database-dump-timeout"
                          : code === "output-limit"
                            ? "database-dump-output-limit"
                            : code === "start-failed"
                              ? "database-client-missing"
                              : "database-dump-failed",
        db.databaseId,
        db.engine,
      );
    } finally {
      // Credentials must be gone before Restic or the post hook starts.
      try {
        await rm(credentials, { force: true });
      } catch {
        throw new BackupLifecycleError(
          "database-dump",
          "database-dump-failed",
          db.databaseId,
          db.engine,
        );
      }
    }
  }

  async cleanup(): Promise<void> {
    if (this.lifecycle.postHook) {
      try {
        await this.runHook(this.lifecycle.postHook, "post-backup", true);
      } catch (error) {
        const code =
          error instanceof BackupLifecycleError ? error.code : "hook-failed";
        this.report.warnings.push({
          stage: "post-backup",
          code:
            code === "hook-invalid" ||
            code === "hook-timeout" ||
            code === "hook-output-limit"
              ? code
              : "hook-failed",
        });
      }
    }
    try {
      await rm(this.workspace, { recursive: true, force: true });
    } catch {
      this.report.warnings.push({ stage: "cleanup", code: "cleanup-failed" });
    }
    await this.stageEvent(
      this.report.warnings.some((warning) => warning.stage === "cleanup")
        ? "cleanup-warning"
        : "cleanup-completed",
    );
  }
}
