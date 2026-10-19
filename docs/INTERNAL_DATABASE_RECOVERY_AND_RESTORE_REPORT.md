# Database recovery preparation and restore availability

Status: **partial implementation, not production acceptance**. The CI fixture
path bug and the recovery-confirmation work are implemented. Persistent Database
Restore, its management/inspection/TTL executor, and automatic container lifecycle
are **not implemented**. Their UI is explicitly unavailable; no retained import
can be started. No production system was accessed or changed.

The targeted follow-up CI restart investigation is in section 25. It does not
extend the restore feature scope described above.

## 1. Baseline and branch

- Working baseline: `c26cc2d6b8c56d460164c4fce91cb2818a0a4a5b` on
  `codex/managed-internal-recovery` (the existing pending PR).
- Fetched `origin/main`: `db645013e0487d150fc9c276df88564e2a5d0198`.
  Native clients and the Oracle worker are on main; Managed Internal Recovery
  and migration 0011 are only on this feature branch.
- The latest direct instruction explicitly authorizes continuing **this branch
  before its merge**. This overrides the attached prompt's new-branch/stop-until-
  merged condition; no cherry-pick, reset, branch switch or merge was performed.
- All changes in this report are uncommitted working-tree edits on that branch.
  No commit, push, release, deployment or secret rotation was performed.

## 2. Existing versus new behavior

| Area                                                                    | Status                       | Behavior                                                                                                |
| ----------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------- |
| Exact-snapshot restore, SQL SHA-256, restricted imports, durable leases | Reused                       | Existing Phase 4/5/6 boundaries                                                                         |
| MariaDB/PostgreSQL Internal test targets                                | Reused and regression tested | Root operator provisions/activates; app imports and requests cleanup; operator removes                  |
| Oracle MySQL Custom testing                                             | Reused and regression tested | Genuine 8.4.11 worker, private Unix IPC, verified DB TLS                                                |
| Linux CI bind source path correction                                    | Fixed                        | Native `Join-Path`, fixture existence checks before resource creation                                   |
| Snapshot metadata preparation and confirmation modal                    | Implemented                  | Exact binding, all recorded DBs, read-only engine, operation-only selection                             |
| Current resource display/admission detail                               | Implemented                  | Measured or Unknown, safe refusal category, unchanged Internal hard limits                              |
| Existing workload protection                                            | Implemented                  | Claim yields to running backups/restores; recheck before imports; global recovery concurrency stays one |
| Actual target/header version gate                                       | Implemented                  | Reject known wrong engine/newer source/dump version before CREATE; no SQL rewrite                       |
| Persistent Internal/Custom Database Restore                             | Scaffolded, unavailable      | No executable import/retention/inspection/delete path                                                   |
| Automatic lifecycle, persistent ownership schema, TTL management        | Not implemented              | Exact blockers in sections 8, 9, 24                                                                     |

## 3. Automatic engine detection and metadata trust

`RemoteRepositoryRecoveryService.testMetadata` reuses the existing managed SFTP
read-only session, not the backup lifecycle or Legacy adapter. It validates the
completed backup, full snapshot ID, repository/plan/storage/device binding and
exact snapshot tags. It cross-checks each receipt artifact's logical path/type/
size against that snapshot listing, rejects unrecorded DB artifacts, then checks
the binding and receipt again before returning.

The existing Phase 5 "manifest" is the authenticated agent completion receipt
persisted in SQLite (`completionStats.lifecycle`), **not a separate versioned JSON
manifest archived inside Restic**. Engine/name/stable database ID/hash come only
from this trusted server receipt. Filename and `.sql` never determine an engine;
current plan database settings do not replace historical snapshot identity.

The preview does **not download or hash SQL**. It labels this limitation. The
existing private staged restore and exact byte/SHA-256 verification remain
mandatory before any native import. A changed valid-looking hash is ultimately
refused against restored SQL, not falsely certified by the preview.

A SHA-256 `metadataToken` fingerprints canonical binding plus parsed artifact
metadata. It is a stale-data fingerprint, **not an authentication token**. The
server re-reads the repository on confirmation and persists the fingerprint in
the job's existing policy JSON. Execution checks it before restore and again
after artifact validation. Changed identity/engine/name/path/size/hash cannot
silently alter a confirmed queued operation. The store rejects another confirmed
operation while the plan already has a queued/running test.

Historical single-DB receipts without engine/name remain artifact-only; native
confirmation refuses incomplete identities. Missing/unknown/duplicate metadata
and cross-plan/snapshot bindings fail closed. All 0..8 recorded DBs participate;
subset testing and whole-snapshot claims for partial selection are not offered.

## 4. Recovery Testing confirmation modal

The completed-backup Run Recovery Test action now opens a bounded, scrollable,
theme-token-based modal instead of immediately enqueueing a job. It shows the
plan, backup, full snapshot, recorded database names/engines/IDs/artifact sizes,
Custom/Internal readiness, worker availability, measured resources, existing
workloads and cleanup requirements.

