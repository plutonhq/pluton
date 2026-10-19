# Phase 5 remote database backup lifecycle

One Backup Plan represents one application or workload. A remote managed plan can
include **0–8 logical databases**, mixing MariaDB, MySQL and PostgreSQL. Every
configured dump must succeed before one Restic backup includes the application
source and all SQL artifacts. Existing single-database Phase 5 plans are migrated
without recreation or password re-entry.

This is an independent extension of the public code. It adds no global Database
Backup product, database restore/import, Phase 5.5, local-script extension or
Legacy mutation path. Phase 4 Browse, Download and staged Restore remain the
recovery path. Validation uses disposable fixtures, not production. Keep SYS MON
active until a separately authorized pilot and cutover decision.

## Audit of the single database implementation

The previous Phase 5 implementation had the following single-database assumptions.
These were traced across persistence, API validation, agent execution and UI before
changing the collection model.

| Boundary                           | Previous assumption                                                                                                     | Current implementation                                                                           |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Plan settings and shared types     | `settings.remoteLifecycle = { version: 1, database: {...}, preHook?, postHook? }`; optional single MariaDB/MySQL config | Strict legacy input plus canonical `{ version: 2, databases: [...] }`                            |
| Credential schema and store        | `remote_plan_database_credentials(plan_id, encrypted_password)`; one password per plan                                  | Additive entry credential table, scoped by plan and stable database ID                           |
| Encryption and write-only API      | Cryptr under server `SECRET`; separate ciphertext; blank edit retained one password                                     | Same encryption boundary, independently for each entry; no password in plan JSON or response     |
| `PlanService`                      | Create, update, disable and schedule rollback passed one ciphertext                                                     | Atomic plan/credential collection writes; unrelated settings do not rewrite secrets              |
| `RemoteBackupService`              | Materialization decrypted one password and checked one engine                                                           | Materializes every owned entry and validates all advertised engines                              |
| Payload and inventory              | Outer `BACKUP_FILESYSTEM` version 2, inner lifecycle version 1, `backupLifecycleVersion: 1`                             | Outer version 3, inner lifecycle version 2, capability version 2; negotiated old-single fallback |
| Binary selection                   | Root-owned `mariadb-dump`, or genuine MySQL `mysqldump`                                                                 | Same engine distinction plus bounded detection of genuine `pg_dump`                              |
| Agent job and artifacts            | One defaults file, one `pluton/database/<filename>.sql`, one report object                                              | Fresh private workspace; per-entry credential/dump files; sequential execution                   |
| Snapshot and completion            | One dump node/size; `completionStats.lifecycle.database`                                                                | Exact snapshot/source and every dump; `lifecycle.databases`; single-entry alias retained         |
| Frontend types, utility and editor | One fixed form; one saved-password flag; object enable/disable                                                          | Independent cards with add/remove/reorder and ID-bound saved passwords                           |

The agent still polls outbound, verifies signed commands, ACKs a lease, validates
source realpaths against allowed roots, and prepares a private SFTP configuration.
Durable commands contain references, not decrypted secrets. Credentials are
materialized only for authenticated, signed agent delivery. Existing OSS local
`PlanScripts` and `executeUserScript` remain unchanged; their interpreter/root/raw
output behavior is not reused for remote hooks.

## Collection model and protocol compatibility

The collection preserves the requested card order. A maximum of eight entries bounds database
load, credential materialization, workspaces, completion size and confirmation
work without introducing parallel dumps. Different applications on one server
normally remain separate plans: one app plus two MariaDB databases is one plan;
two independent apps are normally two plans.

Each entry contains `databaseId`, engine, host, TCP port, database, username,
`dumpFilename`, `timeoutSeconds`, `maxDumpBytes`, TLS mode, and the allowlisted
MariaDB/MySQL routines/events booleans. The public API returns only
`passwordConfigured`, never a password, ciphertext or secret reference. No UI
binary, arbitrary client flags, DSN, socket path or credential-file path exists.

