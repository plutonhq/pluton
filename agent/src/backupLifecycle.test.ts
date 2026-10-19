import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
  stat,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import test from "node:test";
import {
  executeFilesystemBackup,
  BackupFilesystemError,
} from "./backupFilesystem.js";
import { BackupLifecycleJob, postgresPasswordFile } from "./backupLifecycle.js";
import { collectInventory } from "./inventory.js";
import {
  detectDatabaseBinary,
  parseBackupLifecycle,
  validateHookExecutable,
  type BackupLifecycle,
  type DatabaseBackup,
} from "./lifecyclePolicy.js";
import type { AgentConfig } from "./types.js";

const database = {
  engine: "mariadb" as const,
  host: "localhost",
  port: 3306,
  tls: "local" as const,
  database: "example_db",
  username: "backup_reader",
  password: "test-only-db-secret",
  dumpFilename: "app.sql",
  timeoutSeconds: 5,
  maxDumpBytes: 1024 * 1024,
  includeRoutines: false,
  includeEvents: false,
};
const lifecycle: BackupLifecycle = {
  version: 1,
  database,
  preHook: { id: "prepare", args: ["app-01"], timeoutSeconds: 5 },
  postHook: { id: "cleanup", args: [], timeoutSeconds: 5 },
};
const tools = process.env.PLUTON_PHASE5_TEST_TOOLS;
const executionTest =
  process.platform === "linux" && tools && process.getuid?.() !== 0
    ? test
    : test.skip;

test("lifecycle payload is declarative and rejects shell fields, path escapes, option injection and nonlocal plaintext DB", () => {
  assert.deepEqual(parseBackupLifecycle(lifecycle), lifecycle);
  assert.equal(
    parseBackupLifecycle({
      ...lifecycle,
      database: { ...database, host: "::1" },
    }).database?.host,
    "::1",
  );
  for (const bad of [
    { ...lifecycle, command: "sh" },
    { ...lifecycle, database: { ...database, flags: ["--force"] } },
    { ...lifecycle, database: { ...database, host: "db.example.internal" } },
    { ...lifecycle, database: { ...database, dumpFilename: "../app.sql" } },
  ])
    assert.throws(() => parseBackupLifecycle(bad));
  for (const id of ["../prepare", "/bin/sh", "folder/prepare", "$(command)"])
    assert.throws(() =>
      parseBackupLifecycle({
        version: 1,
        preHook: { id, args: [], timeoutSeconds: 5 },
      }),
    );
  for (const arg of [
    "$(id)",
    "curl | sh",
    "`id`",
    "../etc",
    "/etc/passwd",
    "--command",
    "x\nsecret",
  ])
    assert.throws(() =>
      parseBackupLifecycle({
        version: 1,
        preHook: { id: "prepare", args: [arg], timeoutSeconds: 5 },
      }),
    );
});

