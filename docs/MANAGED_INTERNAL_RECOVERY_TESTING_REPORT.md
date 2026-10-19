# Managed Internal Recovery Testing — Phase 6

## Scope and reviewed baseline

Implemented on `codex/managed-internal-recovery`, starting from reviewed main
`db645013e0487d150fc9c276df88564e2a5d0198` (MySQL Recovery Worker PR #28 already
merged). No worker implementation was duplicated. No commit, push, merge,
publication, deployment, production access, secret rotation, agent re-enrollment,
repository maintenance or backup cutover was performed.

This is recovery **testing**, not persistent database restore. Snapshot Browser,
Download, granular Restore to Staging, original SQL downloads, backup lifecycle,
Legacy read-only access and agent protocol remain separate and unchanged.

| Engine | Internal | Custom | Import client |
| --- | --- | --- | --- |
| MariaDB | Operator-managed, temporary | Existing behavior | Server MariaDB 11.8.8 |
| PostgreSQL | Operator-managed, temporary | Existing behavior | Server psql 18.6 |
| Oracle MySQL | **Not offered** | Existing optional worker required | Genuine Oracle MySQL 8.4.11 worker |

`mysql` being a MariaDB alias is still not accepted as a genuine Oracle client.
The settings show worker IPC availability; target authentication/TLS/permissions
are still checked before every actual import.

## Existing versus new behavior

Existing Phase 6 restored the exact managed snapshot into private staging,
verified filesystem structure and SQL size/SHA-256, imported using dedicated
Custom targets, verified catalogs/ownership, and cleaned its leases/workspace.
It did **not** create or remove database containers.

New behavior adds explicit Internal/Custom selection for MariaDB/PostgreSQL,
approved native target provisioning, conservative resource admission, isolated
activation leases and mandatory infrastructure-removal receipts. Missing modes
mean Custom; saved Custom credentials and configuration are not migrated.
Internal selection does not enable imports or after-backup automation. A policy
using Internal must explicitly disable after-backup automation before saving.

## Automatic lifecycle feasibility and actual lifecycle

There is no installed, authenticated, narrowly authorized host controller in the
reviewed baseline. The application cannot safely start containers without new
operator-installed authority. A Docker socket/proxy would grant much broader
authority than recovery testing needs. This implementation therefore uses the
**explicitly permitted operator-managed Compose fallback**, not an automatic
container controller.

1. A trusted Linux administrator provisions an engine once using the reviewed
   operator CLI. It creates only recovery-specific credentials, a dedicated CA,
   TLS material and fixed bootstrap configuration. It refuses existing/unknown
   or partially provisioned engine directories instead of overwriting secrets.
2. For each test, the operator explicitly activates one engine profile. An
   installation/activation-bound container starts with a recovery guard and
   restricted account. No other engine/profile starts automatically.
3. The user selects Required imports and Internal for the matching engine, saves
   the recovery policy, and runs Recovery Test on an existing completed backup.
4. The existing exact-snapshot restore and SQL integrity checks run first. The
   approved activation is durably bound to the test, without database mutation.
   Memory/pressure/cgroup/disk/SQL admission then runs before any SQL import.
5. Existing native imports validate verified TLS, guard, grants, absent/owned
   database names and catalog contents. SQL travels via stdin; private client
   files are 0600. No credential is placed in argv or a password environment
   variable.
6. SQL databases are cleaned only with their matching owner tokens. A further
   read-only guard/catalog check refuses infrastructure removal if an unknown
   database remains. The private workspace must also be removed.
7. The application writes a bounded private cleanup request. It cannot invoke
   Docker. **Cleanup Required** remains until the operator explicitly deactivates
   the exact owned container. Deactivation validates image, labels, ID, user,
   mounts, network and limits, then stops/removes that container only.
8. A root-owned, read-only receipt binds installation, activation, engine, test
   and exact snapshot. The existing job tick reconciles it transactionally with
   the durable lease. Only a completely validated successful job can then become
   Passed. Failed/cancelled/interrupted jobs never become Passed merely because
   infrastructure was removed.

Removal receipts are immutable per-activation files, not just the current
readiness manifest. A subsequent activation cannot erase proof of the previous
removal before the application polls. Keep receipts until the corresponding
leases have been verified released. The operator also persists the test/snapshot
binding before stopping a container, so an interrupted removal cannot be rebound.

