import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  compatibleResticParent,
  resticParentArgs,
  resticParentDiscoveryArgs,
  PARENT_LOOKUP_TIMEOUT_MS,
} from "./resticParent.js";
import {
  preflightSource,
  SourceAccessError,
  type SourceAccessCode,
} from "./filesystemPolicy.js";
import { privateBinaryPath } from "./inventory.js";
import type { AgentConfig } from "./types.js";
import { BackupLifecycleJob, BackupLifecycleError } from "./backupLifecycle.js";
import { runLifecycleProcess } from "./lifecycleProcess.js";
import {
  parseBackupLifecycle,
  assertRootOwnedPath,
  lifecycleDatabases,
  type BackupLifecycle,
  type DatabaseCheckpoint,
  type LifecycleCheckpoint,
  type LifecycleFailureCode,
  type LifecycleReport,
  type LifecycleStage,
} from "./lifecyclePolicy.js";

const MAX_OUTPUT_BYTES = 64 * 1024;
const PROGRESS_INTERVAL_MS = 5_000;

/**
 * Only the password-authenticated SFTP subset is supported for the first
 * remote data-plane path. In particular, never accept rclone options that
 * invoke an external SSH binary, a remote shell command, or an agent-local
 * credential file.
 */
const SFTP_OPTION_KEYS = new Set(["host", "port", "user", "pass"]);

export type BackupFilesystemPayload = {
  version: 1 | 2 | 3;
  lifecycle?: BackupLifecycle;
  backupId: string;
  planId: string;
  sourcePath: string;
  excludes: string[];
  repository: {
    remoteName: "pluton";
    path: string;
    initialize: boolean;
  };
  rclone: {
    type: "sftp";
    options: Record<string, string>;
  };
  repositoryPassword: string;
};

export type ResticSummary = {
  message_type: "summary";
  files_new: number;
  files_changed: number;
  files_unmodified: number;
  dirs_new: number;
  dirs_changed: number;
  dirs_unmodified: number;
  data_blobs: number;
  tree_blobs: number;
  data_added: number;
  data_added_packed: number;
  total_files_processed: number;
  total_bytes_processed: number;
  total_duration: number;
  snapshot_id: string;
};

export type BackupFilesystemResult = {
  snapshotId: string;
  sourcePaths?: string[];
  summary: ResticSummary;
  lifecycle?: LifecycleReport;
};

export class BackupCancelledError extends Error {
  constructor() {
    super("Backup was cancelled.");
  }
}

/**
 * Safe, bounded checkpoints for the remote data-plane operation.  These names
 * are intentionally closed rather than derived from provider output, paths, or
 * command arguments so they can be written to the local journal and returned
 * to the server without disclosing credentials.
 */
export type BackupFilesystemStage =
  | "payload-validation"
  | "source-validation"
  | "state-validation"
  | "tool-validation"
  | "sftp-password-obscure"
  | "temporary-storage-config"
  | "repository-check"
  | "parent-discovery"
  | "parent-verification"
  | "repository-target-check"
  | "repository-initialization"
  | "restic-backup"
  | "cleanup"
  | LifecycleStage;

export type BackupFilesystemFailureCode =
  | "invalid-payload"
  | "source-validation-failed"
  | SourceAccessCode
  | "state-overlap"
  | "state-validation-failed"
  | "tool-unavailable"
  | "sftp-password-obscure-failed"
  | "temporary-config-failed"
  | "repository-check-failed"
  | "repository-target-check-failed"
  | "repository-target-not-empty"
  | "target-check-access-failed"
  | "target-check-auth-failed"
  | "target-check-transport-failed"
  | "repository-initialization-failed"
  | "restic-backup-failed"
  | "restic-summary-missing"
  | "cleanup-failed"
  | "cancelled"
  | "unexpected"
  | LifecycleFailureCode;

export type BackupFilesystemStageEvent = {
  database?: DatabaseCheckpoint;
  diagnostic?: RepositoryDiagnostic;
  stage: BackupFilesystemStage;
  message:
    | "command accepted"
    | "stage started"
    | "source validated"
    | "temporary storage config created"
    | "repository check started"
    | "existing backup snapshot lookup started"
    | "initial repository verification started"
    | "repository verified"
    | "repository reverification started"
    | "real repository failure"
    | "parent candidate discovery started"
    | "parent metadata verification started"
    | "parent selected"
    | "no compatible parent"
    | "parent lookup timeout; checking repository before fallback"
    | "parent metadata invalid; checking repository before fallback"
    | "parent lookup failed; checking repository before fallback"
    | "parent lookup fallback; continuing without explicit parent"
    | "target-not-found"
    | "target-empty"
    | "repository initialization started"
    | "restic backup started"
    | "backup completed"
    | LifecycleCheckpoint;
};

const BACKUP_FAILURE_MESSAGES: Partial<
  Record<BackupFilesystemFailureCode, string>
> = {
  "invalid-payload": "The backup command payload is invalid.",
  "source-validation-failed": "The backup source could not be validated.",
  "source-parent-not-traversable":
    "A source parent directory is not traversable by the service account. Run local read-only preflight.",
  "source-root-not-readable":
    "The canonical source root is not readable/traversable by the service account.",
  "source-entry-inaccessible":
    "A source entry is inaccessible. Run the explicit local read-only source scan.",
  "source-missing": "The source or an expected source entry is missing.",
  "source-symlink-escape":
    "The source symlink escaped its allowed root or changed during validation.",
  "source-unsupported-type": "The source type is not supported.",
  "source-policy-violation":
    "The source violates the allowed-root path policy.",
  "state-overlap": "The backup source overlaps the agent state directory.",
  "state-validation-failed":
    "The agent state directory could not be validated.",
  "tool-unavailable": "The private backup tools are unavailable.",
  "sftp-password-obscure-failed":
    "The SFTP authentication configuration could not be prepared.",
  "temporary-config-failed":
    "The temporary storage configuration could not be prepared.",
  "repository-check-failed": "The Restic repository could not be checked.",
  "repository-target-check-failed":
    "The managed repository target could not be verified.",
  "repository-target-not-empty": "The managed repository target is not empty.",
  "target-check-access-failed":
    "Access to the managed repository target was denied.",
  "target-check-auth-failed":
    "Authentication for the managed repository target failed.",
  "target-check-transport-failed":
    "The connection to the managed repository target failed.",
  "repository-initialization-failed":
    "The Restic repository could not be initialized.",
  "restic-backup-failed": "Restic backup failed.",
  "restic-summary-missing": "Restic did not return a snapshot summary.",
  "cleanup-failed": "Temporary backup state could not be cleaned up.",
  cancelled: "Backup was cancelled.",
  unexpected: "Remote filesystem backup failed.",
};

