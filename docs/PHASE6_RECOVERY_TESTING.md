# Phase 6 automated recovery testing

Phase 6 adds a separate, durable recovery test for an exact completed remote
managed SFTP backup. It restores from the repository into private server staging,
checks the restored structure and every recorded SQL artifact, and can import SQL
into explicitly configured disposable recovery databases. A failed recovery test
does not change a completed backup into a failed backup.

This is implementation and disposable integration evidence, not approval to
replace SYS MON. No production source or database was contacted. SYS MON remains
active; there is no Phase 6.5, source restore, repository mutation, arbitrary
validation script, commit or push in this task.

## 1 Existing recovery architecture

Phase 4 already resolves a backup through `RemoteRepositoryRecoveryService` to
its managed repository and persisted full 64-character snapshot ID. It verifies
both `pluton-plan-<id>` and `pluton-backup-<id>` tags. `ManagedSftpRepositorySession` constructs
a private Rclone SFTP configuration and permits only snapshot inspection,
listing, exact staged restore and archive download. Restic uses `--no-lock` and
`--no-cache`. Browse, Download and ordinary staged Restore use this boundary.

Phase 5 records SQL paths, bytes and SHA-256 in
`completionStats.lifecycle.databases`, or the historical `lifecycle.database`
shape. The existing JobProcessor dispatches an in-memory queue; it is not a
durable recovery-test record. Server secrets already use Cryptr under `SECRET`.

## 2 Chosen architecture

`RecoveryTestService` owns the durable job and workspace. Its filesystem operation
calls the Phase 4 service and session, not a second Restic executor or the backup
lifecycle. `RecoveryDatabaseImporter` streams verified SQL to fixed native clients
and uses database ownership markers plus durable cleanup leases. All operations
are server-side and authenticated through the existing UI-session API.

The sequence is exact binding, repository inspection, private staged restore,
filesystem validation, validation of all SQL artifacts, required imports, database
cleanup, workspace cleanup, and a separate recovery result. Tests have independent
queued, running, passed, failed, cancelled and passed-with-warning states.

## 3 Agent changes

No agent source or protocol changes are required. Phase 6 does not poll, SSH into,
request recovery contents from, or require an online source agent. Existing agent
identity is checked only as stored repository ownership metadata. Existing Phase
4/5 agents, managed storage and plans can be reused after server deployment.

## 4 Persistence model

Four new tables store policies, encrypted per-plan engine targets, recovery tests
and temporary database cleanup leases. A test binds immutable plan, backup,
repository and snapshot IDs, with its policy captured at enqueue time. Only safe
results, counts, hashes, timing, warnings and closed failure codes are retained.

Enqueue and worker claims are transactional. A partial unique index permits only
one queued/running test per plan; a unique automatic key prevents replay. Binding
triggers reject mismatches even on direct inserts. Active jobs and outstanding
database leases prevent plan/backup/repository metadata deletion. Completed test
history follows the existing managed metadata deletion order. Target changes are
blocked while a job or cleanup lease needs those credentials.

## 5 Automatic trigger

Automation is off by default. Enable **After every successful backup** per plan
to reconcile completed backup rows through the existing JobProcessor every five
seconds. Only backups completed since opt-in with a full snapshot ID qualify.
Historical backups remain manually testable; enabling automation does not test the
whole old history. Timestamp precision is one second.

SQLite records bridge a crash between backup completion and dispatch. There is
at most one automatic attempt for an exact backup/snapshot; completion replay and
an already tested backup do not cause repeated imports. A failed automatic test
requires an explicit manual retry after fixing the cause. No separate periodic
recovery schedule or notification workflow is added.

## 6 Filesystem restore and validation

Each run owns `/data/recovery-tests/run-<opaque-24-hex-id>/` and its `files/`
subdirectory, both private `0700`. Non-Docker installations use the same suffix
under their configured application data directory. Restore never targets the
source or an ordinary user restore workspace.

The exact snapshot listing allows only regular files and directories. Traversal,
duplicate logical paths, symlinks and special nodes are rejected. After Restic
restore, actual regular-file counts and sizes must match the listing; every listed
directory, including empty directories, must exist, and unexpected restored paths
are refused. The archived application source tree must exist. Historical source
paths are accepted only when proven to be directories in that exact listing;
agent-private SQL paths are not mistaken for application trees. Binding is checked
again after restore.

This proves Restic restore integrity and structural consistency, not full
application-file SHA-256 comparison or application semantic correctness. It never
compares against live production files.

## 7 Database artifact validation

