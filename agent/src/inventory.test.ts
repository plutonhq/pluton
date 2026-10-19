import assert from "node:assert/strict";
import test from "node:test";
import { commandTypesForInventory } from "./inventory.js";

test("does not advertise BACKUP_FILESYSTEM when a private backup binary is unavailable", () => {
  assert.deepEqual(
    commandTypesForInventory({
      filesystemRootsConfigured: true,
      resticVersion: "restic 0.19.1 compiled with go1.25.1 on linux/amd64",
    }),
    ["PING", "INVENTORY_REFRESH"],
  );
});

test("advertises BACKUP_FILESYSTEM only with roots and both private tools", () => {
  assert.deepEqual(
    commandTypesForInventory({
      filesystemRootsConfigured: true,
      resticVersion: "restic 0.19.1 compiled with go1.25.1 on linux/amd64",
      rcloneVersion: "rclone v1.75.1",
    }),
    ["PING", "INVENTORY_REFRESH", "BACKUP_FILESYSTEM"],
  );
  assert.deepEqual(
    commandTypesForInventory({
      filesystemRootsConfigured: false,
      resticVersion: "restic 0.19.1",
      rcloneVersion: "rclone v1.75.1",
    }),
    ["PING", "INVENTORY_REFRESH"],
  );
});