export class BackupFilesystemError extends Error {
  constructor(
    readonly stage: BackupFilesystemStage,
    readonly code: BackupFilesystemFailureCode,
    readonly databaseId?: string,
    readonly engine?: "mysql" | "mariadb" | "postgresql",
  ) {
    super(BACKUP_FAILURE_MESSAGES[code] || "Remote backup lifecycle failed.");
    this.name = "BackupFilesystemError";
  }
}

export function toBackupFilesystemError(
  error: unknown,
  stage: BackupFilesystemStage,
): BackupFilesystemError {
  // Parent checkpoints are journal-only extensions; existing servers still
  // receive the established repository-check failure/cancellation vocabulary.
  if (stage === "parent-discovery" || stage === "parent-verification")
    stage = "repository-check";
  if (error instanceof BackupFilesystemError) return error;
  if (error instanceof SourceAccessError)
    return new BackupFilesystemError(stage, error.code);
  if (error instanceof BackupLifecycleError)
    return new BackupFilesystemError(
      error.stage,
      error.code,
      error.databaseId,
      error.engine,
    );
  if (error instanceof BackupCancelledError) {
    return new BackupFilesystemError(stage, "cancelled");
  }
  if (
    stage === "repository-check" &&
    error instanceof ProgramTimeoutError &&
    error.diagnostic
  ) {
    return new BackupFilesystemError(
      stage,
      error.diagnostic === "authentication-failed"
        ? "target-check-auth-failed"
        : error.diagnostic === "access-failed"
          ? "target-check-access-failed"
          : error.diagnostic === "transport-failed"
            ? "target-check-transport-failed"
            : "repository-check-failed",
    );
  }
  const code: BackupFilesystemFailureCode =
    stage === "payload-validation"
      ? "invalid-payload"
      : stage === "source-validation"
        ? "source-validation-failed"
        : stage === "state-validation"
          ? error instanceof Error &&
            error.message ===
              "The backup source must not include the agent state directory."
            ? "state-overlap"
            : "state-validation-failed"
          : stage === "tool-validation"
            ? "tool-unavailable"
            : stage === "sftp-password-obscure"
              ? "sftp-password-obscure-failed"
              : stage === "temporary-storage-config"
                ? "temporary-config-failed"
                : stage === "repository-check"
                  ? "repository-check-failed"
                  : stage === "repository-target-check"
                    ? "repository-target-check-failed"
                    : stage === "repository-initialization"
                      ? "repository-initialization-failed"
                      : stage === "restic-backup"
                        ? "restic-backup-failed"
                        : stage === "cleanup"
                          ? "cleanup-failed"
                          : "unexpected";
  return new BackupFilesystemError(stage, code);
}

type ProcessResult = {
  code: number | null;
  stdout: string;
  targetFailureCode?: RepositoryTargetFailureCode;
  repositoryFailure?: RepositoryDiagnostic;
  outputTruncated?: boolean;
};

type RepositoryDiagnostic =
  | "authentication-failed"
  | "access-failed"
  | "transport-failed"
  | "repository-unavailable"
  | "invalid-repository"
  | "timeout"
  | "process-failed";
class ProgramTimeoutError extends Error {
  constructor(readonly diagnostic?: RepositoryDiagnostic) {
    super("Backup process timed out.");
  }
}

type RepositoryTargetFailureCode =
  | "target-check-access-failed"
  | "target-check-auth-failed"
  | "target-check-transport-failed";

type ProcessOptions = {
  maxOutputBytes?: number;
  cwd?: string;
  timeoutMs?: number;
  env: NodeJS.ProcessEnv;
  allowFailure?: boolean;
  classifyTargetFailure?: boolean;
  classifyRepositoryFailure?: boolean;
  stdin?: string;
  shouldCancel: () => Promise<boolean>;
  onJsonLine?: (value: Record<string, unknown>) => Promise<void>;
  source?: string;
};

function repositoryDiagnostic(
  code: number | null,
  diagnostics: string,
): RepositoryDiagnostic | undefined {
  if (
    code === 12 ||
    /wrong password|no key found|unable to authenticate|authentication failed|failed to authenticate|ssh: handshake failed.*authenticate/i.test(
      diagnostics,
    )
  )
    return "authentication-failed";
  if (
    /permission denied|access denied|operation not permitted/i.test(diagnostics)
  )
    return "access-failed";
  if (classifyTargetFailure(diagnostics) === "target-check-transport-failed")
    return "transport-failed";
  if (code === 10) return "repository-unavailable";
  if (
    /ciphertext verification failed|invalid data returned|invalid repository|unsupported repository version|config.*(?:invalid|corrupt)|load.*snapshot.*(?:corrupt|invalid)/i.test(
      diagnostics,
    )
  )
    return "invalid-repository";
  if (code !== 0) return "process-failed";
  return undefined;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string, max = 8_192): string {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > max ||
    /[\x00-\x1f\x7f]/.test(value)
  ) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function validateId(value: unknown, label: string): string {
  const id = requiredString(value, label, 160);
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`${label} is invalid.`);
  return id;
}

function validateRepositoryPath(value: unknown): string {
  const repositoryPath = requiredString(value, "Repository path");
  if (repositoryPath.split(/[\\/]+/).includes("..")) {
    throw new Error("Repository path contains traversal.");
  }
  return repositoryPath;
}

function validateExcludes(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 100)
    throw new Error("Backup excludes are invalid.");
  return value.map((entry, index) => {
    const item = requiredString(entry, `Backup exclude ${index + 1}`, 4_096);
    if (item.split(/[\\/]+/).includes(".."))
      throw new Error("Backup excludes cannot contain traversal.");
    return item;
  });
}

function validateRcloneOptions(value: unknown): Record<string, string> {
  const input = asRecord(value, "SFTP configuration");
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(input)) {
    if (!SFTP_OPTION_KEYS.has(key))
      throw new Error("SFTP configuration contains an unsupported option.");
    const item = requiredString(entry, `SFTP option ${key}`, 16_384);
    result[key] = item;
  }
  if (!result.host || !result.user || !result.pass) {
    throw new Error("SFTP host, user, and password are required.");
  }
  return result;
}

/**
 * Parse the short, server-signed workflow envelope. Unknown fields are refused
 * so this cannot gradually turn into a generic remote execution protocol.
 */