Every recorded multi-database entry retains its stable `db_...` identity, engine,
logical database, exact `/pluton/database/<filename>.sql` path, bytes and SHA-256.
All artifacts are validated before any import. Missing/special files, duplicate
identities/paths, wrong sizes, wrong hashes or malformed metadata fail the test.
SQL files are opened without following symlinks and normalized to `0600` inside
the private workspace. Unrecorded SQL under the reserved artifact namespace is
not silently treated as filesystem-only recovery.

## 8 Disposable database architecture

Each plan may configure one separate target per engine. The administrator must
provision a dedicated recovery-only server, restrict its network access and create
the marker described below. The app does not launch database containers, mount a
Docker socket, install clients, receive administrator credentials, or import into
an existing application database.

Preflight checks the guard marker, restricted account properties/grants and the
visible database catalog. MariaDB/MySQL grant scope must be limited to the plan's
literal logical names; unknown visible databases fail closed. PostgreSQL refuses
superuser, CREATEROLE, replication, BYPASSRLS and inherited role membership. A
guard and restricted grants are defensive checks, not a substitute for the
operator proving that the endpoint is dedicated and not production.

## 9 MariaDB import behavior

Phase 5 uses a `--databases` dump that may contain CREATE DATABASE and USE. Recovery
therefore keeps its original logical database name on the dedicated target.
The name must be absent; an unexpected existing database is never dropped to make
the test work. No SQL or database-selection statement is rewritten.

