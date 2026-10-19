#!/usr/local/bin/node
// Synthetic executable fixture; never connects to a database.
import { basename, dirname, join } from "node:path";
import { readFileSync, statSync, appendFileSync, symlinkSync } from "node:fs";
const args = process.argv.slice(2);
const isPostgres = basename(process.argv[1]) === "pg_dump";
if (args.includes("--version")) {
  console.log(
    isPostgres
      ? "pg_dump (PostgreSQL) 17.6"
      : basename(process.argv[1]) === "mariadb-dump"
        ? "mariadb-dump Ver 10.19 Distrib 10.11.6-MariaDB"
        : "mysqldump Ver 8.0.40 for Linux",
  );
} else {
  const defaults = isPostgres
    ? process.env.PGPASSFILE
    : args[0]?.replace(/^--defaults-file=/, "");
  const config = readFileSync(defaults, "utf8");
  const workspace = dirname(defaults);
  if (
    (statSync(defaults).mode & 0o777) !== 0o600 ||
    (statSync(workspace).mode & 0o777) !== 0o700
  )
    process.exit(22);
  if (args.some((value) => /password=|test-only-db-secret/.test(value)))
    process.exit(23);
  if (
    process.env.SECRET ||
    process.env.MYSQL_PWD ||
    process.env.PGPASSWORD ||
    process.env.PGSERVICE ||
    process.env.PGOPTIONS ||
    process.env.RESTIC_PASSWORD ||
    process.env.RCLONE_CONFIG
  )
    process.exit(24);
  if (
    dirname(process.env.HOME) !== workspace ||
    !/^client-home-\d+$/.test(basename(process.env.HOME)) ||
    (!isPostgres &&
      process.env.MYSQL_TEST_LOGIN_FILE !==
        join(process.env.HOME, ".mylogin.cnf"))
  )
    process.exit(26);
  if (
    !isPostgres &&
    (!args.includes("--single-transaction") ||
      !args.includes("--skip-lock-tables"))
  )
    process.exit(25);
  if (isPostgres) {
    if (
      !args.includes("--format=plain") ||
      !args.includes("--no-password") ||
      process.env.PGGSSENCMODE !== "disable"
    )
      process.exit(27);
    const fields = [];
    let field = "";
    let escaped = false;
    for (const char of config.trimEnd()) {
      if (escaped) {
        field += char;
        escaped = false;
      } else if (char === "\\") escaped = true;
      else if (char === ":") {
        fields.push(field);
        field = "";
      } else field += char;
    }
    fields.push(field);
    for (const [ordinal, flag] of [
      [0, "--host"],
      [1, "--port"],
      [2, "--dbname"],
      [3, "--username"],
    ])
      if (fields[ordinal] !== args[args.indexOf(flag) + 1]) process.exit(28);
    if (fields.length !== 5 || !fields[4].startsWith("test-only-db-secret"))
      process.exit(29);
    if (!["verify-full", "disable"].includes(process.env.PGSSLMODE))
      process.exit(30);
    if (process.env.PGSSLMODE === "verify-full" && !process.env.PGSSLROOTCERT)
      process.exit(31);
  }
  appendFileSync(
    join(dirname(dirname(workspace)), "dump-calls"),
    JSON.stringify({
      workspace,
      credentialFile: defaults,
      mode: statSync(defaults).mode & 0o777,
      args,
      engine: basename(process.argv[1]),
      escaped: isPostgres
        ? config.includes("\\:") && config.includes("\\\\")
        : config.includes('password="'),
      ...(isPostgres ? { sslMode: process.env.PGSSLMODE } : {}),
    }) + "\n",
  );
  const database = isPostgres
    ? args[args.indexOf("--dbname") + 1]
    : args.at(-1);
  if (database === "auth_failure") {
    console.error(
      isPostgres
        ? "pg_dump: password authentication failed (test-only-db-secret must never leave classifier)"
        : "1045 Access denied (test-only-db-secret must never leave classifier)",
    );
    process.exitCode = 2;
  } else if (database === "events_denied") {
    // Login/configuration succeeded and SQL has started; SHOW EVENTS is a separate privilege.
    process.stdout.write(
      "-- synthetic partial SQL\nCREATE TABLE partial_dump(id INT);\n",
    );
    console.error(
      "mariadb-dump: Error 1044: Access denied for user to database when executing SHOW EVENTS (test-only-db-secret)",
    );
    process.exitCode = 2;
  } else if (database === "unavailable") {
    console.error(
      isPostgres
        ? "pg_dump: connection refused: synthetic provider text"
        : "2003 Can't connect: synthetic provider text",
    );
    process.exitCode = 2;
  } else if (database === "tls_failure") {
    console.error(
      "pg_dump: SSL error: certificate verify failed (test-only-db-secret)",
    );
    process.exitCode = 2;
  } else if (database === "incompatible") {
    console.error(
      "pg_dump: error: aborting because of server version mismatch (test-only-db-secret)",
    );
    process.exitCode = 2;
  } else if (database === "slow_dump") {
    setInterval(() => {}, 1000);
  } else if (database === "oversize") {
    process.stdout.write("x".repeat(4096));
  } else if (database === "empty_dump") {
    /* Invalid successful empty output. */
  } else if (database === "symlink_dump") {
    symlinkSync(
      "/etc/passwd",
      join(workspace, "pluton", "database", "escape.sql"),
    );
    process.stdout.write("-- synthetic dump\n");
  } else {
    process.stdout.write(
      "-- synthetic SQL fixture\nCREATE TABLE example (id INT);\nINSERT INTO example VALUES (1);\n",
    );
  }
}