There is **no automatic startup/shutdown or idle TTL**. The operator must be
available to deactivate after each test. Databases have `restart: "no"`, no
default-enabled profile and no persistent data volume. Control/lock metadata is
retained, without a database process or idle database RAM consumption. A stopped
or failed bootstrap is not permission to delete unknown data.

## Security and compatibility boundaries

- Pluton stays UID/GID 10001, with no Docker socket, Docker API, root host mount,
  privileged container or arbitrary command/image/mount endpoint.
- The operator CLI runs **on the trusted host**, explicitly as root, against the
  local Unix Docker endpoint. It is not installed in, mounted into or callable
  through the application. Its commands and Compose profiles are fixed; input
  database/user names are bounded identifiers, not shell fragments.
- Operator actions are serialized with host `flock`; both engine containers also
  share a private exclusive engine lock. SQLite separately permits only one
  unreleased Internal activation and one running recovery job.
- Operator startup intent is persisted before container creation. After an
  interrupted start, `resume-activation` rediscovers only that recorded activation;
  it does not remove or adopt another installation's resources.
- Official immutable OCI index digests are pinned in `targets.compose.yml` and
  `operator.cjs`: MariaDB 11.8.8
  `sha256:24e76fcec8c003a0362d0dd53f4806e7e79458d7fdeaf47437760e19496f5a9c`,
  PostgreSQL 18.6-bookworm
  `sha256:afc7e2d441324c0388fa80c3d24f733b4194a4eb7f47dd8ee2b08eb1a24a647c`.
  The reviewed/tested deployment is Linux amd64; other host architectures refuse
  the operator CLI rather than silently changing the target platform.
- Targets run UID/GID 999, read-only root filesystem, dropped capabilities,
  no-new-privileges, one private `--internal` network, **no host ports**, CPU/memory/
  PID limits and bounded tmpfs. They cannot mount `/data`, source files, staging,
  repositories, `.env`, application keys or worker IPC.
- Public-to-application means an application-private RO bind, not world-readable:
  root-owned directory 0750/GID10001 and JSON/CA files 0640. It contains only the
  dedicated restricted recovery account, approved names, public CA and activation
  metadata. Host-only CA private key/operator metadata and target-only bootstrap/
  server private key are separate. The app request directory is UID10001/0700 and
  requests are 0600; symlinks, unexpected fields and oversized files are rejected.
- Inter-container traffic uses verified TLS with the fixed internal hostname and
  pinned approved CA hash. Separate containers are never treated as loopback.
  The operator explicitly approves the new recovery-only CA by provisioning it;
  an organization-managed replacement needs review before any activation.
  Existing Web UI HTTP LAN access is unchanged.
- Activations expire after two hours for new imports; ownership-checked cleanup
  is still permitted after expiry. Server certificates are generated for 30 days;
  activation refuses certificates with less than two hours validity. Certificate
  renewal is manual, only after every activation/cleanup lease is resolved; no
  application or existing credential is auto-rotated.
- MariaDB grants are scoped to exact escaped database names plus read-only guard
  access, not global administration. PostgreSQL uses the existing non-admin
  CREATEDB contract, no inherited roles/superuser/replication/bypass-RLS, and
  fresh `pluton_rt_...` names. Bootstrap administrator accounts cannot log in
  over the application connection. Private bootstrap sockets are not shared.
  Provision the exact reviewed database-name set for the snapshot; do not widen
  grants to support unrelated plans or historical snapshots with different names.
  Those cases should retain Custom targets or receive a separate operator review.
- Target SQL/provider output is not forwarded to container logs. Bootstrap and
  engine output is discarded rather than risking passwords or SQL row data in
  logs; only closed lifecycle/error categories are printed. Pluton continues to
  classify native stderr locally and returns safe codes only.
- New migration **0011** only adds Internal session/lease tables, indexes and a
  deletion guard. The original Custom target key/FK and encrypted values are
  untouched. Pending cleanup cannot be lost by deleting its test/plan, including
  through an older application. Released histories can cascade normally.