The native MariaDB client must support sandbox mode. Import uses `--sandbox`,
`--binary-mode`, `--local-infile=0` and a private defaults file. Sandbox mode blocks
client commands that could access the application host. See the
[MariaDB client documentation](https://mariadb.com/docs/server/clients-and-utilities/mariadb-client/mariadb-command-line-client).

## 10 MySQL import behavior

MySQL follows the same original-name, scoped-grant and ownership rules, but
requires a genuine MySQL client, not a MariaDB executable exposed as `mysql`.
Binary mode disables interactive client command handling during noninteractive
input, and LOCAL INFILE is disabled. See the
[MySQL client command documentation](https://dev.mysql.com/doc/refman/8.4/en/mysql-commands.html).

MySQL import, credential, catalog, failure and cleanup behavior has synthetic
regression evidence only. The installed disposable image has a MariaDB alias,
not a real MySQL server/client pair. A genuine MySQL integration remains an
acceptance gate for a MySQL workload.

## 11 PostgreSQL import behavior

Plain SQL is imported with `psql` into a fresh `pluton_rt_<24-hex>` database.
`-X`, `--no-psqlrc`, `ON_ERROR_STOP` and native restricted mode protect the client.
The client security floor is 13.22, 14.19, 15.14, 16.10, 17.6 or 18 and later;
the installed client must also be compatible with the archived dump. These floors
correspond to the native restriction fixes documented in
[CVE-2025-8714](https://www.postgresql.org/support/security/CVE-2025-8714/).

The archived pg_dump restriction envelope is replaced by a fresh unpredictable
native restriction key. This changes only the client transport envelope, not SQL,
COPY data, database names, ownership or ACL statements; the archived artifact and
its SHA-256 remain unchanged. An archived key cannot enable shell/meta-command
execution with the fresh key. Malformed envelopes fail closed.

The import account must be compatible with the dump's owner. Required ACL grantee
roles must exist on the disposable server, normally as NOLOGIN roles without
production passwords. Missing roles produce `database-role-missing`; ownership
or extension permissions may otherwise fail import. Do not strip owners/grants,
grant superuser or enable inherited broad roles to force a pass. PostgreSQL plain
dumps do not contain the cluster's roles and global configuration; see
[pg_dump documentation](https://www.postgresql.org/docs/16/app-pgdump.html).

## 12 Credentials and security

Recovery passwords are new, separate, encrypted, write-only values under the
existing server `SECRET`. Neither `SECRET` nor `ENCRYPTION_KEY` is regenerated.
The frontend receives only configuration and `passwordConfigured`; an empty
password on update retains the encrypted value. Backup credentials are never
materialized as import credentials.

Credential files are `0600` and native client HOME directories are `0700`. Passwords
are absent from argv, process titles, logs, results and application environment
inheritance. Native processes use shell-free argv, a minimal environment, fixed
root-owned client files and immutable ancestors. Imports require non-root Linux.
TLS must verify the hostname and system CA for non-loopback targets; plaintext is
accepted only for explicitly selected localhost, 127.0.0.1 or ::1 targets.

Logs/results contain only closed stage/code categories, job/plan/backup IDs and
safe counts or metadata. Raw SQL, native stderr, Rclone configuration, repository
passwords, target passwords and agent secrets never cross that boundary. Phase 6
does not add Restic init, unlock, forget, prune, repair, migrate or retention paths,
and does not change the Legacy repository adapter.

## 13 Cleanup and cancellation

A durable lease is written before CREATE DATABASE. A random ownership token is
then stored in `__pluton_recovery_owner` inside the created database. Cleanup drops
only an exact leased database with the matching token. Missing or mismatched
ownership is never resolved by dropping an unknown database. A crash between
CREATE and ownership-marker insertion can require administrator review.

Success, import failure and cancellation all attempt bounded database cleanup,
then remove only the exact owned workspace. Cleanup warnings preserve validation
results; a successful validation can become Passed with warning. An unsafe or
undeletable workspace is logged by its exact safe ID/path, not deleted through a
broad root. Startup marks interrupted running jobs failed/cancelled and retries
owned database/workspace cleanup without resuming SQL or restore. Queued work is
durable and remains eligible for dispatch.

Cancel stops native Restic/Rclone/import process groups, skips remaining checks,
and persists Cancelled after cleanup. Child descendants are killed even when their
parent exits first. Shutdown aborts work and waits for cleanup; the existing
30-second forced-exit deadline hard-stops any newly tracked cleanup process groups
before exiting and may defer database removal to restart. The default process-manager
stop remains SIGTERM; the hard-stop signal is explicit on forced shutdown. Closing the
result modal or disconnecting an HTTP request does not cancel a durable job; use
the explicit Cancel Recovery Test action.

## 14 Concurrency and resource controls

| Resource                        | Phase 6 limit                                                        |
| ------------------------------- | -------------------------------------------------------------------- |
| Recovery worker                 | One globally and one queued/running test per plan                    |
| Staged restore                  | 24 hours; ordinary manual Phase 4 restore keeps its existing timeout |
| SQL import                      | One hour per database; sequential imports, at most eight artifacts   |
| Preflight and catalog commands  | One minute per command; connection setup timeout 10 seconds          |
| Client inventory probe          | Two seconds and 4 KiB output                                         |
| Native stdout and stderr        | 64 KiB each; excess fails and stops the process tree                 |
| Repository JSON/progress output | Existing bounded Phase 4 output policy                               |
| Workspace listing               | At most 1 TiB of regular-file bytes                                  |
| SQL artifact                    | At most 100 GiB each                                                 |
| Free disk before restore        | Listed restore bytes plus 512 MiB headroom                           |
| Recent attempt list             | 200 attempts plus latest results for up to 999 displayed backups     |

The workspace bound is a listing/preflight check, not an OS filesystem quota.
Reserve adequate disk and recovery DB capacity. Run one Pluton server instance
against its data directory; this does not introduce a distributed worker lease
or cluster/replica scheduling feature.

## 15 UI behavior

Edit a saved remote managed plan, open Advanced, then Recovery Testing. Policy and
engine targets save separately from the plan form. Filesystem and recorded SQL
artifact validation are mandatory. Database import can be Disabled or Required.
For a database backup, Disabled produces Passed with warning and an explicit
disabled import result. Required fails when a target or sufficient identity
metadata is missing. It never silently downgrades to artifact-only success.

Completed backup rows have independent Recovery labels and Run Recovery Test /
View Recovery Result actions. Restore remains its own action. Results show the
exact snapshot, backup/test/trigger, duration, filesystem counts/bytes, every DB
artifact hash/import/catalog result, safe failures and cleanup. The dashboard
separates recovery for the latest backup from the latest recovery attempt and its
tested snapshot/time; an older pass never validates a newer backup.

## 16 Historical snapshots

Completed Phase 4 filesystem snapshots are manually testable if exact managed
binding and an archived source tree can be proved. Historical single-DB metadata
supports byte/hash verification when present. Engine/database/databaseId remain
absent when they were not recorded; Required import then fails rather than
inventing identity. Full single/multi-database metadata supports the corresponding
imports. Missing snapshots, changed repositories, incomplete metadata or missing
source trees fail safely. No plan/storage recreation or retrospective metadata
rewrite is needed.

## 17 Files changed

New backend components are `types/recoveryTests.ts`, `db/schema/recoveryTests.ts`,
`stores/RecoveryTestStore.ts`, `services/RecoveryTestService.ts`,
`controllers/RecoveryTestController.ts`, `routes/recoveryTests.ts`,
`jobs/tasks/RecoveryTestTask.ts` and these utilities:
`recoveryTestPolicy.ts`, `recoveryWorkspace.ts`, `recoveryValidation.ts`,
`recoveryDatabaseClients.ts`, `recoveryProcess.ts`, `recoveryDatabaseImport.ts`.
They live under `backend/src/`.

Wiring changes are limited to `createApp.ts`, `index.ts`, `db/index.ts`, the managed
plan deletion guard in `PlanService.ts`, the Phase 6 entry points in
`RemoteRepositoryRecoveryService.ts` and scoped timeout/workspace/process cleanup
in `utils/restic/ManagedSftpRepositorySession.ts`. No agent runtime file changes.
`managers/ProcessManager.ts` accepts an explicit hard-stop signal for the shutdown
deadline while preserving its existing default SIGTERM behavior.

The frontend adds recovery types, service hooks, exact-backup utilities and
`components/Plan/RecoveryTesting/` settings/result/summary/styles. Existing
Backups, PlanBackups and PlanAdvancedSettings include those components.

Regression suites cover the new store, routes, service and four validation/import/
process/client utilities. Integration entry points are
`backend/__tests__/integration/phase6Persistence.smoke.ts` and
`phase6Database.smoke.ts`; the existing Phase 5 smoke entry point adds Phase 6
modes without changing agent/Phase 5 runtime behavior. Existing managed recovery
and session tests gain Phase 6 coverage; PlanService tests verify its deletion
guard runs before repository/backup/history removal. `scripts/validate-phase6.ps1` and the test-only
`backend/__tests__/fixtures/phase6/Dockerfile` provide isolated Linux validation.
This document and `ARCHITECTURE.md` describe operation and checks.

The exact local diff contains 17 modified and 35 new files:

```text
backend/__tests__/fixtures/phase6/Dockerfile
backend/__tests__/integration/phase5Database.smoke.ts
backend/__tests__/integration/phase6Database.smoke.ts
backend/__tests__/integration/phase6Persistence.smoke.ts
backend/__tests__/managers/ProcessManager.test.ts
backend/__tests__/routes/recoveryTests.test.ts
backend/__tests__/services/PlanService.test.ts
backend/__tests__/services/RecoveryTestService.test.ts
backend/__tests__/services/RemoteRepositoryRecoveryService.test.ts
backend/__tests__/stores/RecoveryTestStore.test.ts
backend/__tests__/utils/recoveryDatabaseClients.test.ts
backend/__tests__/utils/recoveryDatabaseImport.test.ts
backend/__tests__/utils/recoveryProcess.test.ts
backend/__tests__/utils/recoveryValidation.test.ts
backend/__tests__/utils/restic/ManagedSftpRepositorySession.test.ts
backend/drizzle/0009_phase6_recovery_tests.sql
backend/drizzle/meta/0009_snapshot.json
backend/drizzle/meta/_journal.json
backend/src/controllers/RecoveryTestController.ts
backend/src/createApp.ts
backend/src/db/index.ts
backend/src/db/schema/recoveryTests.ts
backend/src/index.ts
backend/src/jobs/tasks/RecoveryTestTask.ts
backend/src/managers/ProcessManager.ts
backend/src/routes/recoveryTests.ts
backend/src/services/PlanService.ts
backend/src/services/RecoveryTestService.ts
backend/src/services/RemoteRepositoryRecoveryService.ts
backend/src/stores/RecoveryTestStore.ts
backend/src/types/recoveryTests.ts
backend/src/utils/recoveryDatabaseClients.ts
backend/src/utils/recoveryDatabaseImport.ts
backend/src/utils/recoveryProcess.ts
backend/src/utils/recoveryTestPolicy.ts
backend/src/utils/recoveryValidation.ts
backend/src/utils/recoveryWorkspace.ts
backend/src/utils/restic/ManagedSftpRepositorySession.ts
docs/ARCHITECTURE.md
docs/PHASE6_RECOVERY_TESTING.md
frontend/__tests__/recoveryTests.test.ts
frontend/src/@types/recoveryTests.ts
frontend/src/components/Plan/Backups/Backups.tsx
frontend/src/components/Plan/PlanBackups/PlanBackups.tsx
frontend/src/components/Plan/PlanSettings/PlanAdvancedSettings.tsx
frontend/src/components/Plan/RecoveryTesting/RecoveryResult.tsx
frontend/src/components/Plan/RecoveryTesting/RecoverySettings.tsx
frontend/src/components/Plan/RecoveryTesting/RecoverySummary.tsx
frontend/src/components/Plan/RecoveryTesting/RecoveryTesting.module.scss
frontend/src/services/recoveryTests.ts
frontend/src/utils/recoveryTests.ts
scripts/validate-phase6.ps1
```

## 18 Migration

`backend/drizzle/0009_phase6_recovery_tests.sql`, its `0009_snapshot.json` and
`meta/_journal.json` are additive. They add the four tables, indices and binding /
deletion guards without rewriting Phase 4/5 plan, backup, repository or credential
metadata. Tests apply the real migration, repeat it, roll back a deliberately
failed migration transaction, exercise encryption/transactions/cascades, and verify
existing history and repository ciphertext remain unchanged.

Production startup runs the existing migration mechanism. Development/test
databases must be migrated explicitly through the existing workflow. Do not
manually modify the old migration journal, regenerate keys or remove prior data.

## 19 Validation commands and results

Run from the repository root using Node.js 24 and pinned pnpm 10.20.0:

```sh
pnpm --filter @plutonhq/core-backend test --runInBand --silent --verbose=false
pnpm --filter @plutonhq/core-backend test --maxWorkers=2 --silent --verbose=false
pnpm --filter @plutonhq/core-backend test --runInBand --detectOpenHandles --silent --verbose=false
pnpm --filter @plutonhq/core-backend test --runInBand --detectOpenHandles --silent --verbose=false __tests__/utils/recoveryProcess.test.ts __tests__/utils/recoveryDatabaseImport.test.ts __tests__/services/RecoveryTestService.test.ts __tests__/utils/restic/ManagedSftpRepositorySession.test.ts
node --experimental-strip-types --test frontend/__tests__/*.test.ts
pnpm --filter @plutonhq/core-backend exec tsc --noEmit -p tsconfig.json
pnpm --filter @plutonhq/core-frontend exec tsc -b
pnpm --filter @plutonhq/core-backend lint
pnpm build
git diff --check
```

Final validation evidence from the local Windows toolchain and disposable Linux:

| Check                                                                      | Result                                                                                            |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Full backend, serial with open-handle diagnostics                          | 141 suites passed; 2,830 tests passed, 4 platform skips; exit 0; no open handles reported by Jest |
| Full backend, two parallel workers                                         | 141 suites passed; 2,830 tests passed, 4 platform skips; exit 0; teardown warning as noted below  |
| Focused non-root Linux backend                                             | 9 suites passed; 229 tests passed, 1 Windows-only skip                                            |
| Focused native process/import/service/session with open-handle diagnostics | 4 suites passed; 91 tests passed; no open handles reported                                        |
| Actual SQLite migration/persistence scenarios                              | All 12 passed, including rollback, ciphertext preservation, restart, ownership and cascades       |
| Frontend utilities and component rendering                                 | 44 tests passed, none skipped                                                                     |
| Existing non-root Linux agent regression suite                             | 63 tests passed, none skipped; no agent source changes                                            |
| Backend/frontend typecheck; backend lint                                   | Passed                                                                                            |
| Root production build                                                      | All three packages passed: frontend, backend and agent                                            |
| Five real Phase 6 fixtures                                                 | Passed, including the expected failed mixed recovery and successful cleanup                       |
| Three existing Phase 5 real fixtures                                       | Single MariaDB, two MariaDB and mixed MariaDB/PostgreSQL passed                                   |
| Frontend lint                                                              | Blocked by the existing flat-config issue described below                                         |
| Git whitespace check                                                       | Passed for tracked changes and every new file                                                     |

The full parallel run exits 0 but emits a generic Jest worker-teardown warning.
The diagnostic full serial run finishes normally and traces the nonfatal
MaxListeners warning to existing Pino transport creation in
`PlanService.resumeBackup` tests. No logger changes or warning suppression are
included here. The production build also emits existing chunk-size/Browserslist
advisories, not build failures.

Backend coverage includes exact/cross-plan binding, repository errors, traversal /
staging escape, restore timeout, unsupported files, empty directories, count/size
checks, every engine's SQL hash/bytes, historical metadata, missing targets,
restricted grants, existing/unknown database refusal, native client permissions,
authentication/TLS/transport/import failures, timeout, cancellation, short input,
sanitized errors, cleanup markers, restart/shutdown, concurrency, replay, cascades
and accurate status beyond recent attempt history. Frontend tests cover exact
backup/snapshot identity and actual component server rendering, plus existing
Phase 4/5, HTTP temporary IDs and theme regressions.

Frontend lint is still blocked by the unchanged ESLint baseline configuration:
`typescript-eslint` flat config rejects the string `eslint-config-prettier`
extension. It is not reported as passed. No interactive browser/pilot acceptance
is implied by component-rendering tests or a production build.

For disposable non-root Linux validation in PowerShell:

```powershell
docker build -t pluton-phase5-real-db:local -f agent/test-fixtures/phase5/RealDatabase.Dockerfile .
docker build -t pluton-phase6-tests:local -f backend/__tests__/fixtures/phase6/Dockerfile .
./scripts/validate-phase6.ps1 -BackendTests -Image pluton-phase6-tests:local
./scripts/validate-phase6.ps1
./scripts/validate-phase6.ps1 -Modes single,two-mariadb,mixed
```

The agent regression command is documented in
[PHASE5_DATABASE_LIFECYCLE.md](PHASE5_DATABASE_LIFECYCLE.md#validation-results-and-reproducible-checks).
The native fixture derives from the existing locally built
`pluton-ci-validation:phase4` base. Build that base through the established Phase
4/5 disposable validation first if it is not already available. Do not deploy
these test images. The runner mounts source read-only, uses temporary storage,
non-root identity, no host network/database/socket, and `--network none`.

## 20 Real integration evidence

| Disposable case              | Evidence                                                                                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Filesystem only              | Real agent backup to SFTP/Restic, exact recovery restore, 1 regular file / 27 bytes, source tree, cleanup and replay checks passed                            |
| MariaDB 11.8.8               | Exact SQL size/hash, real native import, 1 table / 0 views and owned DB/workspace cleanup passed                                                              |
| PostgreSQL 18.6              | Exact SQL size/hash, real psql import with owner/ACL roles, 1 table / 0 views and cleanup passed                                                              |
| Mixed MariaDB and PostgreSQL | Both artifacts/imports passed in one exact snapshot; 3 regular files / 3833 bytes; both targets and staging cleaned                                           |
| Mixed deliberate failure     | Wrong separate PostgreSQL recovery password failed safely after MariaDB passed; overall recovery failed, backup stayed completed, both cleanup results passed |
| MySQL                        | Synthetic only; a MariaDB mysql alias is explicitly rejected as genuine MySQL evidence                                                                        |

All five Phase 6 fixtures compare a repository file SHA-256 manifest before and
after, check source application bytes remain unchanged, stop source database
servers before recovery, and confirm automatic replay is idempotent. Each also
exercises existing Browse, full Download and manual staged Restore. Restic 0.19.1
and Rclone 1.75.1 are real. A native PostgreSQL shell/meta-command probe is refused;
real process-group cancellation, timeout and forced-shutdown cleanup stops leave
no live descendants, even when the fixture children ignore SIGTERM. Single
MariaDB, two MariaDB and mixed Phase 5 regression fixtures pass separately.

## 21 Known limitations

Recovery remains remote-managed password-authenticated SFTP only, not a local,
Legacy, arbitrary-provider or restore-to-source feature. Unsupported special files
fail rather than silently disappearing. Repository JSON/progress bounds can reject
very large listings even when the byte-capacity check would allow them.

Native imports require administrator-installed compatible non-root Linux clients
and recovery-only targets. The standard source-built image does not install DB
clients. Remote verified-TLS success, genuine MySQL and the intended deployment
engine/client/role combinations need their own pilot acceptance. One target per
engine cannot simultaneously hold two dumps with the same original MariaDB/MySQL
logical name; that configuration fails closed. PostgreSQL multiple-owner,
extension or role membership requirements can also fail closed.

Catalog counts are basic logical import evidence, not arbitrary health checks or
application startup verification. Sequential Phase 5 dumps are not a distributed
atomic transaction across databases. Crash-time missing ownership markers and
cleanup permission failures can require administrator intervention. Do not remove
leases or markers simply to bypass the safety guard.

## 22 Deployment and recovery target provisioning

These are future operator steps, not actions performed by this task.

1. Review the feature-branch diff and security/test evidence. Build an approved
   immutable artifact of this fork containing migration 0009; do not deploy an
   upstream release or a disposable test image. Use `Dockerfile.source`, not the
   root executable-bundle `Dockerfile`; follow [DEPLOYMENT.md](DEPLOYMENT.md).
   No artifact was published here.
2. Keep every SYS MON job running. Back up the Pluton control database consistently
   while Pluton is stopped, plus the private keys/config and deployment settings
   through the existing secure operator process. Preserve the existing data volume,
   `SECRET`, `ENCRYPTION_KEY`, agent identity and managed repository password.
3. For artifact-only tests, no DB import client is required. For Required imports,
   prepare a reviewed production image with the administrator-installed clients.
   Keep its application user non-root, root filesystem read-only and no additional
   capabilities or Docker socket. For the Alpine source-built image an administrator
   can derive an image with `mariadb-client` and `postgresql-client` installed at
   build time, then restore `USER pluton`. That does not provide genuine MySQL.
   Provision a genuine compatible MySQL client separately if required. Install
   private CA public certificates into the immutable system trust store, never
   bypass certificate/hostname verification or copy private keys into examples.
4. Check binary ownership/executable permissions and the client versions as the
   application service user. Fixed paths are `/usr/bin/mariadb`, `/usr/bin/mysql`
   and `/usr/bin/psql`; administrator-owned versioned PostgreSQL binaries are also
   detected. Do not make those files or parents writable by the app user. Ensure
   `/data` is owned by the existing non-root UID and has adequate restore headroom.
5. Deploy through the existing immutable-version deployment workflow. In a checkout
   using `deploy/`, the command is `sh deploy/deploy.sh 'sha256:<approved-image-digest>'`
   after its private `.env` selects the correct fork/derived-image repository. The
   digest is a placeholder. The script stops Pluton and copies SQLite before
   replacement; separately preserve all keys/config as above. Check container
   health and successful migration before opening settings. Do not use `latest`,
   `main`, a new volume or regenerated credentials.
6. First run a manual filesystem recovery on an existing exact completed backup.
   No storage/plan/agent recreation is required. Confirm safe results and cleanup.
   Leave automation off until recovery infrastructure is provisioned and checked.
7. Provision disposable DB targets as below. Use new privately entered passwords,
   not production backup passwords. The Pluton app gets only the restricted import
   account, never the administrator account used for provisioning.
8. Edit Plan → Advanced → Recovery Testing. Save each target with verified TLS for
   a remote host; Local is only valid for a server within the same loopback/network
   namespace. Choose Required import, then enable After every successful backup.
   Require a manual successful test before relying on automatic runs. Changing
   targets is refused while a test or cleanup lease is outstanding.

### MariaDB and MySQL target provisioning

On a new dedicated disposable server, an administrator creates the guard database
and marker. Do not run this on production or a server containing unknown app DBs.

```sql
CREATE DATABASE pluton_recovery_guard;
CREATE TABLE pluton_recovery_guard.pluton_recovery_guard
  (purpose VARCHAR(64) NOT NULL);
INSERT INTO pluton_recovery_guard.pluton_recovery_guard
  VALUES ('pluton-phase6-recovery-only');
```

Create a separate `recovery_user` using your secure engine-native administration
procedure and a new password. Replace the sample account host with the exact
approved Pluton address; do not use a broad `%` account. For a sample logical
database `example_db`, grant only these scopes:

```sql
GRANT SELECT ON pluton_recovery_guard.pluton_recovery_guard
  TO 'recovery_user'@'192.0.2.10';
GRANT ALL PRIVILEGES ON `example\_db`.*
  TO 'recovery_user'@'192.0.2.10';
```

The backslash prevents `_` from becoming a grant-scope wildcard. Repeat only for
the exact logical names of this plan. Do not create those application databases
before recovery, grant global ALL/FILE/SUPER, grant roles, add GRANT OPTION or
broaden a rejected grant. The application checks the literal scope as reported by
SHOW GRANTS. Inspect dedicated server configuration, privileged stored routines
and network isolation privately; do not paste credentials or SQL contents.

### PostgreSQL target provisioning

On a new dedicated target, the administrator creates the guard database and
connects to it to create the same marker table and purpose value. Provision a new
login role matching the archived application's owner where necessary, with
CREATEDB but NOSUPERUSER, NOCREATEROLE, NOREPLICATION, NOBYPASSRLS and no inherited
memberships. Set its new password privately. Grant CONNECT on the guard database,
USAGE on its public schema and SELECT on the marker table.

Pre-create the dump's necessary ACL grantees as unprivileged NOLOGIN roles; do not
copy their production passwords or grants. The real fixture uses an `app_owner`
import login and a `backup_pg` NOLOGIN ACL grantee. No application database is
pre-created. If the owner/extension model cannot be supported without broad
privilege, stop and redesign the isolated recovery infrastructure; do not strip
SQL ownership or weaken preflight.

### Cleanup warning procedure

Cancel active work and confirm it is terminal before investigating. Inspect only
the exact logged run directory and durable leased database. Keep the lease/target
credentials available for bounded startup cleanup. Restart may resolve an owned
DB/workspace warning. If ownership proof is missing, an administrator must verify
the disposable database privately before any removal; the app will not drop it.
Never remove `/data`, a source/repository root, or an unknown database wholesale.
Do not treat Passed with warning or failed cleanup as pilot acceptance.

## 23 Shadow migration procedure for one SYS MON dataset

1. Select one low-risk application/workload with a real database. Obtain approval
   for a parallel managed Pluton backup and disposable recovery target only.
   Record current SYS MON schedule, retention, scope, consistency method, expected
   artifacts and recovery objectives. SYS MON remains enabled throughout.
2. Privately record source identity, included/excluded paths and DB engine/name /
   version. Configure equivalent Pluton approved roots and read-only Phase 5 dump
   settings. Use the existing agent/plan where suitable and a separately approved
   managed destination, never a Legacy repository. Keep the same server keys.
3. Provision recovery targets with new credentials, restricted grants, matching
   PostgreSQL owners/ACL roles if applicable, trusted TLS and sufficient capacity.
   Confirm they are not production. Save Required import policy and opt-in
   automation for this one plan.
4. Run Backup Now. Require Complete, a full 64-character snapshot ID, the expected
   source tree, all database IDs/engines/logical names, SQL paths, positive bytes
   and SHA-256 metadata, and no dump/cleanup warnings. Record IDs/status/hashes
   privately; do not export decrypted configuration.
5. Let the automatic test run. Confirm its backup/repository/full snapshot binding,
   filesystem file/byte/source-tree validation, every SQL artifact hash and every
   required native import/catalog result. Require both cleanup flags true and no
   warning. Run Recovery Test manually on that same backup if a separately recorded
   repeat is needed; never select `latest` implicitly.
6. Browse that exact backup. Download it through the normal action; verify the
   expected application files and every SQL artifact privately. Use ordinary
   manual staged Restore with only isolated server staging, never the live source.
   Compare downloaded/staged SQL bytes and SHA-256 to completion metadata.
7. Validate application meaning privately using only the disposable recovered
   contents/DBs and an approved manual procedure. Phase 6 catalog counts alone do
   not prove application startup, row-level correctness or cross-DB consistency.
   Never use production credentials or production DB import for this check.
8. Require at least three consecutive scheduled Pluton backups and their exact
   automated recovery tests, across representative workload activity. Check each
   new backup has its own recovery result, cleanup is complete, and capacity /
   timing remain within the approved objectives. Compare scope, artifacts,
   schedule outcomes and consistency with the still-running SYS MON workflow.
9. Exercise cancellation, wrong test credentials, unavailable recovery target and
   cleanup/restart handling only against disposable recovery infrastructure or a
   synthetic plan. Correct faults and require a fresh clean pass; do not corrupt
   production/source configuration just to inject a failure.
10. Have the source owner verify there are no Pluton recovery writes, SSH recovery
    reads or imports on production. Distinguish normal application/database changes
    from recovery activity; use approved private audit evidence or a controlled
    source quiescence window, not an assumption that a busy source never changes.
11. Review every gate below and the rollback plan. Keep SYS MON active unless the
    operator later gives explicit separate cutover approval for this one dataset.

## 24 Gates blocking SYS MON cutover

Disposable fixture success does not satisfy these real-workload gates.

| Gate                                    | Required evidence before considering this one dataset                                                                       |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Backup                                  | Complete, exact plan/repository/full snapshot, no lifecycle warnings                                                        |
| Application snapshot                    | Correct approved source tree and workload scope                                                                             |
| DB dump                                 | Every stable DB identity/path/bytes/SHA-256 present and valid                                                               |
| Browse                                  | Exact snapshot contents accessible                                                                                          |
| Download                                | Expected application files and every SQL artifact verified privately                                                        |
| Manual staged Restore                   | Correct isolated staged contents; no source overwrite                                                                       |
| Automated filesystem recovery           | Structural/count/bytes/source-tree checks pass                                                                              |
| Automated DB import                     | Every required engine imports on a real compatible disposable target; MySQL needs genuine MySQL evidence                    |
| Cleanup                                 | Workspace and every temporary DB cleaned, no unresolved lease/warning                                                       |
| Repeated scheduling                     | At least three representative scheduled backup/recovery pairs pass                                                          |
| Production source unchanged by recovery | Approved source-owner audit proves no recovery writes/reads/imports                                                         |
| Operational readiness                   | Real TLS, roles, client versions, capacity, timing, failure/cancellation/restart, retention ownership and rollback reviewed |
| Operator approval                       | Explicit future approval for this one dataset only                                                                          |

All real SYS MON workload gates remain open until that future authorized pilot.
Nothing in this implementation disables an old job or authorizes a cutover.