MariaDB/PostgreSQL can choose Internal per recorded engine. MySQL remains Custom
through the worker; Internal is explicitly Not Available. An operator-managed
target must already be provisioned/active. A required saved policy cannot be
downgraded to artifact-only. A disabled saved import policy can be explicitly
upgraded for this manual operation. Artifact-only explicitly says SQL import NOT
TESTED. Confirmation requires acknowledgement, which is never a resource override.

The submitted body contains exact identity/fingerprint and allowlisted operation
choices, not an engine, endpoint, credentials, executable or Docker configuration.
Its durable job policy has automation disabled; saved plan policy, Custom targets
and after-backup subscriptions are unchanged. Old `{backupId}` clients and
automatic testing keep their existing API path and saved-policy semantics.

Readiness is advisory: configured Custom does not mean verified TLS/auth/guard.
The server rechecks selection and Internal admission when confirming, and normal
execution still checks artifact integrity, target safety and current capacity.
Refresh is user initiated, with no new aggressive polling. At most two concurrent
metadata preparations globally, and one per plan, are allowed in this process.

## 5. Actual compatibility matrix

| Recorded engine | Custom Recovery Test                     | Internal Recovery Test                                 | Persistent Internal/Custom Restore |
| --------------- | ---------------------------------------- | ------------------------------------------------------ | ---------------------------------- |
| MariaDB         | Existing native client, dedicated target | Existing manually activated isolated MariaDB server    | Unavailable / unavailable          |
| PostgreSQL      | Existing psql, plain SQL only            | Existing manually activated isolated PostgreSQL server | Unavailable / unavailable          |
| Oracle MySQL    | Genuine 8.4.11 worker, approved target   | Not Available                                          | Unavailable / unavailable          |

All available test imports remain disposable. They do not restore to the source.
Installed `pg_restore` is not used and does not advertise archive/tar support.

## 6. Container lifecycle boundary

No lifecycle controller, Docker proxy, Docker socket mount, root application,
privileged worker or new public management listener was introduced. The existing
fixed operator tooling and digest-pinned MariaDB/PostgreSQL profiles are reused.
Targets have private networks, verified TLS, no host ports, non-root DB users,
read-only roots, bounded memory/swap/CPU/PIDs/tmpfs and a shared exclusive lock.

SQL/catalog and workspace cleanup are insufficient for Passed: the matching
operator infrastructure-removal receipt is still required. Unknown ownership,
failed cleanup or interrupted import cannot become Passed by the new modal.

## 7. Startup/shutdown is manual

The UI cannot start/stop a container. A root operator reviews/provisions and
activates one target, the authenticated user confirms a test, and the operator
deactivates only after the exact cleanup-ready request. The app reconciles the
matching removal receipt. Existing crash-safe activation/deactivation records,
per-activation receipts and SQL leases are retained unchanged.

## 8. Database Restore architecture and blocker

The Restore Database (availability) action reuses the same metadata preview. It
can display a selected recorded DB/read-only engine and proposed 1/6/24-hour
retention (default 24, **not saved or active**). Internal/Custom execution remains
disabled, with an explanation and the existing Download/Restore to Staging path.

An authenticated strict `database-restores` request returns 409 unavailable and
has no executor, provisioning, SQL or retention side effect. It cannot bypass the
disabled controls. There is no running restored database and no fake restore
history, inspect endpoint or delete button.

Existing Internal DB storage is **tmpfs**, and current import leases describe
disposable test cleanup. Keeping either by merely skipping DROP would lose data
on stop or let restart reconciliation delete a supposedly persistent restore.
A safe persistent implementation needs a separate reviewed operation model,
quota-enforced persistent storage, ownership/retention records, inspection access
and independently tested deletion/reconciliation. These are not established here.

## 9. Persistent ownership/retention model (not implemented)

A future executor must bind plan/repository/backup/full snapshot/database ID/hash
to immutable target/container/storage identities, a distinct purpose guard and
owner token, hard quota and expiry, before provisioning or CREATE. Explicit
delete/TTL must stop access, settle imports, verify exact ownership and remove
only owned resources. Unknown identity remains Cleanup Required. Existing test
lease reconciliation must never see or delete a retained restore.

No such table, volume or retention job was added just to make a disabled UI look
complete. There is no indefinite retention, automatic snapshot deletion or
reuse of application `/data`, source, repository, agent or production DB volumes.

## 10. Engine and version validation

The native importer now queries the actual approved server after TLS/auth/guard/
privilege validation, before CREATE/lease. MariaDB must report MariaDB; an Oracle
MySQL import cannot accept a MariaDB target. PostgreSQL uses `SHOW server_version`.

A bounded first-64-KiB read of the already hash-verified SQL checks recognized
source/dump headers against the **recorded** engine. Known cross-engine headers,
newer source major versions (and MariaDB/MySQL minor versions on the same major),
newer pg_dump major versions, unrecognized target versions and PGDMP archives are
refused with the existing safe `database-client-incompatible` category. No SQL
bytes or database names are rewritten. Native import still independently fails
on actual syntax/privilege/catalog errors.

