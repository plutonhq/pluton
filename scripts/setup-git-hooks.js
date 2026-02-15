#!/usr/bin/env node

const { existsSync, chmodSync } = require("fs");
const { spawnSync } = require("child_process");

if (!existsSync(".git")) {
  console.log("[hooks] Skipped: not a git checkout.");
  process.exit(0);
}

const result = spawnSync(
  "git",
  ["config", "--local", "core.hooksPath", ".githooks"],
  {
    stdio: "inherit",
  },
);

if (result.status !== 0) {
  console.log(
    "[hooks] Failed to configure core.hooksPath. Run manually: git config --local core.hooksPath .githooks",
  );
  process.exit(result.status || 1);
}

try {
  if (existsSync(".githooks/pre-push")) {
    chmodSync(".githooks/pre-push", 0o755);
  }
} catch {
  // ignore on filesystems that do not support chmod
}

console.log("[hooks] Configured git hooks path to .githooks");
