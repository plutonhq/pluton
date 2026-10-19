import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runOnce } from "./runtime.js";
import { saveIdentity } from "./identity.js";
import type {
  AgentCommandEnvelope,
  AgentConfig,
  StoredAgentIdentity,
} from "./types.js";

const tools = process.env.PLUTON_PHASE5_TEST_TOOLS;
const executionTest =
  process.platform === "linux" && tools && process.getuid?.() !== 0
    ? test
    : test.skip;

executionTest(
  "multi-DB failure reaches signed completion without secrets; persisted replay never redumps",
  async () => {
    const scratch = await mkdtemp(
      path.join(os.tmpdir(), "pluton-phase5-transport-"),
    );
    const source = path.join(scratch, "source");
    const dataDir = path.join(scratch, "state");
    await mkdir(source);
    await mkdir(dataDir, { mode: 0o700 });
    await writeFile(path.join(source, "app.txt"), "synthetic app");
    const identity: StoredAgentIdentity = {
      deviceId: "device-01",
      agentId: "agent-01",
      secret: "test-only-agent-identity-secret",
      pollIntervalSeconds: 1,
      completedCommands: [],
    };
    await saveIdentity(dataDir, identity);
    const database = {
      databaseId: "db_one",
      engine: "mariadb",
      host: "localhost",
      port: 3306,
      tls: "local",
      database: "example_db",
      username: "backup_reader",
      password: "test-only-db-secret",
      dumpFilename: "one.sql",
      timeoutSeconds: 5,
      maxDumpBytes: 1024 ** 2,
      includeRoutines: false,
      includeEvents: false,
    };
    const command: AgentCommandEnvelope = {
      id: "command-01",
      type: "BACKUP_FILESYSTEM",
      idempotencyKey: "backup:01",
      leaseToken: "a".repeat(32),
      leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      signatureTimestamp: String(Date.now()),
      signature: "",
      payload: {
        version: 3,
        planId: "plan-01",
        backupId: "backup-01",
        sourcePath: source,
        excludes: [],
        repository: {
          remoteName: "pluton",
          path: "managed/app-01",
          initialize: true,
        },
        repositoryPassword: "test-only-managed-repository-password",
        rclone: {
          type: "sftp",
          options: {
            host: "sftp.example.internal",
            user: "backup_reader",
            pass: "test-only-sftp-password",
          },
        },
        lifecycle: {
          version: 2,
          databases: [
            database,
            {
              ...database,
              databaseId: "db_two",
              engine: "postgresql",
              port: 5432,
              database: "auth_failure",
              dumpFilename: "two.sql",
            },
          ],
        },
      },
    };
    command.signature = crypto
      .createHmac("sha256", identity.secret)
      .update(
        [
          "command",
          command.signatureTimestamp,
          command.id,
          command.type,
          JSON.stringify(command.payload),
          command.idempotencyKey,
          command.leaseToken,
          Date.parse(command.leaseExpiresAt!).toString(),
        ].join("\n"),
      )
      .digest("base64");
    const completions: Record<string, unknown>[] = [];
    const events: Record<string, unknown>[] = [];
    const server = http.createServer(async (request, response) => {
      let raw = "";
      for await (const chunk of request) raw += chunk.toString();
      const body = JSON.parse(raw);
      let result: unknown = {};
      if (request.url === "/api/agent/poll") result = { command };
      else if (request.url?.endsWith("/status")) result = { cancelled: false };
      else if (request.url?.endsWith("/complete")) completions.push(body);
      else if (request.url?.endsWith("/events")) events.push(body.event);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ success: true, result }));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const info: unknown[] = [],
      errors: unknown[] = [];
    const previousInfo = console.info,
      previousError = console.error;
    console.info = (...args) => {
      info.push(args);
    };
    console.error = (...args) => {
      errors.push(args);
    };
    try {
      const config: AgentConfig = {
        serverUrl: new URL(
          `http://127.0.0.1:${(server.address() as { port: number }).port}`,
        ),
        dataDir,
        allowedRoots: [source],
        allowInsecureHttp: true,
        binDir: path.join(tools!, "bin"),
        databaseBinDirs: [path.join(tools!, "bin")],
      };
      await runOnce(config);
      assert.equal(completions.length, 1);
      assert.equal(completions[0].success, false);
      assert.equal(completions[0].failureStage, "database-dump");
      assert.equal(completions[0].failureCode, "database-auth-failed");
      assert.equal(completions[0].databaseId, "db_two");
      assert.equal(completions[0].engine, "postgresql");
      for (const value of [completions, events, info, errors]) {
        for (const forbidden of [
          database.password,
          identity.secret,
          "test-only-managed-repository-password",
          "test-only-sftp-password",
        ])
          assert.ok(!JSON.stringify(value).includes(forbidden));
      }
      const dumps = await readFile(path.join(dataDir, "dump-calls"), "utf8");
      await runOnce(config);
      assert.equal(completions.length, 2);
      assert.deepEqual(completions[1], completions[0]);
      assert.equal(
        await readFile(path.join(dataDir, "dump-calls"), "utf8"),
        dumps,
      );
      // A fresh successful command and its cached receipt must preserve complete
      // metadata without rerunning dumps, hooks, or a second Restic backup.
      command.id = "command-success";
      command.idempotencyKey = "backup:02";
      command.payload.backupId = "backup-02";
      (
        command.payload.lifecycle as { databases: { database: string }[] }
      ).databases[1].database = "example_db2";
      command.signature = crypto
        .createHmac("sha256", identity.secret)
        .update(
          [
            "command",
            command.signatureTimestamp,
            command.id,
            command.type,
            JSON.stringify(command.payload),
            command.idempotencyKey,
            command.leaseToken,
            Date.parse(command.leaseExpiresAt!).toString(),
          ].join("\n"),
        )
        .digest("base64");
      await runOnce(config);
      assert.equal(completions[2].success, true);
      assert.equal(
        (completions[2].result as { lifecycle: { databases: unknown[] } })
          .lifecycle.databases.length,
        2,
      );
      const successfulDumps = await readFile(
        path.join(dataDir, "dump-calls"),
        "utf8",
      );
      await runOnce(config);
      assert.deepEqual(completions[3], completions[2]);
      assert.equal(
        await readFile(path.join(dataDir, "dump-calls"), "utf8"),
        successfulDumps,
      );
      for (const forbidden of [
        database.password,
        identity.secret,
        "test-only-managed-repository-password",
        "test-only-sftp-password",
      ])
        assert.ok(
          !JSON.stringify([completions, events, info, errors]).includes(
            forbidden,
          ),
        );
      assert.deepEqual(await readdir(path.join(dataDir, "jobs")), []);
    } finally {
      console.info = previousInfo;
      console.error = previousError;
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(scratch, { recursive: true, force: true });
    }
  },
);