This is a conservative compatibility gate, not a SQL dialect proof. Existing
receipts do not record source/client versions. Headerless historical SQL remains
supported with `versionValidation=not-recorded`, not a fabricated certification.
Local results can report `header-and-target-checked`; neither means application
semantic recovery was tested. Corrupt metadata/hash or failed imports still fail.

## 11. Oracle worker compatibility

The worker and server share the importer, so rebuilding the optional worker
includes the real-server/header gate. Its version-1 protocol, strict import/
cleanup request allowlist, bounded artifact stream, server-acknowledged durable
lease, Unix permissions, target allowlist and verified TLS are unchanged.

No retained-import or arbitrary SQL RPC was added. A future persistent protocol
needs separately authorized restore purpose, exact snapshot binding, durable
retention/storage ownership, restart/idempotency and explicit owned cleanup.
Changing an import flag to omit cleanup is insufficient. Older v1 workers remain
wire-compatible but do not gain the new shared-code check until rebuilt; v1
responses do not report version-check details, which the result UI states.

## 12. Security and transport

All new routes use the existing authenticated UI-session router. API-key-only
access is still refused. Bodies are strict/bounded; arbitrary engine, SQL, host,
credential, image or path overrides are rejected. Preview responses contain no
passwords, secret keys, connection strings, client stderr or credential files.
Errors are closed categories, not provider output.

The existing source-endpoint refusal before import now covers all three engines,
not only MySQL. Hostname equality is an additional guard, **not a complete DNS/
network separation guarantee**. Independently provision dedicated targets and
network egress restrictions; verified TLS, DB purpose markers, grants/catalog and
owner checks remain mandatory. No new source contact or source import is added.

Passwords remain in private 0600 files, not argv or password environment values.
SQL integrity is verified before native clients; worker independently checks it
again. No `shell:true`, credential rotation, root agent, weakened ACL, repository
maintenance command or Legacy mutation was added. Public UI HTTPS/reverse-proxy
deployment and WAF/session protections remain operator responsibilities; HTTP
LAN operation is not forcibly disabled.

## 13. Resource policy and 4/6/8-GiB guidance

Internal hard limits are unchanged: one engine/test; target 1 CPU, 2 GiB memory
and total memory+swap, 128 PIDs, 2-GiB DB tmpfs, 128-MiB private tmp. SQL budget is
128 MiB by default, at most 448 MiB by explicit operator configuration. SQL × 4

- 256 MiB must fit 2 GiB. Staged snapshot limit is 4 GiB for Internal tests.

Admission samples real Linux host RAM/available RAM/swap/PSI, server cgroup
limit/usage/swap and free staging filesystem capacity. Unknown fails closed for
Internal. Required thresholds remain total ≥3800 MiB, available ≥2560 MiB, used
host swap ≤128 MiB, PSI avg10 ≤1%, finite cgroup limit ≥768 MiB with usage ≤85%,
no cgroup swap, and staging free ≥SQL bytes +2 GiB. Safe categories now distinguish
operator SQL budget, expansion estimate, host headroom/total, pressure/swap,
cgroup headroom and staging capacity. A 272-MiB dump exceeds the default budget;
acknowledgement cannot admit it or enlarge a limit.

Existing workload flags are measured in SQLite. Recovery claim yields to active
backups/restores. Native import rechecks those flags, and new manual confirmation
refuses competing active workloads. One global recovery worker remains enforced;
an unreleased Internal session blocks another native test, including Custom.
Backup scheduling is not paused. This is **not a global OS resource reservation**:
a later scheduled backup or unrelated host job can still start, and the app
cannot inventory arbitrary DB containers without authority it deliberately lacks.
Custom targets retain their existing client/worker bounds; their aggregate host
resources and remote DB quotas still require operator review.

| VM RAM | Recommendation, not a measured production guarantee                                                                                                                      |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 4 GiB  | Start only with separately approved 5–20-MB synthetic data and measured headroom. Do not force the 272-MiB artifact or run a local three-engine stack. Refusal is valid. |
| 6 GiB  | One engine may fit at low competing load; measure actual expansion, app/worker use, disk and pressure before approval. No automatic budget increase.                     |
| 8 GiB  | Better starting point for a later large-artifact rehearsal, still subject to the same caps and admission. Not a guarantee for arbitrary SQL/index growth.                |

The optional MySQL worker's separately configured memory/tmpfs and its target
must be accounted for too; the sample is not permission to run that whole stack
on 4 GiB. There is no automatic memory escalation/retry. This app does not inspect
Docker OOMKilled, so an unknown subprocess exit is not falsely labeled proven OOM.

## 14. UI status and unavailable functionality

The modal distinguishes Configured (full preflight pending), Ready (operator-
managed), Not Configured, Not Provisioned, Cleanup Required, Worker Unavailable,
Insufficient Resources and Unknown capacity. Required/disabled import semantics
remain distinct from Backup Complete. The result explains missing version evidence.

