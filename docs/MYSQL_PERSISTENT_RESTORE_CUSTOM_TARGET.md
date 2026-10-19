# MySQL Persistent Restore — approved Custom targets

## Scope and audited baseline

Implemented on `codex/mysql-persistent-restore-custom-target` from reviewed
`origin/main` `c7f7368`, after verifying a clean working tree and fetching the
fork's main reference. The previously approved dashboard/Backup History changes
are already merged and are untouched here. No commit, push, merge, publication,
deployment, production access, secret rotation, Agent update, repository command
or host deployment-script change was performed.

Source inspection, not previous feature reports, confirmed:

- `DatabaseRestoreService`, `PersistentRestoreTargets`, `DatabaseRestoreStore`
  and `PersistentDatabaseImporter` already implement retained MariaDB/PostgreSQL
  restore, root approvals, exact snapshot staging, encrypted target credentials,
  reservations, ownership leases, TTL and safe deletion.
- MySQL was explicitly rejected in service preparation/creation and approval
  schemas. The existing Oracle worker exposed only disposable Phase 6
  import/cleanup operations; using them for a retained restore would be wrong.
- Migration **0012** owns retained records/leases and immutable source bindings.
  **0013** only adds a backup-history read index. Neither is edited.

| Engine / destination | This change |
| --- | --- |
| MySQL → Custom | Supported through the genuine Oracle worker and independent operator approval |
| MySQL → Internal | **Not supported**, disabled in UI and rejected server-side |
| MariaDB / PostgreSQL | Existing native client and destination paths retained |
| Cross-engine import | Rejected; no dump/engine/name rewriting |

## Reused architecture and ownership

The existing wizard sends only stable backup/snapshot/database IDs, metadata
token, approved target ID, TTL and acknowledgements. It cannot supply SQL,
credentials, endpoint, executable, arguments or filesystem paths. Existing
administrator authentication, same-origin JSON checks and request limits remain.

`DatabaseRestoreService` re-resolves the exact managed remote snapshot, stages
only the selected receipt-bound SQL artifact, checks workspace/path containment,
regular-file/size/SHA-256 integrity, source/target separation and admission, and
dispatches **only MySQL** to `MysqlPersistentDatabaseImporter`.

That client extends the existing UID-checked Unix-socket transport. Additive v1
operations are `persistent-import`, `persistent-inspect`, `persistent-cleanup`.
They are typed lifecycle operations, **not a SQL, command, path or process RPC**.
The worker rechecks its independently approved profile, CA digest, uploaded size
and SHA-256, then runs the shared `PersistentDatabaseImporter` implementation.
It does not implement a second ownership/SQL importer.

Before CREATE, the worker requests an exact `intended` lease. The server commits
it to SQLite before ACK. `created` and `validated` transitions are similarly
ordered/acknowledged. Foreign IDs, database names, tokens, repeated/out-of-order
transitions and premature completion fail closed. Existing target reservations,
single executor and workload mutex remain in force.

The database marker `__pluton_persistent_owner` binds restore ID, full snapshot
ID, artifact SHA-256, unpredictable ownership token and retained purpose. The
server history also retains source backup/repository/database ID, authoritative
engine, target fingerprint, timestamps, TTL, inspection and cleanup state. No
credentials or ownership tokens appear in the API or UI.

## Custom target security and compatibility

The target must be a separately provisioned, isolated **Oracle MySQL Community
8.4** server. Import, inspection and deletion recheck actual server version and
vendor, not just a saved engine label. The existing worker still requires the
signature/SHA-pinned **Oracle MySQL Community Client 8.4.11**. Its Debian base,
official-package provenance, native-client verification and UID/GID **10001**
are unchanged. A MariaDB `mysql` alias is never accepted.

The existing compatibility check additionally rejects recognized MariaDB,
PostgreSQL, unsupported/newer dump headers and non-plain SQL. A historical SQL
file without a version header is not falsely declared version-certified.
The selected artifact engine/identity is never rewritten.

The root approval must use `mode: custom`, engine/target engine `mysql`, an
allowed logical database name, `operator-approved-external` storage, non-admin
credentials, explicit retention/SQL limits and a matching CA SHA-256. Existing
approvals are root-owned, non-writable by the application, read-only mounted;
credential files are root:10001 0640 with safely traversable non-writable parents.
The approval is fingerprint-bound and encrypted in the existing SQLite store.

