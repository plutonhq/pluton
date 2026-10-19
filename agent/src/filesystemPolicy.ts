import path from "node:path";
import { access, lstat, opendir, readlink, realpath } from "node:fs/promises";
import { constants } from "node:fs";

export type SourceAccessCode =
  | "source-parent-not-traversable"
  | "source-root-not-readable"
  | "source-entry-inaccessible"
  | "source-missing"
  | "source-symlink-escape"
  | "source-unsupported-type"
  | "source-policy-violation";

/** Paths are only for the explicit local CLI diagnostic, never provider errors or journal messages. */
export class SourceAccessError extends Error {
  constructor(
    readonly code: SourceAccessCode,
    readonly requestedPath?: string,
    readonly resolvedPath?: string,
    readonly blockedPath?: string,
  ) {
    super(
      code === "source-policy-violation"
        ? "An absolute path without traversal is required; paths outside allowed roots are refused."
        : code === "source-symlink-escape"
          ? "Source symlink is outside allowed roots or changed during validation."
          : `Source access preflight failed (${code}).`,
    );
  }
}

export function safeSourceDiagnosticPath(value?: string): string | undefined {
  if (!value) return undefined;
  return value.length > 4096 ||
    /[\x00-\x1f\x7f]|(?:password|token|secret|credential|key)=|:\/\//i.test(
      value,
    )
    ? "[redacted path]"
    : value;
}

function rejectUnsafePath(value: string): void {
  if (
    !value ||
    value.length > 4096 ||
    /[\x00-\x1f\x7f]/.test(value) ||
    !path.isAbsolute(value) ||
    value.split(/[\\/]+/).includes("..")
  )
    throw new SourceAccessError("source-policy-violation");
}

function within(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

async function assertTraversableParents(
  candidate: string,
  requested = candidate,
): Promise<void> {
  const parent = path.dirname(candidate),
    root = path.parse(parent).root;
  let current = root;
  for (const part of [
    "",
    ...parent.slice(root.length).split(path.sep).filter(Boolean),
  ]) {
    if (part) current = path.join(current, part);
    try {
      await access(current, constants.X_OK);
    } catch (error) {
      throw new SourceAccessError(
        (error as NodeJS.ErrnoException).code === "ENOENT"
          ? "source-missing"
          : "source-parent-not-traversable",
        requested,
        candidate,
        current,
      );
    }
  }
}

async function resolveSource(candidate: string): Promise<string> {
  try {
    return await realpath(candidate);
  } catch (error) {
    let target = candidate;
    try {
      if ((await lstat(candidate)).isSymbolicLink())
        target = path.resolve(
          path.dirname(candidate),
          await readlink(candidate),
        );
    } catch {
      /* Metadata only; no unvalidated directory walk. */
    }
    if (
      ["EACCES", "EPERM"].includes((error as NodeJS.ErrnoException).code || "")
    ) {
      await assertTraversableParents(target, candidate);
      throw new SourceAccessError(
        "source-root-not-readable",
        candidate,
        target,
        target,
      );
    }
    throw new SourceAccessError(
      (error as NodeJS.ErrnoException).code === "ELOOP"
        ? "source-symlink-escape"
        : "source-missing",
      candidate,
      target,
    );
  }
}

export async function resolveAllowedRoots(roots: string[]): Promise<string[]> {
  const resolved = await Promise.all(
    roots.map(async (root) => {
      rejectUnsafePath(root);
      return resolveSource(root);
    }),
  );
  return [...new Set(resolved)];
}

/** Realpath containment rejects traversal, sibling-prefix tricks and symlink escapes. */
export async function assertPathWithinAllowedRoots(
  candidate: string,
  roots: string[],
): Promise<string> {
  rejectUnsafePath(candidate);
  const resolvedRoots = await resolveAllowedRoots(roots);
  const resolvedCandidate = await resolveSource(candidate);
  if (!resolvedRoots.some((root) => within(root, resolvedCandidate)))
    throw new SourceAccessError(
      path.resolve(candidate) !== resolvedCandidate
        ? "source-symlink-escape"
        : "source-policy-violation",
      candidate,
      resolvedCandidate,
    );
  return resolvedCandidate;
}

/** Cheap per-backup check. CLI --scan is bounded and is never called on heartbeat. */
export async function preflightSource(
  candidate: string,
  roots: string[],
  options: { scan?: boolean; maxEntries?: number; deadlineMs?: number } = {},
) {
  const resolved = await assertPathWithinAllowedRoots(candidate, roots);
  await assertTraversableParents(resolved, candidate);
  const check = async (entry: string, root = false) => {
    try {
      const stat = await lstat(entry);
      if (stat.isSymbolicLink()) {
        if (root)
          throw new SourceAccessError(
            "source-symlink-escape",
            candidate,
            resolved,
            entry,
          );
        return stat; // Restic archives nested links; never traverse their targets here.
      }
      if (!stat.isFile() && !stat.isDirectory())
        throw new SourceAccessError(
          "source-unsupported-type",
          candidate,
          resolved,
          entry,
        );
      await access(
        entry,
        constants.R_OK | (stat.isDirectory() ? constants.X_OK : 0),
      );
      return stat;
    } catch (error) {
      if (error instanceof SourceAccessError) throw error;
      throw new SourceAccessError(
        (error as NodeJS.ErrnoException).code === "ENOENT"
          ? "source-missing"
          : root
            ? "source-root-not-readable"
            : "source-entry-inaccessible",
        candidate,
        resolved,
        entry,
      );
    }
  };
  const stat = await check(resolved, true);
  if ((await resolveSource(resolved)) !== resolved)
    throw new SourceAccessError("source-symlink-escape", candidate, resolved);
  const report = {
    requestedPath: candidate,
    resolvedPath: resolved,
    entriesChecked: 1,
    linksNotFollowed: 0,
    scan: options.scan ? "complete" : "not-requested",
  };
  if (!options.scan || !stat.isDirectory()) return report;
  const limit = Math.max(1, Math.min(options.maxEntries || 10_000, 10_000));
  const end =
    Date.now() + Math.max(1, Math.min(options.deadlineMs || 5000, 5000));
  const pending = [resolved];
  while (pending.length) {
    const directory = pending.pop()!;
    try {
      if (
        (await resolveSource(directory)) !== directory ||
        !within(resolved, directory)
      )
        throw new SourceAccessError(
          "source-symlink-escape",
          candidate,
          resolved,
          directory,
        );
      for await (const entry of await opendir(directory)) {
        if (report.entriesChecked >= limit || Date.now() >= end) {
          report.scan =
            report.entriesChecked >= limit ? "entry-limit" : "deadline";
          return report; // Iterator closes its fd; a partial scan is explicit.
        }
        const filename = path.join(directory, entry.name),
          info = await check(filename);
        report.entriesChecked++;
        if (info.isSymbolicLink()) report.linksNotFollowed++;
        else if (info.isDirectory()) pending.push(filename);
      }
    } catch (error) {
      if (error instanceof SourceAccessError) throw error;
      throw new SourceAccessError(
        "source-entry-inaccessible",
        candidate,
        resolved,
        directory,
      );
    }
  }
  return report;
}
