# Legacy Restic repository adapter — Phases 1–2

Status: implemented for existing local-filesystem Restic repositories. The adapter
uses only the public Pluton source and documented Restic interfaces. It does not
certify a Restic-version or repository-format compatibility matrix.

Phase 1 introduced registration, safe metadata, and snapshot listing. Phase 2
adds structured snapshot browsing and a constrained staged restore. Neither phase
hands a legacy repository to Pluton's managed backup lifecycle.

## Adoption contract

An operator registers an existing repository with a display name, its absolute
path on the Pluton server, and its repository password. The registration is
separate from managed plans, backups, schedules, storage definitions, replication,
and retention. Removing it deletes only Pluton's local record.

The repository is mandatory read-only. The UI shows **READ ONLY REPOSITORY**, and
the API rejects any stored record that is not local and read-only. Phase 2 restore
is intentionally narrow: it reads from the repository and writes selected content
only to an application-controlled staging directory. It never uses the managed
restore service and never accepts an operator-provided restore destination.

The original backup tooling retains ownership of scheduling, retention,
maintenance, credentials, and recovery policy.

## Local registration and job records

The [legacy repository schema](../backend/src/db/schema/legacyRepositories.ts)
creates `legacy_repositories` through migration
[`0003_luxuriant_fat_cobra.sql`](../backend/drizzle/0003_luxuriant_fat_cobra.sql).
It is not related to managed plans or backups.

| Field | Meaning |
| --- | --- |
| `id`, `displayName` | Local registration identity and UI label. |
| `repositoryPath` | Existing validated absolute local path. |
| `backend` | Fixed to `local`; Rclone and other remote locators are not accepted. |
| `encryptedPassword` | External repository password encrypted locally with Pluton's configured `SECRET`; never returned to the frontend. |
| `isReadOnly` | Always `true`; callers cannot opt out and non-read-only records are rejected. |
| `validationStatus`, `lastValidatedAt` | Local availability state from the most recent safe operation. |

Migration [`0004_next_vision.sql`](../backend/drizzle/0004_next_vision.sql)
creates a separate `legacy_restore_jobs` table. It stores the repository ID,
full snapshot ID, selected logical paths, an internal staging path, safe status,
safe error text, summary counts, and timestamps. It has no relationship to a
managed plan, backup, or managed restore record.

The password remains independent of managed password derivation and
`ENCRYPTION_KEY`. `SECRET` protects the stored value; it does not re-key the
external repository. The password is supplied only in the child process
environment and is not logged, returned, or placed in command arguments.

## Legacy operation matrix

Only typed code paths below can invoke Restic for a legacy registration. All use
argument arrays, `shell: false`, `--no-lock`, `--no-cache`, bounded output, a
timeout, and discarded stderr. `--no-lock` avoids Restic lock-object writes; the
repository owner still needs to coordinate maintenance. A read-only filesystem
mount or backend credential remains recommended defense in depth.

| Restic operation | Available | Repository effect | Other filesystem effect | Boundary |
| --- | --- | --- | --- | --- |
| `snapshots` | Yes | Read only | None | Fixed JSON inspection command. |
| `stats --mode raw-data` | Yes | Read only | None | Fixed JSON inspection command. |
| `ls <snapshot> <logical-path> --long` | Yes | Read only | None | Structured JSON browser; no human-output parsing. |
| `restore <snapshot>` | Yes, constrained | Read only | Writes only an isolated staging workspace | Fixed `--target`, `--overwrite never`, and validated `--include` paths. |
| `backup` | No | Never invoked | N/A | No route, service, job, or UI control. |
| `forget` / `prune` | No | Never invoked | N/A | No retention handoff. |
| `unlock` | No | Never invoked | N/A | Never used as error recovery. |
| `migrate` / `repair` / `init` | No | Never invoked | N/A | No repository lifecycle handoff. |

