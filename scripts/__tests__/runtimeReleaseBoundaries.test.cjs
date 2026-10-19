"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { verifyRuntime } = require("../verify-runtime-release-boundaries.cjs");
const root = path.resolve(__dirname, "../..");
function fixture(t) {
  const temporary = fs.mkdtempSync(
    path.join(os.tmpdir(), "pluton-release-test-"),
  );
  t.after(() => fs.rmSync(temporary, { recursive: true }));
  for (const name of [
    "backend/dist",
    "backend/public",
    "drizzle",
    "node_modules",
  ])
    fs.mkdirSync(path.join(temporary, name), { recursive: true });
  fs.writeFileSync(path.join(temporary, "LICENSE"), "Apache-2.0");
  fs.writeFileSync(path.join(temporary, "backend/dist/index.js"), "export {};");
  fs.writeFileSync(
    path.join(temporary, "drizzle/0015_reviewed.sql"),
    "CREATE TABLE example(id TEXT);",
  );
  return temporary;
}
test("release accepts compiled app, public UI and intended SQL migrations", (t) => {
  assert.equal(verifyRuntime(fixture(t)), 2);
});
test("release rejects fixture, local state, credential-file and developer-path payloads", (t) => {
  const temporary = fixture(t);
  for (const name of [
    "backend/public/.env",
    "backend/public/synthetic.sql",
    "backend/dist/local.db",
    "backend/dist/private.key",
    "backend/dist/automatic-recovery-vm-debug.cjs",
  ]) {
    const file = path.join(temporary, name);
    fs.writeFileSync(file, "not production data");
    assert.throws(() => verifyRuntime(temporary));
    fs.unlinkSync(file);
  }
  const file = path.join(temporary, "backend/dist/debug.js");
  for (const value of [
    "C:/Users/example/.ssh/key",
    "C:\\laragon\\www\\example",
    "/srv/pluton-fixture/lifecycle-lab-" + "a".repeat(32),
    "fixture_admin",
  ]) {
    fs.writeFileSync(file, value);
    assert.throws(() => verifyRuntime(temporary));
  }
});
test("CI hard-gates frontend interaction tests and non-root read-only runtime artifact verification", () => {
  const workflow = fs.readFileSync(
    path.join(root, ".github/workflows/container.yml"),
    "utf8",
  );
  const frontend = workflow
    .split(
      "- name: Test frontend state, polling, accessibility and recovery regressions",
    )[1]
    .split("- name:")[0];
  assert.match(
    frontend,
    /node --experimental-strip-types --test frontend\/__tests__\/\*\.test\.ts/,
  );
  assert.doesNotMatch(frontend, /continue-on-error/);
  assert.match(workflow, /automaticRecoveryRequests\.test\.cjs/);
  const artifact = workflow
    .split(
      "- name: Verify release excludes test fixtures, host operators and local state",
    )[1]
    .split("- name:")[0];
  assert.match(artifact, /--network none --read-only --user 10001:10001/);
  assert.match(
    artifact,
    /--cap-drop ALL --security-opt no-new-privileges:true/,
  );
  assert.match(
    artifact,
    /--memory 256m --memory-swap 256m --cpus 1 --pids-limit 32/,
  );
  assert.match(artifact, /verify-runtime-release-boundaries\.cjs/);
  assert.doesNotMatch(artifact, /continue-on-error|docker\.sock|--privileged/);
  assert.match(
    fs.readFileSync(path.join(root, ".dockerignore"), "utf8"),
    /^scripts\/automatic-recovery-vm-\*$/m,
  );
});
