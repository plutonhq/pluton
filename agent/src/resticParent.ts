import path from "node:path";

export const PARENT_LOOKUP_TIMEOUT_MS = 60_000;

/** Enumerate existing metadata, never directly load possibly foreign/stale receipt IDs. */
export function resticParentDiscoveryArgs(planId: string): string[] {
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(planId))
    throw new Error("Invalid parent plan binding.");
  return [
    "--no-lock",
    "snapshots",
    "--json",
    "--tag",
    `pluton-plan-${planId}`,
    "--latest",
    "16",
  ];
}

/** Local successful completion receipts, not untrusted command-supplied parents. */
export function successfulSnapshotIds(
  receipts: { success: boolean; result?: Record<string, unknown> }[],
): string[] {
  return [
    ...new Set(
      receipts
        .filter((receipt) => receipt.success)
        .map((receipt) => receipt.result?.snapshotId)
        .filter(
          (id): id is string =>
            typeof id === "string" && /^[a-f0-9]{64}$/.test(id),
        ),
    ),
  ].slice(-16);
}

/** The caller reads metadata from the exact managed repository with its password. */
export function compatibleResticParent(
  snapshots: unknown,
  input: {
    successfulIds: string[];
    planId: string;
    source: string;
    hostname: string;
    jobsRoot: string;
    artifacts: string[];
    now?: number;
  },
): string | undefined {
  if (!Array.isArray(snapshots)) return;
  const eligible = new Set(input.successfulIds);
  const jobsRoot = path.posix.normalize(input.jobsRoot);
  const compatible = snapshots.filter((snapshot) => {
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot))
      return false;
    if (
      typeof snapshot.id !== "string" ||
      !/^[a-f0-9]{64}$/.test(snapshot.id) ||
      !eligible.has(snapshot.id) ||
      typeof snapshot.tree !== "string" ||
      !/^[a-f0-9]{64}$/.test(snapshot.tree) ||
      snapshot.hostname !== input.hostname ||
      typeof snapshot.time !== "string" ||
      !Number.isFinite(Date.parse(snapshot.time)) ||
      Date.parse(snapshot.time) > (input.now ?? Date.now()) ||
      !Array.isArray(snapshot.tags) ||
      !snapshot.tags.includes(`pluton-plan-${input.planId}`) ||
      snapshot.tags.filter(
        (tag: unknown) =>
          typeof tag === "string" && tag.startsWith("pluton-plan-"),
      ).length !== 1 ||
      !snapshot.tags.some(
        (tag: unknown) =>
          typeof tag === "string" && /^pluton-backup-[A-Za-z0-9_-]+$/.test(tag),
      ) ||
      !Array.isArray(snapshot.paths) ||
      snapshot.paths.length !== input.artifacts.length + 1 ||
      snapshot.paths.filter((item: unknown) => item === input.source).length !==
        1
    )
      return false;
    const remaining = new Set(input.artifacts);
    let workspace: string | undefined;
    for (const item of snapshot.paths) {
      if (item === input.source) continue;
      if (
        typeof item !== "string" ||
        path.posix.normalize(item) !== item ||
        !item.startsWith(jobsRoot + "/")
      )
        return false;
      const relative = item.slice(jobsRoot.length + 1);
      const slash = relative.indexOf("/");
      const job = relative.slice(0, slash);
      const artifact = relative.slice(slash + 1);
      if (
        !/^job-[A-Za-z0-9_-]+$/.test(job) ||
        !remaining.delete(artifact) ||
        (workspace && workspace !== job)
      )
        return false;
      workspace = job;
    }
    return remaining.size === 0;
  });
  compatible.sort(
    (a, b) =>
      Date.parse(b.time) - Date.parse(a.time) ||
      input.successfulIds.indexOf(b.id) - input.successfulIds.indexOf(a.id),
  );
  return compatible[0]?.id;
}

export function resticParentArgs(parent: string | undefined): string[] {
  // Unique backup tag excludes implicit cross-plan/path grouping when no verified parent exists.
  return parent
    ? ["--parent", parent, "--group-by", "host"]
    : ["--group-by", "host,paths,tags"];
}
