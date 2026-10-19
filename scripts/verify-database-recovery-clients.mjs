// Safe build/startup diagnostic only: no connection, credentials, configuration bootstrap or application startup.
import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import {
  detectRecoveryClient,
  assertRecoveryClientPath,
} from "/app/backend/dist/utils/recoveryDatabaseClients.js";

assert.equal(process.getuid(), 10001, "Recovery image must use UID 10001.");
assert.equal(process.getgid(), 10001, "Recovery image must use GID 10001.");
const maria = detectRecoveryClient("mariadb");
const postgres = detectRecoveryClient("postgresql");
const env = { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" };
const version = (binary, args) =>
  execFileSync(binary, args, {
    encoding: "utf8",
    env,
    timeout: 2000,
    maxBuffer: 4096,
  });
const mariaVersion = /(?:Distrib |from )?(\d+\.\d+\.\d+)-MariaDB/.exec(
  version(maria, [
    "--no-defaults",
    "--sandbox",
    "--binary-mode",
    "--local-infile=0",
    "--version",
  ]),
);
const pgVersion = /psql \(PostgreSQL\) (\d+\.\d+)/.exec(
  version(postgres, ["--version"]),
);
assert(
  mariaVersion && pgVersion,
  "Native client version could not be verified.",
);

// pg_restore is bundled by postgresql18-client, not an application archive-import feature.
const bundledRestore = assertRecoveryClientPath("/usr/bin/pg_restore");
assert.match(
  version(bundledRestore, ["--version"]),
  /pg_restore \(PostgreSQL\) 18\./,
);
let mysqlDiagnostic;
assert.throws(
  () => detectRecoveryClient("mysql"),
  (error) => {
    mysqlDiagnostic = error?.code;
    return ["database-client-incompatible", "database-client-missing"].includes(
      mysqlDiagnostic,
    );
  },
);
for (const binary of [
  "/usr/bin/mariadbd",
  "/usr/bin/mysqld",
  "/usr/bin/postgres",
  "/usr/libexec/postgresql18/postgres",
])
  assert(
    !fs.existsSync(binary),
    "Application image must not include a database server.",
  );
for (const service of ["mariadb", "mysql", "postgresql", "postgresql18"])
  assert(
    !fs.existsSync(`/etc/init.d/${service}`),
    "Application image must not include database services.",
  );
console.log(
  JSON.stringify({
    uid: process.getuid(),
    gid: process.getgid(),
    mariadb: mariaVersion[1],
    postgresql: pgVersion[1],
    mysql: "not-available-as-genuine-client",
    mysqlDiagnostic,
    pgRestore: "bundled-only-not-used-for-Phase6-SQL",
    databaseServers: "absent",
  }),
);