- The existing Phase 7 outbox now defers results whose optional infrastructure
  cleanup flag is false. It sends the final result after cleanup, not a provisional
  Failed event followed by a misleading Passed event. Custom notification behavior
  and existing outbox rows/subscriptions are unchanged.

### Findings verified while testing

1. MariaDB hostname-verification failures were rejected securely but classified
   as generic import failure. Native error 2026/TLS-SSL failures now get the safe
   TLS category; no verification flag was disabled.
2. Cancelling a real PostgreSQL import killed psql while one owned SQL backend
   remained active (`pg_sleep` fixture); immediate DROP consequently failed.
   Internal PostgreSQL cleanup now verifies the exact owner token, terminates
   only this restricted role's client sessions in that fresh temporary database
   with a bounded wait, verifies the owner token again, then drops it. No admin
   or `pg_signal_backend` grant was added. Custom cleanup is unchanged.
3. SQL cleanup success alone is insufficient: unknown catalogs, failed workspace
   removal or absent/mismatched infrastructure receipts retain Cleanup Required.
4. Internal target materialization now strips its private ID before passing client
   configuration to the strict validator, matching the existing Custom path.
   Otherwise cleanup would be refused. The real import harness now uses actual
   SQLite migrations, encrypted Internal sessions and a second-process restart,
   not a mocked persistence layer, to test this integration boundary.