The isolated database server must contain `pluton_restore_guard.contract` with
exactly the retained purpose `pluton-persistent-database-restore-v1`, approved
activation ID and approved storage ID. Provision the guard only through the
operator's secure channel on the isolated target, never on source/production.
Use a dedicated account with SELECT on this contract and database-scoped
privileges on the exact destination, with properly escaped `_`/`%` grant names.
Global/admin privileges, role grants, GRANT OPTION and unrelated visible
databases are refused. Restrict the account's network source and require SSL.
Create/set its password through private operator tooling/stdin, not argv,
environment variables, repository files or copied public examples.

The destination database must **not already exist**. Pluton creates it itself;
it does not adopt or claim a pre-provisioned external database. Missing guard,
wrong activation/storage/target identity, TLS identity/CA mismatch, wrong
credentials, unsafe grants, existing unrelated data and unsupported versions all
fail closed. A UI checkbox cannot override these checks.

## Independent worker profile (no host tooling changes)

Keep the current top-level Phase 6 worker configuration unchanged. Add the
following optional `persistent` object to its existing root-controlled target
JSON. Values below are synthetic format examples, not production identities:

```json
{
  "persistent": {
    "targetId": "cccccccccccccccccccccccc",
    "activationId": "dddddddddddddddddddddddddddddddd",
    "storageId": "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    "host": "mysql-restore.example.internal",
    "port": 3306,
    "username": "restore_operator",
    "database": "example_db",
    "maxArtifactBytes": 134217728
  }
}
```

This is an **addition inside** the existing JSON, not a replacement document.
No password belongs in the worker configuration. The server's private approval
must match this independent profile, including target/activation/storage IDs,
endpoint, username and logical database. This avoids replacing the existing
Recovery Testing account or endpoint. The reviewed CA bundle already mounted at
`/run/pluton-mysql-config/ca.pem` must verify both configured endpoints; the
persistent approval CA file must have exactly the same SHA-256. Do not silently
replace existing trust or mutate an active restore's approval fingerprint.

There is one optional persistent target profile per worker, with one active
operation at a time. Use separate isolated database endpoints when retained
MySQL data and ongoing disposable tests need the same original logical database
name. A colliding database is refused, never renamed/overwritten. Multiple
persistent target pools are not introduced here.

Existing Compose overlays already provide the root approval directory, private
worker configuration/CA and Unix-socket volume. No Docker socket, additional
privileges, public ports, `/data`, repository credentials, `.env` or host root
are mounted into the worker. No target DB/server is installed in the app/worker.
The worker still uses its separately approved DB egress network.

## Lifecycle, validation, TTL and Delete

Existing states are reused: queued → importing (preflight/import/validation
stages) → active. Success retains the database and validated lease. Measured
catalog/table/view counts, target version, size and observation time are shown;
this is **SQL import/catalog validation, not application recovery verification**.

Expiration revokes inspection and requests owned cleanup. Explicit Delete/cancel
requires the exact restore ID and existing administrator authorization. Cleanup
rechecks approved identity, retained guard, server engine, dedicated catalog and
ownership marker. It drops only the exact database Pluton created and can prove
it owns. It does **not** delete the external server, its storage or unrelated
operator data. The management history remains; encrypted approval/inspection
are removed only after verified cleanup.

A missing database can be reconciled idempotently. A database with absent/wrong
ownership marker, an ambiguous CREATE, unavailable target, changed approval or
uncertain catalog stays `cleanup_required`, with its lease/reservation retained.
No uncertain resource is called Deleted. Original failure stage/code remain
separate from a later cleanup error. Do not manually remove rows/leases to free
a target; investigate and resolve ownership through the reviewed operator path.

Application restart does not delete an idle successful restore. Interrupted
imports are not resumed or marked Ready: durable leases drive ownership-checked
cleanup. Shutting down during metadata-only inspection cancels inspection
without requesting deletion of the retained database. Completion after TTL
expiry cannot become Active.

## IPC/cancellation reliability findings

The historical intermittent CI error alone did not establish its cause. Audit
and regression/stress reproduction established these defects:

1. Shared cancellation checks emit `job/cancelled`; the worker wire stage
   allowlist has only database stages. Explicit cancellation could therefore
   become `mysql-worker-protocol-failed`. Only this explicit category is now
   mapped to the active DB stage. Unexpected errors/crashes remain failures.