The [inspector](../backend/src/utils/restic/LegacyRepositoryInspector.ts) accepts
only `snapshots`, `stats`, and `ls`. The separate
[restore executor](../backend/src/utils/restic/LegacyRepositoryRestoreExecutor.ts)
exposes only one fixed repository-read/staging-write restore request. Neither
accepts an arbitrary command name, Restic flags, destination, password command,
or repository environment override. Inherited `RESTIC_REPOSITORY`,
`RESTIC_REPOSITORY_FILE`, `RESTIC_PASSWORD_COMMAND`, and `RESTIC_PASSWORD_FILE`
values are removed before spawning the child process.

## Snapshot browser and logical paths

The browser invokes `restic ls --json` and validates individual JSON node records.
It does not parse human-oriented Restic output and does not browse by restoring.
It displays breadcrumbs and direct children with type, size, modification time,
permissions, and logical path. A response is capped at 8 MiB and 10,000 direct
entries so an unusually large snapshot directory fails safely.

Browser and restore input use a logical POSIX-relative path grammar. The backend
rejects empty selections, absolute paths, `.` or `..` segments, repeated
separators, backslashes or Windows drive confusion, percent-encoded ambiguity,
NUL/control characters, replacement characters, malformed paths, and paths that
are not direct entries of the selected snapshot directory. Full 64-character
snapshot IDs are required. The server converts a validated logical path to the
fixed Restic form only after validation.

The UI can select one regular file, one directory, or up to 20 non-overlapping
files/directories. It prevents selecting an item under an already-selected parent,
and selecting a parent removes its already-selected descendants. Direct symlink
selection is rejected server-side and disabled in the UI. Other unsupported node
types are also rejected.

## Staged restore boundary

The application owns the staging root through
[`AppPaths.getLegacyRestoresDir`](../backend/src/utils/AppPaths.ts). It is separate
from the managed restore temporary directory:

| Runtime | Legacy staging root |
| --- | --- |
| Development/test | `<repository>/data/legacy-restores` |
| Docker | `/data/legacy-restores` |
| Installed runtime | `<Pluton data base>/legacy-restores`, including `PLUTON_DATA_DIR` when configured |

Every job gets a generated internal workspace named
`restore-job-<24-lowercase-alphanumeric-id>`. The service creates it under the
staging root with private POSIX permissions where supported, stores the exact path,
then rejects symlinked roots/workspaces and validates the ID, expected path,
`lstat`, and resolved path before using it. The path is never returned by the API
or UI. The service never uses an
operator-selected destination, source path, live application directory, or
repository path as the target.

Before a restore job is created, the service resolves both the registered
repository path and the staging root and rejects equal, nested, or ancestor
paths, including symlink aliases. This prevents a repository registration from
causing the fixed restore target to write anywhere inside the source repository
tree.

The only restore command shape is equivalent to:

```text
restic --no-lock --no-cache --json --repo <registered-path> restore <full-snapshot-id>
  --target <internal-staging-workspace> --overwrite never
  --include /<validated-logical-path> [...]
```

It never supplies `--delete`. The executor records only JSON summary counts, has a
30-minute timeout, caps stdout at 4 MiB and individual lines at 128 KiB, and does
not retain Restic stderr. Job state is persisted as `queued`, `running`,
`completed`, `failed`, or `cancelled`. Independent jobs use different workspaces;
on application restart, queued and running jobs are marked failed rather than
resumed against unknown partial output. Cancellation sends a termination signal to
the tracked child and marks the job cancelled without attempting cleanup or unlock.

