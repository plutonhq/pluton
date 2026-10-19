import test from "node:test";
import assert from "node:assert/strict";
import {
  compatibleResticParent,
  resticParentArgs,
  successfulSnapshotIds,
  resticParentDiscoveryArgs,
  PARENT_LOOKUP_TIMEOUT_MS,
} from "./resticParent.js";

test("parent discovery lists current plan metadata without loading receipt IDs and keeps the original bounded deadline", () => {
  assert.deepEqual(resticParentDiscoveryArgs("plan-01"), [
    "--no-lock",
    "snapshots",
    "--json",
    "--tag",
    "pluton-plan-plan-01",
    "--latest",
    "16",
  ]);
  assert.equal(PARENT_LOOKUP_TIMEOUT_MS, 60_000);
  assert.throws(() => resticParentDiscoveryArgs("plan-01,other-plan"));
  assert.throws(() => resticParentDiscoveryArgs("../other"));
});
import {
  summaryForExistingSnapshot,
  BackupCancelledError,
  toBackupFilesystemError,
} from "./backupFilesystem.js";
import { backupProgressStage } from "./progressDelivery.js";

test("parent journal stages retain existing progress and cancellation protocol vocabulary", () => {
  for (const stage of ["parent-discovery", "parent-verification"] as const) {
    assert.equal(backupProgressStage(stage), "preparing-repository");
    const error = toBackupFilesystemError(new BackupCancelledError(), stage);
    assert.equal(error.stage, "repository-check");
    assert.equal(error.code, "cancelled");
  }
});

const id = "a".repeat(64);
const snapshot = {
  id,
  tree: "c".repeat(64),
  hostname: "app-01",
  time: "2026-01-01T00:00:00Z",
  tags: ["pluton-plan-plan-01", "pluton-backup-backup-01"],
  paths: [
    "/srv/example-app",
    "/var/lib/pluton-agent/jobs/job-abc123/pluton/database/app.sql",
  ],
};
const input = {
  successfulIds: [id],
  planId: "plan-01",
  source: "/srv/example-app",
  hostname: "app-01",
  jobsRoot: "/var/lib/pluton-agent/jobs",
  artifacts: ["pluton/database/app.sql"],
};

test("parent accepts private changing workspace only for the same successful plan/source/host/layout", () => {
  assert.equal(compatibleResticParent([snapshot], input), id);
  assert.equal(
    compatibleResticParent([{ ...snapshot, paths: [input.source] }], {
      ...input,
      artifacts: [],
    }),
    id,
  );
  assert.deepEqual(resticParentArgs(id), [
    "--parent",
    id,
    "--group-by",
    "host",
  ]);
  assert.deepEqual(resticParentArgs(undefined), [
    "--group-by",
    "host,paths,tags",
  ]);
});
for (const [name, change] of Object.entries({
  "other plan": { tags: ["pluton-plan-plan-02", "pluton-backup-backup-02"] },
  "multiple plan tags": { tags: [...snapshot.tags, "pluton-plan-plan-02"] },
  "other host": { hostname: "app-02" },
  "changed source": { paths: ["/srv/other-app", snapshot.paths[1]] },
  "changed artifact set": {
    paths: [
      input.source,
      snapshot.paths[1],
      "/var/lib/pluton-agent/jobs/job-abc123/pluton/database/logs.sql",
    ],
  },
  "other state root": {
    paths: [input.source, "/tmp/job-abc123/pluton/database/app.sql"],
  },
  "path escape": {
    paths: [
      input.source,
      "/var/lib/pluton-agent/jobs/job-abc123/../pluton/database/app.sql",
    ],
  },
  "invalid id": { id: "latest" },
  "invalid tree": { tree: "bad" },
  "invalid time": { time: "bad" },
  "future time": { time: "2099-01-01T00:00:00Z" },
  "missing backup tag": { tags: ["pluton-plan-plan-01"] },
}))
  test(`parent refuses ${name}`, () =>
    assert.equal(
      compatibleResticParent([{ ...snapshot, ...change }], input),
      undefined,
    ));
test("failed/unreceipted snapshots cannot become parents, even if newest", () => {
  assert.equal(
    compatibleResticParent([snapshot], { ...input, successfulIds: [] }),
    undefined,
  );
  const newer = {
    ...snapshot,
    id: "b".repeat(64),
    time: "2026-01-02T00:00:00Z",
  };
  assert.equal(compatibleResticParent([snapshot, newer], input), id);
  assert.equal(
    compatibleResticParent([snapshot, newer], {
      ...input,
      successfulIds: [id, newer.id],
    }),
    newer.id,
  );
  assert.deepEqual(
    successfulSnapshotIds([
      { success: false, result: { snapshotId: id } },
      { success: true, result: { snapshotId: newer.id } },
      { success: true, result: { snapshotId: "latest" } },
    ]),
    [newer.id],
  );
});
test("multi-DB parent requires exact filenames and one historical workspace", () => {
  const artifacts = ["pluton/database/app.sql", "pluton/database/logs.sql"];
  const paths = [
    ...snapshot.paths,
    "/var/lib/pluton-agent/jobs/job-abc123/pluton/database/logs.sql",
  ];
  assert.equal(
    compatibleResticParent([{ ...snapshot, paths }], { ...input, artifacts }),
    id,
  );
  paths[2] = paths[2].replace("abc123", "def456");
  assert.equal(
    compatibleResticParent([{ ...snapshot, paths }], { ...input, artifacts }),
    undefined,
  );
});
test("lost-receipt replay restores actual stored Restic statistics, not fabricated zeros", () => {
  const stats = {
    files_new: 4,
    files_changed: 1,
    files_unmodified: 10,
    dirs_new: 2,
    dirs_changed: 1,
    dirs_unmodified: 0,
    data_blobs: 3,
    tree_blobs: 2,
    data_added: 300,
    data_added_packed: 100,
    total_files_processed: 15,
    total_bytes_processed: 900,
    backup_start: "2026-01-01T00:00:00Z",
    backup_end: "2026-01-01T00:00:02Z",
  };
  assert.deepEqual(summaryForExistingSnapshot(id, stats), {
    ...Object.fromEntries(
      Object.entries(stats).filter(([key]) => !key.startsWith("backup_")),
    ),
    message_type: "summary",
    snapshot_id: id,
    total_duration: 2,
  });
  assert.throws(
    () => summaryForExistingSnapshot(id, undefined),
    /No valid Restic summary|summary|statistics|Remote/,
  );
});
