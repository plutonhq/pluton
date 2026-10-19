import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { ProgressDelivery } from "./progressDelivery.js";
import {
  progressFromRestic,
  sourceFailureFromRestic,
} from "./backupFilesystem.js";
import {
  preflightSource,
  safeSourceDiagnosticPath,
  SourceAccessError,
} from "./filesystemPolicy.js";
import {
  runLifecycleProcess,
  LifecycleProcessError,
} from "./lifecycleProcess.js";
import { createAgentConfig } from "./config.js";
import { AgentTransport } from "./transport.js";
import { checkConnection, runOnce } from "./runtime.js";
import { saveIdentity } from "./identity.js";
import { execFileSync } from "node:child_process";

test("Restic 0.19 status fields produce real bounded counters, not summary field names or fabricated percentages", () => {
  assert.deepEqual(
    progressFromRestic({
      message_type: "status",
      bytes_done: 91,
      files_done: 3,
      total_bytes: 110,
      total_files: 4,
      current_files: ["/not-forwarded"],
      percent_done: 0.8,
    }),
    {
      phase: "running",
      backupStage: "backing-up",
      progress: {
        bytesProcessed: 91,
        filesProcessed: 3,
        totalBytesProcessed: 110,
        totalFilesProcessed: 4,
      },
    },
  );
  assert.equal(progressFromRestic({ message_type: "summary" }), null);
  assert.deepEqual(
    progressFromRestic({
      message_type: "status",
      bytes_done: NaN,
      files_done: -1,
    })?.progress,
    {
      bytesProcessed: 0,
      filesProcessed: 0,
      totalBytesProcessed: 0,
      totalFilesProcessed: 0,
    },
  );
});
test("progress outage/reconnect coalesces events without blocking or failing the backup; flush serializes before completion", async () => {
  const sent: Record<string, unknown>[] = [];
  let failed = 0;
  let resume!: () => void;
  const gate = new Promise<void>((resolve) => {
    resume = resolve;
  });
  const delivery = new ProgressDelivery(
    async (event) => {
      sent.push(event);
      if (sent.length === 1) {
        await gate;
        throw new Error("synthetic network error");
      }
    },
    () => {
      failed++;
    },
  );
  delivery.enqueue({ backupStage: "validating-source" });
  for (let i = 1; i <= 500; i++)
    delivery.enqueue({
      backupStage: "backing-up",
      progress: { bytesProcessed: i },
    });
  assert.equal(sent.length, 1);
  resume();
  await delivery.flush();
  assert.equal(failed, 1);
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[1].progress, { bytesProcessed: 500 });
  delivery.enqueue({ backupStage: "cleanup" });
  await delivery.flush();
  assert.equal(sent.at(-1)?.backupStage, "cleanup");
});
test("Restic source JSON is classified without leaking raw errors; storage/provider errors cannot be mistaken for source failures", () => {
  const record = (item: string, message: string) =>
    JSON.stringify({
      message_type: "error",
      during: "archival",
      item,
      error: { message },
    });
  assert.equal(
    sourceFailureFromRestic(
      record("/srv/example-app/a", "open: permission denied secret=test-only"),
      "/srv/example-app",
    ),
    "source-entry-inaccessible",
  );
  assert.equal(
    sourceFailureFromRestic(
      record("/srv/example-app/a", "no such file or directory"),
      "/srv/example-app",
    ),
    "source-missing",
  );
  assert.equal(
    sourceFailureFromRestic(
      record("/srv/example-app-other/a", "permission denied"),
      "/srv/example-app",
    ),
    undefined,
  );
  assert.equal(
    sourceFailureFromRestic("sftp permission denied", "/srv/example-app"),
    undefined,
  );
});
const linux =
  process.platform === "linux" && process.getuid?.() !== 0 ? test : test.skip;