Persistent Restore UI is an availability scaffold, **not a completed wizard**.
There is no Restore Management page, read-only data preview, retained database,
container resource monitor, explicit restore delete, TTL expiration or persistent
stop/restart acceptance. Do not advertise these as delivered features.

## 15. Schema, API and protocol changes

- No new migration; **0011 and its journal entry were not modified**.
- Existing job-policy JSON gains the internal optional `snapshotMetadataToken`.
  Saved-policy API rejects it as user input; old jobs remain readable.
- Existing local DB results can gain `versionValidation`; old results render safely.
- Additive authenticated preparation and unavailable restore routes; extended
  manual-confirmation body while preserving old `{backupId}` and cancel endpoints.
- No agent change, agent protocol change, re-enrollment, worker wire-version
  change, outbox migration or plan/repository change.

## 16. Changed files

CI harness and guard:

- `scripts/validate-internal-recovery.ps1`
- `scripts/__tests__/internalRecovery.test.cjs`

Backend implementation:

- `backend/src/controllers/RecoveryTestController.ts`
- `backend/src/routes/recoveryTests.ts`
- `backend/src/services/RecoveryTestService.ts`
- `backend/src/services/RemoteRepositoryRecoveryService.ts`
- `backend/src/stores/RecoveryTestStore.ts`
- `backend/src/types/recoveryTests.ts`
- `backend/src/utils/internalRecoveryTargets.ts`
- `backend/src/utils/recoveryPreparation.ts` (new)
- `backend/src/utils/recoveryDumpCompatibility.ts` (new)
- `backend/src/utils/recoveryDatabaseImport.ts`

Frontend implementation:

- `frontend/src/@types/recoveryTests.ts`
- `frontend/src/services/recoveryTests.ts`
- `frontend/src/utils/recoveryConfirmation.ts` (new)
- `frontend/src/components/Plan/RecoveryTesting/RecoveryConfirmation.tsx` (new)
- `frontend/src/components/Plan/RecoveryTesting/RecoveryResult.tsx`
- `frontend/src/components/Plan/Backups/Backups.tsx`

Regression coverage:

- `backend/__tests__/integration/phase6Persistence.smoke.ts`
- `backend/__tests__/routes/recoveryTests.test.ts`
- `backend/__tests__/services/RecoveryTestService.test.ts`
- `backend/__tests__/services/RemoteRepositoryRecoveryService.test.ts`
- `backend/__tests__/stores/RecoveryTestStore.test.ts`
- `backend/__tests__/utils/internalRecoveryTargets.test.ts`
- `backend/__tests__/utils/recoveryDatabaseImport.test.ts`
- `backend/__tests__/utils/recoveryPreparation.test.ts` (new)
- `backend/__tests__/utils/recoveryDumpCompatibility.test.ts` (new)
- `frontend/__tests__/recoveryConfirmation.test.ts` (new)
- This report.

## 17. Validation results

Final local results (2026-10-14):