| Plan and agent                                           | Wire behavior                                                                          |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Filesystem-only Phase 4 plan                             | Original outer version 1, no lifecycle                                                 |
| Old single-DB API request                                | Version 1 `database` accepted for MariaDB/MySQL; persisted as one version 2 entry      |
| One MariaDB/MySQL entry with old lifecycle-capable agent | Outer version 2, inner version 1, ID omitted only from this legacy wire representation |
| Collection-capable agent                                 | Outer version 3, inner version 2, stable ID on every entry                             |
| Multiple entries or PostgreSQL with old agent            | Refused before queuing/materialization; update agent first                             |

The updated inventory reports agent `0.4.0`, `backupLifecycleVersion: 2`, installed
`databaseEngines`, and whether the administrator-owned hook root is ready. Every
selected engine must be advertised. Old single-DB API edits inherit the one
existing entry ID; an old request cannot silently truncate a multi-entry plan.
Filesystem-only and historical recovery consumers are not upgraded into a new
lifecycle merely to reuse their UI.

## Stable identity and credential migration

The server assigns opaque `db_` IDs using UUID randomness. Clients cannot invent
new persisted IDs or attach another plan's ID. Credential lookup is always scoped
to the owning plan. Reorder moves whole entries, never a password array indexed
by card position. A blank or omitted password retains the exact saved ciphertext;
changing A does not change B; removing A erases only A's binding and secret.
`passwordConfigured: true` from a client is not evidence that a secret exists.

Migration `0008_phase5_multiple_database_credentials.sql` adds:

```text
remote_plan_database_entry_credentials
  database_id        PRIMARY KEY
  plan_id            NOT NULL REFERENCES plans(id) ON DELETE CASCADE
  encrypted_password NOT NULL
  legacy_single      NOT NULL DEFAULT false

index: remote_plan_database_entry_plan_idx(plan_id)
```

The old `0007` table is retained. For a healthy old version 1 plan, `0008` copies
its ciphertext **byte-for-byte**, generates an ID, marks that copied binding
`legacy_single`, and normalizes its JSON into a one-item collection in the same
migration transaction. Hooks and unrelated settings survive. No key or plaintext
password is needed by the migration. Framework replay does not regenerate IDs.
An already unhealthy plan with a missing old credential is not silently repaired.

The retained old ciphertext follows explicit password changes for its imported
entry and is erased if that entry is removed. It is not shared with additional
entries. Plan create/update and all credential mutations share a transaction.
The store checks IDs against the actual saved plan before writing, rejects
cross-plan ownership/orphan bindings, and explicitly erases both credential
tables on plan deletion even if an older migration disabled foreign-key checks.
The new foreign key also passes cascade tests with enforcement enabled.

Tests force failure during multi-entry create/update, schedule updates and the
migration itself. The previous plan and credentials remain intact after rollback;
the rolled-back migration can then be applied successfully. This is not a
supported destructive down-migration: **do not run the old application against a
migrated multi-DB schema**. Before deployment, preserve a consistent server DB
backup and existing key material for a coordinated rollback. Do not change
`SECRET` or `ENCRYPTION_KEY` during the upgrade.

## Client detection and PostgreSQL implementation

Clients must already be installed by an administrator; the installer does not
download database clients. Detection uses an argument array, `shell: false`, a
two-second version timeout, a 4 KiB output bound and a minimal environment.
Resolved executables and every canonical ancestor must be root-owned, executable
as appropriate and not group/other writable or setuid/setgid.