2. Socket write failures were labeled malformed protocol. Closed/broken
   transport is now `mysql-worker-unavailable`; invalid/oversized/truncated
   frames still fail as protocol errors. Imports are **not automatically retried**.
3. Busy refusal half-closed a socket without consuming its unread request. Under
   repeated cancellation this exhausted `maxConnections` and blocked cleanup.
   Refusal now drains/releases the socket. A native socket regression and real
   stress case cover it; no timeout increase or protocol-error suppression.

Cleanup alone has bounded retries for busy/unavailable transport. Cancellation
closes IPC, aborts native execution and preserves durable ownership. Worker stop
awaits operation/child/private-file cleanup. Successful terminal responses are
deferred until staging cleanup finishes; private-cleanup failure emits a closed
error and refuses further work until operator recovery. The retained client
also waits for clean EOF, refusing additional/partial terminal messages.

## Resources and limits

- Default SQL budget remains **128 MiB**. Both the operator approval and worker
  persistent profile constrain it. Existing explicitly reviewed higher ceilings
  are not increased; the retained request cap is 448 MiB and expansion checks
  still apply. Tests use tiny generated SQL, not production dumps.
- Existing real RAM, cgroup, swap, memory-pressure, staging-capacity, expanded
  data, TTL and workload admission checks remain. Acknowledgements do not bypass
  them. Custom storage capacity is operator-approved external capacity, not an
  Internal ext4 quota or automatically allocated DB container.
- Upload uses 32 KiB chunks/96 KiB bounded JSON frames and backpressure. It is
  never buffered as one large SQL string in the app. Native import streams a
  private regular file. Both ends verify its size and digest.
- Existing bounds remain: 10-second DB connection timeout, bounded 60-second
  control queries, one-hour import, 10-minute upload, 75-minute worker deadline,
  heartbeat/idle protection, bounded output and single-operation concurrency.
- SQL/credential files are 0600 inside UID-10001 0700 private directories.
  Passwords stay out of argv, process environments, logs, errors and URLs.

## API/UI and additive schema

The existing Restore Database Wizard/Restore Management are extended, not
replaced. MySQL defaults to Custom with **no target preselected**; Internal is
disabled. The wizard displays authoritative engine, selected artifact, full
snapshot, SQL size/digest, matching approvals and actual budgets. Management
shows retained target/database, original failure, import completion, latest
inspection, expiration and permitted existing actions. Theme/responsive tokens
are reused; Backup History, filters and menus are untouched.

Public API changes are additive capability/metadata fields; request URLs and
strict request bodies are unchanged. Worker v1 gains purpose-specific operations
and an optional independent profile. Existing Phase 6 requests remain supported;
old workers cannot perform new persistent operations and fail safely. Upgrade
server and worker as a reviewed pair. No Agent protocol or enrollment changes.

Migration **0014_persistent_restore_outcomes** adds nullable `completed_at`,
`failure_stage`, `failure_code`. It is needed because completion was not durable
across inspection refresh, and cleanup could obscure the original import error.
It does not rewrite old rows, source metadata, backups, credentials, existing
migrations, leases or snapshots. Old completion dates remain unknown, not guessed.

## Validation evidence

| Check | Actual result |
| --- | --- |
| Full backend Jest suite, including Phase 5/6/7 and existing persistent/auth/source/repository guards | **168 suites passed; 3,294 tests passed, 0 failed, 4 existing skips** |
| Full frontend suite, including real wizard/management rendering and unchanged Backup History tests | **135 passed, 0 failed** |
| Worker-image/operator/required-CI structural tests | **12 passed, 0 failed** |
| Genuine Oracle MySQL persistent fixture | **20 scenarios passed**, including same-worker Phase 6 coexistence and **20 preflight + 20 import cancellations** |
| Production-default importer dispatch recheck | **4 real lifecycle cases passed** (success, new app/container inspection/deletion, Phase 6 coexistence, TTL); only forced-restart fixtures use a signaling wrapper |
| Existing genuine Oracle MySQL Phase 6 fixture against the new worker | **12 scenarios passed**; existing runtime/client interoperability retained |
| Existing non-privileged real MariaDB/PostgreSQL import fixture | **Both engines passed** import/content/catalog/owned cleanup; psql meta-command protection and MariaDB-alias refusal passed |
| Agent suite on Windows | **45 passed, 0 failed, 75 Linux-only skips**; no Agent code/protocol change |
| Backend/frontend typechecks | Passed |
| Production monorepo build | Passed: frontend, backend and Agent; includes docs **12/12**, Fumadocs **8/8** |
| Genuine worker Docker build/native UID check | Passed: official Oracle Community **8.4.11**, UID/GID **10001** |
| Backend lint / patch whitespace | Passed |
| Frontend lint | Pre-existing ESLint 10 / typescript-eslint `extends: "eslint-config-prettier"` configuration error; **not** a pass |