| Check                                                                           | Result                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @plutonhq/core-backend test --runInBand`                         | **158 suites passed; 3,082 tests passed, 4 skipped, 0 failed** (3,086 total)                                                                                                                                                                                      |
| `node --experimental-strip-types --test frontend/__tests__/*.test.ts`           | **91 passed, 0 failed**, including confirmation utilities and actual React SSR                                                                                                                                                                                    |
| Compiled Linux agent suite in isolated non-root Docker                          | **120 passed, 0 skipped, 0 failed**, including parent selection/fallback, source permissions, multi-DB lifecycle and cancellation                                                                                                                                 |
| `node --test scripts/__tests__/*.test.cjs`                                      | **28 passed, 0 failed**, including portable mount paths, image/ownership guards and release metadata                                                                                                                                                              |
| Corrected `validate-internal-recovery.ps1` against `pluton-recovery-next:local` | **10 native scenarios passed** (normal/invalid marker/existing DB/TLS/restart × MariaDB/PostgreSQL); second-engine exclusive lock refused; real SQLite/encrypted leases, SQL content, auth/cancel/0600 credentials, SQL/workspace cleanup, exact removal receipts |
| `validate-mysql-recovery-worker.ps1` with rebuilt worker/server                 | **12 real Oracle MySQL scenarios passed**: success, wrong password, marker, existing DB, SQL failure, client-command attempt, hash mismatch, target mismatch, cancel, restart, TLS failure, unavailable; repeated private-file/argv/environment inspection passed |
| `validate-phase6.ps1` default modes plus `-Modes single,two-mariadb,mixed`      | **8 real Restic 0.19.1/SFTP/database scenarios passed**; one intentionally failed DB import was correctly refused/cleaned. Exact snapshot, Browse/Download/staged Restore, original SQL hashes and repository preservation checked                                |
| `validate-phase7.ps1`                                                           | Passed isolated HTTP/HMAC/status/timeouts, SMTP/auth/rejection, lifecycle/dedup/restart and verified/untrusted TLS                                                                                                                                                |
| Backend lint; backend/frontend/agent typechecks                                 | Passed                                                                                                                                                                                                                                                            |
| `pnpm build`                                                                    | Passed; documentation compile/tests, production frontend, backend and agent built                                                                                                                                                                                 |
| Local `Dockerfile.source` and `Dockerfile.mysql-recovery-worker` builds         | Passed. Server UID/GID 10001 with MariaDB 11.8.8 and PostgreSQL 18.6, no DB servers; worker UID/GID 10001, genuine Oracle MySQL 8.4.11                                                                                                                            |
| Both Internal Compose profile configurations                                    | Passed with synthetic installation/activation IDs; omission of required IDs correctly refuses validation                                                                                                                                                          |
| `git diff --check`; changed-file sensitive-identifier/private-key marker scan   | Passed; 29 changed files, no production identifiers/private keys introduced                                                                                                                                                                                       |
| Frontend lint                                                                   | **Blocked by unchanged baseline config loader**, not a source lint result; details below                                                                                                                                                                          |

Frontend `pnpm --filter @plutonhq/core-frontend lint` exits 2 because
`typescript-eslint.config()` cannot load the pre-existing string
`extends: 'eslint-config-prettier'` entry under ESLint 10. The loader fails before
linting source. `frontend/eslint.config.js`, its package manifest and the lockfile
are byte-unchanged from this working baseline. This separate configuration issue
was not hidden, bypassed or expanded into an unrelated dependency/config refactor.
No claim of a successful frontend lint run is made.

An initial new persistence assertion accidentally retained the automatic test
fixture's replay key when simulating manual confirmation; automatic deduplication
correctly returned the prior job. The fixture now uses the real manual contract
(`trigger=manual`, null automation key, automation disabled), keeping the rejection
assertion and original automated deduplication tests. The final full suite above
passes. The initial SSR test fixture also needed to isolate browser-only shared
helpers; no application security checks were removed to make it pass.

Existing build warnings remain (bundle size, documentation CSS/browser externals,
Browserslist age and experimental Node loader). No dependency updates were made
to suppress warnings. Local image sizes are 171,404,767 bytes for the server and
93,158,731 bytes for the worker (uncompressed Docker inspection, not registry
transfer size or retained DB storage).

All fixtures are synthetic, isolated and disposable; they are small structural/
security checks, not 5–20-MB or 272-MiB performance acceptance. No production
acceptance is claimed. Local images are test artifacts, not releases/deployments.
GitHub Ubuntu CI must still be rerun after the user submits the changes.

## 18. Confirmed CI failure and limitations

The supplied job reached the Internal integration step: image build, UID 10001
client checks and MySQL worker checks had already passed. The failure was Docker
rejecting a Linux bind source containing literal Windows backslashes, for example
`/home/runner/work/example/example\backend\__tests__\integration\internalRecovery.prepare.mjs`.
PowerShell interpolation does not normalize separators passed as Docker argument
strings. Five sources now use `Join-Path` with portable relative paths; fixture
files are checked before any container/network/volume is created. The harness also
refuses to publish a removal receipt if stopping/removing its test target failed.

The static regression guards both path conventions and real file existence. Local
native tests use Docker Linux containers driven by Windows PowerShell. This is
not the same as rerunning GitHub's Ubuntu PowerShell job. Remote CI must be rerun
after the user submits the uncommitted changes; no CI success is invented here.

## 19. Deployment prerequisites (not executed)

Review and integrate the whole feature branch, including 0011, through the normal
PR process. Do not deploy only a new frontend against the old server. Keep the
existing environment file, SECRET, ENCRYPTION_KEY, `/data` volume/SQLite, stored
credentials, plans, repository/snapshot data, agent state and Phase 7 outbox.
Take the established consistent configuration/SQLite backup; never regenerate keys.

Use reviewed server and optional worker image digests. An updated worker is needed
only to gain its new shared importer version check, not an agent update. Existing
v1 IPC compatibility remains. Keep existing Compose overrides/mounts; do not
replace them with an example compose file or add a Docker socket.

## 20. Secure operator provisioning

Follow `MANAGED_INTERNAL_RECOVERY_TESTING_REPORT.md` and the existing root-owned
operator tooling. On a separately approved disposable Linux amd64 host, review
the fixed digests/networks/mounts/quotas before preparing one engine. Synthetic
example, **not a command to run on existing infrastructure without review**:

```sh
sudo node deploy/internal-recovery/operator.cjs prepare mariadb example_db recovery_user 128
sudo node deploy/internal-recovery/operator.cjs activate mariadb
# Run one explicitly confirmed recovery test using that archived logical name.
# Only after the application publishes the exact cleanup-ready request:
sudo node deploy/internal-recovery/operator.cjs deactivate
```

Prepare refuses overwriting existing provisioning; it is not a secret-rotation or
budget-edit shortcut. Custom targets remain independently approved dedicated
targets with the recovery-only marker, restricted non-admin grants and verified
TLS. MySQL additionally requires its root-approved worker allowlist and Unix IPC.
No public database ports or administrative app credentials are required.

## 21. Small-dataset manual acceptance still required

1. Use synthetic 5–20-MB MariaDB/PostgreSQL data on disposable infrastructure;
   verify the target marker, exact grants, TLS SAN/CA and absence of unrelated DBs.
2. Back up once; open the exact completed snapshot. Confirm recorded engines and
   sizes, all-required DB semantics, target readiness and measured resource warning.
3. Verify artifact-only is explicit and never claims SQL import. Confirm an
   operation-only native selection without changing the saved policy/automation.
4. Check actual import/catalog/content and SQL/workspace cleanup. For Internal,
   verify Cleanup Required until the exact operator removal receipt, then the
   appropriate terminal result. Inspect the private operator audit locally.
5. Repeat wrong credentials/TLS, stale metadata, existing DB, competing workload,
   cancel/restart and unknown ownership; never approve cleanup for foreign data.
6. Repeat Custom Oracle MySQL with the genuine worker and separately dedicated
   TLS target. Check ordinary backup, Browse, Download, granular/staged restore
   and Phase 7 independently. Do not enable persistent restore controls.

Browser interaction, public-domain proxy/session/WAF behavior and a real Linux
operator-host rehearsal remain manual acceptance work, not SSR unit evidence.

## 22. Later approximately 272-MiB SQL acceptance

Do not begin with this size on a 4-GiB host. First establish the small-data
baseline and measured SQL expansion/index footprint, keep the normal backup
scheduler intact, and review capacity after any separately approved RAM upgrade.
The 128-MiB default must reject it. A larger explicit operator allowance requires
independent review/rehearsal and still cannot exceed the unchanged hard budgets.
Run at most one approved engine, monitor memory/PSI/disk/client/target use, and
retain exact cleanup records on failure. Never raise limits automatically or
claim acceptance from the tiny fixtures in this repository.

## 23. Rollback and cleanup

Drain/cancel confirmed queued/running jobs using existing controls before an
image rollback. Resolve owned SQL/workspace/activation cleanup with the exact
operator request/receipt; unknown resources must be retained for investigation.
Roll back to an image compatible with the existing 0011 data, preserving all
volumes/environment/keys/credentials/outbox and repository mounts. Do not roll
back by deleting SQLite tables, migrations, snapshots, volumes or agent identity.

No new schema rollback is needed. Older code ignores the optional JSON fields,
but loses fingerprint/header-gate protection, so do not leave new queued jobs
for it to execute silently. A server-only deployment can omit the optional worker
overlay after its active work/leases are reconciled; ordinary backups still run.
Never remove an unrelated container/volume or run repository maintenance to recover
an application update. No infrastructure deployment or rollback was performed here.

## 24. Remaining blockers and safe next work

- A privileged but narrowly authenticated/authorized lifecycle controller requires
  independent operator installation/review, immutable operation/ownership records,
  fixed approved resources and real Linux-host crash/cancellation/security tests.
  A generic Docker proxy is explicitly rejected.
- Persistent restore needs enforceable disk quotas, separately owned persistent
  storage and a durable restore purpose/retention/inspection/delete lifecycle.
  Current tmpfs test profiles and leases cannot safely provide it.
- Custom persistent restore needs a separate approved retained-target contract,
  original-name/format restrictions and scoped read-only inspection credentials;
  disposable recovery targets must not be silently repurposed.
- MySQL retained import/owned delete requires a reviewed typed worker extension,
  not skipping test cleanup. MySQL Internal server provisioning remains unavailable.
- Restore Management, expiry/access revocation, persistent stop/restart, retained
  data inspection, safe explicit delete and ownership-uncertain TTL handling are
  not implemented or tested. There are no false success placeholders.
- Version headers are incomplete historical evidence; this change does not add
  source/client versions to the agent protocol or certify application semantics.
- Full-host workload inventory/reservation and reliable Docker OOM attribution
  are unavailable without additional reviewed operator authority. Existing bounds
  and conservative Internal admission are retained; no claim of universal 4-GiB safety.

This delivers independently testable recovery preparation/safety work while
preserving existing operations. It does **not** complete the full persistent
Database Restore request and must not be presented as doing so.

## 25. CI durable restart regression investigation (2026-10-14)

### Scope and proven cause

Follow-up baseline: `2bb0c93`, still on `codex/managed-internal-recovery`.
Existing feature work was preserved. This fix changes the **fixture/readiness
synchronization**, not application reconciliation, operator provisioning or the
recovery safety architecture. No application `.ts`, frontend, agent, schema,
dependency, production Compose or runtime Dockerfile change is required.

The previous harness called `docker restart`, slept three seconds, and attempted
cleanup once. Docker returning a running container is not SQL readiness.
`bootstrap.sh` emits `internal-target-started` immediately after spawning the
final MariaDB/PostgreSQL process, before it necessarily accepts connections.
Historical container logs are especially not a restart readiness condition.
Restarting these disposable tmpfs targets repeats initialization/bootstrap.

The failing path is:

`internalRecovery.smoke.mjs reconcile` -> stored SQLite session/lease and
encrypted target -> `InternalRecoveryImporter.cleanup` -> activation and CA
validation -> `RecoveryDatabaseImporter.cleanup` -> native client catalog
query -> `runRecoveryProcess` -> `database-target-unavailable`.

For MariaDB, the failing subprocess is the actual `/usr/bin/mariadb` client
with a private `--defaults-file=<0600-file>`, restricted batch/binary/sandbox
options, verified TLS and SQL `SHOW DATABASES;` on stdin. Connection failure is
classified locally before any owned `DROP DATABASE` or `removeLease` call.
The PowerShell exception merely propagates that nonzero smoke-test exit.
There is no Restic operation in this failing cleanup path.

This was reproduced **before the fix**, retaining the three-second delay, on
a disposable target restricted to 0.25 CPU. It returned the same
`database-cleanup/database-target-unavailable` and reconciliation failure.
Safe inspection showed a running container, attached network, no OOM and a
current bootstrap marker. After the fix, Linux probes observed successful DNS
but multiple failed listener checks, then successful verified TLS/native SQL.
Three consecutive slow-start runs needed approximately **8.33, 5.56 and 9.34
seconds of readiness probing** and completed reconciliation/receipt checks.
This demonstrates the missing readiness barrier rather than assuming a delay.
The final separate-counter run again passed all ten scenarios and the slow
restart: **zero DNS failures, 12 TCP/listener waits, 13 probes, 3.04 seconds**.
Thus the reproduced unavailability was the DB listener, not a lost DNS alias.

The original GitHub log does not retain native stderr or a per-probe timeline;
its precise historical connection errno/CPU pressure cannot be recovered from
that screenshot. The fixture race and identical failure are proven locally;
there is no evidence of lost activation/SQLite state, corrupt credentials, OOM,
or a backend cleanup defect. Variable runner startup timing can expose this
race. It is not the earlier Windows-separator issue, whose `Join-Path` fix stays.

### Narrow fix and safety

- Start/stop the exact captured container ID and validate its scope label,
  running state and network attachment. Native readiness is required after both
  initial bootstrap and restart, not a guessed sleep or a historical log.
- The new test-only `internalRecovery.readiness.mjs` runs as UID/GID 10001 with
  existing genuine native clients and TLS verification. The retry window is
  45 seconds, interval 250 ms, DNS timeout 500 ms/one try, TCP timeout 500 ms,
  native query timeout three seconds. A last bounded probe can finish beyond
  the retry-window edge. Only read-only connection/probe timeout failures retry;
  authentication, TLS, activation, target mismatch and unknown failures stop.
  No import, DDL, cleanup, lease deletion or success receipt is retried here.
- Restart readiness opens existing SQLite read-only/query-only/file-must-exist,
  uses the existing fixture encryption key and encrypted target, validates the
  original session/CA/activation and exact snapshot, and verifies the guard
  purpose by native SQL. Leases and `cleanupReady=false` must remain unchanged.
  Private probe credentials use exclusive 0600 files in 0700 temporary storage;
  no passwords enter argv, environment, logs or returned errors.
- The restart scenario now explicitly stops the target first and asserts that
  real native cleanup fails with `database-target-unavailable`, retaining the
  byte-identical lease/session, original snapshot and no removal approval. A
  stale activation is refused. Only then does it start the same target, await
  native readiness and run the original cleanup/catalog/workspace/receipt checks.
- The existing final receipt and service-result rules remain unchanged. SQL
  success alone cannot become Passed; failed/interrupted imports cannot become
  Passed merely because infrastructure was removed. Empty tmpfs after restart
  is not assumed clean: a live authenticated catalog check remains mandatory.
- Failure diagnostics expose only closed scenario/stage/error categories,
  DNS/TCP readiness, attempts/time, pending-lease count, container state/health,
  exit/OOM/network flags and filtered current-boot marker counts. No raw native
  output, config, SQL rows, TLS private keys or application secrets are printed.
- Fixture failure teardown validates the exact ID and fixture label; operator
  regression assertions additionally refuse foreign installation/activation/
  engine labels, IDs, images and mounts. No foreign deletion is approved.

### Changed files

| File | Change |
| --- | --- |
| `scripts/validate-internal-recovery.ps1` | Native startup/restart barrier, exact ID, unavailable negative path, safe diagnostics, optional scenario/CPU-lower-only reproduction controls |
| `backend/__tests__/integration/internalRecovery.readiness.mjs` | Bounded read-only TLS/native readiness with persisted binding checks |
| `backend/__tests__/integration/internalRecovery.smoke.mjs` | Native outage preserves leases/snapshot; stale activation refusal |
| `scripts/__tests__/internalRecoveryReadiness.test.cjs` | Nine deterministic retry/deadline/terminal-error/safety regressions |
| `scripts/__tests__/internalRecovery.test.cjs` | Portable readiness path and foreign-label cleanup rejection |
| `.github/workflows/container.yml` | Run the new regression tests as well as existing operator checks; no skipped/removed gates |
| `scripts/fixtures/internal-recovery-linux/Dockerfile` | Digest-pinned Ubuntu PowerShell/Docker CLI image for local test orchestration only; no runtime/Compose wiring |
| `docs/INTERNAL_DATABASE_RECOVERY_AND_RESTORE_REPORT.md` | This follow-up section |

### Validation on this follow-up

| Check | Result |
| --- | --- |
| Previously failing MariaDB restart, pre-fix 0.25 CPU | Reproduced the reported failure; not counted as a passing negative test |
| Native Internal matrix from Windows-host PowerShell / Linux Docker | 10/10 scenarios passed, plus second-engine exclusion, exact receipt and pending-cleanup guards |
| Exact Ubuntu PowerShell workflow command | 10/10 passed on repeated Linux runs, including the bounded-DNS variant; no scenario skipped |
| Linux slow-start restart, 0.25 CPU | 3/3 consecutive passes, then 3/3 again with bounded DNS (5.81, 3.30 and 3.82 seconds of readiness probing) |
| All backend tests | 158 suites, 3,082 passed, four skipped, zero failed (3,086 total) |
| Linux recovery API/service/store/client/process/managed-SFTP tests | Nine suites, 263 passed, one skipped, zero failed |
| Focused recovery service/store/API/Internal admission recheck | Four suites, 88 passed, zero failed |
| Frontend and script tests | 128 passed: 91 frontend + 37 script, zero failed; 16 Internal fixture tests also passed in Linux |
| Linux Agent tests | 120 passed, zero skipped/failed |
| Genuine Oracle MySQL worker matrix | 12/12 passed against disposable Oracle 8.4.11 with private IPC/verified TLS, including restart, cancellation, failure and cleanup |
| Phase 5/6 real SFTP/Restic integrations | 8/8 scenarios passed, including mixed failure, Browse/Download/staged Restore, exact snapshot/SQL hashes and cleanup |
| Phase 7 native integration | Isolated HTTP/HMAC, SMTP/auth/rejection, timeout, restart/dedup and verified/untrusted TLS passed |
| Backend lint; backend/frontend/agent typechecks; `pnpm build` | Passed (Node 24.16.0, pnpm 10.20.0) |
| `Dockerfile.source` and optional worker Docker builds | Passed, locally loaded only; server native clients execute as 10001, no DB servers in the app image |
| Final-image client/import checks | MariaDB/PostgreSQL actual import/catalog/content/owned cleanup passed; MariaDB MySQL alias rejected; genuine MySQL handled only by the separate validated worker |
| Compose | Both Internal profiles plus server/Internal and server/worker overlays validated with synthetic placeholders; no services deployed |
| Patch/sensitive-marker review | `git diff --check` passed; eight changed/new files reviewed, no production identifiers or private-key/token markers introduced |
| Frontend lint | Same unchanged ESLint 10/typescript-eslint config-loader baseline failure described in section 17; no source lint success claimed |

The extra Linux Jest run needs the test-dependency image explicitly:
`./scripts/validate-phase6.ps1 -BackendTests -Image pluton-phase6-tests:local`.
The ordinary real-DB fixture image lacks Jest; using that default first failed
to launch a test runner, then the correct test image passed all nine suites.
Likewise, Compose validation needs placeholder image references (the intended
required-image guard rejects an unset reference). Neither setup correction
required an application change or skipping an assertion.

The exact workflow command is unchanged:

```powershell
./scripts/validate-internal-recovery.ps1 -RuntimeImage pluton-recovery-ci:local
# Additional disposable slow-start reproduction, not a different endpoint:
./scripts/validate-internal-recovery.ps1 -RuntimeImage pluton-recovery-ci:local -Engines mariadb -Variants restart -TargetCpus 0.25
```

Linux execution used Ubuntu 24.04.1, PowerShell 7.5.0 and Docker CLI 28.5.1
against a local Linux Docker daemon. Only the six selected synthetic fixture
source files were copied into a disposable Linux-native volume; bind sources
were Linux absolute paths visible to the daemon, not Windows paths. With the
user's **explicit, one-time authorization**, a temporary local orchestration
container could access that local daemon socket. This is host-equivalent Docker
authority despite a read-only socket mount; it is not a safe application mount.
The image does not configure such access by default. No Pluton, worker or DB
container received a Docker socket, privileged mode, host ports or host data.
This setup is a local Ubuntu equivalent, **not an actual GitHub-hosted run**.

### Compatibility and handoff

No new schema migration, API/agent protocol or agent update is needed. No
production deployment, secret rotation, identity change, repository operation,
new plan or retained Database Restore feature was performed. Existing TLS,
ownership, admission, durable leases, snapshot binding and operator lifecycle
remain intact. No commit, push, merge, release or image publication was done.
The local fixture teardown removes only scoped disposable resources; it cannot
authorize application infrastructure cleanup or substitute a production receipt.

Rerun PR CI after the user publishes these branch changes; do not merge based
only on local success. A remote Actions result and production acceptance remain
unverified. Reverting these test-only edits needs no database/data rollback and
must not delete persistent volumes, keys, leases, repositories or agent identity.