MariaDB prefers `mariadb-dump` and accepts a verified MariaDB `mysqldump` alias.
MySQL requires a genuine `mysqldump`, not that alias. PostgreSQL requires a genuine
`pg_dump --version`. Default detection also checks root-owned versioned executables
under `/usr/lib/postgresql/<major>/bin/`, highest major first, after the standard
binary locations. Debian/Ubuntu's `/usr/bin/pg_dump` can resolve to `pg_wrapper`;
the agent executes the real packaged binary rather than invoking that wrapper
under its canonical name or inheriting cluster-selection defaults. See the
[Debian wrapper documentation](https://manpages.debian.org/trixie/postgresql-client-common/pg_wrapper.1.en.html).
An administrator-specified binary-directory list remains authoritative.

The fixed PostgreSQL dump argv is:

```text
pg_dump --format=plain --no-password --host <host> --port <port>
        --username <username> --dbname <simple-database-name>
```

Output streams directly to a private SQL file with an independent size/time cap
and SHA-256. Default ownership/ACL statements are retained; no SQL import is
implemented. Database/user names are restricted to safe simple identifiers, at
most 63 characters for PostgreSQL. Connection strings, option-like identifiers,
MySQL-only routines/events flags and arbitrary pg_dump switches are refused.
A client cannot dump a newer server major version; use a compatible client and
validate the exact deployment version. Such failures have a closed
`database-client-incompatible` code, not raw provider output. See the official
[pg_dump documentation](https://www.postgresql.org/docs/current/app-pgdump.html).

## Private credentials and verified transport

Passwords are write-only and encrypted server-side. The signed leased command
contains transient plaintext, as Phase 4 already does for storage credentials;
use HTTPS for untrusted networks. The existing explicitly enabled trusted-LAN
HTTP exception is unchanged. No database password is persisted in durable queued
commands, completion receipts, progress or logs.

MariaDB/MySQL keep the Phase 5 defaults-file model: the private `0600` file is the
first client argument; host/user/password are quoted and escaped inside it, never
passed as password argv or `MYSQL_PWD`. An empty private HOME/login-file location
blocks inherited login configuration. Their existing remote certificate/hostname
verification behavior is preserved.

PostgreSQL uses one private `database-<ordinal>.pgpass` file per dump. All fields
escape colon and backslash; CR/LF passwords and NUL are refused. The file is
exclusively created at `0600` in a `0700` job workspace and deleted in that dump's
`finally`, before Restic and the post hook. `PGPASSFILE` contains only the file
path, never the password. The client receives a minimal allowlisted environment,
not parent application variables or `PGPASSWORD`, `PGSERVICE`, DSNs or storage
credentials. These requirements follow the official
[password-file format](https://www.postgresql.org/docs/current/libpq-pgpass.html).

For remote TCP, `PGSSLMODE=verify-full` verifies certificate chain and hostname.
`PGSSLROOTCERT` points to the checked root-owned, immutable system CA bundle
`/etc/ssl/certs/ca-certificates.crt`; a missing/unsafe bundle fails closed. Install
the required trust through normal administrator-controlled system CA provisioning,
not a UI-supplied file. `PGGSSENCMODE=disable` prevents a different encryption
mechanism from skipping the requested certificate check. There is no plaintext
fallback. Explicit `local` mode sets `sslmode=disable` only for `localhost`,
`127.0.0.1` or `::1`. See PostgreSQL's
[TLS verification](https://www.postgresql.org/docs/current/libpq-ssl.html) and
[environment controls](https://www.postgresql.org/docs/current/libpq-envars.html).

## Execution order and complete snapshot semantics

A normal new attempt follows this order:

1. Validate the command, source realpath/allowed roots, state overlap and tools.
   All database configs are parsed before execution. Check for an existing
   snapshot with this backup tag to preserve replay safety.
2. Validate **every** required database client and both configured hooks before
   creating a fresh private workspace or running the pre hook.
3. Run the plan-level pre hook once, then dump entries **sequentially** in saved
   order. Validate each dump as regular, agent-owned, `0600`, nonempty and within
   its own cap. Record bytes and SHA-256; delete that entry's credential file.
4. Only after every dump succeeds, prepare/init the managed repository under the
   unchanged non-empty-target safety check. Run **one** Restic backup containing
   the original absolute application source and every relative SQL artifact.
5. Confirm the exact full 64-character snapshot ID, both plan/backup tags, the
   application source binding and its tree node, and every expected dump file's
   exact safe path and size. Exit zero alone is insufficient.
6. Attempt the bounded plan-level post hook once and remove the workspace and
   temporary storage config. Preserve confirmed success if post/cleanup fails,
   with a closed warning instead of concealing the cleanup problem.

Each attempt uses `/var/lib/pluton-agent/jobs/job-<random>/` at `0700`; dumps are
`pluton/database/<safe-filename>.sql` at `0600`. Files are never staged in the live
application. Filenames must be unique after case/normalization checks; separators,
traversal, controls, empty/option-like names and silent overwrite are rejected.
Restic receives those relative paths with the private workspace as cwd, exposing
them naturally as `/pluton/database/<safe-filename>.sql`. Absolute/relative input
handling follows the existing Phase 5 model and
[Restic documentation](https://restic.readthedocs.io/en/stable/040_backup.html#absolute-and-relative-paths).

`completionStats.lifecycle.databases` contains one object per configured entry:

```text
{ databaseId, engine, database, path, bytes, sha256 }
```

For exactly one dump, `lifecycle.database = { path, bytes, sha256 }` is also
returned for old consumers. Multiple entries have no ambiguous single alias.
The server independently rejects a multi-DB success missing an artifact or using
the wrong ID, engine, database, filename, count or size cap. Strict completion
validation rejects secret-bearing fields. Historical single-DB recovery still
uses its original snapshots; Browse, full Download and staged Restore need no
database-specific import adapter.

## Failure cancellation and replay

If DB1 succeeds and DB2 fails, DB3 is skipped, no Restic **backup/init** occurs,
and all generated files are cleaned. Repository listing/replay probes may
already have run. Failure is terminal and identifies the safe database ID/engine
with a closed stage/code. Another Backup Now creates a new job and fresh dumps
for **all** configured entries, never reusing DB1's old output.

Cancellation kills the active process group and remaining descendants, skips
later dumps/backup, and attempts bounded post cleanup before deleting the private
workspace. The post hook ignores cancellation but keeps refreshing the command
lease. A successful snapshot confirmed before cancellation is retained. Remote
failures are not a new automatic database retry engine.

Persisted successful completion replay returns its receipt without hooks, dumps
or a duplicate snapshot. If the receipt is lost but the tagged snapshot exists,
the agent confirms source/all artifact nodes and reconstructs collection hashes
by streaming `restic --no-lock dump` into a bounded hash sink. It does not stage
SQL or rerun the database clients. Recovery failure still fails closed.

## Hook execution and safe observability

Hooks remain optional, disabled-by-default **plan-level** references to flat
identifiers under `/etc/pluton-agent/hooks`, with fixed non-secret argv and a
1–300 second timeout. Files and ancestors must be root-owned and not group/other
writable; symlinks, traversal, nonregular/nonexecutable and setuid/setgid files
are refused. The agent directly executes the deployed file with `shell: false`,
never a UI-selected interpreter, sudo or root escalation. Hook output is
discarded and bounded; process descendants are stopped even on parent success.

Hooks receive a small fixed environment and `PLUTON_JOB_WORKSPACE`. They are
trusted administrator code, not a web-script sandbox. Review their semantics,
make cleanup idempotent, and never deploy hooks that mutate the live application,
accept shell fragments, launch daemons or expose secrets. Existing local Scripts
behavior is not changed.

Agent/server events include fixed checkpoints such as `database-dump-started`
and `database-dump-completed`, plus `databaseId`, engine and ordinal/count.
Failures include safe codes for missing/incompatible clients, authentication,
unavailability, TLS, timeout, empty/oversize output and invalid artifacts. Raw
provider stderr, SQL, credential contents, passwords, HMAC, agent secrets, lease
tokens and encryption keys are never logged. Failed entries are visible in the
sanitized final error. Post/cleanup warnings remain visible as
**Complete · Cleanup warning** after a confirmed snapshot.

## Database and Hooks editor

Edit Plan → Advanced → Database & Hooks now has independent database cards with
Add, Remove, Move up and Move down. Each card owns its engine, connection,
write-only password, unique filename, timeout/size and transport settings.
Defaults are port 3306 for MariaDB/MySQL and 5432 for PostgreSQL. PostgreSQL hides
and clears MySQL-only flags. New filenames are unique; the backend still enforces
all invariants independently.

Saved passwords are never prefilled; each card shows its own saved state. Moving
a card preserves its stable server ID and any unsaved replacement password.
Unsaved UI keys are not persisted database IDs. Existing plans render as one card
after migration. Saving unrelated settings does not read/rewrite credentials.
Disabling database backup sends an explicit empty collection, preserving optional
plan hooks; omitting lifecycle settings from an unrelated partial update retains
the saved collection. Lifecycle edits are blocked while that plan is backing up.

## Files changed for this upgrade

No dependency, lockfile, installer or Legacy/recovery-service changes are needed.
Paths below are relative to the repository root; grouped names share that prefix.

| Area                        | Changed files                                                                                                                                                                                                                                                                          |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agent execution             | `agent/src/backupFilesystem.ts`, `backupLifecycle.ts`, `lifecyclePolicy.ts`, `lifecycleProcess.ts`, `client.ts`, `inventory.ts`, `runtime.ts`, `types.ts`                                                                                                                              |
| Agent regression fixtures   | `agent/src/backupLifecycle.test.ts`, `lifecycleTransport.test.ts`; `agent/test-fixtures/phase5/Dockerfile`, `RealDatabase.Dockerfile`, `database-client.mjs`, `restic.mjs`                                                                                                             |
| Backend model and execution | `backend/src/types/remoteLifecycle.ts`, `agents.ts`, `backups.ts`; `backend/src/utils/remoteLifecycle.ts`; `backend/src/stores/PlanStore.ts`; `backend/src/services/PlanService.ts`, `RemoteBackupService.ts`, `AgentService.ts`                                                       |
| Schema                      | `backend/src/db/index.ts`, `db/schema/remotePlanCredentials.ts`; `backend/drizzle/0008_phase5_multiple_database_credentials.sql`, `meta/0008_snapshot.json`, `meta/_journal.json`                                                                                                      |
| Backend tests               | `backend/__tests__/utils/multipleDatabaseLifecycle.test.ts`; `services/AgentService.test.ts`, `PlanLifecycle.test.ts`, `RemoteBackupService.test.ts`; `stores/PlanStore.test.ts`, `RemotePlanCredentials.test.ts`; `integration/phase5Credentials.smoke.ts`, `phase5Database.smoke.ts` |
| Frontend                    | `frontend/src/@types/plans.ts`, `backups.ts`; `utils/remoteLifecycle.ts`; `components/Plan/PlanSettings/PlanAdvancedSettings.tsx`, `PlanRemoteLifecycleSettings.tsx`, `PlanRemoteLifecycleSettings.module.scss`; `frontend/__tests__/remoteLifecycle.test.ts`                          |
| Documentation               | This Phase 5 lifecycle document                                                                                                                                                                                                                                                        |

## Validation results and reproducible checks

Validation on the implementation branch used Node.js 24, pnpm 10.20.0 and isolated
test data. Focused tests cover ownership and duplicate bindings, reordering,
independent password update/removal, full/missing completion metadata, old API
fallback, arbitrary flags/DSNs, filename collisions, per-engine permissions,
credentials escaping, cleanup, cancellation, fresh retries, hook counts, source
confirmation and signed failure/success transport without secrets.

- Focused collection/lifecycle/plan/credential regressions: **91 tests passed in
  six suites**, including the real migration/store scenarios below.
- Full backend Jest: **134 suites passed; 2,713 tests passed; 1 skipped**. Both
  normal parallel workers and the documented serial run were exercised.
- Isolated real SQLite credential/migration scenarios: **10 passed**, including
  byte-identical usable legacy ciphertext, stable migration replay, cascade,
  schedule/store rollback and forced migration failure followed by reapply.
- Complete non-root Linux agent suite: **63 passed; none skipped**.
- Frontend lifecycle/download utility tests: **17 passed**.
- Backend/agent typechecks, frontend `tsc -b`, backend lint, agent build and root
  production build: **passed**.
- Existing Phase 4 real SFTP recovery regression: **passed**; two historical TAR
  downloads, 14 files, cancellation, full/granular/custom staging, matching
  hashes, unchanged source/repository and credential cleanup.
- `git diff --check`: **passed**. No production endpoint, identifier, SQL data or
  credential is added to the public source/fixtures/docs.

Frontend lint was attempted and remains blocked by the unchanged baseline:
ESLint 10 with `tseslint.config()` rejects string `extends: 'eslint-config-prettier'`.
It is not reported as passed. Production build still emits baseline bundle-size
and Browserslist warnings; Jest emits an exit-listener warning. Browser visual
verification against an application was not performed; utility tests, typecheck
and production compilation do not replace operator UI acceptance.

Run the standard commands in [ARCHITECTURE.md](ARCHITECTURE.md), plus:

```sh
pnpm --filter @plutonhq/core-backend test --runInBand --silent --verbose=false
pnpm --filter @plutonhq/core-backend test --runInBand --silent --verbose=false \
  __tests__/utils/multipleDatabaseLifecycle.test.ts \
  __tests__/services/PlanLifecycle.test.ts \
  __tests__/services/RemoteBackupService.test.ts \
  __tests__/services/AgentService.test.ts \
  __tests__/stores/RemotePlanCredentials.test.ts
pnpm --filter @plutonhq/pluton-agent typecheck
pnpm --filter @plutonhq/pluton-agent build
node --experimental-strip-types --test frontend/__tests__/*.test.ts
git diff --check
```

The Linux harness must run non-root with immutable fixture clients and executable
temporary scripts. Windows alone skips Linux execution cases and is insufficient:

```sh
docker build -t pluton-phase5-validation -f agent/test-fixtures/phase5/Dockerfile .
docker run --rm --network none --read-only --tmpfs /tmp:exec,mode=1777,size=128m \
  --mount type=bind,src="$PWD/agent/dist",dst=/app/agent/dist,readonly \
  --entrypoint /bin/sh pluton-phase5-validation \
  -c 'node --test /app/agent/dist/*.test.js'
```

Credential smoke tests run the actual store/migrations in a separate Node/TSX
process per scenario with in-memory SQLite. Actual insertion/migration failures
are asserted; rollback is not mocked away. This also avoids native SQLite state
sharing across Jest VM realms.

## Real database and recovery evidence

`backend/__tests__/integration/phase5Database.smoke.ts` runs three disposable modes:
`single` (legacy MariaDB), `two-mariadb`, and `mixed` (MariaDB + PostgreSQL). Evidence
uses MariaDB **11.8.8**, PostgreSQL/pg_dump **18.6**, Restic **0.19.1**, Rclone
**1.75.1**, limited synthetic accounts and generated credentials. Each success
includes source plus all SQL files in one snapshot, confirms known fixture rows,
recovers every SQL through Browse/full Download/staged Restore, compares each
SHA-256/size to completion metadata, and verifies unchanged source and no job
workspace. The mixed case also proves a real password with colon/backslash works.
Real PostgreSQL wrong-password, unavailable-port and TLS-failure paths fail with
safe entry-specific diagnostics and cleanup.

All three modes and the Phase 4 real recovery smoke **passed**. MySQL + PostgreSQL
and old single MySQL pass synthetic executable/argv/security regressions only;
**no real MySQL server was tested**. There was no production connection. Verified
remote PostgreSQL TLS success, client-version incompatibility, size/timeout and
cancellation need pilot acceptance on the intended installed versions; synthetic
regressions do not establish that production evidence.

The opt-in real-DB image uses the local pinned Phase 4 validation image as its
base. Database-client packages added to this image are test-only, not agent
installer dependencies. With that base available, a Linux-shell reproduction is:

```sh
docker build -t pluton-phase5-real-db -f agent/test-fixtures/phase5/RealDatabase.Dockerfile .
for mode in single two-mariadb mixed; do
  docker run --rm --network none --read-only --tmpfs /tmp:exec,mode=1777,size=768m \
    -e NODE_ENV=test -e PLUTON_DATA_DIR=/tmp/phase5-data \
    -e ENCRYPTION_KEY=synthetic-validation-key \
    -e USER_NAME=fixture-admin -e USER_PASSWORD=synthetic-validation-password \
    --mount type=bind,src="$PWD/backend/src",dst=/app/backend/src,readonly \
    --mount type=bind,src="$PWD/backend/__tests__/integration",dst=/app/backend/__tests__/integration,readonly \
    --mount type=bind,src="$PWD/agent/dist",dst=/app/agent/dist,readonly \
    --mount type=bind,src="$PWD/agent/package.json",dst=/app/agent/package.json,readonly \
    pluton-phase5-real-db /app/backend/__tests__/integration/phase5Database.smoke.ts "$mode"
done
```

These application values are explicitly synthetic fixture inputs, not production
credentials. Everything runs inside a network-isolated container/tmpfs; there is
no host database volume. The original real integration entry point defaults to
`single`, preserving its old invocation. Do not redirect these tests to a live
repository or dump production configuration to reproduce them.

## Limits and existing plan actions

Sequential dumps are **not a distributed atomic transaction** across databases or
engines. One snapshot proves all selected dumps completed and the expected files
were captured; their transaction timestamps can differ. Changing application
files also prevent an atomic app checkpoint. MariaDB/MySQL single-transaction
consistency is intended for transactional tables, not nontransactional tables or
concurrent DDL. Review the installed engine's
[MariaDB](https://mariadb.com/docs/server/clients-and-utilities/backup-restore-and-import-clients/mariadb-dump)
or [MySQL](https://dev.mysql.com/doc/refman/8.4/en/mysqldump.html) constraints.
PostgreSQL dumps one logical database, not cluster roles/global configuration.
SQL is not semantically validated or imported by Pluton.

Limits are eight entries, 100 GiB and one hour per dump, 64 KiB per hook output
stream, five minutes per hook and 24 hours for lifecycle Restic execution. Plan
excludes can exclude SQL/source; snapshot confirmation then fails closed rather
than reporting a complete application backup. SIGKILL, power loss or denied
filesystem cleanup can leave private stale workspaces. They are never reused;
inspect only the exact inactive job directory after a warning, never delete a
broad source/state/repository root.

Healthy existing single-DB plans require **no configuration recreation or password
re-entry**: preserve server keys, deploy the additive migration, and keep the same
agent identity/storage/repository. Old lifecycle-capable agents still accept one
MariaDB/MySQL entry through negotiated compatibility. To use multiple databases
or PostgreSQL, update the agent and install suitable root-owned dump clients first.
No new agent enrollment is required. Read-only Legacy registrations and existing
retention/prune/unlock boundaries remain unchanged.

## Pilot for two MariaDB databases

1. Keep SYS MON active. Back up the server DB/key material and deploy the server
   migration. Update a test agent in place, preserving identity and allowed roots.
   Inventory must show agent 0.4.0, filesystem capability, lifecycle version 2 and
   MariaDB. Install an appropriate client; as the service user, verify
   `/usr/bin/mariadb-dump --no-defaults --version` and root-owned immutable paths.
2. Select a disposable application source such as `/srv/example-app` inside the
   approved root. Record hashes of application files. Use an approved **managed**
   test destination, not an imported Legacy repository. Existing managed storage
   and plan can be reused; a first pilot need not recreate an existing plan.
3. Prepare separate disposable InnoDB databases `app_main` and `app_logs` with
   known synthetic rows. Give distinct accounts only the necessary read/view/
   trigger privileges for their own database; leave routines/events off. Do not
   use root, write, SUPER or a shared broad account. Enter each password privately
   in the UI, never in shell argv/chat/config dumps.
4. Edit Plan → Advanced → Database & Hooks → Enable database backup. Add two
   MariaDB cards with database names `app_main`/`app_logs`, the corresponding
   usernames/passwords, port 3306 and filenames `app_main.sql`/`app_logs.sql`.
   Use timeout 900 seconds and a 10 GiB cap for each initial test. For a database
   on the agent's own host, choose explicit Local with `127.0.0.1`; for a remote
   host, use verified TLS and administrator-provisioned trust. Leave hooks off.
5. Save and reopen. Both cards must have different stable IDs, say Password saved
   and have empty password inputs. Move one card, save and reopen; the same IDs
   must follow their own entries. Saving unrelated settings must retain both
   credentials. Updating one test password must not affect the other.
6. Run Backup Now. Require Complete, a full snapshot ID and exactly two
   `completionStats.lifecycle.databases` entries matching the configured IDs,
   engine/names, positive bytes and `/pluton/database/<filename>` paths. Require
   no cleanup warning and no workspace for this completed job.
7. Browse that exact backup, then full Download and staged Restore to an isolated
   directory. For **both** SQL files compare `sha256sum` (or `Get-FileHash` on
   Windows) with metadata, and check the known fixture rows privately. Compare
   source hashes with step 2. Do not restore into the live application or import
   SQL into production. Logical import acceptance needs a separately selected
   disposable target and operator authorization; Pluton adds no import feature.
8. With a deliberately wrong **test** password on the second saved entry, run a
   new Backup Now. Require an entry-specific safe authentication failure, no new
   backup snapshot and cleanup of both dumps. Correct it and retry: both dumps
   must be fresh. Exercise cancellation during DB2 and reviewed pre/post hooks
   separately; hooks run once per job, not once per database.

## Pilot for MariaDB and PostgreSQL

1. Apply the same deployment, source, destination, saved-password/reorder and
   recovery checks above. Install administrator-owned `mariadb-dump` **and** a
   `pg_dump` compatible with the intended PostgreSQL server. Run version probes
   as the non-root service user; on Debian/Ubuntu check the actual versioned
   executable as well. Inventory must advertise both MariaDB and PostgreSQL.
2. Prepare one disposable MariaDB `app_main` and one PostgreSQL `analytics_db`,
   each with a known row and different limited backup accounts. For PostgreSQL,
   grant only the needed database connect, schema usage and reads on intended
   objects; large objects, policies and ownership may require additional reviewed
   permissions. Do not grant superuser merely to make a dump succeed.
3. Add MariaDB `app_main.sql` on port 3306 and PostgreSQL `analytics.sql` on port
   5432, each with its own privately entered password, 900-second timeout and
   10 GiB cap. PostgreSQL routines/events stay off. Use explicit loopback Local
   only for local DBs; remote PostgreSQL requires a trusted certificate with the
   correct hostname and the immutable system CA bundle. Never bypass verification.
4. Save/reopen, run Backup Now, and require one confirmed snapshot with source
   plus **both** entries. Browse, Download and staged Restore must recover both
   SQL hashes/sizes matching completion metadata; source and workspace checks
   must pass. Repeat a scheduled backup as well as a manual backup.
5. Test the second database's wrong test password, unavailable test port and
   invalid test certificate. Each must fail safely, skip Restic backup/init and
   remove every workspace artifact. Correct the test configuration and require a
   fresh successful attempt. Validate client-version mismatch, timeout, size cap,
   cancellation and optional once-per-job hooks in the intended deployment.

## SYS MON cutover remains blocked

Disposable smoke success is not production acceptance. Before any replacement,
obtain explicit cutover authorization and prove repeated scheduled backups on the
actual engine/client versions, remote TLS trust, required least-privilege grants,
application consistency strategy, capacity/time budget, cancellation/network/
failure recovery, reviewed hooks, retention ownership and a tested rollback.
Verify logical recovery into separately authorized disposable databases. Real
MySQL acceptance and intended Ubuntu/client packaging still require that pilot.
SYS MON has not been disabled, production has not been contacted, and no commit
or push is made by this task.
