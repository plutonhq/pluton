"use strict";
// CI-only read-only artifact inspection. Never starts Pluton, opens /data,
// invokes Docker, follows application symlinks or prints captured file contents.
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

function verifyRuntime(root = "/app") {
  assert.deepEqual(fs.readdirSync(root).sort(), [
    "LICENSE",
    "backend",
    "drizzle",
    "node_modules",
  ]);
  const pending = ["backend", "drizzle"];
  let checked = 0;
  while (pending.length) {
    const relative = pending.pop(),
      file = path.join(root, relative);
    // Third-party production packages are separately locked; do not confuse
    // their vendor tests/licenses with Pluton's own fixture/data payload.
    if (relative === "backend/node_modules") continue;
    const stat = fs.lstatSync(file);
    assert(!stat.isSymbolicLink());
    assert(
      !/(?:^|\/)(?:__tests__|fixtures|data|\.env(?:\.[^/]*)?)(?:\/|$)/.test(
        relative,
      ),
    );
    assert(
      !/(?:automatic-recovery-vm-|automaticRecovery(?:Api|Native|Visual|Vm)|\.(?:test|spec)\.)/.test(
        relative,
      ),
    );
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(file))
        pending.push(path.posix.join(relative, name));
      continue;
    }
    assert(stat.isFile());
    assert(
      !/\.(?:db|sqlite(?:3)?|ext4|tar|tgz|pem|key)$|(?:^|\/)(?:keys|config)\.json$/.test(
        relative,
      ),
    );
    assert(!relative.endsWith(".sql") || relative.startsWith("drizzle/"));
    if (/\.(?:[cm]?js|json|map|html|css|ts)$/.test(relative)) {
      const text = fs.readFileSync(file, "utf8");
      assert(
        !/(?:[A-Z]:[\\/]+(?:Users|laragon)[\\/]+|\/srv\/pluton-fixture\/lifecycle-lab-[a-f0-9]{32})/i.test(
          text,
        ),
      );
      if (relative.startsWith("backend/dist/"))
        assert(
          !/disposable-lifecycle-rehearsal|operator-held-synthetic-visual-acceptance|fixture_admin/.test(
            text,
          ),
        );
    }
    checked++;
  }
  for (const directory of ["backend/dist", "backend/public", "drizzle"])
    assert(fs.statSync(path.join(root, directory)).isDirectory());
  return checked;
}
module.exports = { verifyRuntime };
if (require.main === module) {
  try {
    assert.equal(process.argv.length, 2);
    assert.equal(process.getuid(), 10001);
    assert.equal(process.getgid(), 10001);
    assert.equal(process.getgid(), 10001);
    for (const forbidden of [
      "/workspace",
      "/app/scripts",
      "/app/deploy",
      "/opt/pluton-recovery-operator",
    ])
      assert(!fs.existsSync(forbidden));
    assert(
      !fs
        .readdirSync("/app/node_modules/.pnpm")
        .some((name) => /^jsdom@/.test(name)),
    );
    assert.notEqual(process.env.PLUTON_AUTOMATIC_RECOVERY, "enabled");
    const checked = verifyRuntime();
    process.stdout.write(
      JSON.stringify({
        event: "runtime_release_boundaries_verified",
        uid: 10001,
        gid: 10001,
        gid: 10001,
        checked,
      }) + "\n",
    );
  } catch {
    process.stderr.write(
      "Runtime release boundary verification failed; no file contents disclosed.\n",
    );
    process.exitCode = 1;
  }
}