The Restic [restore documentation](https://restic.readthedocs.io/en/stable/050_restore.html)
describes `--target`, `--include`, and the effect of restoring selected content.

## Download boundary

The UI offers individual download only after that repository's job is completed.
The download endpoint rechecks the UI session, repository ownership, job ownership,
completed state, the same logical path grammar, workspace containment, and realpath
containment. It uses `lstat`, refuses directories and symlinks, opens only a regular
file with no-follow semantics where supported, and streams that file to the client.
Directory archives are deliberately not generated. This avoids a second archive
format, directory traversal during packaging, and ambiguous symlink behavior.

A selected directory may contain symlinks in staging because Restic represents the
snapshot faithfully, but those links can never be downloaded through this endpoint.
Operators must inspect staged content through their approved local process if they
need a directory-level recovery workflow.

## API and UI

All legacy routes require an authenticated UI session. The restricted machine
API-key allowlist does not include them.

| Endpoint | Local effect |
| --- | --- |
| `GET /api/legacy-repositories` | List safe local registration metadata. |
| `POST /api/legacy-repositories` | Validate with snapshot inspection, then store one read-only registration. |
| `GET /api/legacy-repositories/:id` | View one registration's safe metadata. |
| `POST /api/legacy-repositories/:id/validate` | Recheck access through snapshot inspection. |
| `GET /api/legacy-repositories/:id/snapshots` | List snapshot metadata with optional exact `tag`, `path`, and `host` filters. |
| `GET /api/legacy-repositories/:id/snapshots/:snapshotId` | View one already-listed snapshot by full 64-character ID. |
| `GET /api/legacy-repositories/:id/snapshots/:snapshotId/tree?path=<logical-path>` | List direct structured snapshot entries. |
| `GET /api/legacy-repositories/:id/stats` | Obtain safe statistics when supported by Restic. |
| `POST /api/legacy-repositories/:id/restores` | Queue a validated staged restore. |
| `GET /api/legacy-repositories/:id/restores/:jobId` | Read safe state for that repository's job. |
| `POST /api/legacy-repositories/:id/restores/:jobId/cancel` | Cancel a queued or running staged restore. |
| `GET /api/legacy-repositories/:id/restores/:jobId/files?path=<logical-path>` | Stream one regular file from a completed job. |
| `DELETE /api/legacy-repositories/:id` | Delete the local registration only. |

The [Legacy Repositories UI](../frontend/src/routes/LegacyRepositories/) labels the
repository as read-only, shows a breadcrumb browser, labels symlinks, supports
multi-select and confirmation, reports job state, and only shows per-file download
after successful staged recovery. The confirmation explains that the repository is
read and staging is written.

## Error handling, limits, and operational limits

Raw stderr, command environments, passwords, internal staging paths, and raw
repository/transport errors never cross the service boundary. The API maps known
errors to safe messages. Availability is marked unavailable on a repository-level
execution failure; invalid logical paths and missing selected entries do not become
arbitrary command input.

Current deliberate limits are:

- local filesystem registrations only;
- no automatic staging cleanup, disk-space preflight, resume, or retry of a
  partial restore;
- no directory archive/download and no symlink download;
- at most 20 selected paths, 10,000 direct browser entries, 8 MiB browser output,
  and 4 MiB restore stdout;
- a 30-second inspection timeout and 30-minute restore timeout;
- no support matrix for all Restic versions, repository formats, or external mount
  guarantees.

Staging output can contain sensitive recovered data. Operators must protect the
Pluton data volume, review and remove staging output through an explicitly approved
operational process, and never place it in source control.

## Test coverage and remaining boundary

Focused tests use mocked child processes and generic fixtures. They cover fixed
argument arrays, environment clearing, JSON validation, path rejection, direct
entry validation, symlink refusal, workspace containment, cross-job denial,
cancellation, safe failure messages, session-only routes, streamed single-file
download, fresh/upgrade migration, and independent concurrent workspaces. A
disposable Docker Restic fixture is also used to verify `ls --json` and a selected
`restore --no-lock --target ... --overwrite never --include ...` invocation without
using a user repository.

These checks establish the application boundary. They do not prove that an external
repository is mounted read-only, that an operator has enough protected staging
capacity, or that every Restic version has identical output. Any expansion to a
remote backend, managed lifecycle, directory archive, automatic cleanup, recovery
testing, or workload migration requires a separately scoped phase.