export function parseBackupFilesystemPayload(
  value: Record<string, unknown>,
): BackupFilesystemPayload {
  const allowed = new Set([
    "version",
    "backupId",
    "planId",
    "sourcePath",
    "excludes",
    "repository",
    "rclone",
    "repositoryPassword",
    ...(value.version === 2 || value.version === 3 ? ["lifecycle"] : []),
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new Error("Backup command contains unsupported fields.");
  }
  if (value.version !== 1 && value.version !== 2 && value.version !== 3)
    throw new Error("Backup command version is unsupported.");
  const repository = asRecord(value.repository, "Repository configuration");
  const rclone = asRecord(value.rclone, "Rclone configuration");
  if (
    repository.remoteName !== "pluton" ||
    typeof repository.initialize !== "boolean"
  ) {
    throw new Error("Repository configuration is invalid.");
  }
  if (rclone.type !== "sftp")
    throw new Error("Only SFTP storage is supported by this agent.");
  const password = requiredString(
    value.repositoryPassword,
    "Repository password",
    512,
  );
  if (password.length < 20) throw new Error("Repository password is invalid.");
  const lifecycle =
    value.version === 1 ? undefined : parseBackupLifecycle(value.lifecycle);
  if (lifecycle && lifecycle.version !== (value.version === 3 ? 2 : 1))
    throw new Error("Incompatible lifecycle envelope.");
  return {
    version: value.version,
    ...(lifecycle ? { lifecycle } : {}),
    backupId: validateId(value.backupId, "Backup ID"),
    planId: validateId(value.planId, "Plan ID"),
    sourcePath: requiredString(value.sourcePath, "Source path", 4_096),
    excludes: validateExcludes(value.excludes),
    repository: {
      remoteName: "pluton",
      path: validateRepositoryPath(repository.path),
      initialize: repository.initialize,
    },
    rclone: { type: "sftp", options: validateRcloneOptions(rclone.options) },
    repositoryPassword: password,
  };
}

function isWithin(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

async function assertSourceDoesNotOverlapState(
  source: string,
  dataDir: string,
): Promise<void> {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const state = await realpath(dataDir);
  if (isWithin(source, state) || isWithin(state, source)) {
    throw new Error(
      "The backup source must not include the agent state directory.",
    );
  }
}

function appendBounded(
  existing: string,
  chunk: string,
  limit = MAX_OUTPUT_BYTES,
): string {
  if (existing.length >= limit) return existing;
  return (existing + chunk).slice(0, limit);
}

/** Provider text is used only to categorize failures, never to permit init or log it. */
function classifyTargetFailure(
  diagnostics: string,
): RepositoryTargetFailureCode | undefined {
  if (
    /unable to authenticate|authentication failed|no supported methods remain|permission denied \((?:publickey|password|keyboard-interactive)/i.test(
      diagnostics,
    )
  ) {
    return "target-check-auth-failed";
  }
  if (
    /permission denied|access denied|SSH_FX_PERMISSION_DENIED|operation not permitted/i.test(
      diagnostics,
    )
  ) {
    return "target-check-access-failed";
  }
  if (
    /dial tcp|connection refused|connection reset|connection closed|i\/o timeout|connection timed out|broken pipe|no route to host|network is unreachable|no such host|(?:^|[\s:])(?:unexpected )?EOF(?:\s|$)/i.test(
      diagnostics,
    )
  ) {
    return "target-check-transport-failed";
  }
  return undefined;
}

function terminateProcessTree(
  child: ChildProcessWithoutNullStreams,
): ReturnType<typeof setTimeout> | undefined {
  // On Linux, descendants can still hold stdio open after the leader exits.
  if (process.platform === "win32" && (child.exitCode !== null || child.killed))
    return;
  try {
    if (process.platform === "win32" && child.pid) {
      const killer = spawn("taskkill", ["/PID", String(child.pid), "/T"], {
        shell: false,
        windowsHide: true,
        stdio: "ignore",
      });
      killer.once("error", () => {
        try {
          child.kill("SIGTERM");
        } catch {
          // The process has already stopped.
        }
      });
      killer.unref();
    } else if (child.pid) process.kill(-child.pid, "SIGTERM");
    else child.kill("SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
  const forceKill = setTimeout(() => {
    try {
      if (process.platform === "win32" && child.pid) {
        const killer = spawn(
          "taskkill",
          ["/PID", String(child.pid), "/T", "/F"],
          {
            shell: false,
            windowsHide: true,
            stdio: "ignore",
          },
        );
        killer.once("error", () => {
          try {
            child.kill("SIGKILL");
          } catch {
            // The process has already stopped.
          }
        });
        killer.unref();
      } else if (child.pid) process.kill(-child.pid, "SIGKILL");
      else child.kill("SIGKILL");
    } catch {
      // The process has already stopped.
    }
  }, 5_000);
  forceKill.unref();
  return forceKill;
}

async function runProgram(
  binary: string,
  args: string[],
  options: ProcessOptions,
): Promise<ProcessResult> {
  await access(binary, constants.X_OK);
  return new Promise<ProcessResult>((resolve, reject) => {
    const child = spawn(binary, args, {
      shell: false,
      detached: process.platform !== "win32",
      windowsHide: true,
      env: options.env,
      stdio: ["pipe", "pipe", "pipe"],
      cwd: options.cwd,
    });
    let stdout = "";
    let diagnostics = "";
    let stdoutBuffer = "";
    let stderrBuffer = "";
    let sourceFailure: SourceAccessCode | undefined;
    let cancelled = false;
    let eventChain = Promise.resolve();
    let settled = false;
    let timedOut = false;
    let outputBytes = 0;
    let forceKill: ReturnType<typeof setTimeout> | undefined;
    const deadline = options.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          forceKill ||= terminateProcessTree(child);
        }, options.timeoutMs)
      : undefined;

    const cancellationTimer = setInterval(() => {
      void options
        .shouldCancel()
        .then((shouldCancel) => {
          if (!shouldCancel || cancelled || settled) return;
          cancelled = true;
          forceKill ||= terminateProcessTree(child);
        })
        .catch(() => {
          // A transient control-plane outage must not terminate a data-plane backup.
        });
    }, 10_000);
    cancellationTimer.unref();

    const consumeLine = (line: string) => {
      if (!options.onJsonLine || !line.trim()) return;
      try {
        const parsed = JSON.parse(line) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
          return;
        eventChain = eventChain.then(() =>
          options.onJsonLine!(parsed as Record<string, unknown>),
        );
      } catch {
        // Restic may emit non-JSON diagnostics. They are never forwarded to the control plane.
      }
    };

    child.stdout.on("data", (chunk) => {
      const text = String(chunk);
      outputBytes += Buffer.byteLength(text);
      stdout = appendBounded(stdout, text, options.maxOutputBytes);
      stdoutBuffer = appendBounded(stdoutBuffer, text);
      for (;;) {
        const newline = stdoutBuffer.indexOf("\n");
        if (newline < 0) break;
        const line = stdoutBuffer.slice(0, newline);
        stdoutBuffer = stdoutBuffer.slice(newline + 1);
        consumeLine(line);
      }
    });
    child.stderr.on("data", (chunk) => {
      // Target/repository probes use only a bounded in-memory classifier.
      // Raw provider text is never returned, logged, or forwarded to the server.
      if (options.classifyTargetFailure || options.classifyRepositoryFailure) {
        diagnostics = appendBounded(diagnostics, String(chunk));
      }
      if (options.source) {
        stderrBuffer = appendBounded(stderrBuffer, String(chunk));
        const lines = stderrBuffer.split("\n");
        stderrBuffer = lines.pop() || "";
        for (const line of lines)
          sourceFailure ||= sourceFailureFromRestic(line, options.source);
      }
    });
    child.stdin.end(options.stdin || "");
    child.once("error", (error) => {
      settled = true;
      clearInterval(cancellationTimer);
      if (deadline) clearTimeout(deadline);
      if (forceKill) clearTimeout(forceKill);
      reject(error);
    });
    child.once("close", (code: number | null) => {
      settled = true;
      clearInterval(cancellationTimer);
      if (deadline) clearTimeout(deadline);
      if (forceKill) clearTimeout(forceKill);
      consumeLine(stdoutBuffer);
      void eventChain.then(
        () => {
          if (cancelled) return reject(new BackupCancelledError());
          if (timedOut) {
            const reason = options.classifyRepositoryFailure
              ? repositoryDiagnostic(code, diagnostics)
              : undefined;
            return reject(
              new ProgramTimeoutError(
                reason === "process-failed" ? undefined : reason,
              ),
            );
          }
          if (code !== 0 && !options.allowFailure) {
            if (options.source)
              sourceFailure ||= sourceFailureFromRestic(
                stderrBuffer,
                options.source,
              );
            if (sourceFailure)
              return reject(new SourceAccessError(sourceFailure));
            return reject(
              new Error(
                `Backup process exited with status ${code ?? "unknown"}.`,
              ),
            );
          }
          resolve({
            code,
            stdout,
            outputTruncated:
              outputBytes > (options.maxOutputBytes ?? MAX_OUTPUT_BYTES),
            ...(options.classifyRepositoryFailure
              ? { repositoryFailure: repositoryDiagnostic(code, diagnostics) }
              : {}),
            ...(options.classifyTargetFailure
              ? { targetFailureCode: classifyTargetFailure(diagnostics) }
              : {}),
          });
        },
        (error) => reject(error),
      );
    });
  });
}

/** Authenticate/decrypt the exact repository config, without snapshot enumeration or locks. */
async function verifyRepository(
  restic: string,
  repository: string,
  env: NodeJS.ProcessEnv,
  shouldCancel: () => Promise<boolean>,
  diagnostic: (reason: RepositoryDiagnostic) => void,
): Promise<void> {
  let reason: RepositoryDiagnostic | undefined;
  try {
    const result = await runProgram(
      restic,
      ["-r", repository, "--no-lock", "cat", "config"],
      {
        env,
        shouldCancel,
        timeoutMs: 30_000,
        allowFailure: true,
        classifyRepositoryFailure: true,
      },
    );
    reason = result.repositoryFailure;
    if (!reason) {
      try {
        const config = JSON.parse(result.stdout);
        if (
          result.outputTruncated ||
          !config ||
          ![1, 2].includes(config.version) ||
          !/^[a-f0-9]{64}$/.test(config.id)
        )
          reason = "invalid-repository";
      } catch {
        reason = "invalid-repository";
      }
    }
  } catch (error) {
    if (error instanceof BackupCancelledError) throw error;
    reason =
      error instanceof ProgramTimeoutError
        ? error.diagnostic || "timeout"
        : "process-failed";
  }
  if (reason) {
    diagnostic(reason);
    throw new BackupFilesystemError(
      "repository-check",
      reason === "authentication-failed"
        ? "target-check-auth-failed"
        : reason === "access-failed"
          ? "target-check-access-failed"
          : reason === "transport-failed"
            ? "target-check-transport-failed"
            : "repository-check-failed",
    );
  }
}

function rcloneConfigValue(value: string): string {
  if (/[\r\n\x00]/.test(value))
    throw new Error("SFTP configuration contains an unsafe value.");
  return value;
}

export async function writeTemporaryRcloneConfig(
  dataDir: string,
  options: Record<string, string>,
): Promise<{ directory: string; configPath: string }> {
  const directory = await mkdtemp(path.join(dataDir, "rclone-"));
  await chmod(directory, 0o700);
  const configPath = path.join(directory, "rclone.conf");
  const lines = ["[pluton]", "type = sftp"];
  for (const key of Object.keys(options).sort()) {
    lines.push(`${key} = ${rcloneConfigValue(options[key])}`);
  }
  await writeFile(configPath, `${lines.join("\n")}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await chmod(configPath, 0o600);
  return { directory, configPath };
}

async function obscureSensitiveSftpOptions(
  rclone: string,
  options: Record<string, string>,
  env: NodeJS.ProcessEnv,
  shouldCancel: () => Promise<boolean>,
): Promise<Record<string, string>> {
  const obscured = { ...options };
  for (const key of ["pass", "key_file_pass"]) {
    if (!obscured[key]) continue;
    const result = await runProgram(rclone, ["obscure", "-"], {
      env,
      stdin: `${obscured[key]}\n`,
      shouldCancel,
    });
    const value = result.stdout.trim();
    if (!value || /[\r\n\x00]/.test(value)) {
      throw new BackupFilesystemError(
        "sftp-password-obscure",
        "sftp-password-obscure-failed",
      );
    }
    obscured[key] = value;
  }
  return obscured;
}

function numeric(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}

/** Only classify JSON source errors, not arbitrary storage/provider text. Raw output stays local in memory. */
export function sourceFailureFromRestic(
  line: string,
  source: string,
): SourceAccessCode | undefined {
  try {
    const error = JSON.parse(line);
    if (
      error.message_type !== "error" ||
      !["scan", "archival"].includes(error.during) ||
      typeof error.item !== "string"
    )
      return;
    const relative = path.relative(source, error.item);
    if (
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    )
      return;
    const message =
      typeof error.error?.message === "string" ? error.error.message : "";
    if (/permission denied|operation not permitted/i.test(message))
      return "source-entry-inaccessible";
    if (/no such file|not found/i.test(message)) return "source-missing";
  } catch {
    /* Not a safe Restic source record. */
  }
}

function summaryFromRestic(
  value: Record<string, unknown>,
): ResticSummary | null {
  if (
    value.message_type !== "summary" ||
    typeof value.snapshot_id !== "string" ||
    !/^[A-Fa-f0-9]{8,128}$/.test(value.snapshot_id)
  ) {
    return null;
  }
  return {
    message_type: "summary",
    files_new: numeric(value.files_new),
    files_changed: numeric(value.files_changed),
    files_unmodified: numeric(value.files_unmodified),
    dirs_new: numeric(value.dirs_new),
    dirs_changed: numeric(value.dirs_changed),
    dirs_unmodified: numeric(value.dirs_unmodified),
    data_blobs: numeric(value.data_blobs),
    tree_blobs: numeric(value.tree_blobs),
    data_added: numeric(value.data_added),
    data_added_packed: numeric(value.data_added_packed),
    total_files_processed: numeric(value.total_files_processed),
    total_bytes_processed: numeric(value.total_bytes_processed),
    total_duration: numeric(value.total_duration),
    snapshot_id: value.snapshot_id.slice(0, 128),
  };
}

export function progressFromRestic(
  value: Record<string, unknown>,
): Record<string, unknown> | null {
  if (value.message_type !== "status") return null;
  return {
    phase: "running",
    backupStage: "backing-up",
    progress: {
      bytesProcessed: numeric(value.bytes_done),
      filesProcessed: numeric(value.files_done),
      totalBytesProcessed: numeric(value.total_bytes),
      totalFilesProcessed: numeric(value.total_files),
    },
  };
}

async function ensureManagedRepository(
  payload: BackupFilesystemPayload,
  restic: string,
  rclone: string,
  repository: string,
  resticEnv: NodeJS.ProcessEnv,
  rcloneEnv: NodeJS.ProcessEnv,
  shouldCancel: () => Promise<boolean>,
  onRepositoryInitializationStarted?: () => void,
  onTargetChecked?: (result: "target-not-found" | "target-empty") => void,
): Promise<void> {
  if (!payload.repository.initialize) return;
  const snapshots = await runProgram(
    restic,
    ["-r", repository, "snapshots", "--json"],
    {
      env: resticEnv,
      allowFailure: true,
      shouldCancel,
    },
  );
  if (snapshots.code === 0) return;

  const listing = await runProgram(
    rclone,
    ["lsf", `${payload.repository.remoteName}:${payload.repository.path}`],
    {
      env: rcloneEnv,
      allowFailure: true,
      classifyTargetFailure: true,
      shouldCancel,
    },
  );
  // Rclone reserves exit code 3 for fs.ErrorDirNotFound. Do not infer absence
  // from free-form "not found" text (e.g. a missing config or SSH key), exit
  // code 4 (file not found), or any authentication/access/transport failure.
  const missingTarget = listing.code === 3 && !listing.targetFailureCode;
  if (listing.code !== 0 && !missingTarget) {
    throw new BackupFilesystemError(
      "repository-target-check",
      listing.targetFailureCode || "repository-target-check-failed",
    );
  }
  // Even whitespace-only filenames or partial output must refuse initialization.
  if (listing.stdout.length > 0) {
    throw new BackupFilesystemError(
      "repository-target-check",
      "repository-target-not-empty",
    );
  }
  onTargetChecked?.(missingTarget ? "target-not-found" : "target-empty");

  try {
    onRepositoryInitializationStarted?.();
    await runProgram(restic, ["-r", repository, "init"], {
      env: resticEnv,
      shouldCancel,
    });
  } catch (error) {
    // A lost completion response can cause an idempotent retry after `init`
    // succeeded. Accept it only when this exact password can open the repo.
    const retry = await runProgram(
      restic,
      ["-r", repository, "snapshots", "--json"],
      {
        env: resticEnv,
        allowFailure: true,
        shouldCancel,
      },
    );
    if (retry.code !== 0) {
      throw new BackupFilesystemError(
        "repository-initialization",
        "repository-initialization-failed",
      );
    }
  }
}

export function summaryForExistingSnapshot(
  snapshotId: string,
  value: unknown,
): ResticSummary {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new BackupFilesystemError(
      "repository-check",
      "restic-summary-missing",
    );
  const stats = value as Record<string, unknown>;
  for (const key of [
    "files_new",
    "files_changed",
    "files_unmodified",
    "dirs_new",
    "dirs_changed",
    "dirs_unmodified",
    "data_blobs",
    "tree_blobs",
    "data_added",
    "data_added_packed",
    "total_files_processed",
    "total_bytes_processed",
  ]) {
    if (
      typeof stats[key] !== "number" ||
      !Number.isFinite(stats[key]) ||
      (stats[key] as number) < 0
    )
      throw new BackupFilesystemError(
        "repository-check",
        "restic-summary-missing",
      );
  }
  const start = Date.parse(String(stats.backup_start));
  const end = Date.parse(String(stats.backup_end));
  const duration =
    Number.isFinite(start) && Number.isFinite(end) && end >= start
      ? (end - start) / 1000
      : 0;
  return summaryFromRestic({
    ...stats,
    message_type: "summary",
    snapshot_id: snapshotId,
    total_duration: duration,
  })!;
}

/**
 * If an earlier successful Restic run lost its completion ACK, the durable
 * command can be leased again. Reuse the snapshot tagged with its stable
 * backup ID rather than creating a second unrelated snapshot.
 */
async function findExistingBackupSnapshot(
  restic: string,
  repository: string,
  backupId: string,
  env: NodeJS.ProcessEnv,
  shouldCancel: () => Promise<boolean>,
): Promise<BackupFilesystemResult | null> {
  const result = await runProgram(
    restic,
    [
      "-r",
      repository,
      "snapshots",
      "--json",
      "--tag",
      `pluton-backup-${backupId}`,
    ],
    {
      env,
      allowFailure: true,
      shouldCancel,
      timeoutMs: 30_000,
      classifyRepositoryFailure: true,
    },
  );
  if (
    result.repositoryFailure &&
    !["repository-unavailable", "process-failed"].includes(
      result.repositoryFailure,
    )
  ) {
    throw new BackupFilesystemError(
      "repository-check",
      result.repositoryFailure === "authentication-failed"
        ? "target-check-auth-failed"
        : result.repositoryFailure === "access-failed"
          ? "target-check-access-failed"
          : result.repositoryFailure === "transport-failed"
            ? "target-check-transport-failed"
            : "repository-check-failed",
    );
  }
  if (result.code !== 0 || !result.stdout.trim()) return null;
  try {
    const snapshots = JSON.parse(result.stdout) as unknown;
    if (!Array.isArray(snapshots)) return null;
    const snapshot = snapshots
      .slice()
      .reverse()
      .find((value) => {
        if (!value || typeof value !== "object" || Array.isArray(value))
          return false;
        const id = (value as Record<string, unknown>).id;
        return typeof id === "string" && /^[a-f0-9]{8,128}$/i.test(id);
      });
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot))
      return null;
    const snapshotId = (snapshot as Record<string, unknown>).id as string;
    if (!(snapshot as Record<string, unknown>).summary)
      throw new BackupFilesystemError(
        "repository-check",
        "restic-summary-missing",
      );
    return {
      snapshotId,
      summary: summaryForExistingSnapshot(
        snapshotId,
        (snapshot as Record<string, unknown>).summary,
      ),
    };
  } catch (error) {
    if (error instanceof BackupFilesystemError) throw error;
    // Treat malformed tool output as a non-match. Repository initialization
    // below remains fail-closed if the target is not a valid managed repo.
    return null;
  }
}

/** Phase 5 confirms the exact full snapshot and artifact, not just an exit code. */
async function confirmLifecycleSnapshot(
  restic: string,
  repository: string,
  payload: BackupFilesystemPayload,
  snapshotId: string,
  env: NodeJS.ProcessEnv,
  shouldCancel: () => Promise<boolean>,
  source: string,
  expectedReport?: LifecycleReport,
): Promise<string> {
  try {
    const result = await runProgram(
      restic,
      [
        "-r",
        repository,
        "snapshots",
        "--json",
        "--tag",
        `pluton-backup-${payload.backupId}`,
      ],
      { env, shouldCancel, timeoutMs: 60_000 },
    );
    const snapshots: unknown = JSON.parse(result.stdout);
    if (!Array.isArray(snapshots)) throw new Error("Invalid snapshots.");
    const matches = snapshots.filter(
      (item) =>
        item &&
        typeof item.id === "string" &&
        /^[a-f0-9]{64}$/.test(item.id) &&
        item.id.startsWith(snapshotId) &&
        Array.isArray(item.tags) &&
        item.tags.includes(`pluton-plan-${payload.planId}`) &&
        item.tags.includes(`pluton-backup-${payload.backupId}`),
    );
    if (matches.length !== 1) throw new Error("Snapshot binding failed.");
    const fullId = matches[0].id as string;
    if (payload.version === 3) {
      if (
        !Array.isArray(matches[0].paths) ||
        !matches[0].paths.includes(source)
      )
        throw new Error("Application source not bound to snapshot.");
      let sourceFound = false;
      await runProgram(
        restic,
        ["-r", repository, "--no-lock", "ls", "--json", fullId, source],
        {
          env,
          shouldCancel,
          timeoutMs: 60_000,
          onJsonLine: async (node) => {
            if (
              node.path === source &&
              (node.type === "dir" || node.type === "file")
            )
              sourceFound = true;
          },
        },
      );
      if (!sourceFound)
        throw new Error("Application source missing from snapshot.");
    }
    for (const db of payload.lifecycle
      ? lifecycleDatabases(payload.lifecycle)
      : []) {
      const dumpPath = `/pluton/database/${db.dumpFilename}`;
      const expected =
        expectedReport?.databases?.find(
          (item) => item.databaseId === db.databaseId,
        ) || expectedReport?.database;
      let files = 0;
      let size: unknown;
      await runProgram(
        restic,
        ["-r", repository, "--no-lock", "ls", "--json", fullId, dumpPath],
        {
          env,
          shouldCancel,
          timeoutMs: 60_000,
          onJsonLine: async (node) => {
            if (node.path === dumpPath && node.type === "file") {
              files++;
              size = node.size;
            }
          },
        },
      );
      if (
        files !== 1 ||
        typeof size !== "number" ||
        !Number.isSafeInteger(size) ||
        size <= 0 ||
        (expected !== undefined &&
          (size !== expected.bytes || expected.path !== dumpPath))
      )
        throw new BackupLifecycleError(
          "snapshot-confirmation",
          "snapshot-confirmation-failed",
          db.databaseId,
          db.engine,
        );
      if (payload.version === 3 && expectedReport && !expected) {
        // Local completion receipt lost: recover hashes from the existing tagged
        // snapshot, never rerun hooks/dumps or materialize SQL in the live source.
        const digest = await runLifecycleProcess({
          binary: restic,
          args: ["-r", repository, "--no-lock", "dump", fullId, dumpPath],
          cwd: path.dirname(env.RCLONE_CONFIG!),
          env,
          shouldCancel,
          timeoutSeconds: db.timeoutSeconds,
          hashOutputMaxBytes: size,
        });
        if (digest.bytes !== size)
          throw new BackupLifecycleError(
            "snapshot-confirmation",
            "snapshot-confirmation-failed",
            db.databaseId,
            db.engine,
          );
        (expectedReport.databases ||= []).push({
          databaseId: db.databaseId!,
          engine: db.engine,
          database: db.database,
          path: dumpPath,
          ...digest,
        });
      }
    }
    if (expectedReport?.databases?.length === 1) {
      const { path: artifactPath, bytes, sha256 } = expectedReport.databases[0];
      expectedReport.database = { path: artifactPath, bytes, sha256 };
    }
    return fullId;
  } catch (error) {
    if (error instanceof BackupCancelledError) throw error;
    if (error instanceof BackupLifecycleError) throw error;
    throw new BackupLifecycleError(
      "snapshot-confirmation",
      "snapshot-confirmation-failed",
    );
  }
}

export async function executeFilesystemBackup(input: {
  payload: Record<string, unknown>;
  config: AgentConfig;
  allowedRoots: string[];
  shouldCancel: () => Promise<boolean>;
  onEvent: (event: Record<string, unknown>) => Promise<void>;
  onStage?: (event: BackupFilesystemStageEvent) => void;
  /** Internal local receipts; never accepted from the remote command payload. */
  successfulSnapshotIds?: string[];
  /** Trusted in-process test budget only; cannot be supplied in a command envelope or increase the deadline. */
  parentLookupTimeoutMs?: number;
}): Promise<BackupFilesystemResult> {
  let stage: BackupFilesystemStage = "payload-validation";
  let temporary: { directory: string; configPath: string } | undefined;
  let operationError: unknown;
  let job: BackupLifecycleJob | undefined;
  let completedResult: BackupFilesystemResult | undefined;
  const setStage = (
    next: BackupFilesystemStage,
    message?: BackupFilesystemStageEvent["message"],
  ): void => {
    stage = next;
    input.onStage?.({ stage: next, message: message || "stage started" });
  };
  const lifecycleEvent = async (
    checkpoint: LifecycleCheckpoint,
    database?: DatabaseCheckpoint,
  ): Promise<void> => {
    if (checkpoint === "pre-backup-started") stage = "pre-backup";
    if (checkpoint === "database-dump-started") stage = "database-dump";
    if (checkpoint === "post-backup-started") stage = "post-backup";
    input.onStage?.({
      stage,
      message: checkpoint,
      ...(database ? { database } : {}),
    });
    // Stage delivery is best-effort; failure must not undo a completed snapshot/cleanup.
    try {
      await input.onEvent({ lifecycleStage: checkpoint, ...database });
    } catch {
      /* Status polling refreshes the lease as well. */
    }
  };

  try {
    const payload = parseBackupFilesystemPayload(input.payload);
    setStage("payload-validation", "command accepted");

    setStage("source-validation");
    const source = (
      await preflightSource(payload.sourcePath, input.allowedRoots)
    ).resolvedPath;
    input.onStage?.({
      stage: "source-validation",
      message: "source validated",
    });

    setStage("state-validation");
    await assertSourceDoesNotOverlapState(source, input.config.dataDir);
    if (await input.shouldCancel()) throw new BackupCancelledError();

    setStage("tool-validation");
    let restic = privateBinaryPath(input.config.binDir, "restic");
    let rclone = privateBinaryPath(input.config.binDir, "rclone");
    if (payload.lifecycle) {
      restic = assertRootOwnedPath(await realpath(restic));
      rclone = assertRootOwnedPath(await realpath(rclone));
    }
    await Promise.all([
      access(restic, constants.X_OK),
      access(rclone, constants.X_OK),
    ]);

    const env: NodeJS.ProcessEnv = {
      PATH: payload.lifecycle
        ? `${path.dirname(restic)}:/usr/bin:/bin`
        : `${path.dirname(restic)}${path.delimiter}${process.env.PATH || ""}`,
      RESTIC_PASSWORD: payload.repositoryPassword,
      RESTIC_CACHE_DIR: path.join(input.config.dataDir, "restic-cache"),
    };
    const rcloneEnv: NodeJS.ProcessEnv = { PATH: env.PATH };
    setStage("sftp-password-obscure");
    const rcloneOptions = await obscureSensitiveSftpOptions(
      rclone,
      payload.rclone.options,
      rcloneEnv,
      input.shouldCancel,
    );
    setStage("temporary-storage-config");
    temporary = await writeTemporaryRcloneConfig(
      input.config.dataDir,
      rcloneOptions,
    );
    input.onStage?.({
      stage: "temporary-storage-config",
      message: "temporary storage config created",
    });
    env.RCLONE_CONFIG = temporary.configPath;
    rcloneEnv.RCLONE_CONFIG = temporary.configPath;
    const repository = `rclone:${payload.repository.remoteName}:${payload.repository.path}`;

    setStage("repository-check");
    input.onStage?.({
      stage: "repository-check",
      message: "repository check started",
    });
    input.onStage?.({
      stage: "repository-check",
      message: "existing backup snapshot lookup started",
    });
    const existing = await findExistingBackupSnapshot(
      restic,
      repository,
      payload.backupId,
      env,
      input.shouldCancel,
    );
    if (existing) {
      if (payload.lifecycle) {
        setStage("snapshot-confirmation");
        const replayReport: LifecycleReport = {
          warnings: [],
          ...(payload.version === 3 ? { databases: [] } : {}),
        };
        const fullId = await confirmLifecycleSnapshot(
          restic,
          repository,
          payload,
          existing.snapshotId,
          env,
          input.shouldCancel,
          source,
          replayReport,
        );
        existing.snapshotId = fullId;
        existing.summary.snapshot_id = fullId;
        existing.lifecycle = replayReport;
      }
      completedResult = existing;
      existing.sourcePaths = [source];
      return existing;
    }
    let artifacts: string[] = [];
    if (payload.lifecycle) {
      setStage("lifecycle-validation");
      if (source === "/pluton" || source.startsWith("/pluton/database"))
        throw new BackupLifecycleError(
          "lifecycle-validation",
          "lifecycle-invalid",
        );
      job = await BackupLifecycleJob.create(
        input.config,
        payload.lifecycle,
        input.shouldCancel,
        lifecycleEvent,
      );
      artifacts = await job.prepare();
      if (await input.shouldCancel()) throw new BackupCancelledError();
    }
    setStage("repository-target-check");
    await ensureManagedRepository(
      payload,
      restic,
      rclone,
      repository,
      env,
      rcloneEnv,
      input.shouldCancel,
      () => {
        setStage(
          "repository-initialization",
          "repository initialization started",
        );
      },
      (result) => setStage("repository-target-check", result),
    );

    // Restic records absolute input paths even for relative DB artifacts. Keep the
    // existing snapshot tree layout/private per-job workspace, but select only a
    // verified successful parent rather than changing/weakening source paths.
    let parent: string | undefined;
    setStage("repository-check", "initial repository verification started");
    const verify = async () => {
      await verifyRepository(
        restic,
        repository,
        env,
        input.shouldCancel,
        (diagnostic) =>
          input.onStage?.({
            stage: "repository-check",
            message: "real repository failure",
            diagnostic,
          }),
      );
      input.onStage?.({
        stage: "repository-check",
        message: "repository verified",
      });
    };
    await verify();
    const successfulIds = (input.successfulSnapshotIds || [])
      .filter((id) => /^[a-f0-9]{64}$/.test(id))
      .slice(-16);
    if (successfulIds.length) {
      setStage("parent-discovery", "parent candidate discovery started");
      try {
        const metadata = await runProgram(
          restic,
          ["-r", repository, ...resticParentDiscoveryArgs(payload.planId)],
          {
            env,
            shouldCancel: input.shouldCancel,
            timeoutMs:
              Number.isSafeInteger(input.parentLookupTimeoutMs) &&
              input.parentLookupTimeoutMs! > 0
                ? Math.min(
                    input.parentLookupTimeoutMs!,
                    PARENT_LOOKUP_TIMEOUT_MS,
                  )
                : PARENT_LOOKUP_TIMEOUT_MS,
            allowFailure: true,
            classifyRepositoryFailure: true,
            maxOutputBytes: 1024 * 1024,
          },
        );
        if (
          metadata.repositoryFailure &&
          metadata.repositoryFailure !== "process-failed"
        ) {
          input.onStage?.({
            stage: "repository-check",
            message: "real repository failure",
            diagnostic: metadata.repositoryFailure,
          });
          throw new BackupFilesystemError(
            "repository-check",
            metadata.repositoryFailure === "authentication-failed"
              ? "target-check-auth-failed"
              : metadata.repositoryFailure === "access-failed"
                ? "target-check-access-failed"
                : metadata.repositoryFailure === "transport-failed"
                  ? "target-check-transport-failed"
                  : "repository-check-failed",
          );
        }
        if (metadata.code !== 0)
          throw new Error("Parent lookup execution failed.");
        if (metadata.outputTruncated)
          throw new SyntaxError("Parent metadata exceeded the bounded output.");
        setStage("parent-verification", "parent metadata verification started");
        const snapshots: unknown = JSON.parse(metadata.stdout);
        if (!Array.isArray(snapshots))
          throw new SyntaxError("Invalid parent metadata collection.");
        parent = compatibleResticParent(snapshots, {
          successfulIds,
          planId: payload.planId,
          source,
          hostname: os.hostname(),
          jobsRoot: path.join(await realpath(input.config.dataDir), "jobs"),
          artifacts,
        });
        input.onStage?.({
          stage: "parent-verification",
          message: parent ? "parent selected" : "no compatible parent",
        });
      } catch (error) {
        if (
          error instanceof BackupCancelledError ||
          error instanceof BackupFilesystemError
        )
          throw error;
        try {
          if (await input.shouldCancel()) throw new BackupCancelledError();
        } catch (cancelError) {
          if (cancelError instanceof BackupCancelledError) throw cancelError;
          // Match the runner's existing outage policy; hard repository/process
          // deadlines still apply, and a confirmed cancellation is never ignored.
        }
        if (error instanceof ProgramTimeoutError && error.diagnostic) {
          input.onStage?.({
            stage: "repository-check",
            message: "real repository failure",
            diagnostic: error.diagnostic,
          });
          throw toBackupFilesystemError(error, "repository-check");
        }
        input.onStage?.({
          stage: "parent-discovery",
          message:
            error instanceof ProgramTimeoutError
              ? "parent lookup timeout; checking repository before fallback"
              : error instanceof SyntaxError
                ? "parent metadata invalid; checking repository before fallback"
                : "parent lookup failed; checking repository before fallback",
        });
        setStage("repository-check", "repository reverification started");
        await verify();
        input.onStage?.({
          stage: "parent-discovery",
          message: "parent lookup fallback; continuing without explicit parent",
        });
      }
    } else
      input.onStage?.({
        stage: "parent-discovery",
        message: "no compatible parent",
      });
    setStage("restic-backup");
    // Re-check the selected root after preparation; do not follow a changed symlink.
    if (
      (await preflightSource(payload.sourcePath, input.allowedRoots))
        .resolvedPath !== source
    )
      throw new SourceAccessError("source-symlink-escape");
    if (job) await lifecycleEvent("backup-started");
    input.onStage?.({
      stage: "restic-backup",
      message: "restic backup started",
    });
    let summary: ResticSummary | null = null;
    let lastProgress = 0;
    const args = [
      "-r",
      repository,
      "backup",
      source,
      ...artifacts,
      "--host",
      os.hostname(),
      ...resticParentArgs(parent),
      "--json",
      "--tag",
      `pluton-plan-${payload.planId}`,
      "--tag",
      `pluton-backup-${payload.backupId}`,
    ];
    for (const exclude of payload.excludes) args.push("--exclude", exclude);
    await runProgram(restic, args, {
      env,
      source,
      ...(job ? { cwd: job.workspace, timeoutMs: 24 * 60 * 60 * 1000 } : {}),
      shouldCancel: input.shouldCancel,
      onJsonLine: async (event) => {
        const parsedSummary = summaryFromRestic(event);
        if (parsedSummary) {
          summary = parsedSummary;
          return;
        }
        const progress = progressFromRestic(event);
        if (!progress || Date.now() - lastProgress < PROGRESS_INTERVAL_MS)
          return;
        lastProgress = Date.now();
        await input.onEvent(progress);
      },
    });
    if (!summary)
      throw new BackupFilesystemError(
        "restic-backup",
        "restic-summary-missing",
      );
    // TypeScript cannot observe the assignment performed by the async JSON-line
    // callback, but runProgram awaits that callback chain before returning.
    const completedSummary = summary as ResticSummary;
    if (job) {
      setStage("snapshot-confirmation");
      completedSummary.snapshot_id = await confirmLifecycleSnapshot(
        restic,
        repository,
        payload,
        completedSummary.snapshot_id,
        env,
        input.shouldCancel,
        source,
        job.report,
      );
    }
    const result = {
      snapshotId: completedSummary.snapshot_id,
      sourcePaths: [source],
      summary: completedSummary,
      ...(job ? { lifecycle: job.report } : {}),
    };
    completedResult = result;
    if (job) await lifecycleEvent("backup-completed");
    input.onStage?.({ stage: "restic-backup", message: "backup completed" });
    return result;
  } catch (error) {
    operationError = error;
    throw toBackupFilesystemError(error, stage);
  } finally {
    if (job) await job.cleanup();
    if (temporary) {
      try {
        setStage("cleanup");
        await rm(temporary.directory, { recursive: true, force: true });
      } catch (error) {
        // Never replace the actionable operation failure with a cleanup error.
        // If cleanup is the only failure, return a safe cleanup classification.
        if (completedResult?.lifecycle) {
          completedResult.lifecycle.warnings.push({
            stage: "cleanup",
            code: "cleanup-failed",
          });
        } else if (!operationError) {
          throw toBackupFilesystemError(error, "cleanup");
        }
      }
    }
  }
}