The unchanged Alpine runtime fixture reports MariaDB **11.8.8**, PostgreSQL
**18.6**, no DB servers, and no genuine local MySQL client. MySQL validation above
is through the separate Oracle worker, not the Alpine alias. Native existing
Internal/ext4 mount/loop-device fixtures were **not rerun**: this task explicitly
does not authorize new privileged infrastructure. Existing retained
MariaDB/PostgreSQL policy/importer/state regression suites passed; the new real
persistent fixture targets MySQL Custom only. Production-size artifacts,
production latency/load and application-semantic recovery were not tested.

Build warnings about existing chunks, CSS `::highlight`, browser data and the
Node loader remain non-fatal. The backend suite also emits its existing process
listener warning. No test gate or assertion was disabled to get these results.

The real fixture has an internal Docker network without host ports, non-root
UID-10001 app/worker, a separate disposable Oracle MySQL 8.4.11 target, generated
private credentials/CA and temporary volumes. It tests SQL/catalog/content,
verified TLS, ownership/retention, container/application restart, TTL, explicit
deletion, collision/data protection, invalid metadata/digest/size/engine,
credentials, TLS identity, absent approval, worker unavailable/startup failure,
worker restart, application interruption/reconciliation and coexistence with
the old disposable Phase 6 protocol. Cancellation runs **20 preflight + 20 import
attempts**, with ownership cleanup after each. No arbitrary stability sleeps;
the SQL SLEEP fixture deliberately provides an interruptible import, and readiness
checks/bounded busy retries remain condition-driven.

Local fixture failures were fixed rather than bypassed: a 32 MiB tmpfs correctly
failed staging admission, so fixture staging moved to its private measured disk
volume; repeated cancellation then exposed the socket defects above. No resource
threshold, size budget, test expectation or required CI gate was weakened.

The source fixture uses synthetic receipt-bound metadata and real compiled
service/store/importer/worker/native MySQL operations. It is not a production
Restic-to-application end-to-end acceptance claim. The existing repository,
artifact/path, authorization, Recovery Testing, MariaDB/PostgreSQL and Phase 7
regressions supply the other layers. No privileged mount/loop-device fixture is
used or authorized for this feature.

Reproduce with Node 24 and pinned pnpm 10.20.0:

```sh
pnpm --filter @plutonhq/core-backend test --runInBand
node --experimental-strip-types --test frontend/__tests__/*.test.ts
pnpm --filter @plutonhq/core-backend exec tsc --noEmit -p tsconfig.json
pnpm --filter @plutonhq/core-frontend exec tsc -b
pnpm --filter @plutonhq/core-backend lint
pnpm build
docker build -f Dockerfile.mysql-recovery-worker -t pluton-mysql-persistent-worker:local .
pwsh -NoProfile -File scripts/validate-mysql-persistent-restore.ps1 -WorkerImage pluton-mysql-persistent-worker:local -RuntimeImage pluton-recovery-ci:local
git diff --check
```

The full CI gate uses a freshly built runtime image. Local `-UseLocalBuild` is an
explicit fixture-only option mounting freshly compiled backend and migrations
read-only over an existing runtime image. All named fixture containers/volumes
are randomized and removed on completion/failure; images are local test artifacts.

### Changed files (28)

Production backend:

- `backend/src/services/DatabaseRestoreService.ts`
- `backend/src/stores/DatabaseRestoreStore.ts`
- `backend/src/types/databaseRestores.ts`
- `backend/src/db/schema/databaseRestores.ts`
- `backend/src/utils/persistentRestorePolicy.ts`
- `backend/src/utils/persistentDatabaseImporter.ts`
- `backend/src/utils/mysqlRecoveryWorkerClient.ts`
- `backend/src/utils/mysqlPersistentDatabaseImporter.ts` (new)
- `backend/src/mysql-worker/protocol.ts`
- `backend/src/mysql-worker/server.ts`
- `backend/src/mysql-worker/persistent.ts` (new)
- `backend/drizzle/0014_persistent_restore_outcomes.sql` (new)
- `backend/drizzle/meta/_journal.json` (append-only entry)

Frontend:

- `frontend/src/utils/databaseRestores.ts`
- `frontend/src/@types/databaseRestores.ts`
- `frontend/src/components/Restore/DatabaseRestore/DatabaseRestoreWizard.tsx`
- `frontend/src/routes/DatabaseRestores/DatabaseRestores.tsx`
- `frontend/__tests__/databaseRestores.test.ts`

Tests, CI and report:

- `backend/__tests__/utils/mysqlRecoveryWorker.test.ts`
- `backend/__tests__/utils/persistentDatabaseImporter.test.ts`
- `backend/__tests__/utils/mysqlPersistentDatabaseImporter.test.ts` (new)
- `backend/__tests__/services/DatabaseRestoreService.test.ts` (new)
- `backend/__tests__/integration/mysqlPersistentRestore.prepare.mjs` (new)
- `backend/__tests__/integration/mysqlPersistentRestore.smoke.mjs` (new)
- `scripts/validate-mysql-persistent-restore.ps1` (new)
- `scripts/__tests__/mysqlRecoveryWorkerImage.test.cjs`
- `.github/workflows/container.yml` (additional required test, existing gates retained)
- This document (new).

## Future deployment, acceptance and rollback (not executed)

1. Review/test the branch and the additive migration. Back up `/data`/SQLite by
   the existing approved procedure, preserving SECRET, ENCRYPTION_KEY, all
   persistent volumes, encrypted approvals and ownership history. Do not create
   new Backup Plans or re-enroll/update Agents for this feature.
2. An operator provisions an isolated Oracle MySQL 8.4 target, verifies TLS and
   non-admin grants, creates the retained purpose guard, and securely installs
   the root approval/CA in the existing approval mount. The destination database
   itself remains absent. No automatic Docker/DB provisioning is provided.
3. Add the optional independent persistent profile to the existing worker config.
   Preserve Phase 6 endpoint/account/trust settings and all existing overlays.
   Use the existing reviewed **immutable GHCR digest** workflow for the matching
   app/worker pair. No changes to `compose.yml`, `compose.lab.yml`, `install.sh`,
   `deploy.sh`, `rollback.sh` or `lib.sh` are required by this code.
4. With an authorized session, select an existing small MySQL backup and exact
   database artifact, Custom target and TTL. Review budgets. Preflight runs before
   CREATE/import, not as a claim that a metadata refresh tested connectivity.
   Confirm. Verify full source binding, Active status, completion time, target
   catalog and retained database through operator-approved read-only checks.
5. Restart the app through the approved procedure; confirm the same retained
   record/database, then inspect metadata. Verify a rejected wrong-engine/target
   selection and ordinary backups/Recovery Testing still work. Test expiry or
   exact-ID owned deletion only on that disposable acceptance restore. Confirm
   original snapshots/source/production databases are untouched.
6. Application/business recovery needs a separate operator acceptance test.
   Larger artifacts and production resource/load/latency acceptance are still
   pending; small fixture success does not establish them.

Before rollback to a version without MySQL Persistent support, stop new requests,
finish or cancel in-flight jobs with the current server/worker, and verify owned
cleanup of MySQL retained databases. Older code cannot manage these new MySQL
approvals: defer such a downgrade if data must remain retained, or obtain a
reviewed ownership-preserving operator handoff. Do not drop an unproven database.

Then use the existing approved rollback procedure and previous reviewed digests,
retaining **the current** `/data`/SQLite, keys, volumes and approval/lease records.
Nullable additive columns may remain; no down migration/reset is needed. Never
restore a stale SQLite copy independently of target ownership: that can orphan
databases. Do not delete socket/storage/data volumes, rotate keys or regenerate
identity as a rollback shortcut.

Remaining future work: **MySQL Internal Restore**, automatic Recovery Container
lifecycle/provisioning, multiple persistent-worker target pools, production-scale
resource validation and application-level recovery acceptance. None is claimed.
