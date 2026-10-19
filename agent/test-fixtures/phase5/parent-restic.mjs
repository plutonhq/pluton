#!/usr/local/bin/node
// Root-owned disposable fault injector. All other operations use real Restic.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
const args = process.argv.slice(2);
const state = path.dirname(path.dirname(process.env.RCLONE_CONFIG));
fs.appendFileSync(
  path.join(state, "parent-restic-calls"),
  JSON.stringify(args) + "\n",
);
let mode = "";
try {
  mode = fs.readFileSync(path.join(state, "parent-fixture-mode"), "utf8");
} catch {}
if (args.includes("--latest")) {
  fs.writeFileSync(path.join(state, "parent-lookup-started"), "started");
  if (
    mode === "timeout" ||
    mode === "timeout-unavailable" ||
    mode === "cancelled"
  ) {
    const child = spawn(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)"],
      { stdio: "inherit" },
    );
    fs.writeFileSync(path.join(state, "parent-child-pid"), String(child.pid));
    setInterval(() => {}, 1000);
  } else if (mode === "malformed") {
    console.log("synthetic invalid JSON");
    process.exit(0);
  } else if (mode === "process-failed") {
    // Generated credential material tests redaction; never persisted in fixture logs.
    process.stderr.write(process.env.RESTIC_PASSWORD);
    process.exit(1);
  } else {
    const child = spawn("/usr/local/bin/restic", args, {
      stdio: "inherit",
      env: process.env,
    });
    child.on("exit", (code) => process.exit(code ?? 1));
  }
} else if (
  args.includes("cat") &&
  mode === "timeout-unavailable" &&
  fs.existsSync(path.join(state, "parent-lookup-started"))
) {
  process.exit(10);
} else {
  const child = spawn("/usr/local/bin/restic", args, {
    stdio: "inherit",
    env: process.env,
  });
  child.on("exit", (code) => process.exit(code ?? 1));
}
