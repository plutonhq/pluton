#!/usr/local/bin/node
import {
  readFileSync,
  existsSync,
  writeFileSync,
  appendFileSync,
  statSync,
  readdirSync,
} from "node:fs";
import { dirname, join } from "node:path";
const args = process.argv.slice(2);
const state = dirname(dirname(process.env.RCLONE_CONFIG));
appendFileSync(join(state, "restic-calls"), JSON.stringify(args) + "\n");
const snapshot = join(state, "synthetic-snapshot.json");
if (args.includes("cat") && args.includes("config")) {
  console.log(JSON.stringify({ version: 2, id: "c".repeat(64) }));
} else if (args.includes("snapshots")) {
  console.log(existsSync(snapshot) ? readFileSync(snapshot, "utf8") : "[]");
} else if (args.includes("init")) {
  /* Success. */
} else if (args.includes("backup")) {
  if (existsSync(join(state, "fail-backup"))) process.exit(1);
  const source = args[args.indexOf("backup") + 1];
  const artifacts = args.filter((arg) => arg.startsWith("pluton/database/"));
  const files = Object.fromEntries(
    artifacts.map((relative) => [
      "/" + relative,
      statSync(join(process.cwd(), relative)).size,
    ]),
  );
  if (
    readdirSync(process.cwd()).some((name) =>
      /^database(?:-\d+)?\.(cnf|pgpass)$/.test(name),
    )
  )
    process.exit(31);
  const tags = args.filter((_arg, index) => args[index - 1] === "--tag");
  const id = "a".repeat(64);
  const size =
    Object.values(files).reduce((total, value) => total + value, 0) || 1;
  const summary = {
    files_new: 1 + artifacts.length,
    files_changed: 0,
    files_unmodified: 0,
    dirs_new: 0,
    dirs_changed: 0,
    dirs_unmodified: 0,
    data_blobs: 0,
    tree_blobs: 0,
    data_added: 0,
    data_added_packed: 0,
    total_files_processed: 1 + artifacts.length,
    total_bytes_processed: size,
    backup_start: new Date().toISOString(),
    backup_end: new Date().toISOString(),
  };
  writeFileSync(
    snapshot,
    JSON.stringify([
      {
        id,
        tags,
        size,
        files,
        summary,
        paths: [source, ...Object.keys(files)],
      },
    ]),
  );
  console.log(
    JSON.stringify({
      message_type: "summary",
      ...summary,
      snapshot_id: id,
      total_files_processed: 1 + artifacts.length,
      total_bytes_processed: size,
    }),
  );
} else if (args.includes("ls")) {
  const data = JSON.parse(readFileSync(snapshot, "utf8"))[0];
  const target = args.at(-1);
  if (
    existsSync(join(state, "missing-source")) &&
    !target.startsWith("/pluton/database/")
  )
    process.exit(0);
  if (
    existsSync(join(state, "missing-artifact")) &&
    target.startsWith("/pluton/database/")
  )
    process.exit(0);
  console.log(
    JSON.stringify({
      type: target.startsWith("/pluton/database/") ? "file" : "dir",
      path: target,
      size: existsSync(join(state, "wrong-artifact-size"))
        ? 1
        : (data.files?.[target] ?? data.size),
    }),
  );
} else if (args.includes("dump")) {
  process.stdout.write(
    "-- synthetic SQL fixture\nCREATE TABLE example (id INT);\nINSERT INTO example VALUES (1);\n",
  );
}