linux(
  "source preflight differentiates parent/root/entry denial; cheap check does not scan; nested symlinks are not followed",
  async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "source-preflight-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const parent = path.join(root, "parent"),
      source = path.join(parent, "source"),
      alias = path.join(root, "alias");
    await mkdir(source, { recursive: true });
    await symlink(source, alias);
    await writeFile(path.join(source, "a"), "fixture");
    const valid = await preflightSource(alias, [source]);
    assert.equal(valid.resolvedPath, source);
    assert.equal(valid.scan, "not-requested");
    assert.equal(valid.entriesChecked, 1);
    await chmod(parent, 0o600);
    try {
      await assert.rejects(
        preflightSource(alias, [source]),
        (error) =>
          error instanceof SourceAccessError &&
          error.code === "source-parent-not-traversable" &&
          error.blockedPath === parent,
      );
    } finally {
      await chmod(parent, 0o700);
    }
    await chmod(source, 0o100);
    try {
      await assert.rejects(
        preflightSource(alias, [source]),
        (error) =>
          error instanceof SourceAccessError &&
          error.code === "source-root-not-readable",
      );
    } finally {
      await chmod(source, 0o700);
    }
    await chmod(path.join(source, "a"), 0);
    try {
      assert.equal((await preflightSource(alias, [source])).entriesChecked, 1);
      await assert.rejects(
        preflightSource(alias, [source], { scan: true }),
        (error) =>
          error instanceof SourceAccessError &&
          error.code === "source-entry-inaccessible",
      );
    } finally {
      await chmod(path.join(source, "a"), 0o600);
    }
    await symlink(
      "/not-existing-outside-source",
      path.join(source, "nested-link"),
    );
    const scan = await preflightSource(alias, [source], { scan: true });
    assert.equal(scan.linksNotFollowed, 1);
    assert.equal(scan.scan, "complete");
    assert.equal(
      (await preflightSource(alias, [source], { scan: true, maxEntries: 1 }))
        .scan,
      "entry-limit",
    );
    const inaccessible = path.join(source, "inaccessible");
    await mkdir(inaccessible);
    await chmod(inaccessible, 0);
    try {
      await assert.rejects(
        preflightSource(alias, [source], { scan: true }),
        (error) =>
          error instanceof SourceAccessError &&
          error.code === "source-entry-inaccessible",
      );
    } finally {
      await chmod(inaccessible, 0o700);
    }
    const fifo = path.join(source, "special");
    execFileSync("mkfifo", [fifo]);
    await assert.rejects(
      preflightSource(fifo, [source]),
      (error) =>
        error instanceof SourceAccessError &&
        error.code === "source-unsupported-type",
    );
    await assert.rejects(
      preflightSource(path.join(source, "missing"), [source]),
      (error) =>
        error instanceof SourceAccessError && error.code === "source-missing",
    );
    assert.equal(
      safeSourceDiagnosticPath("/srv/token=test-only"),
      "[redacted path]",
    );
  },
);
for (const [message, category] of [
  ["1049 Unknown database example_missing", "invalid-configuration"],
  [
    "1044 Access denied for user to database when executing SHOW EVENTS",
    "insufficient-privileges",
  ],
  ["1142 SELECT command denied to user", "insufficient-privileges"],
  ["1227 need (at least one of) PROCESS privilege", "insufficient-privileges"],
  ["1045 Access denied for user using password: YES", "auth-failed"],
  ["2003 Can't connect connection refused", "unavailable"],
  ["certificate verify failed", "tls-verification-failed"],
  ["unexpected dump error", "failed"],
  [
    "2026 SSL connection error: certificate verify failed",
    "tls-verification-failed",
  ],
] as const)
  linux(
    `native dump classifier: ${category} (${message.split(" ")[0]}); partial SQL remains failed`,
    async (t) => {
      const root = await mkdtemp(path.join(os.tmpdir(), "dump-classify-"));
      t.after(() => rm(root, { recursive: true, force: true }));
      // A successful login/process check is not a successful dump.
      await runLifecycleProcess({
        binary: process.execPath,
        args: ["-e", "process.exit(0)"],
        cwd: root,
        timeoutSeconds: 5,
        shouldCancel: async () => false,
      });
      const output = path.join(root, "partial.sql");
      await assert.rejects(
        runLifecycleProcess({
          binary: process.execPath,
          args: [
            "-e",
            `process.stdout.write('-- partial fixture SQL'); process.stderr.write(${JSON.stringify(message + " test-only-secret")}); process.exit(2)`,
          ],
          cwd: root,
          timeoutSeconds: 5,
          shouldCancel: async () => false,
          output: { file: output, maxBytes: 1024 },
        }),
        (error) =>
          error instanceof LifecycleProcessError &&
          error.code === category &&
          !error.message.includes("test-only-secret"),
      );
      assert.ok((await readFile(output, "utf8")).length > 0);
    },
  );
test("agent origin never accepts credential-bearing paths or queries; explicitly allowed LAN HTTP still works", () => {
  for (const url of [
    "https://example.invalid/?token=test-only",
    "https://example.invalid/path",
    "https://user:pass@example.invalid",
  ])
    assert.throws(() => createAgentConfig({ serverUrl: url }));
  assert.equal(
    createAgentConfig({
      serverUrl: "http://192.0.2.10",
      allowInsecureHttp: true,
    }).serverUrl.protocol,
    "http:",
  );
});
test("installer check sends only authenticated heartbeat and leaves identity/receipts unchanged; missing source does not silence regular polling", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-check-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, "source");
  await mkdir(source);
  const dataDir = path.join(root, "state");
  await saveIdentity(dataDir, {
    agentId: "agent-01",
    deviceId: "app-01",
    secret: "test-only-agent-secret",
    pollIntervalSeconds: 5,
    completedCommands: [],
  });
  const before = await readFile(path.join(dataDir, "identity.json"), "utf8");
  const calls: string[] = [];
  const server = http.createServer((req, res) => {
    calls.push(req.url!);
    req.resume();
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ success: true, result: { command: null } }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const config = createAgentConfig({
    serverUrl: `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`,
    dataDir,
    allowedRoots: [source].join(","),
    allowInsecureHttp: true,
  });
  await checkConnection(config);
  assert.deepEqual(calls, ["/api/agent/heartbeat"]);
  await rm(source, { recursive: true });
  await runOnce(config);
  assert.deepEqual(calls, [
    "/api/agent/heartbeat",
    "/api/agent/heartbeat",
    "/api/agent/poll",
  ]);
  assert.equal(
    await readFile(path.join(dataDir, "identity.json"), "utf8"),
    before,
  );
});
test("agent HTTP requests have a bounded deadline and bounded response", async (t) => {
  const sockets = new Set<import("node:net").Socket>();
  const server = http.createServer((req, res) => {
    if (req.url === "/oversize") res.end("x".repeat(2048));
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    for (const socket of sockets) socket.destroy();
    server.close();
  });
  const config = createAgentConfig({
    serverUrl: `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`,
    allowInsecureHttp: true,
  });
  await assert.rejects(
    new AgentTransport(config, 100, 1024).post("/never", "{}"),
    /timed out/,
  );
  await assert.rejects(
    new AgentTransport(config, 1000, 1024).post("/oversize", "{}"),
    /size limit/,
  );
});