async function fixture(patch: Partial<BackupLifecycle> = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "pluton-phase5-"));
  const source = path.join(root, "source");
  const dataDir = path.join(root, "state");
  await mkdir(source);
  await mkdir(dataDir, { mode: 0o700 });
  await writeFile(
    path.join(source, "example.txt"),
    "unchanged application fixture",
  );
  const config: AgentConfig = {
    serverUrl: new URL("https://example.invalid"),
    dataDir,
    allowedRoots: [source],
    allowInsecureHttp: false,
    binDir: path.join(tools!, "bin"),
    databaseBinDirs: [path.join(tools!, "bin")],
    hookRoot: path.join(tools!, "hooks"),
  };
  const events: Record<string, unknown>[] = [];
  const input = {
    payload: {
      version: 2,
      backupId: "backup-01",
      planId: "plan-01",
      sourcePath: source,
      excludes: [],
      repository: {
        remoteName: "pluton",
        path: "managed/app-01",
        initialize: true,
      },
      rclone: {
        type: "sftp",
        options: {
          host: "sftp.example.internal",
          user: "backup_reader",
          pass: "test-only-sftp-password",
        },
      },
      repositoryPassword: "test-only-managed-repository-password",
      lifecycle: { ...lifecycle, ...patch },
    },
    config,
    allowedRoots: [source],
    shouldCancel: async () => false,
    onEvent: async (event: Record<string, unknown>) => {
      events.push(event);
    },
  };
  return { root, source, dataDir, config, input, events };
}
async function absent(file: string) {
  await assert.rejects(stat(file), { code: "ENOENT" });
}
async function calls(file: string) {
  try {
    return (await readFile(file, "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

for (const engine of ["mysql", "mariadb"] as const)
  executionTest(
    `${engine}: private dump + live source in one confirmed snapshot, cleanup and safe argv`,
    async () => {
      const f = await fixture({
        database: {
          ...database,
          engine,
          password: 'test-only-db-secret\\"\nline\tend',
        },
      });
      try {
        const result = await executeFilesystemBackup(f.input);
        assert.equal(result.snapshotId.length, 64);
        assert.equal(
          result.lifecycle?.database?.path,
          "/pluton/database/app.sql",
        );
        assert.equal(result.lifecycle?.database?.sha256.length, 64);
        assert.deepEqual(result.lifecycle?.warnings, []);
        const dumps = await calls(path.join(f.dataDir, "dump-calls"));
        assert.equal(dumps.length, 1);
        assert.equal(
          dumps[0].engine,
          engine === "mysql" ? "mysqldump" : "mariadb-dump",
        );
        assert.equal(dumps[0].mode, 0o600);
        assert.equal(
          dumps[0].args.some((arg: string) =>
            arg.includes("test-only-db-secret"),
          ),
          false,
        );
        const restic = await calls(path.join(f.dataDir, "restic-calls"));
        const backup = restic.find((args: string[]) => args.includes("backup"));
        assert.ok(backup.includes(f.source));
        assert.ok(backup.includes("pluton/database/app.sql"));
        assert.deepEqual(
          f.events.map((event) => event.lifecycleStage).filter(Boolean),
          [
            "pre-backup-started",
            "database-dump-started",
            "database-dump-completed",
            "backup-started",
            "backup-completed",
            "post-backup-started",
            "cleanup-completed",
          ],
        );
        assert.equal(
          await readFile(path.join(f.source, "example.txt"), "utf8"),
          "unchanged application fixture",
        );
        assert.deepEqual(await readdir(path.join(f.dataDir, "jobs")), []);
        await absent(dumps[0].workspace);
        assert.equal(
          JSON.stringify(result).includes("test-only-db-secret"),
          false,
        );
      } finally {
        await rm(f.root, { recursive: true, force: true });
      }
    },
  );

for (const [name, code] of [
  ["auth_failure", "database-auth-failed"],
  ["events_denied", "database-insufficient-privileges"],
  ["unavailable", "database-unavailable"],
  ["slow_dump", "database-dump-timeout"],
  ["empty_dump", "database-dump-failed"],
  ["oversize", "database-dump-output-limit"],
] as const)
  executionTest(
    `${name}: blocks backup, classifies without secrets, post and cleanup still run`,
    async () => {
      const f = await fixture({
        database: {
          ...database,
          database: name,
          includeEvents: name === "events_denied",
          timeoutSeconds: 1,
          maxDumpBytes: 1024,
        },
      });
      try {
        await assert.rejects(executeFilesystemBackup(f.input), (error) => {
          assert.ok(error instanceof BackupFilesystemError);
          assert.equal(error.code, code);
          assert.equal(error.message.includes("test-only-db-secret"), false);
          return true;
        });
        assert.equal(
          (await calls(path.join(f.dataDir, "restic-calls"))).some(
            (args: string[]) => args.includes("backup"),
          ),
          false,
        );
        if (name === "events_denied") {
          const dump = (await calls(path.join(f.dataDir, "dump-calls")))[0];
          assert.ok(dump.args.includes("--events")); // Never silently remove user options.
          assert.equal(dump.mode, 0o600);
        }
        assert.equal(
          (await calls(path.join(f.dataDir, "hook-calls"))).at(-1).name,
          "cleanup",
        );
        assert.deepEqual(await readdir(path.join(f.dataDir, "jobs")), []);
      } finally {
        await rm(f.root, { recursive: true, force: true });
      }
    },
  );

executionTest(
  "missing client and invalid/nonexecutable/symlink hooks fail before job or backup",
  async () => {
    assert.equal(detectDatabaseBinary("mysql", ["/nonexistent"]), undefined);
    const f = await fixture();
    try {
      const noClient = { ...f.config, databaseBinDirs: ["/nonexistent"] };
      await assert.rejects(
        BackupLifecycleJob.create(
          noClient,
          lifecycle,
          async () => false,
          async () => {},
        ),
        (error) =>
          (error as { code: string }).code === "database-tool-unavailable",
      );
      for (const id of [
        "link",
        "not-executable",
        "writable",
        "setuid",
        "../prepare",
        "/bin/sh",
      ])
        assert.throws(() =>
          validateHookExecutable(f.config.hookRoot!, {
            id,
            args: [],
            timeoutSeconds: 5,
          }),
        );
      await assert.rejects(
        BackupLifecycleJob.create(
          f.config,
          {
            ...lifecycle,
            preHook: { id: "link", args: [], timeoutSeconds: 5 },
          },
          async () => false,
          async () => {},
        ),
      );
      await absent(path.join(f.dataDir, "jobs"));
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  },
);

function multiEntries(engines: DatabaseBackup["engine"][]): DatabaseBackup[] {
  return engines.map((engine, index) => ({
    ...database,
    engine,
    databaseId: `db_entry${index + 1}`,
    database: `example_db${index + 1}`,
    port: engine === "postgresql" ? 5432 : 3306,
    dumpFilename: `database-${index + 1}.sql`,
    password:
      engine === "postgresql"
        ? "test-only-db-secret:with\\escape"
        : database.password,
  }));
}
async function multiFixture(entries: DatabaseBackup[]) {
  const f = await fixture();
  f.input.payload.version = 3;
  f.input.payload.lifecycle = {
    version: 2,
    databases: entries,
    preHook: lifecycle.preHook,
    postHook: lifecycle.postHook,
  };
  return f;
}

test("PostgreSQL password file escapes fields, IPv6 and password without connection strings or extra lines", () => {
  assert.equal(
    postgresPasswordFile({
      ...database,
      engine: "postgresql",
      host: "::1",
      port: 5432,
      password: "test-only-db-secret:p\\q",
    }),
    "\\:\\:1:5432:example_db:backup_reader:test-only-db-secret\\:p\\\\q\n",
  );
});

test("multi-database agent validator independently rejects duplicates, unsafe names and PostgreSQL options", () => {
  const entries = multiEntries(["mariadb", "postgresql"]);
  assert.deepEqual(
    parseBackupLifecycle({ version: 2, databases: entries }).databases,
    entries,
  );
  for (const databases of [
    [entries[0], { ...entries[1], dumpFilename: entries[0].dumpFilename }],
    [entries[0], { ...entries[1], dumpFilename: "DATABASE-1.sql" }],
    [entries[0], { ...entries[1], databaseId: entries[0].databaseId }],
    [{ ...entries[0], dumpFilename: "-option.sql" }],
    [{ ...entries[0], dumpFilename: "../escape.sql" }],
    [{ ...entries[1], password: "test-only-db-secret\nline" }],
    [{ ...entries[1], database: "postgresql://user:secret@db/app" }],
    [{ ...entries[1], host: "/run/postgresql" }],
    [{ ...entries[1], includeRoutines: true }],
    [{ ...entries[1], flags: ["--force"] }],
    multiEntries(Array(9).fill("postgresql")),
  ])
    assert.throws(() => parseBackupLifecycle({ version: 2, databases }));
});

for (const engines of [
  ["mariadb", "mariadb"],
  ["mariadb", "postgresql"],
  ["mysql", "postgresql"],
] as DatabaseBackup["engine"][][])
  executionTest(
    `${engines.join(" + ")}: all dumps sequential, one Restic snapshot, plan-level hooks once, no secrets`,
    async () => {
      const f = await multiFixture(multiEntries(engines));
      try {
        const stages: unknown[] = [];
        const result = await executeFilesystemBackup({
          ...f.input,
          onStage: (event) => stages.push(event),
        });
        assert.match(result.snapshotId, /^[a-f0-9]{64}$/);
        assert.equal(result.lifecycle?.databases?.length, engines.length);
        assert.equal(
          result.lifecycle?.database,
          undefined,
          "Multi-DB reports must not pretend to be a single DB",
        );
        assert.deepEqual(
          result.lifecycle?.databases?.map((entry) => entry.databaseId),
          ["db_entry1", "db_entry2"],
        );
        const dumps = await calls(path.join(f.dataDir, "dump-calls"));
        assert.equal(dumps.length, 2);
        for (const dump of dumps) {
          assert.equal(dump.mode, 0o600);
          assert.ok(!JSON.stringify(dump.args).includes("test-only-db-secret"));
          await absent(dump.credentialFile);
          await absent(dump.workspace);
          if (dump.engine === "pg_dump") {
            assert.ok(dump.escaped);
            assert.equal(dump.sslMode, "disable");
          }
        }
        const restic = await calls(path.join(f.dataDir, "restic-calls"));
        const backups = restic.filter((args) => args.includes("backup"));
        assert.equal(backups.length, 1);
        assert.ok(backups[0].includes(f.source));
        assert.ok(backups[0].includes("pluton/database/database-1.sql"));
        assert.ok(backups[0].includes("pluton/database/database-2.sql"));
        assert.deepEqual(
          (await calls(path.join(f.dataDir, "hook-calls"))).map(
            (hook) => hook.name,
          ),
          ["prepare", "cleanup"],
        );
        assert.deepEqual(
          f.events
            .filter((event) =>
              event.lifecycleStage?.toString().startsWith("database-dump"),
            )
            .map((event) => [
              event.lifecycleStage,
              event.databaseId,
              event.ordinal,
              event.count,
            ]),
          [
            ["database-dump-started", "db_entry1", 1, 2],
            ["database-dump-completed", "db_entry1", 1, 2],
            ["database-dump-started", "db_entry2", 2, 2],
            ["database-dump-completed", "db_entry2", 2, 2],
          ],
        );
        assert.deepEqual(await readdir(path.join(f.dataDir, "jobs")), []);
        assert.equal(
          await readFile(path.join(f.source, "example.txt"), "utf8"),
          "unchanged application fixture",
        );
        for (const value of [result, f.events, stages])
          assert.ok(!JSON.stringify(value).includes("test-only-db-secret"));
      } finally {
        await rm(f.root, { recursive: true, force: true });
      }
    },
  );

for (const [databaseName, code] of [
  ["auth_failure", "database-auth-failed"],
  ["unavailable", "database-unavailable"],
  ["tls_failure", "database-tls-verification-failed"],
  ["incompatible", "database-client-incompatible"],
  ["slow_dump", "database-dump-timeout"],
  ["empty_dump", "database-output-empty"],
  ["oversize", "database-dump-output-limit"],
])
  executionTest(
    `PostgreSQL ${databaseName}: DB2 failure skips DB3/Restic, identifies safe entry, cleans all`,
    async () => {
      const entries = multiEntries(["mariadb", "postgresql", "mariadb"]);
      entries[1] = {
        ...entries[1],
        database: databaseName,
        timeoutSeconds: 1,
        maxDumpBytes: 1024,
      };
      const f = await multiFixture(entries);
      try {
        await assert.rejects(executeFilesystemBackup(f.input), (error) => {
          assert.ok(error instanceof BackupFilesystemError);
          assert.equal(error.stage, "database-dump");
          assert.equal(error.code, code);
          assert.equal(error.databaseId, "db_entry2");
          assert.equal(error.engine, "postgresql");
          assert.ok(!JSON.stringify(error).includes("test-only-db-secret"));
          return true;
        });
        const dumps = await calls(path.join(f.dataDir, "dump-calls"));
        assert.equal(dumps.length, 2);
        for (const dump of dumps) {
          await absent(dump.workspace);
          await absent(dump.credentialFile);
        }
        assert.ok(
          !(await calls(path.join(f.dataDir, "restic-calls"))).some(
            (args) => args.includes("backup") || args.includes("init"),
          ),
        );
        assert.deepEqual(
          (await calls(path.join(f.dataDir, "hook-calls"))).map(
            (hook) => hook.name,
          ),
          ["prepare", "cleanup"],
        );
        assert.deepEqual(await readdir(path.join(f.dataDir, "jobs")), []);
      } finally {
        await rm(f.root, { recursive: true, force: true });
      }
    },
  );

executionTest(
  "pg_dump detection requires genuine root-owned client; all clients validated before pre/workspace",
  async () => {
    const f = await multiFixture(multiEntries(["mariadb", "postgresql"]));
    try {
      assert.ok(detectDatabaseBinary("postgresql", f.config.databaseBinDirs));
      assert.equal(
        detectDatabaseBinary("postgresql"),
        "/usr/lib/postgresql/17/bin/pg_dump",
        "Versioned Debian/Ubuntu packages must resolve to the immutable real executable, not pg_wrapper",
      );
      assert.equal(
        detectDatabaseBinary("postgresql", [path.join(tools!, "mysql-only")]),
        undefined,
      );
      const inventory = collectInventory({
        filesystemRootsConfigured: true,
        binDir: f.config.binDir,
        databaseBinDirs: f.config.databaseBinDirs,
      });
      assert.equal(inventory.capabilities.backupLifecycleVersion, 2);
      assert.ok(inventory.capabilities.databaseEngines?.includes("postgresql"));
      await assert.rejects(
        executeFilesystemBackup({
          ...f.input,
          config: {
            ...f.config,
            databaseBinDirs: [path.join(tools!, "mysql-only")],
          },
        }),
        (error) =>
          (error as BackupFilesystemError).code === "database-client-missing" &&
          (error as BackupFilesystemError).databaseId === "db_entry2",
      );
      await absent(path.join(f.dataDir, "jobs"));
      assert.deepEqual(await calls(path.join(f.dataDir, "hook-calls")), []);
      assert.deepEqual(await calls(path.join(f.dataDir, "dump-calls")), []);
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  },
);

executionTest(
  "cancellation during DB2 terminates active client and removes DB1/DB2, skips DB3/backup",
  async () => {
    const entries = multiEntries(["mariadb", "postgresql", "mysql"]);
    entries[1].database = "slow_dump";
    const f = await multiFixture(entries);
    let secondStarted = 0;
    try {
      await assert.rejects(
        executeFilesystemBackup({
          ...f.input,
          onEvent: async (event) => {
            if (
              event.lifecycleStage === "database-dump-started" &&
              event.databaseId === "db_entry2"
            )
              secondStarted = Date.now();
          },
          shouldCancel: async () =>
            !!secondStarted && Date.now() - secondStarted > 250,
        }),
        (error) =>
          (error as BackupFilesystemError).code === "cancelled" &&
          (error as BackupFilesystemError).databaseId === "db_entry2",
      );
      assert.equal((await calls(path.join(f.dataDir, "dump-calls"))).length, 2);
      assert.deepEqual(await readdir(path.join(f.dataDir, "jobs")), []);
      assert.ok(
        !(await calls(path.join(f.dataDir, "restic-calls"))).some((args) =>
          args.includes("backup"),
        ),
      );
      assert.deepEqual(
        (await calls(path.join(f.dataDir, "hook-calls"))).map(
          (hook) => hook.name,
        ),
        ["prepare", "cleanup"],
      );
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  },
);

executionTest(
  "retry after DB2 failure redumps every DB in a new job; successful replay does not redump",
  async () => {
    const entries = multiEntries(["mariadb", "postgresql"]);
    entries[1].database = "auth_failure";
    const f = await multiFixture(entries);
    try {
      await assert.rejects(executeFilesystemBackup(f.input));
      const first = await calls(path.join(f.dataDir, "dump-calls"));
      f.input.payload.lifecycle.databases![1].database = "example_db2";
      const result = await executeFilesystemBackup(f.input);
      const all = await calls(path.join(f.dataDir, "dump-calls"));
      assert.equal(all.length, 4);
      assert.notEqual(first[0].workspace, all[2].workspace);
      assert.equal(all[2].workspace, all[3].workspace);
      const replay = await executeFilesystemBackup(f.input);
      assert.equal(replay.snapshotId, result.snapshotId);
      assert.deepEqual(
        replay.lifecycle?.databases,
        result.lifecycle?.databases,
        "Lost local receipt replay must recover every artifact's safe metadata",
      );
      assert.equal((await calls(path.join(f.dataDir, "dump-calls"))).length, 4);
      assert.equal(
        (await calls(path.join(f.dataDir, "restic-calls"))).filter((args) =>
          args.includes("backup"),
        ).length,
        1,
      );
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  },
);

for (const marker of [
  "missing-source",
  "missing-artifact",
  "wrong-artifact-size",
])
  executionTest(
    `snapshot confirmation rejects ${marker} even if Restic exited zero`,
    async () => {
      const f = await multiFixture(multiEntries(["mariadb", "postgresql"]));
      try {
        await writeFile(path.join(f.dataDir, marker), "1");
        await assert.rejects(
          executeFilesystemBackup(f.input),
          (error) =>
            (error as BackupFilesystemError).code ===
            "snapshot-confirmation-failed",
        );
        assert.deepEqual(await readdir(path.join(f.dataDir, "jobs")), []);
      } finally {
        await rm(f.root, { recursive: true, force: true });
      }
    },
  );

executionTest(
  "hook-only lifecycle confirms its filesystem snapshot without a DB dump",
  async () => {
    const f = await fixture({ database: undefined });
    try {
      const result = await executeFilesystemBackup(f.input);
      assert.equal(result.snapshotId.length, 64);
      assert.equal(result.lifecycle?.database, undefined);
      assert.deepEqual(result.lifecycle?.warnings, []);
      assert.deepEqual(await calls(path.join(f.dataDir, "dump-calls")), []);
      assert.deepEqual(
        (await calls(path.join(f.dataDir, "hook-calls"))).map(
          (value) => value.name,
        ),
        ["prepare", "cleanup"],
      );
      assert.deepEqual(await readdir(path.join(f.dataDir, "jobs")), []);
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  },
);

executionTest(
  "pre failure prevents filesystem backup; post failure preserves completed snapshot with warning",
  async () => {
    const f = await fixture({
      preHook: { id: "fail", args: [], timeoutSeconds: 5 },
    });
    try {
      await assert.rejects(
        executeFilesystemBackup(f.input),
        (error) => (error as BackupFilesystemError).code === "hook-failed",
      );
      assert.equal(
        (await calls(path.join(f.dataDir, "restic-calls"))).some(
          (args: string[]) => args.includes("backup"),
        ),
        false,
      );
      f.input.payload.lifecycle = {
        ...lifecycle,
        postHook: { id: "fail", args: [], timeoutSeconds: 5 },
      };
      const result = await executeFilesystemBackup(f.input);
      assert.equal(result.snapshotId.length, 64);
      assert.deepEqual(result.lifecycle?.warnings, [
        { stage: "post-backup", code: "hook-failed" },
      ]);
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  },
);

executionTest(
  "backup failure cleans artifacts; retry creates a fresh workspace and does not reuse a dump",
  async () => {
    const f = await fixture();
    try {
      const failed = path.join(f.dataDir, "fail-backup");
      await writeFile(failed, "1");
      await assert.rejects(executeFilesystemBackup(f.input));
      const previous = (await calls(path.join(f.dataDir, "dump-calls")))[0]
        .workspace;
      await absent(previous);
      await rm(failed);
      await executeFilesystemBackup(f.input);
      const dumps = await calls(path.join(f.dataDir, "dump-calls"));
      assert.equal(dumps.length, 2);
      assert.notEqual(dumps[1].workspace, previous);
      const replay = await executeFilesystemBackup(f.input);
      assert.equal(replay.snapshotId.length, 64);
      assert.equal((await calls(path.join(f.dataDir, "dump-calls"))).length, 2);
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  },
);

executionTest(
  "cancellation stops dump, runs bounded post cleanup, removes files and never starts backup",
  async () => {
    const f = await fixture({
      database: { ...database, database: "slow_dump", timeoutSeconds: 5 },
    });
    try {
      const started = Date.now();
      f.input.shouldCancel = async () => Date.now() - started > 300;
      await assert.rejects(
        executeFilesystemBackup(f.input),
        (error) => (error as BackupFilesystemError).code === "cancelled",
      );
      assert.deepEqual(await readdir(path.join(f.dataDir, "jobs")), []);
      assert.equal(
        (await calls(path.join(f.dataDir, "restic-calls"))).some(
          (args: string[]) => args.includes("backup"),
        ),
        false,
      );
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  },
);

for (const [id, code] of [
  ["slow", "hook-timeout"],
  ["noisy", "hook-output-limit"],
] as const)
  executionTest(`${id} hook is bounded and blocks backup`, async () => {
    const f = await fixture({ preHook: { id, args: [], timeoutSeconds: 1 } });
    try {
      await assert.rejects(
        executeFilesystemBackup(f.input),
        (error) => (error as BackupFilesystemError).code === code,
      );
      assert.deepEqual(await readdir(path.join(f.dataDir, "jobs")), []);
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  });

executionTest(
  "cleanup failure is a separate warning after a successful snapshot",
  async () => {
    const f = await fixture({
      postHook: { id: "dirty", args: [], timeoutSeconds: 5 },
    });
    try {
      const result = await executeFilesystemBackup(f.input);
      assert.equal(result.snapshotId.length, 64);
      assert.deepEqual(result.lifecycle?.warnings, [
        { stage: "cleanup", code: "cleanup-failed" },
      ]);
      const workspace = (await calls(path.join(f.dataDir, "dump-calls")))[0]
        .workspace;
      await chmod(path.join(workspace, "cleanup-test"), 0o700);
      assert.ok(
        f.events.some((event) => event.lifecycleStage === "cleanup-warning"),
      );
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  },
);

executionTest(
  "cancellation terminates hook descendants, not just its parent",
  async () => {
    const f = await fixture({
      preHook: { id: "child", args: [], timeoutSeconds: 5 },
    });
    try {
      const started = Date.now();
      f.input.shouldCancel = async () => Date.now() - started > 400;
      await assert.rejects(
        executeFilesystemBackup(f.input),
        (error) => (error as BackupFilesystemError).code === "cancelled",
      );
      const pid = (
        await readFile(path.join(f.dataDir, "child-pid"), "utf8")
      ).trim();
      try {
        const status = await readFile(`/proc/${pid}/stat`, "utf8");
        assert.match(
          status,
          /\) Z /,
          "Only an unreaped zombie, never a running descendant, may remain.",
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      assert.deepEqual(await readdir(path.join(f.dataDir, "jobs")), []);
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  },
);

executionTest(
  "post cleanup keeps polling the lease but ignores cancellation and remains bounded",
  async () => {
    const f = await fixture();
    let polls = 0;
    try {
      const job = await BackupLifecycleJob.create(
        f.config,
        { version: 1, postHook: { id: "slow", args: [], timeoutSeconds: 2 } },
        async () => {
          polls += 1;
          return true;
        },
        async () => {},
      );
      await job.cleanup();
      assert.ok(
        polls >= 2,
        "Cleanup must refresh the command lease, not disable status polling.",
      );
      assert.deepEqual(job.report.warnings, [
        { stage: "post-backup", code: "hook-timeout" },
      ]);
      await absent(job.workspace);
    } finally {
      await rm(f.root, { recursive: true, force: true });
    }
  },
);