See the primary [PostgreSQL signaling-function contract](https://www.postgresql.org/docs/18/functions-admin.html),
[PostgreSQL TLS documentation](https://www.postgresql.org/docs/18/ssl-tcp.html),
and [MariaDB verified-client TLS guidance](https://mariadb.com/docs/server/security/encryption/data-in-transit-encryption/securing-connections-for-client-and-server).

## Resource policy

| Resource | Enforced Internal default |
| --- | --- |
| Running recovery jobs / internal engines | 1 / 1 |
| Each database target | 1 CPU, 2 GiB memory, no additional swap, 128 PIDs |
| Target database data / private tmp | 2 GiB tmpfs / 128 MiB tmpfs |
| Opt-in application overlay | 1536 MiB memory, no additional swap, 256 PIDs |
| Total SQL for the selected internal engine | 128 MiB default; operator can explicitly approve up to 448 MiB |
| Expanded-data estimate | SQL × 4 + 256 MiB must fit 2 GiB; estimate is not a guarantee |
| Internal recovery staged snapshot | At most 4 GiB; ordinary Custom and Restore to Staging limits unchanged |
| Application admission | Host MemTotal ≥3800 MiB; MemAvailable ≥2560 MiB; host used swap ≤128 MiB; PSI memory avg10 ≤1%; cgroup v2 limit ≥768 MiB, usage ≤85%, swap use 0; workspace free ≥SQL bytes +2 GiB |

Unknown Linux PSI/cgroup-v2 measurements fail closed. Admission runs at recovery
execution, not each agent heartbeat. The operator checks host memory/pressure/
disk before starting a target; the application checks actual staging capacity
and admission again after SQL verification. CPU/memory/PID/tmpfs limits remain
hard limits, not automatic retries or adjustable-on-failure budgets.

| VM RAM | Operational guidance, not a benchmark guarantee |
| --- | --- |
| 4 GiB | Not recommended for the ~272 MiB SQL pilot. Small explicitly approved tests only if measured headroom passes; otherwise refuse. Do not increase caps to force admission. |
| 6 GiB | One native engine may be feasible with low competing load and measured headroom. A 384 MiB SQL allowance is an explicit operator decision after a disposable rehearsal, not the default. Account separately for any MySQL worker or other service. |
| 8 GiB | Recommended starting point for a controlled ~272 MiB acceptance run. Still check disk, expansion/index growth and concurrent service budgets; no promise every workload fits. |

Do not run other database stacks/acceptance imports concurrently. Do not run all
engine profiles together. A mixed MariaDB+PostgreSQL snapshot must use at most
one Internal engine; keep the other Custom. Mixed required imports and the
MySQL worker need their own aggregate host-capacity review. The hard target
limit can still cause a large/expansive dump to fail; the correct outcome is
Failed/Cleanup Required, never silently raised limits or false success.

## UI and API

Existing Recovery Testing settings now show MariaDB/PostgreSQL Internal/Custom
selectors; MySQL shows Custom only and worker availability. Internal views show
Not Provisioned, Ready (full preflight still required), Running, Insufficient
Resources, Passed, Failed or Cleanup Required, with explicit manual operator
instructions. Pending cleanup takes precedence; resource refusal is also shown
as the last admission reason. No administrator password, key or container
configuration is returned by the configuration API.

Additive JSON fields: `RecoveryPolicy.targetModes`, configuration
`internalTargets`/`mysqlWorker`, result `internalEngine` and
`cleanup.infrastructure`. Existing status values and agent/worker wire protocols
are unchanged. Existing Backup Complete remains independent of recovery results.

## Deployment procedure — only after review and separate approval

No deployment was performed by this task. Use a maintenance window, reviewed
image digests, backups of persistent configuration/SQLite, and a disposable
rehearsal first. Preserve the existing `.env`, SECRET/ENCRYPTION_KEY, `/data`
volume name, SQLite data, repository credentials, plans, snapshots, agent
identities, outbox and every existing Compose override/staging/repository mount.
Never generate new application keys or recreate an existing plan to enable this.

Prerequisites: trusted Linux amd64 operator host, Docker Compose v2, local Docker
daemon, Node >=16 with `node:` builtins, OpenSSL, util-linux `flock`, Linux PSI and
cgroup v2. Do not upgrade/replace an unrelated global production Node installation
just for this; use a separately approved operator runtime if necessary. The CLI
and its companion files must be reviewed, root-owned and not group/world writable.

From the reviewed checkout, provision **only the needed engine**, using synthetic
names below as placeholders for independently reviewed archived logical names:

```sh
sudo node deploy/internal-recovery/operator.cjs prepare mariadb example_db recovery_user 128
# Alternative, not a second concurrently running stack:
# sudo node deploy/internal-recovery/operator.cjs prepare postgresql example_db archived_owner 128
```

This creates only recovery-specific state under `/etc/pluton-internal` and
`/var/lib/pluton-internal-requests`, plus an installation-labelled private network
and tiny lock volume. For PostgreSQL dumps retaining owner statements, provision
the matching non-admin archived owner name in the isolated cluster; never give
it production credentials or superuser rights. Internal identifiers are deliberately
restricted to simple ASCII names. Nonmatching/complex requirements stay Custom.

Add `deploy/compose.internal-recovery.yml` **after the existing deployment files**,
retaining optional MySQL worker and all operator overrides. Review the explicit
application memory/PID limits and aggregate VM budget before applying. Validate
with `docker compose ... config --quiet`, not logged `config` output that might
contain existing secrets. Recreate only the reviewed application service using
the exact same persistent volume and keys; the additive migration runs through
the normal application migration path. This does not start a DB profile.

For each approved test:

```sh
sudo node deploy/internal-recovery/operator.cjs activate mariadb
# Run exactly one Recovery Test from the existing completed backup in the UI.
# Wait for SQL/workspace cleanup and Cleanup Required.
sudo node deploy/internal-recovery/operator.cjs deactivate
```

Refresh readiness/results or allow the normal job tick to reconcile the exact
receipt. Expect Passed only after database, workspace and infrastructure cleanup
are all complete. Do not run `compose up` for all target profiles. Do not use
`docker compose down -v`, prune volumes, force-remove unknown containers or
rewrite ownership markers/SQLite leases to make a result green.

If startup was interrupted before readiness publication:

```sh
sudo node deploy/internal-recovery/operator.cjs resume-activation
```

This only reconciles the persisted starting activation. If SQL ownership,
credentials, marker, TLS or catalog cleanup is uncertain, retain the state and
investigate locally. Repair access only to the exact owned temporary target,
then restart only Pluton with the same image/configuration/volume to retry
durable cleanup; it does not resume imports or contact the source. Failed
bootstrap/partial provisioning and certificate renewal require explicit trusted
operator review, not credential regeneration or arbitrary resource deletion.
An activation never used by a test has no cleanup receipt: do not fabricate one.
An operator must independently verify no job/lease/data exists before manually
retiring that unused, exactly owned disposable target.

## Manual acceptance — existing ~272 MiB MariaDB pilot

This procedure intentionally omits real infrastructure identifiers.

1. Obtain separate deployment approval and upgrade/review VM capacity first;
   prefer 8 GiB. Keep the existing legacy backup schedule active: no cutover.
2. Rehearse an equivalent synthetic dataset/schema on disposable infrastructure.
   Measure memory, temporary space, expansion and import duration. No production
   success is inferred from this task's small fixture imports.
3. Provision the exact archived logical DB name with a new recovery-only account.
   A ~272 MiB artifact exceeds the 128 MiB default. An administrator may approve
   a 384 MiB ceiling for that reviewed engine config without changing its existing
   password, after rehearsal; keep hard memory/disk limits and admission checks.
4. Preserve Custom targets; set only MariaDB to Internal, import Required,
   after-backup automation off. Save separately. Activate MariaDB explicitly.
5. Select the existing completed backup/exact snapshot and Run Recovery Test.
   Confirm original artifact size/SHA, catalog/table/view counts, independent
   filesystem checks and safe source isolation. No source agent contact or
   production SQL import should occur.
6. Confirm SQL databases and workspace are cleaned. Run operator deactivation.
   Confirm no owned target container remains and infrastructure cleanup becomes
   Complete before Passed. Check the final existing Phase 7 delivery, if enabled,
   without exposing its secrets or claiming inbox delivery.
7. Verify original Browse, Download, Restore to Staging and SQL download still
   return the same files/artifacts. Verify ordinary backups and agent heartbeats
   remain healthy; do not re-enroll or rotate credentials.

## Rollback

Before rollback, disable recovery automation, resolve all Internal SQL/workspace
leases, deactivate the exact owned target and wait for its removal receipt to be
reconciled. Keep a consistent SQLite/config backup for disaster recovery, without
printing or committing it. Set modes back to Custom explicitly and preserve the
previous Custom target configuration.

Return the application to its prior reviewed digest and remove only the Internal
overlay from the Compose invocation, keeping all other overrides, optional worker,
`/data` mount and existing keys. Do not downgrade/delete the SQLite file or roll
back migration 0011 destructively: the added tables are harmless to the old app,
and the deletion guard intentionally protects unresolved cleanup. Do not use an
older app to run an Internal policy. Do not remove application volumes, snapshots,
repositories, keys, recovery leases or outbox records. Retain Internal control
files for audit/recovery until a trusted operator confirms every activation is
released. No agent update or protocol rollback is needed.

## Tests and evidence

Results below are disposable development evidence, not production acceptance.

| Check | Result |
| --- | --- |
| Full backend Jest suite | 156 suites passed; 3039 passed, 4 skipped, 0 failed |
| Focused recovery/permission/notification tests | 113 passed at intermediate checkpoint; included in full suite |
| Frontend utility/component suite | 86 passed, including actual rendered Internal/Custom and MySQL Custom-only controls |
| Operator/image/release guards | 27 passed |
| Internal native final-image matrix | All 10 engine/variant runs passed with actual migrated SQLite/encrypted sessions, plus second-engine exclusion and next-activation/stale-snapshot receipt guards |
| Phase 5/6 real DB → SFTP/Restic → Browse/Download/Restore | 8 isolated modes passed; filesystem, native single/multi/mixed, expected-failure paths |
| Existing Oracle MySQL worker | All 12 real TLS/private-IPC scenarios passed, including cancellation/restart/cleanup and secret inspection |
| Phase 7 integration | HTTP/HMAC/status/timeout, SMTP/auth/rejection, dedup/restart and trusted/untrusted TLS passed |
| Linux agent regression | 120 passed, 0 skipped/failed |
| Backend/frontend typecheck and backend lint | Passed |
| Local production build / Docker source image | Passed; UID/GID10001 clients execute and no database server binaries are installed in the application image |
| Compose profiles | MariaDB and PostgreSQL `config --quiet` passed |
| Patch review | `git diff --check` passed; 36 changed files reviewed, no production identifiers/private-key material matched |

Native Internal tests use the actual pinned database images as UID999, actual
server clients as UID10001, private TLS/networking, real memory/PSI/cgroup/disk
preflight, tiny synthetic SQL with catalog/content assertions, real cancellation,
durable-lease restart and exact removal receipts. Marker/foreign database/wrong
credentials/hostname-verification failures refuse import and removal approval.
An independent engine-lock fixture refuses a second engine before initialization.
They do not use real repositories, endpoints, passwords, source data or host ports.

Reproduction commands (development/disposable environment only):

```sh
pnpm --filter @plutonhq/core-backend test --runInBand
pnpm --filter @plutonhq/core-backend exec tsc --noEmit
pnpm --filter @plutonhq/core-backend lint
pnpm --filter @plutonhq/core-frontend exec tsc -b
node --experimental-strip-types --test frontend/__tests__/*.test.ts
node --test scripts/__tests__/*.test.cjs
pnpm build
git diff --check
```

PowerShell Docker fixtures: `scripts/validate-internal-recovery.ps1`,
`scripts/validate-mysql-recovery-worker.ps1`, `scripts/validate-phase6.ps1`
(also `-Modes single,two-mariadb,mixed`), and `scripts/validate-phase7.ps1`.
The Internal runner defaults to the built runtime image, not a source override;
its explicit development-only `-WorkingTreeCode` switch mounts compiled backend
code read-only when diagnosing an intermediate edit. CI validates the built image
without that switch. The Linux agent check runs the compiled test suite in the
existing isolated agent-test image with no network or writable application root.

Early fixture failures were test-harness issues (TLS helper lacked OpenSSL,
Docker reports tmpfs separately from volumes, insufficient 128 MiB test workspace,
and receipt verification incorrectly attempted a new activation). These were
corrected without weakening the production guard. The real TLS classification
and PostgreSQL cancellation finding above were fixed with regressions.

The Windows development environment did not execute the root host operator CLI
against a real Linux host installation. Its permission/ownership validators and
Compose/bootstrap lifecycle are tested separately; an operator-installed Linux
rehearsal is still required. No 4/6/8 GiB load benchmark or actual ~272 MiB pilot
import was performed. These are explicit remaining acceptance gates, not claims
of production readiness or automatic lifecycle completion.

### Changed files

- `.github/workflows/container.yml`
- `backend/drizzle/0011_internal_recovery_sessions.sql`, `backend/drizzle/meta/_journal.json`
- `backend/src/db/index.ts`, `backend/src/db/schema/internalRecovery.ts`
- `backend/src/types/recoveryTests.ts`, `backend/src/utils/recoveryTestPolicy.ts`
- `backend/src/services/RecoveryTestService.ts`
- `backend/src/stores/RecoveryTestStore.ts`, `backend/src/stores/NotificationDeliveryStore.ts`
- `backend/src/utils/internalRecoveryTargets.ts`, `backend/src/utils/internalRecoveryImporter.ts`
- `backend/src/utils/recoveryDatabaseImport.ts`, `backend/src/utils/recoveryProcess.ts`
- `backend/__tests__/integration/internalRecovery.prepare.mjs`, `backend/__tests__/integration/internalRecovery.smoke.mjs`, `backend/__tests__/integration/phase6Persistence.smoke.ts`
- `backend/__tests__/services/RecoveryTestService.test.ts`
- `backend/__tests__/stores/RecoveryTestStore.test.ts`, `backend/__tests__/stores/NotificationDeliveryStore.test.ts`
- `backend/__tests__/utils/internalRecoveryTargets.test.ts`, `backend/__tests__/utils/recoveryDatabaseImport.test.ts`, `backend/__tests__/utils/recoveryProcess.test.ts`
- `frontend/src/@types/recoveryTests.ts`, `frontend/src/services/recoveryTests.ts`, `frontend/src/utils/recoveryTargetModes.ts`
- `frontend/src/components/Plan/RecoveryTesting/RecoverySettings.tsx`, `frontend/src/components/Plan/RecoveryTesting/RecoveryResult.tsx`
- `frontend/__tests__/recoveryTargetModes.test.ts`
- `deploy/compose.internal-recovery.yml`, `deploy/internal-recovery/targets.compose.yml`, `deploy/internal-recovery/bootstrap.sh`, `deploy/internal-recovery/operator.cjs`
- `scripts/validate-internal-recovery.ps1`, `scripts/__tests__/internalRecovery.test.cjs`
- `docs/MANAGED_INTERNAL_RECOVERY_TESTING_REPORT.md`

No dependency/lockfile, agent code, MySQL worker protocol, ordinary restore route,
Legacy adapter or existing production configuration was changed.
