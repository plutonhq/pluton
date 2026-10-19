# Oracle MySQL Internal automatic recovery

## Scope and verified baseline

Baseline: `95536becb6ec13d3258a0d6f560f8888bd248847` (`origin/main`, fetched
and inspected before editing). The clean baseline contains the complete reviewed
MariaDB/PostgreSQL automatic lifecycle, migration 0015, PID-1 mount plane,
durable Resume consumption, boot ordering, API/UI, and deployment safeguards.
Work is uncommitted on `codex/mysql-internal-automatic-recovery`. No Release
Please PR, production service, existing repository, or real backup was modified.

This extends Phase 6, not a new phase. Phase A disposable import was implemented
and tested before Phase B retained restore. MySQL Custom paths remain independent.
The original MySQL extension reused migration0015. The subsequent RC-01 shared
lifecycle correction requires additive migration0016 and matching application/root
code, as documented below. No Agent update/protocol, dependency or lockfile change
is required. The worker's version-1 protocol has additive optional Internal
context/capabilities; an old or Custom-only worker cannot authorize Internal work.

## Architecture and authority

The existing host operator remains the **only** privileged lifecycle controller.
It selects a fixed Oracle image, owns the ext4 images, submits fixed mount units
to PID 1, and verifies exact container/storage/installation identity. Pluton and
the client-only worker stay UID/GID 10001, read-only root, no capabilities,
no Docker socket, no sudo, no host namespace, and no published database ports.
Database containers stay UID/GID 999 with the existing bounded non-root profile.

Internal MySQL is an explicit, independent host opt-in:

1. An operator reviews/installs the root-owned code and preloads the fixed image.
2. `operator.cjs approve-mysql` verifies the existing installation, code, and
   preloaded image, creates root-owned `mysql.json` and a dedicated
   `mysql-public` proof directory, and does not change identities or keys.
3. Ordinary ticks advertise MySQL only while this approval is valid. Readiness
   checks never create, repair, or adopt missing paths. An unexpected preexisting
   approval directory/marker is refused, not overwritten.
4. A separately approved worker policy enables Internal. The worker independently
   verifies its narrow root-owned proof directory before advertising readiness.
5. Every Internal request must match root proof for engine, mode, operation,
   exact snapshot, stable database identity/name, SQL digest/bytes, scoped
   endpoint, TLS CA, storage quota, and a fresh matching ready receipt. Retained
   requests also independently bind the durable owner token through its hash.

The worker sees only its IPC volume, approved policy, and **MySQL-only** root proof
directory. It does not receive `/data`, repository credentials, host private keys,
application environment files, MariaDB/PostgreSQL target proofs, or database data.
Proofs contain short-lived target credentials; despite the historical "public"
directory name, they are not public: root-owned, group 10001, protected 0750/0640,
mounted read-only, bounded no-follow/nonblocking reads, no API/log disclosure.

The existing Unix IPC streams only the authorized SQL with bounded frames,
single-flight concurrency, deadlines, cancellation, 0600 staging/credential files,
and secure cleanup. Passwords are not subprocess arguments or environments. There
is no arbitrary SQL-query or shell-command RPC. Native TLS uses VERIFY_IDENTITY.
Custom requests retain their existing static endpoint/CA/approval restrictions.

## Genuine MySQL implementation differences

| Component | Reviewed implementation |
| --- | --- |
| Database | Oracle MySQL Community Server **8.4.11**, official `mysql:8.4.11@sha256:24989179f58856db763f418010c1169fecc944e3ec1ea7e921572d83eb070f70` |
| Client | Existing separate Debian 12 worker; genuine Oracle Community Client **8.4.11-1debian12**, official signed packages, pinned key fingerprint and package SHA-256 in `Dockerfile.mysql-recovery-worker` |
| Server provenance | Official image's Oracle Linux 9 package build; native `mysqld --version` is checked before initialization, requires reviewed 8.4.11 Community identity, refuses MariaDB aliases |
| Application clients | MariaDB 11.8.8 and PostgreSQL 18.6 remain local; Alpine's `mysql` alias is still explicitly incompatible for genuine MySQL import |
| Storage | Existing fully allocated ext4 **2 GiB**, loop mount, ownership anchor, private read-only seed and propagated app view; no unbounded Docker database-volume fallback |
| SQL | Internal default/cap **128 MiB**, unchanged existing native-engine budgets |
| Resources | MySQL additionally reserves 384 MiB worker headroom; admission requires 2944 MiB available versus the existing native 2560 MiB rule, plus existing CPU/swap/cgroup checks |

The Oracle image genuinely lacks `flock` and `cmp`. The fixed root-owned
`mysql-lock.py` runs using the image's bundled mysqlsh Python (mysqlsh **8.4.10**),
takes the same kernel `flock` on inherited descriptor 9 and `exec`s the fixed Bash
bootstrap. The descriptor remains inheritable; concurrent initialization is
refused with exit 71. No package, caller path, alternate controller, or added
privilege is introduced. The identity-file comparison uses exact SHA-256 for
this engine; MariaDB/PostgreSQL behavior is unchanged.

Initialization is network-disabled, on a fresh verified empty datadir, with no
reusable root password. It creates the purpose/activation/storage guard and scoped
SSL-only non-admin restore user, **locks root before network startup**, and writes
the completion marker only after success. An existing datadir without the marker
is uncertain and cannot be automatically reinitialized. The network server has
TLS, MySQL X/local-infile/file-export/event restrictions and bounded memory.

Native testing reproduced Oracle's refusal of `--log-error=/dev/null`
(MY-010187/MY-013236). The MySQL-only command omits this incompatible option;
shell redirection still withholds raw native output. Diagnostics remain closed,
stage/code/category only. Other engines' commands are unchanged.

The first four-GiB VM run correctly refused post-provision admission: Oracle's
default server used about 452 MiB RSS before any archived SQL import. The failed
test remained Failed and its native/infrastructure cleanup completed. The MySQL
profile now disables optional Performance Schema telemetry and bounds the InnoDB
log buffer to 8 MiB during offline initialization, guard bootstrap and network
operation. Recovery validation uses information_schema, not telemetry. Native
tests assert the actual server variables, not only command strings. Admission
thresholds, the 2 GiB server hard limit, SQL/storage caps, TLS, grants, exact
ownership and import/catalog checks are **not** relaxed. Post-change VM capacity
and end-to-end results are recorded separately below.

Even with this profile, a real four-GiB run observed approximately 2840 MiB
available while the reviewed policy requires 2944 MiB. A temporary eight-second
measurement-only settling experiment also refused correctly. It did not solve
the observed capacity limitation and was **removed**, together with its
experiment-only tests, rather than changing established admission timing without
demonstrated benefit. The final code retains immediate fail-closed admission,
without a threshold discount, SQL retry, reclaim/drop-cache operation or new UI
poll loop. Larger host capacity is required to complete this acceptance run.

See [Oracle's Performance Schema startup documentation](https://dev.mysql.com/doc/refman/8.4/en/performance-schema-startup-configuration.html)
for the optional instrumentation/memory relationship. This is a dedicated
synthetic/recovery target profile, not a change to any source database.

An additional real integration failure was found: the durable Internal recovery
store namespaces lease IDs as `il_...` by mutating its input. Passing the wire
lease object directly broke lease ACK. The client now persists a clone before
ACK and translates only an Internal durable ID back to its exact 24-hex wire ID
for cleanup/reconciliation. Durable storage semantics and Custom wire IDs remain
unchanged. Tests cover this boundary.

Provenance references: [official image build](https://github.com/docker-library/mysql/blob/master/8.4/Dockerfile.oracle),
[Oracle initialization](https://dev.mysql.com/doc/refman/8.4/en/data-directory-initialization.html),
[Oracle TLS](https://dev.mysql.com/doc/refman/8.4/en/using-encrypted-connections.html).
Version compatibility here is the actually tested 8.4.11 pair, not a claim that
every MySQL version/dump or future security update has been validated.

## Disposable and retained semantics

Disposable: exact completed snapshot/artifact verification -> durable reservation
and root request -> TLS/guard/ownership readiness -> streamed native import and
catalog validation -> owner-checked SQL cleanup -> empty catalog verification ->
exact root physical-removal receipt -> workspace cleanup -> Passed. An uncertain
cleanup never becomes Passed. No source database or source Agent is contacted.

Retained: same artifact/ownership boundary with a distinct persistent purpose;
Active, Inspect, Stop, explicit Resume, TTL and Delete reuse the existing durable
store and controller. Restart cannot reimport or replace the target. A consumed
Resume does not become a restart policy. Delete retains Cleanup Required until
native lease cleanup and exact root removal are verified. Unknown/partial
resources are retained for investigation, not adopted or automatically destroyed.

UI selection depends on actual root **and** worker capabilities. Old/manual
profiles and Custom-only installations retain MySQL Custom. Existing stable
dialog/progress/timer components, keys, focus behavior, and polling cadence are
unchanged; no fabricated percentages or new polling loop was added.

## Changes

- Host: `deploy/automatic-recovery/operator.cjs`,
  `deploy/persistent-restore/operator.cjs`, `bootstrap.sh`, new `mysql-lock.py`.
- Worker: `backend/src/mysql-worker/{index,protocol,server}.ts`, new `internal.ts`.
- Backend: `DatabaseRestoreService`, `RecoveryTestService`, recovery types,
  `automaticRecoveryLifecycle`, `internalRecoveryImporter`,
  `internalRecoveryTargets`, `mysqlPersistentDatabaseImporter`,
  `mysqlRecoveryWorkerClient`, `persistentRestorePolicy`,
  `persistentRestoreTargets`, `recoveryPreparation`, `recoveryTestPolicy`.
- Frontend: recovery types, `RecoveryConfirmation`, `RecoverySettings`,
  `DatabaseRestoreWizard`, and their existing normalization/resource helpers.
- Deployment: optional `deploy/compose.mysql-internal-recovery.yml`, `.dockerignore`
  excludes private local rehearsal archives/drivers, narrow
  validator in `deploy/compose-tools.py`, required CI native Internal gates.
- Regression coverage: backend route/service/worker/authority/lease tests,
  frontend target/selection tests, operator MySQL/Resume tests, actual Compose
  merging/permission tests, native Internal fixture/runner, and optional synthetic
  MySQL extension to the existing Restic API fixture/client.

The overlay is tested alone and after the existing Custom overlay. Explicit
`!override` is necessary for bounded tmpfs/security options during Compose merge;
otherwise duplicate security options can make a safe-looking overlay fail
validation. Custom CA/egress are retained when explicitly configured.

## Validation evidence

Local, synthetic-only evidence (no production data):

| Check | Result |
| --- | --- |
| Complete backend including Phase 5/6/7 | 170 suites passed; 3353 tests passed, 4 existing skips; focused worker authority suite 36/36 |
| Frontend utility/interaction suite | 145 passed, zero failed, includes stable dialogs/accessibility/progress regressions |
| Host/security/release/deployment Node suites | 116 passed, zero failed; includes explicit MySQL expiry, pre-provision cancellation and interrupted-cleanup regressions |
| Actual Compose deployment policy | 27 passed, zero failed |
| Linux boot unit/policy | 9 passed, zero failed |
| Native MySQL Internal disposable | 6/6: success, wrong password, TLS failure, wrong marker, existing DB, cancellation; real import/content assertion and owned cleanup |
| Native MySQL Internal persistent | 6/6: same refusal cases, retained success with exact identity and Stop/Resume |
| Existing MySQL Custom worker | 12/12, native TLS/import/worker restart/unavailability/cleanup |
| Existing MySQL Custom retained | 20 cases passed, including 20 preflight + 20 import cancellations |
| MariaDB/PostgreSQL automatic native | 4/4 disposable/retained, real SQL/content/ownership cleanup |
| Existing native Internal profiles | 10 engine/variant cases passed, including wrong marker, existing database, TLS and durable restart/cleanup |
| Final runtime clients | Native MariaDB/PostgreSQL content import/cleanup passed as UID 10001; MySQL alias refused |
| Dual-origin compiled application | Authenticated HTTPS terminator and direct HTTP session/CSRF checks passed; trust proxy remains disabled |
| Runtime packaging | UID/GID 10001, 1574 paths checked; privileged code, fixtures and local state excluded |
| Typecheck/build/backend lint | Passed; final installed-compiler/backend-linter and frontend-test reruns also passed |
| Agent Windows compatibility | 45 passed, 75 platform-specific skips; Agent files unchanged |
| Agent Linux | 120 passed, zero skipped/failed, including Phase 5 multi-DB and subprocess cancellation |
| Phase 7 isolated integration | HTTP/HMAC/retry/SMTP/auth/TLS/outbox/restart checks passed |
| Frontend ESLint baseline | Existing ESLint 10/typescript-eslint string-extends configuration failure before source inspection; not disabled or misreported as passed |

The nonprivileged native fixtures use a **bounded test tmpfs**, not production
storage. They do not prove ext4 ENOSPC, host isolation, daemon restart, or cold
boot. The retained local fixture reopens durable state and cycles the DB but is
not a full application-container restart. These distinctions are acceptance gates,
not implied success from unit tests.

An initial ad-hoc Linux Agent invocation omitted Docker `--init`: seven PID
absence assertions saw unreaped orphan processes. Repeating with the required
init reaper passed all 120 tests; no Agent source/test assertion was changed.

Final local-tooling checks also encountered two environment limitations, not
hidden product passes: the host's global pnpm 11 attempted to fetch the project's
pinned pnpm 10.20.0 and failed fetching; a sandboxed backend rerun could not open
an existing synthetic plan log (`EPERM`). No package/lockfile, logging control or
filesystem ACL was changed to accommodate either. Typechecks, frontend tests and
backend lint were rerun using the installed locked tools directly; the backend
suite was rerun outside the Windows file sandbox. The source-image production
build and native Linux validation remain separate from these Windows launch
limitations. The unsuccessful pnpm bootstrap's exact temporary package metadata
was removed; no generated dependency/bootstrap fixture is part of the diff.

### Previous disposable Linux rehearsal (before resource follow-up)

This earlier scope was fully removed before the resource work below. Its cleanup
proof does not claim that a later, deliberately retained visual-UAT fixture has
already been removed.

Fresh explicit approval covers only a separate disposable KVM guest, synthetic
data on its separate ext4 fixture disk, 4 vCPU/4 GiB minimum, root operator only,
an isolated fixture Docker/containerd pair, ext4 2 GiB loop storage, ENOSPC,
cancellation, ownership, TTL/reconciliation, app and private-daemon restart, and
ownership-verified cleanup. **No guest reboot or main Docker modification is
authorized.** Execute only after required local checks pass; the separately
documented frontend lint baseline is not a new feature failure.

Planned evidence: real synthetic Restic snapshot -> authenticated preparation and
Required Internal MySQL Recovery Testing -> native import/catalog/content
assertion -> exact removal; retained Restore -> Inspect -> app restart -> Stop /
Resume -> private-daemon restart with explicit Resume -> verified Delete;
readonly propagated app view and root-only storage; real ENOSPC without escaping
the quota; cancellation/ownership mismatch refusal; no fixture mounts, loops,
containers, temporary units, or disk images remaining.

#### Initial four-GiB rehearsal

The initial run was **partial: full API import was blocked by measured memory
headroom**, not falsely marked Passed. That host had approximately 3915 MiB usable
RAM. The operator ran with PrivateTmp, ProtectHome and NoNewPrivileges intact on
the separate fixture disk and separate Docker/containerd instances.

| Actual disposable-host check | Observed result |
| --- | --- |
| Checksum-reviewed image transfer and explicit MySQL approval | Passed; existing fixture installation identity preserved |
| Real Restic snapshot, authenticated application and exact-snapshot preparation | Passed; genuine read-only synthetic SFTP repository, no published ports |
| Session, JSON, origin and forged proxy/host refusal | Passed against actual HTTP API |
| Oracle target provisioning, TLS/guard readiness | Passed; non-root Oracle server and separate UID-10001 client-only worker |
| Root storage and namespace plane | Passed; fixed 2 GiB ext4, correct host/operator/Docker propagation, retained existing isolation |
| Real ENOSPC | Passed; approximately 1.898 GB allocated, filesystem 2,040,373,248 bytes, available 0; fixture host reserve protected; filler removed before restarting the same owned target |
| Owner/snapshot/engine/digest substitution | Four real substitutions refused; original container/volume/metadata unchanged |
| Full Required Recovery Test/import | Refused at post-provision resource gate; artifact passed, native import remained pending, status Failed rather than Passed |
| Retained full API import | Refused with `resource-host-memory-headroom`; uncertain/interrupted work cleaned through normal durable lifecycle, never reimported automatically |
| SQL/infrastructure/workspace reconciliation | Six attempted lifecycle journals reached exact Removed; failed recovery records retained their failure and completed cleanup |
| Active/Inspect/Stop/Resume after successful API import, app/private-daemon restart | Not completed at four GiB; superseded by the fresh eight-GiB results below |
| Human MySQL visual UAT and MySQL cold boot | Not performed; earlier MariaDB/PostgreSQL UAT/boot is not MySQL evidence, no reboot authorized |

All six root lifecycle journals reached Removed. The exact old fixture was then
fully cleaned and its absence verified, including zero owned containers, volumes,
images, mounts, loops and disk images. Only after that cleanup did the user
increase the VM to eight GiB and confirm it was available. No Proxmox access or
guest reboot was performed by this task.

#### Fresh eight-GiB rehearsal

Read-only checks confirmed **7941 MiB usable RAM**, four vCPUs, the separate ext4
fixture disk with approximately 29 GiB available, and the expected Docker Engine.
A new independent fixture, new synthetic credentials and a new real Restic
snapshot were created. No previous identity, database, directory or uncertain
resource was adopted. The same final application/worker images and immediate
admission policy were used; the removed settling experiment was not reinstated.

| Actual disposable-host check | Result |
| --- | --- |
| Real snapshot and authenticated preparation | Passed; exact completed snapshot and archived MySQL SQL identity/digest/size; measured available RAM about 7 GiB |
| Session/origin/JSON/forged Host/forwarded headers | Passed against the full running application; no anonymous restore authorization |
| Required Internal Recovery Testing | **Passed**; artifact integrity and genuine native import passed, one table catalog validated, SQL content assertion executed |
| Recovery cleanup gates | Database, workspace and infrastructure all verified complete before final Passed; exact root removal receipt required |
| Persistent Restore | **Active**; Inspect passed against the exact archived database/snapshot |
| Owner/snapshot/engine/digest substitution | Four real substitutions refused; original root journal, container and storage unchanged |
| ext4 quota and mount plane | Passed under PrivateTmp/ProtectHome/NoNewPrivileges; real 2 GiB image, read-only propagation and exact ownership retained |
| Real ENOSPC | Passed: 1,897,553,920 filler bytes, 2,040,373,248-byte filesystem, available bytes zero; host reserve protected; filler removed and same target resumed |
| Full application-container restart | Same retained container/storage/snapshot identity; Inspect passed; no SQL reimport |
| Stop / explicit Resume | Verified Stopped then Active, same identity; an early Resume before Stop reconciliation returned 409, not an unsafe start |
| Separate fixture Docker-daemon restart | Same container/storage identity, restart policy did not auto-start it; repeated reconciliation remained Stopped until a new explicit Resume |
| Retained SQL after both restarts | Exact synthetic content checked by UID-10001 genuine client using verified TLS and a private 0600 credential file, not a new query RPC |
| Delete | Native owner-checked cleanup followed by exact physical removal; Deleted only with `cleanup=verified` |
| API cancellation before provisioning | Passed; root journal `attempted=false`, positive absence, no target created, verified Deleted |
| API cancellation during creation | Observed `provisioning-container`, accepted cancellation, reconciled partial concurrent creation without successful import, verified Deleted |
| Duplicate reconciliation / consumed Resume | Repeated real polls and private-daemon restart retained correct state; explicit MySQL replay/expiry/partial-creation/cleanup-crash regression tests passed |
| Final root journals | All four fresh-scope operations reached exact Removed; no pending mailbox requests |

The existing API conservatively showed `internal-cleanup-required` while waiting
for the disposable root-removal receipt, then reconciled to Passed only after all
cleanup gates succeeded. Stop/Resume/Delete responses are asynchronous: a 202 is
accepted intent, not proof the host has already changed state. The acceptance
client waited for authoritative state and did not remove those guards. Historical
cancellation/reconciliation diagnostics may remain in verified Deleted history;
they are not permission to retry import or bypass cleanup.

**Final cleanup was independently verified, not inferred from UI status.** Both
the previous and fresh fixture scopes were removed only after proving ownership.
For the fresh scope: zero containers, volumes, images, mounts, loop devices and
disk images; both private Docker/containerd units stopped; no persistent test
unit files; no process using the fixture; exact fixture directory absent. The
main Docker container-ID inventory hash matched its pre-test value. Root
ownership journals were terminal before removal of the private fixture files.
Normal OS systemd audit history was not globally vacuumed or altered.

Sanitized evidence was saved locally outside Git, and `/tmp/` is excluded from
the Docker build context. No disposable host identifier, password, credential
file, VM path or private test driver is shipped in the application image/report.

Remaining acceptance distinctions:

- Expiry/access revocation/cleanup and MySQL expired-worker cleanup are covered
  by deterministic regression tests; a real one-hour TTL wall-clock wait was not
  performed. Do not describe that as a completed disposable-host TTL test.
- Native wrong-password/TLS/marker/existing-database/import-cancellation cases
  passed in isolated local containers; the fresh VM was not made to repeat every
  failure or kill the operator mid-removal. The crash/restart decision path is
  covered by explicit MySQL regression tests, not claimed as a real VM crash.
- Human MySQL visual UAT and MySQL cold-boot regression were not performed. No
  reboot was authorized; permission to restart a private daemon is not reboot
  permission. Prior MariaDB/PostgreSQL UAT is not substituted.
- The VM used small synthetic SQL with a content assertion. The 128 MiB policy
  boundary is enforced, but full-size/real-application dump acceptance remains
  operator UAT, not implied by this small fixture.

## Deployment prerequisites and manual UAT

Do not run these steps on an unreviewed host or as part of an ordinary image
update. This branch has not been committed, pushed, published, or deployed.

1. Review the whole branch and required CI. Back up stopped application SQLite,
   deployment contract/overlay selection, operator configuration and ownership
   journals. Preserve `SECRET`, `ENCRYPTION_KEY`, `/data`, Agent identity,
   repository passwords, existing plans, snapshots and notification outbox.
2. Use the existing reviewed systemd host installation/boot procedure. Install
   the full host code root-owned/non-writable, **including `mysql-lock.py`**;
   preserve PrivateTmp, ProtectHome and NoNewPrivileges, mount anchors before
   Docker, and application startup after root reconciliation. Do not re-run
   `init` on an existing installation or reset its installation identity.
3. Independently verify/preload the exact Oracle image above; no implicit pull is
   performed by an application request. Review supply-chain updates separately.
   Run the fixed root `approve-mysql` action only after installing reviewed code.
4. Supply the separately built, reviewed worker by immutable digest. Internal-only
   policy file: `{"internal":{"enabled":true,"maxArtifactBytes":134217728}}`.
   Root owns its protected parent/file; worker group 10001 needs read only.
5. Append `compose.mysql-internal-recovery.yml` after the existing persistent and
   automatic overlays (and after the Custom worker overlay, if used). Compose
   must support `!override`. Keep both root-created internal networks private.
   Never mount host Docker, `/data`, data volumes, or environment files in worker.
6. Review the changed mount/service contract explicitly. The existing deployment
   tool refuses a different sealed mount/project contract; **do not delete or
   rewrite the contract to force acceptance**. Install an operator-reviewed
   matching contract/overlay bundle with a preserved rollback copy. This is an
   explicit host-capability activation, not an automatic server-only update.
7. A mixed Custom+Internal policy must fit the Internal 128 MiB/384 MiB worker
   envelope. Existing larger Custom-only deployments must keep their original
   overlay until independently capacity-reviewed; they are not silently shrunk.
8. On synthetic data first, select an exact completed MySQL snapshot under the
   128 MiB SQL cap, acknowledge resources/security and choose Required Internal
   import. Verify artifact and import passed, exact snapshot, completed SQL,
   infrastructure and workspace cleanup before considering Recovery Test Passed.
9. Restore Wizard: choose the stable archived database identity, Internal and an
   approved TTL. Verify Active/Inspect, Stop/explicit Resume, app and Docker
   restart retaining exact ID/data, then owner-verified Delete. Verify ordinary
   backups, MariaDB/PostgreSQL and MySQL Custom remain unaffected.

## Rollback and limitations

- Stop accepting new Internal MySQL operations first. Keep the new operator and
  worker running until all native leases, retained targets and physical removal
  receipts are resolved. Never roll back by deleting SQLite rows, mailbox files,
  ext4 images, mounts or ownership journals.
- Export any explicitly retained synthetic/operator-approved result before
  deletion. Do not use in-place/source restore or a production target.
- Only after zero active/uncertain MySQL resources, restore the preserved
  server-only/Custom deployment contract, overlay selection and immutable images.
  Do not remove a worker needed by existing Custom restores. Restore reviewed host
  code after draining; retain protected audit records. Do not rotate secrets,
  regenerate identity, drop migration 0015, or restore an older SQLite backup over
  newer lifecycle state.
- No automatic engine/version upgrade, dump retry after uncertainty, remote root
  login, MySQL X endpoint, arbitrary MySQL version guarantee, or >128 MiB Internal
  SQL support. SQL syntax/content incompatibility fails closed.
- The safe outcome for unknown resources is Cleanup Required plus operator review,
  not forced deletion. Severe corruption may prevent native ownership cleanup;
  no maintenance/repair command is introduced as an escape hatch.
- Required gates before rollout: successful disposable-host rehearsal and cleanup,
  required CI on Linux, review of the exact host/image/overlay contract, and human
  MySQL UAT. MySQL cold boot needs separate approval if requested; none is implied
  by permission to restart only the fixture daemon.

Current recommendation: **GO for independent source/security review**, with the
original four-GiB API capacity blocker resolved by the fresh eight-GiB rehearsal.
**NO-GO for production deployment yet**: required Linux CI, human MySQL visual UAT,
wall-clock TTL acceptance, review of the exact immutable deployment contract and
any separately approved MySQL cold-boot gate remain. No PR, commit, push, release
or production deployment was performed. Successful synthetic native/API testing
does not validate arbitrary production dumps or replace those operational gates.

## Reproduction and required CI

Use Node.js 24 and the repository-pinned pnpm 10.20.0 with the existing lockfile.
Do not use the host's incompatible global pnpm as a substitute or alter the
lockfile to get a different package manager. Run from the repository root:

```sh
pnpm --filter @plutonhq/core-backend test --runInBand
pnpm --filter @plutonhq/core-backend lint
pnpm --filter @plutonhq/core-backend exec tsc --noEmit -p tsconfig.json
pnpm --filter @plutonhq/core-frontend exec tsc -b
node --experimental-strip-types --test frontend/__tests__/*.test.ts
node --test scripts/__tests__/*.test.cjs
pnpm build
git diff --check
```

The existing frontend lint command must still be run/recorded separately; its
documented ESLint configuration failure is not a passing check. Host Python
policy/boot tests and real Compose merge validation require the existing Linux
fixture environment. `.github/workflows/container.yml` additionally hard-gates
the actual source/worker images on both modes of
`scripts/validate-mysql-automatic-recovery.ps1`, unchanged MySQL Custom and
MariaDB/PostgreSQL native fixtures, release boundaries and dual-origin sessions.
These nonprivileged CI fixtures do not mount the host Docker socket, provision
host loops or stand in for the separately authorized disposable-host rehearsal.

Final Windows rechecks used the installed compiler/linter/test executables
directly after the package-manager bootstrap limitation above: backend/frontend
typecheck, backend lint, all 145 frontend tests and all 116 host/security Node
tests passed without installing dependencies or modifying package-manager state.
The complete backend suite also passed outside the file sandbox (170 suites,
3353 passed, four existing skips). Source-image production build, native clients
and UID-10001 release-boundary checks passed separately against the reviewed
image rather than a development server or a mounted production volume.

## Resource-safety follow-up — 2026-10-17

### Confirmed gaps and changes

The earlier successful small-data rehearsal was not a workload-capacity test.
Preparation exposed server measurements, but did not provide a stable contextual
warning in both confirmation flows; import-time measurement and the operator's
ancestor-cgroup envelope also needed explicit enforcement. Installed RAM alone
is not admission. In addition, a namespaced cgroup-root fixture exposed a trailing
slash bug: the capacity walker could continue from `/sys/fs/cgroup/` into its
parent. Canonical root normalization now stops at the exact cgroup boundary.
Unknown/malformed/missing measurements still fail closed; no path escape or
fallback to invented measurements was added.

- Both Internal confirmations have one stable inline accessible resource panel:
  Ready/Warning/Blocked/Checking, exact engine/SQL bytes/cap, measured host and
  operator RAM, CPU, PSI/swap, staging/recovery free space, workload reservation,
  database/worker limits and fixed ext4 quota. Checking and Blocked disable
  confirmation even when the existing acknowledgement is checked. DOM tests
  preserve dialog/panel/control identity, focus, scroll and acknowledgements
  through refresh and refusal. No new frontend query, interval or percentage.
- A separate root-owned **read-only** `capacity.json` contains a closed schema,
  a fresh timestamp and real host/ancestor-cgroup counters. It is not a caller
  policy or a new privileged command. App and worker reject stale (>30 s),
  future, malformed or unknown samples. Existing v1 capability/receipt schemas,
  database identity, migration 0015 and Agent protocol remain unchanged.
- MySQL keeps 2,944 MiB available memory, including worker headroom. CPU,
  PSI/swap, server/worker cgroup and disk guards remain mandatory. Provisioning
  reserves 3 GiB free before allocating the fixed 2 GiB image; the remaining
  reserve is checked before initialization/import/Resume. Root independently
  measures before creating and immediately before starting initialization.
- The server rechecks before durable provisioning/reservation and before explicit
  Resume. Internal imports check before executing and every two seconds while
  in flight, with one bounded observation at a time and a 1.5 s observation
  deadline. Worker independently checks its own cgroup/private tmpfs and root
  capacity. Sampler failures use only the existing operation AbortSignal, wait
  for native settlement, preserve the resource failure and do not retry import.
- Native ENOMEM/MySQL allocation failures and ENOSPC/table-full failures have
  sanitized resource categories. A lost worker or SIGKILL without OOM evidence
  is not falsely called OOM. Late observations cannot cancel an already
  validated retained database. Resource-refused Resume leaves data, ownership
  and validated lease intact; Stop/Delete/cleanup do not require free RAM.
- Internal-only CPU reservations are not imposed on the separate Custom contract.
  MariaDB/PostgreSQL native client paths and all dump/backup behavior are retained.

### Measured synthetic workload matrix

All physical-host tests below use a separate disposable Linux guest (4 vCPU,
7,941 MiB usable RAM) and genuine Oracle MySQL 8.4.11 through the real root
operator, private worker, authenticated API, real Restic snapshots and verified
TLS. No production source, repository, Docker configuration or database was used.
SQL is independently generated synthetic row data, not a production dump.

| Envelope | Workload | Rows | Actual SQL bytes | Admission/import | Cleanup |
|---|---|---:|---:|---|---|
| Physical 8 GiB | Small | 512 | 529,353 | Admitted; native import and actual row/payload validation passed | Exact SQL/container/mount/image cleanup verified |
| Physical 8 GiB | Medium | 16,000 | 16,553,815 | Admitted; native import and actual row/payload validation passed | Exact SQL/container/mount/image cleanup verified |
| Physical 8 GiB | Large | 96,000 | 99,376,315 | Admitted; native import and actual row/payload validation passed | Exact SQL/container/mount/image cleanup verified |
| Physical 8 GiB | Oversized | 136,000 | 140,823,584 | Refused before provisioning: exceeds 134,217,728-byte SQL cap | No DB created |
| **Constrained simulation**, 4 GiB cgroup on 8 GiB guest | Small | 512 | 529,353 | Safely refused; no import | No DB created |
| **Constrained simulation**, 4 GiB cgroup on 8 GiB guest | Medium | 16,000 | 16,553,815 | Safely refused; no import | No DB created |
| **Constrained simulation**, 4 GiB cgroup on 8 GiB guest | Large | 96,000 | 99,376,315 | Safely refused; no import | No DB created |
| **Constrained simulation**, 4 GiB cgroup on 8 GiB guest | Oversized | 136,000 | 140,823,584 | Safely refused; no import | No DB created |

The constrained service had a real 4 GiB MemoryMax, zero cgroup swap, four CPUs
and a bounded 1.25 GiB anonymous test allocation. Its measured available capacity
was 2,937,286,656 bytes (about 2,801 MiB), below 2,944 MiB; host RAM was not
exhausted. All allocations ended with the transient service. This is **not an
actual 4 GiB host success test**. Historical physical 4 GiB refusal evidence
above remains distinct. Deterministic tests additionally admit a 4 GiB envelope
with 3,000 MiB available, and reject an 8 GiB sample with only 2,800 MiB available.
No threshold was reduced to obtain a pass.

| Physical 8 GiB measurement | Small | Medium | Large |
|---|---:|---:|---:|
| DB cgroup peak bytes (includes initialization) | 312,274,944 | 386,224,128 | 606,056,448 |
| Worker cgroup peak bytes (cumulative across this fixture) | 47,755,264 | 77,484,032 | 166,768,640 |
| Backend restore/import/validation elapsed | 9.957 s | 13.487 s | 27.928 s |
| Whole operation, including provisioning | 22.888 s | 64.040 s | 43.032 s |
| DB accumulated CPU time, including initialization/probes | 5.322 s | 7.168 s | 8.093 s |
| Peak sampled DB cores, not an instantaneous guarantee | Not captured during import | 0.295 | 0.387 |
| ext4 used bytes after validation | 148,766,720 | 166,592,512 | 260,964,352 |
| Lowest observed effective available RAM | Import-time minimum not captured | 7,213,043,712 | 6,936,297,472 |

The small import finished before its independent content probe was corrected:
the operator deliberately deletes its temporary readiness credential file. The
probe now creates/removes a distinct private 0640 credential file and validates
the **same retained DB**, without replaying SQL. Small's original in-flight
observations and cgroup peak are retained; a late sample is not represented as
its import-time CPU peak. Medium/Large were observed through import and catalog
validation. Every successful tier checked actual count and payload byte lengths
over TLS, and native SQL assertions and the artifact SHA-256 remained required.
No OOM or swap use occurred in these successful tiers. Each ext4 filesystem was
2,040,373,248 usable bytes within its preallocated 2,147,483,648-byte image.
Recovery-image free space remained over 26 GiB at admission. These values are
dataset measurements, not universal production capacity guarantees.

The resource follow-up also repeated the real ext4 boundary: a stopped owned
synthetic target accepted 1,888,227,328 bytes of bounded filler, reached actual
ENOSPC with zero free bytes, and did not grow its preallocated host image. Only
the proved fixture filler was removed before native restart; no database file,
identity or unrelated workload was removed. This proves filesystem enforcement,
not a claim that every native SQL ENOSPC/OOM branch was physically induced.

Follow-up regression results: full backend **171 suites / 3,389 passed / 4
existing skips / zero failed**; frontend **148 passed**; host/security Node
**117 passed**; deployment Python **27 passed**; backend/frontend typecheck and
backend lint passed; source runtime/frontend/docs production build and genuine
Oracle worker build passed with pnpm 10.20.0 and unchanged lockfile. Native
Internal **6 disposable + 6 persistent** cases, Custom worker **12** cases,
and actual MariaDB/PostgreSQL client imports passed. Runtime release-boundary
inspection as UID/GID 10001 checked **1,578** paths. Additional Custom persistent
checks passed **20** cases, including **20 preflight and 20 import cancellations**.
The final image's real authenticated Required Internal Recovery Test also reached
Passed, with artifact/import validation and all three cleanup gates true.
Windows sandbox-only EPERM on generated caches/test logs was rerun with scoped
local test permissions; it was not fixed by weakening permissions or suppressing
tests. Test fixtures were updated to provide the new measured CPU metadata;
the expected memory refusal and immutable owner/lease invariants were retained.

The resource-matrix scope was then completely removed: all five root journals
were Removed; zero containers, volumes, images, mounts, loop devices or disk
images; both private daemons stopped; exact fixture directory absent; primary
Docker inventory unchanged. Teardown first refused an anonymous volume rather
than assuming ownership. Independent checks proved its private-Docker origin,
creation time, absence of consumers and exclusively empty UID-10001 application
directory skeleton before its exact removal. This cleanup adapter is private test
tooling, not a production app/operator change. Normal systemd audit logs remain;
no global journal vacuum or Docker prune was used.

### Security review and gate status

| Classification | Finding / disposition |
|---|---|
| Blocker — fixed | Missing import-time observations, stale/unknown root capacity, cgroup-root walker boundary, and insufficient preparation/Resume diagnostics now fail closed with regressions. |
| Blocker — fixed | New CPU admission must not silently alter MySQL Custom; it is now Internal-only and tested. |
| Reviewed boundary | `approve-mysql` remains explicit/idempotent and pinned; MySQL-only proof/CA and private IPC never grant Docker, mounts, `/data`, keys, caller endpoints or arbitrary commands. |
| Reviewed boundary | Oracle bootstrap stays offline before guard/grants, locks root before TCP, requires verified TLS and scoped non-admin permissions; native client aliases remain refused. |
| Reviewed boundary | Exact ownership/receipt/SQL digest/snapshot and one-heavy reservation remain mandatory. No retry of uncertain SQL, no global OOM policy, no unrelated process/container control, and no deletion of a validated retained DB from a resource alarm. |
| Reviewed boundary | Runtime release inspection runs as UID/GID 10001 and rejects fixtures, data, credentials, private paths and root host code. Deployment keeps immutable refs, strict overlay ordering and sealed mount contracts; rollback never reinitializes ownership or secrets. |
| Known limitation | Whole-host OOM/disk exhaustion was deliberately not induced. Safe resource rejection, native allocation/ENOSPC classification, operation-only cancellation and retained-data preservation are tested; do not label all theoretical resource failures as physical-host fault injection. |
| Known limitation | Frontend ESLint still fails before linting due to the documented baseline string `extends` incompatibility. No checks were disabled. DOM stability is not a substitute for human visual UAT. |
| Known limitation | Operator service/ancestor cgroup constraints are deliberately conservative admission ceilings, not proof that sibling DB cgroups share the controller's envelope. A narrowly capped controller can refuse despite free physical RAM; review the host contract rather than automatically relaxing isolation/limits. |
| Pending human gate | Fresh MySQL visual UAT, with an explicitly agreed maximum eight-hour SSH-only handoff, followed by exact ownership-verified fixture teardown. |
| Pending timed gate | Separate real one-hour TTL/access-revocation/physical-cleanup test, without clock manipulation. Deterministic TTL tests are not this gate. Keep separate from human Stop/Delete actions. |
| Pending permission | MySQL guest cold boot: request permission before reboot. Prior MariaDB/PostgreSQL approval is not inherited. |

**GO for bounded synthetic 8 GiB UAT; NO-GO for final production acceptance.**
The current 4 GiB production host has not been accessed or certified. A successful
backup is not recovery/import acceptance. SQL larger than the configured 128 MiB
cap remains blocked. Production capacity, reviewed host-operator installation,
immutable deployment/rollback and the pending gates still require review.

For upgrade, install reviewed root code first so it can publish fresh capacity,
then deploy the matching worker/application bundle. An old operator does not
silently approve MySQL under the new guard: missing capacity blocks Internal,
not ordinary backups or Custom. Quiesce work before rollback, preserve `/data`,
`SECRET`, `ENCRYPTION_KEY`, root/private journals, fixed images, anchors and
retained identities; never run `init`, re-enroll, reseal a different contract or
erase unknown resources to make rollback pass. Stop retained targets explicitly
and review engine support before selecting an older bundle.

### Fresh, bounded visual UAT handoff

After the matrix scope was completely removed, a **different** disposable scope
was prepared using the final reviewed application/worker images and four new
real Restic snapshots of independently generated synthetic SQL. This scope is
intentionally still running for the agreed human UAT; it is **not** included in
the earlier zero-resource cleanup claim. At handoff it has only three fixture
containers (application, read-only SFTP, client worker), no database image or
loop device yet, no published container ports, no privileged containers, and no
change to the guest's primary Docker inventory. All four backup plans are paused
and their synthetic source identity is offline; no ordinary backup is scheduled.

The browser proxy binds only the guest loopback address. Access is through an SSH
local forward to the fixed browser origin `http://127.0.0.1:15173`; use that exact
origin, not a LAN address or `localhost` alias. Normal password login, host-only
HttpOnly/SameSite=Lax cookies, authenticated-session checks and same-origin JSON
validation remain enabled. HTTP is inside the SSH tunnel, not a public listener;
`TRUST_PROXY` is not required for this fixture. Login material is independently
generated, kept in a private 0600 handoff file, and not included here or in the
release context. The application does not auto-login the browser.
The actual Windows SSH local-forward path was checked separately: the forwarded
health endpoint and browser application page both returned HTTP 200. That
temporary verification tunnel was then stopped; the human opens their own tunnel
for UAT. Anonymous API requests still return 401.

Actual API preparation was rechecked for all four exact snapshots: lifecycle
available, measured resource metadata present, SQL sizes unchanged from the
matrix above. The intended visual checks are Small: Ready (if current headroom
still admits it); Medium/Large: Warning; Oversized: Blocked with confirmation
disabled. Fresh backend/operator checks can still refuse any allowed preview if
resources change. Check both Internal confirmations, then Active/Inspect,
Stop/Resume/Delete, Required Recovery Testing, stable focus/scroll/progress, and
verified cleanup. Do not enter real source credentials, change existing plans,
or use a Custom/production target to bypass admission.

A fixture-only systemd timer is armed for the agreed maximum eight-hour handoff
(2026-10-17 20:36:14 UTC). Earlier user completion permits earlier teardown. At
the deadline the exact owned browser proxy is closed first, then normal API
cancellation/deletion and the isolated runtime operator reconcile SQL, leases
and infrastructure. Host namespace access is confined to the reviewed fixture
uninstaller for already-verified empty host anchors; the runtime operator keeps
PrivateTmp, ProtectHome and NoNewPrivileges. Unknown resources or unproved native
cleanup are retained for review, never adopted or reported as clean. The final
audit must prove zero scope containers/volumes/images/mounts/loops, private daemons
stopped, exact fixture directory absent and primary Docker inventory unchanged.
OS audit journals remain; do not vacuum unrelated logs.

This is a **UAT-ready handoff, not a completed human acceptance test**. The
separate real one-hour TTL/access-revocation test remains pending and must not be
confused with this fixture's eight-hour availability deadline or interrupted by
human Stop/Delete actions. MySQL cold boot still needs an explicit reboot
approval. No reboot or production acceptance is implied by this handoff.

### Visual UAT feedback: blocked versus checking and immediate activity

The first human MySQL UAT successfully exercised persistent restore, but exposed
two distinct conditions that must not be disguised as a perpetual loader:

- The private rehearsal timer had the systemd default `AccuracySec=1min` despite
  requesting a two-second interval. Root readiness/capacity is intentionally
  valid for only thirty seconds; coalescing could make both stale between ticks.
  The fixture timer now explicitly uses `AccuracySec=1s`, matching the existing
  production timer. The thirty-second security freshness contract is unchanged.
  Authenticated API preparation subsequently reported fresh root capacity and
  the genuine worker Ready. This was fixture scheduling, not insufficient RAM
  or authorization to ignore an unavailable operator.
- A human-created retained MySQL restore was Stopped, not Deleted. The existing
  single-owned-Internal-lifecycle contract still reserves its slot. The API
  correctly reported occupied (`running` readiness), even though no import or
  backup was running. UI wording now distinguishes occupied lifecycle from an
  unavailable operator and explains that Stop retains the slot; Delete is an
  explicit user action followed by verified cleanup. No stopped data was deleted,
  resumed or adopted to unblock the demo. Mandatory admission is not weakened.

Both confirmation dialogs now display a stable, accessible, sticky activity
banner immediately while preparation/refresh or POST submission is in flight.
It is indeterminate, has no fabricated percentage or synthetic completion, and
distinguishes checking from awaiting server acceptance and failure/idle. Blocked
does not animate indefinitely. Restore navigation seeds the detail query with
only the actual accepted server record, avoiding an empty wait for another poll;
it never optimistically labels a database Active. Initial management fetches and
control submissions also show request activity. Existing backend stage progress,
timestamps, focus/scroll, cancellation and five-second polling remain unchanged.
An explicit refused admission now exposes its real reason rather than calling
every refusal operator unavailable; missing admission still fails closed.

Follow-up frontend checks: **150 passed / zero failed**, including deferred-POST
banner visibility, accepted-record cache handoff, stable nodes, checking/sending/
idle/failure, missing admission refusal and occupied-lifecycle diagnostics.
Frontend typecheck, **117 host/security tests**, production source image build
(including frontend/docs/backend) and `git diff --check` passed. Backend runtime
code and lifecycle semantics were not changed by this UI feedback follow-up.
These changes are not automatically injected into a
running human UAT session: finish/delete owned restores and confirm permission
before replacing the fixture application. The original eight-hour deadline is
not extended by a UI rebuild. Human Recovery Testing is not yet marked accepted.
The tester subsequently confirmed that after explicit Delete and completed
cleanup, the Small fixture's Recovery Test could be started. This confirms slot
availability, not yet a claim of a Passed result or final fixture teardown. The
fixture expiry timer now also uses one-second accuracy at the **same original**
deadline, not a new eight-hour window.

## Final acceptance closure audit — final review handoff

Initial gap reconstruction, before privileged acceptance work: branch remains
`codex/mysql-internal-automatic-recovery`; HEAD/main/origin-main are the reviewed
baseline above. The 66-file implementation is intentionally uncommitted, not a
clean working tree. The final activity/occupied-lifecycle UI image was built and
tested locally but was not injected into the earlier human UAT application.
Human Restore and ability to start Recovery Testing were reported; authoritative
Passed/results, action history and root removal still need independent audit.
The old UAT fixture remains present at read-only preflight. New one-hour TTL is
not yet started; MySQL reboot has not been authorized or performed. Prior
successful scopes do not prove cleanup of this remaining scope.

Read-only preflight of the designated synthetic guest confirmed KVM, four CPUs,
7,941 MiB usable RAM, swap unused, over 26 GiB free on its separate ext4 fixture
disk, and the expected Docker Engine. No hypervisor/production/primary Docker
change is permitted. Subsequent evidence below must distinguish implementation,
acceptance and rollout readiness; none is inferred from earlier unit-test totals.

Read-only authoritative UAT audit: **two Required MySQL tests Passed**, each with
artifact/import passed, one validated table, filesystem result present and all
database/workspace/infrastructure cleanup flags true. The retained Small restore
has completed import timestamps and is Deleted/verified. All three corresponding
root journals are Removed, mailbox empty, SQL leases zero, no retained/disposable
ext4 images left, and primary Docker inventory unchanged. The retained journal
has readyOnce but **no consumed Resume revision**: do not claim human Resume was
observed. The running image is the earlier UAT runtime, not the final activity
banner build. Exported sanitized history SHA-256:
`315c5235f4839fc08fab4854fc866cad52348f02b8aa9ae2f726e111c49b3d18`;
root action summary:
`3067b6ad4755add17b4154890d1e349ef77bf9a38c56efca76150077f89467fb`.
These contain only synthetic IDs/statuses/check outcomes, not credentials/proofs.
That UAT scope subsequently completed independent teardown: all owned containers,
volumes, images, mounts, loops and ext4 files absent; private daemons stopped;
exact fixture directory removed; primary Docker inventory unchanged. Both the
application-native cleanup proof and host finalizer succeeded. Normal OS audit
history was preserved. This proof applies to that completed UAT scope, not to
the new TTL observer below.

### Closure regressions on the final activity-banner tree

| Check | Fresh observed result |
| --- | --- |
| Backend Windows | 171 suites; 3389 passed, 4 existing skips, zero failed |
| Backend Linux, Node 24.16.0 / pinned pnpm 10.20.0 | 171 suites; 3386 passed, 7 existing skips, zero failed |
| Complete frontend tests | 150 passed, zero failed |
| Complete host/security/release Node tests | 117 passed, zero failed |
| Python deployment / real Compose policy | 27 passed; boot policy 9 passed |
| Actual POSIX immutable deploy/rollback | 17 passed; exact disposable test resources removed |
| Native MySQL Internal | Both runner modes, 6/6 cases each, unchanged final runtime/worker |
| MySQL Custom worker / retained | 12/12 and 20 cases respectively, including repeated real cancellation |
| Native MariaDB/PostgreSQL automatic | 4/4 retained/disposable engine-mode cases |
| Native Internal safety and restart | All 10 engine/variant cases passed |
| Real Phase 6 SFTP/Restic | Five modes passed: filesystem, MariaDB, PostgreSQL, mixed, mixed with expected SQL-auth failure and verified cleanup |
| Phase 7 real private integration | HTTP/HMAC/SMTP/auth/TLS/outbox/restart regression passed |
| Final runtime clients | UID 10001 native MariaDB/PostgreSQL import/content/cleanup passed; MariaDB alias still refused for Oracle MySQL |
| Linux Agent | 120 passed, zero skipped/failed; no Agent source changes |
| Compiled HTTPS/LAN origin/session checks | Passed with trust proxy disabled; malformed/cross-origin/forged-host requests still refused |
| Runtime release boundary | UID/GID 10001; 1578 paths checked; no host operator, test fixture or local state shipped |
| Typechecks / backend lint / production builds | Passed; final app and genuine pinned worker built locally, not published |
| Frontend lint | Existing ESLint configuration/string-extends baseline failure, not disabled |

The Linux backend also passed with the actual serial CI command (`--runInBand`),
in a bounded 5 GiB no-swap container. An additional bounded run used two workers
and a test-command-only 512 MiB worker-recycling threshold; both produced the
same 3386 passes and 7 skips. Production and repository Jest policy were not
modified. Earlier harness attempts are
retained as failed evidence: absent test/operator inputs, a too-small staging
tmpfs and missing writable test data path, PID exhaustion, and a worker SIGKILL
whose cause was not established. Correcting those fixture inputs/capacities
preserved all assertions. One stale Agent fixture omitted the distro-versioned
PostgreSQL path; rebuilding the existing fixture Dockerfile yielded all 120
passes. The deploy driver initially lacked a writable private CLI cache; the
successful run used ephemeral cache only. None of these is a production fix or
proof of production OOM behavior. GitHub-hosted required checks remain pending:
no push, PR, publication or production deployment is authorized.

### Live natural TTL and conditionally approved boot

A new independent synthetic Small restore was accepted at
**2026-10-17 17:01:50.595 UTC**, with authoritative expiry
**2026-10-17 18:01:50.595 UTC**: exactly 3600 seconds, not a shortened test policy.
It reached Active; verified-identity TLS checked 512 rows and payload lengths;
Inspect returned one table; SQL was 529353 bytes and the ext4 image 2147483648
bytes. The observer uses actual wall and monotonic clocks, does not Stop/Delete
before expiry, and requires normal expiry authorization refusal and verified
native/root cleanup before recording PASS. It completed the real hour: Inspect
and Resume each returned 409 while the authenticated session remained valid and
inspection data was withheld. Observed expiry latency was 14 ms and monotonic
observation 3603399 ms. Native cleanup and exact root Removed were observed
20068 ms after expiry, with the database container, loop and ext4 image absent.
No Stop/Delete or clock change preceded natural expiry. Closed evidence SHA-256:
`21bdeaaedfbffd7e6af409fa1c4404042ba638c840055ba4274a162eac053957`.

The complete TTL scope was independently torn down afterward: zero containers,
volumes, images, mounts, loops and disk images, private daemons stopped, exact
directory absent and primary Docker inventory unchanged. A private historical
finalizer assumed two workload journals and initially refused this one-operation
scope; its original assertion was not weakened. A separate exact-single-ID proof
was added, together with a bounded GET-health wait for app restart. No uncertain
SQL was retried or physical cleanup guard skipped. Final removal was verified
before beginning any active boot fixture or reboot.

The first observer launch raced application startup and failed before any
operation existed; independent SQLite/root checks proved zero restores,
lifecycle requests and journals before the reviewed launch. No uncertain import
was retried. Its failure evidence is preserved separately.

The user explicitly approved **one disposable guest reboot only after the TTL
and its exact scope cleanup pass**. Both conditions passed before the actual
guest reboot at **2026-10-17 18:44 UTC**. No second reboot, hypervisor access or
primary Docker configuration change was performed. A separate synthetic boot
scope used the existing persistent systemd anchor renderer, private-daemon
dependencies, PrivateTmp/ProtectHome/NoNewPrivileges, and fixed application/worker
starts. Root-owned unit files and their hashes were checked before boot.

Actual post-boot ordering passed: persistent anchors before private Docker,
initial root reconciliation before application startup. The boot ID changed;
the retained database remained Stopped, with identical container ID, ext4 image
identity/inode, snapshot, binding, installation, protected operator/bootstrap
code, application environment hash, request hash and consumed Resume revision.
Normal authenticated explicit Resume, Inspect, Stop, Resume and Inspect then
passed. Verified-identity TLS checked the original 512 rows/payload lengths;
bootstrap root remained locked. No automatic Resume or SQL reimport occurred.
Final normal API Delete reached Deleted/verified and both exact root journals
became Removed. The controller initially treated the intermediate
Cleanup Required/infrastructure-pending state as fatal; later **read-only**
reconciliation verified the normal terminal result. No import or destructive
request was retried to obtain that evidence.

**Cold-boot acceptance limitation:** the strict aggregate checkpoint for the
primary Docker inventory/configuration changed across the reboot. Every other
checkpoint field matched. Current primary inventory has zero containers,
images and volumes and only the three default networks. The original checkpoint
stored an aggregate hash, not component baselines, so the cause of that change
cannot be established from the available evidence. Default-network regeneration
is only a hypothesis, not a proven explanation. The original strict comparison
remains failed. A separate functional-only verifier explicitly records
`passed: false` and `primaryInventoryCheckpointVerified: false`; it does not
convert this incomplete host-boundary proof into full acceptance. Resolving that
gate needs a reviewed granular baseline and separately authorized future boot,
not a second reboot under the existing permission.

Sanitized boot evidence SHA-256:
`10a23e1321b8c7c15310e1280f78da7a20e499afeb662bd7e96136f49a33203c`;
terminal functional-result SHA-256:
`cd6414355d015e4c31015f0fada8a6de928258de6d5aab99b5f531273f9c7fe7`.
The latter was observed at **2026-10-17 19:05:32.247 UTC** and deliberately does
not claim the full boot gate passed.

An earlier additional direct-process-stop rehearsal interrupted a periodic
native readiness check. It conservatively produced Cleanup Required, preserved
the validated data and consumed Resume revision, and was deleted through normal
owner-verified cleanup. The actual guest-boot case was a different new operation
created only after that deletion was verified, not an uncertain import retry.
This fault observation is retained separately from the ordered-boot evidence.

### Final fixture teardown

All three closure scopes (earlier human UAT, natural TTL, and cold boot) are now
removed. The final boot scope independently proved zero native SQL/import
leases and nonterminal lifecycle records, both exact root journals Removed,
mailbox empty, then zero owned containers, volumes, images, mounts, loop devices
and ext4 image files. The reviewed finalizer stopped the exact private daemons,
verified the directory allowlist and removed only that scope. Independent
post-removal inspection confirmed directory absence, no matching mounts/loops,
no running scope services/timers/processes, and no persistent scope unit files.
Normal systemd audit history, including failed controller attempts, was kept;
only the exact finished transient failed-unit states were released.

The finalizer's `mainDockerInventoryUnchanged` check compares container
inventory only. It passed and must **not** be mistaken for resolving the separate
full primary inventory/configuration hash discrepancy documented above.

Private cleanup harness refusals are also retained: ProtectHome creates a
private namespace and therefore correctly refused a host-anchor uninstaller;
the separate one-off host cleanup ran in the approved host namespace with
NoNewPrivileges. Application/worker and runtime operator isolation were not
changed. After verified unit-file removal, systemd no longer exposed ExecStart
for the still-running private daemons. The finalizer required the recorded
uninstall proof **and** exact root PID, executable, complete config-only argv
and owning systemd cgroup before stopping those daemons. No arbitrary process
termination or unknown-resource adoption was added to the product. These tools
and all test state remain excluded from Git and release images.

### Closure status ledger (live; do not read pending rows as success)

| Gate | Status | Evidence | Blocker |
| --- | --- | --- | --- |
| Human Persistent Restore UAT | BLOCKED | Human Chrome sign-off now confirms Stop/Resume/Inspect/Delete; final API Deleted/verified and matching physical container/storage events exported | Consumed Resume revision absent in final journal; separate before/after Inspect records not retained; historical target-binding-mismatch requires review |
| Human Required Recovery Test UAT | PASS | Two exact-snapshot Required tests Passed, SQL/artifact/filesystem and all cleanup flags verified | None for the observed build |
| Final UI UAT build verification | PASS | Reviewed immutable final app/worker identified at runtime; explicit human Chrome visual sign-off for the reported restore/admission/occupied-slot flows; exact-snapshot Recovery Test Passed | No additional UAT screenshots or automated visual evidence; sign-off scope and limits recorded below |
| Previous UAT fixture cleanup | PASS | Application/root proof plus exact host teardown and directory absence | None |
| Real one-hour TTL expiry | PASS | Actual 3600-second wall-clock expiry and monotonic observation | None |
| Expired access revocation | PASS | Inspect/Resume 409, authenticated session valid, inspection withheld; expired-worker/capability/lease regressions reviewed | No direct arbitrary worker-query RPC introduced |
| TTL physical cleanup | PASS | Native/root Removed after 20068 ms; exact complete scope teardown afterward | None |
| Real approved MySQL cold boot | BLOCKED | One actual approved guest boot; functional checks passed, original strict checkpoint failure preserved | Primary Docker aggregate checkpoint differs; no granular pre-boot baseline to resolve cause |
| Boot ordering and identity preservation | PASS | Actual anchors → private Docker → reconciliation → application order; exact retained database/storage/snapshot/installation/code identity unchanged | Full primary-host inventory proof is separately blocked above |
| Explicit Resume / no automatic reimport | PASS | Stopped after real boot and quiescence; two normal explicit Resume/content checks; original creation/import timestamps unchanged | None for observed functional behavior |
| Post-boot Delete and cleanup | PASS | Normal Delete → Deleted/verified, both exact root journals Removed; no SQL reimport/retry | Full fixture teardown independently recorded below |
| Backend/frontend/host regression tests | PASS | Fresh counts above; typechecks/backend lint pass | Known frontend lint baseline separately disclosed |
| MariaDB/PostgreSQL/Custom compatibility | PASS | Native automatic, Internal safety, Custom worker/retained, Phase 5/6/7 and Agent tests pass | No production claim |
| Linux CI and production-image tests | BLOCKED | Local Linux tests/builds, compiled sessions and 1578-path runtime gate pass | GitHub-hosted required jobs pending; no push/PR authorized |
| Security and immutable contract review | PASS | Root approval, MySQL-only proofs, owner/snapshot/digest/TLS/expiry, scoped grants, resource guards, Compose merge/rollback and release boundaries reviewed/tested | Independent human source approval remains separate |
| Final independent fixture teardown | PASS | Earlier three scopes and fresh manual UAT scope removed; owned resources, private daemons/timers/mounts/loops absent; fresh non-reboot primary component comparison matched | Historical full primary cold-boot checkpoint discrepancy remains separately blocked, not hidden by cleanup |
| Source review/PR approval | BLOCKED | Entire current public diff inventoried; no sensitive additions found | Independent reviewer approval and PR not authorized/completed |
| Deployment readiness and rollback | BLOCKED | Drain-first rollback procedure and real isolated deploy/rollback passed | No production capacity, host activation or published artifact approval |

Earlier automated browser access was blocked by the origin permission gate.
No alternate surface or indirect browser automation was used. The later,
explicitly authorized **human-operated Chrome** run is recorded below; it is
human visual sign-off on the final build, not automated browser evidence. The
loopback proxy/tunnel stopped and temporary synthetic login copies were removed;
no credential value is included here.

**A — Implementation:** the previously passing suites remain recorded above;
the fresh manual UAT additionally retained a historical `target-binding-mismatch`
and lacks consumed Resume evidence. Their historical cause remains unestablished;
no source fix or operation replay was authorized during that closure audit.
The separately authorized RC-01 source correction is recorded below and does
not establish that historical cause. **B — Acceptance:** incomplete
while the mandatory boot host-boundary proof, independent persistent-Resume
evidence, hosted CI and independent approval rows above remain blocked.
**C — Production rollout:** NO-GO pending independent review, hosted CI,
immutable artifact/host activation review and measured production headroom.
Success on the disposable eight-GiB guest does not certify a four-GiB server.
Do not declare Phase 6 acceptance complete from these intermediate results.

### Human manual final-build UAT closure — 2026-10-18

The user explicitly switched to ordinary Windows Google Chrome after the Work
browser repeatedly refused the origin. The agent did **not** automate Chrome or
use an alternate route to browser content. The user subsequently confirmed Small
Internal Restore Active, matching Inspect, Oversized refusal with confirmation
disabled, Recovery Testing refusal while the Internal slot was occupied, their
own Stop -> Stopped -> Resume -> Active actions, a normal second Inspect, and
their own Delete with verified cleanup. They signed off the visible UI as normal.
This is a human report; exact human click timestamps were not independently
recorded. Existing screenshots document configuration and fixture readiness,
not the completed restore/Inspect/Resume screens. No additional visual capture,
automated UI test, or separately captured transient Checking/Warning/banner frame
is claimed. The final UI row accepts this reported manual visual scope.

No new fixture, import, Restore, Stop, Resume, or recovery test was submitted by
the agent during this audit. The existing disposable scope used the final builds:

| Artifact | Verified OCI index | Linux amd64 config used by the private Docker daemon |
| --- | --- | --- |
| App | `sha256:c59e46bcf3639ca0e46a424df20f247bccec8e4da03c67ea7e9ef12d6cce887c` | `sha256:e407fdcf6d207b18139e84f450c4ce646ef410dc83d27b7ecfd9c2057dba82d2` |
| Worker | `sha256:9a220ccf08b29cb627275207890841b8f02b52a476a9ce81ce47729426e5b4c4` | `sha256:18dac51ab1681e201ebdcf9ded406d5884c66d1dc08b8c80ff1f520f432f8705` |

The fresh export's complete index -> amd64 manifest -> config/layer chain was
hash-verified before use; these different digest types are not different builds.
Both running processes were UID/GID 10001, read-only root, without published
ports. Four synthetic snapshots existed; only Small was imported.

Authenticated API, read-only SQLite, root receipts, and private-daemon events
independently established the following synthetic binding:

- Restore `3898af862ab444dd3729a24b`; exact snapshot
  `6117059f5ea7dbb971def0f24c7d0af9775fee32b0d543e20e9e09b4ea71ed67`;
  stable database ID `db_example`, database `fixture_mysql_small`, SQL 529353 bytes,
  SHA-256 `3e128cd62d66fab1a721a6a14e66858f8e9cb4a5dccf5e2c09d81b8211f6781a`.
- Created **05:08:58.617 WIB**, import started **05:09:16.757**, import completed
  **05:09:26.486**, final Deleted/verified reconciliation **05:11:01.708**.
  The final API retained historical `errorCode=target-binding-mismatch` with no
  final failureCode. Its cause and timing are not established or hidden.
- The bounded Docker event history retained Stop **05:10:36.526**, Start
  **05:10:48.948**, final Stop **05:10:57.545**, and Destroy **05:10:57.602**.
  All share the exact container
  `7fea77ffb39a35037f29f22fdefa2a97dd7985138fc8f86977b40f36df86b7cf`,
  storage `e3379940-c44d-48c2-8178-8ff53a5931f4`, activation and binding hash.
  The final root removed-state proof matches these identities and the snapshot.
  These are physical events, not an authenticated API action-history transcript;
  the Start event alone cannot distinguish explicit Resume from cleanup recovery.
- **Persistent Resume remains BLOCKED:** the final bound root journal has
  `readyOnce=true`, sequence 24, but no `resumeRevision`. No separate action audit
  or pre/post Inspect transcript was retained. Delete deliberately clears stored
  inspection; both comparison snapshots cannot be reconstructed afterward. Human
  confirmation is preserved, but it does not create the missing consumed revision
  or independent Inspect evidence. No operation was repeated to manufacture it.
- Human-run Required Recovery Test `d19c4cbb799f7c2b698f0056` Passed on the same
  snapshot and artifact, **05:11:26–05:11:56 WIB**: artifact/import passed, one
  table and one view, filesystem result present, and database/workspace/
  infrastructure cleanup all true. This is additional evidence for the already
  passing Recovery Test gate, not a replacement for persistent Resume evidence.
- Both exact root journals/receipts were Removed (sequences 24 and 7), all three
  native SQL lease tables empty, mailbox empty, and both target containers absent.
  Native cleanup is attested by the normal application's verified cleanup path
  and exact root physical removal; no query was run against a deleted target.

Early teardown was requested at **05:19:28 WIB**, through the existing narrow
fixture cleanup mailbox after these terminal checks. The normal authenticated
cleanup/operator/finalizer path completed; independent inspection at
**05:20:04 WIB** found the exact scope directory and both private sockets absent,
zero matching services/timers/unit files/processes/mounts/loops, and guest
loopback port closed. The fresh non-reboot comparison matched every primary
Docker inventory/configuration/unit component. This does **not** resolve or
reclassify the earlier cold-boot aggregate hash discrepancy. The exact owned
Windows forward was stopped separately. Temporary local credentials and fixture
inputs were removed; sanitized audit artifacts remain excluded from Git.

Private sanitized evidence SHA-256:

| Evidence | SHA-256 |
| --- | --- |
| Final SQLite/root operation proof | `cbdbd32f5accf3e1a8ff56e5ede0305e99a41b1ea1d7faa3c77d04c1c6362904` |
| Authenticated API, root receipts and Docker events | `9167c7f7fbdad1b1cf551885b96aa9ae3aee9524b3ec8d2a0fd6facca3d7546c` |
| Independent host post-cleanup proof | `36f8e95e144ac7b30553f7de8e8fa2981c6fc85c8d31f6e9cc583fae1574f4e1` |
| Recorded human sign-off and visual-evidence limits | `088ffacd46fb4f45d32166269b844f71a45ec1383cb5ede91f86a1634180b51a` |

The Docker discrepancy, hosted CI, independent review and production-readiness
statuses remain unchanged. No TTL hour, boot, workload matrix or full regression
suite was repeated. No application source, main Docker configuration, production
resource, commit, push or deployment was changed.

## RC-01 — durable explicit Resume correction — 2026-10-18

The user separately approved source, additive migration, regression tests and
related documentation only. No new UAT fixture, VM/server access, Docker action,
sudo, reboot, physical crash, image build, commit, push, PR or deployment was
performed for this correction. The historical mismatch, missing consumed revision,
strict cold-boot failure and their retained evidence remain unchanged.

The confirmed source-level defect was distinct from that historical anomaly:
reconstructing a lost mailbox changed inode/ctime and could renew an already
consumed Resume. The original actual-code memory model recorded one explicit
action and two modeled Starts. Its pre-fix output/source hashes remain preserved
privately. The same fault scenario, with the harness adapter updated for the
additive column and directory fsync, now records **one explicit Resume, one
automatic reconstruction, one modeled Start, unexpectedAutomaticRestart=false**.
Permanent application/root regressions exercise MariaDB, PostgreSQL and MySQL.
This is deterministic code evidence, not a physical power-loss observation.

### Durable authority and publication

Migration **0016** adds `resume_sequence INTEGER NOT NULL DEFAULT 0`, bounded to
safe nonnegative integers, plus a trigger prohibiting decrease. Applied0015 is
unchanged. Legacy0 means no new-protocol explicit Resume; it is not evidence of
historical consumption. Owner/binding/identity, encrypted approvals, native leases,
existing data and original indexes/triggers are preserved by upgrade tests.

Only an authenticated explicit Resume can increment the counter, inside the
same immediate SQLite transaction that records its action. That connection is
set to synchronous FULL before allocation: WAL's NORMAL default is insufficient
to promise a durable per-action counter. This can increase write latency; it
does not change a global host configuration. Polling, reconstruction, Stop,
Inspect, provision and Delete do not increment it. Queued publication rechecks
both current action and sequence, so a newer Resume or Delete supersedes it.
The public API still accepts an empty action body, never a caller sequence.

| Root request | Behavior |
| --- | --- |
| v1 provision/inspect/stop/delete | Existing bounded ownership and cleanup contract retained |
| v1 Resume without sequence | Observe exact Ready/Stopped only; never Start, never fabricate consumption |
| v2 Resume with positive safe integer | Root checks immutable ownership/TTL/budgets; durably consumes a strictly newer sequence before Start |
| Equal/older sequence or reconstructed inode | No Start; maximum consumed authority cannot decrease |
| Malformed sequence or corrupted consumed state | Fail closed; no counter reset or ownership adoption |

Root stores `consumedResumeSequence` in its protected journal before Start and
retains it across Stop/Delete/Removed. Its writer fsyncs both file and parent.
The inode-based `resumeRevision` remains supplementary evidence. Consumption
also occurs if the exact target is already running; that request cannot later
become a restart policy. An older Provision cannot restart a never-ready target
after any Resume was consumed. Native cleanup during authorized Delete remains
an explicit separate exception: exact stopped targets may start only to finish
owner-checked SQL cleanup before physical removal.

Application publication fsyncs the temporary file, atomically renames it and
fsyncs its no-follow directory descriptor. Failure is returned conservatively;
the durable sequence is retained, never reset or automatically incremented.
Replay of identical already-visible bytes retries directory fsync. An uncertain
publication can already be visible to root, so an error is not proof of zero
execution: refresh authoritative state instead of assuming success or retrying
SQL. Root consumption still bounds that explicit intent to one Start.

### Crash gap and safe recovery

A crash **after durable consumption but before Start** deliberately burns the
intent. It may produce zero Starts. Reconciliation preserves the sequence and
the stopped target; it cannot manufacture sequence+1 or retry uncertain SQL.
After exact ownership, fresh host state and a completed retained import's validated
lease are verified, the API can recover host-only uncertainty to **Stopped**.
It rechecks cancellation and expiry after asynchronous verification. It does
not import, Start or delete anything during that status recovery.

The human then refreshes status, verifies the exact retained target and current
resource admission, and submits a **new authenticated explicit Resume**. That
allocates the next durable sequence. Missing/foreign/unvalidated leases, stale
or inconsistent host state, changed approval, expiry or concurrent Delete keep
the operation fail-closed for operator investigation. Do not reset counters,
remove journals/mailboxes, rotate identity or use Provision to escape this state.

### Deployment and rollback compatibility

Matching RC-01 root operator and application code plus migration0016 are needed
for usable Resume. New application/old root rejects v2 requests; old application/
new root cannot start via v1 Resume. Mixed versions fail closed and are not an
accepted deployment. Root receipts and the worker SQL RPC remain unchanged.
The evidence collector now requires matching requested/consumed sequences for
future Resume/boot proofs, in addition to existing container/storage/binding
and diagnostic revision checks. It was syntax/unit checked, not run on a VM.

Drain or obtain an approved ownership-preserving handoff before host/app rollback.
Keep cleanup-capable code active while native leases/targets drain. Do not drop
0016, rewrite0015, restore older SQLite over newer counters or downgrade root to
inode-only Resume while any retained resource can remain. Old non-Resume SQL
updates leave the additive counter intact; that alone is not rollback approval.
Previous image digests and human UI evidence certify their original build only.
The corrected source still needs new immutable artifacts, hosted CI and review.

### Correction validation and acceptance limits

Focused API/lifecycle/migration tests, dependent backend/worker/native-ownership
tests and root/security tests were run locally without Docker or physical
workloads. Exact observed results and post-fix source hashes are retained under
ignored project tmp. Backend typecheck and the changed backend source lint pass.
Tests cover missing/replaced mailboxes, older sequences, consumed-before-Start
crash models, already-running targets, legacy drain, concurrent Delete, strict
caller-input rejection, migration preservation and file/directory fsync failure.

| RC-01 local check | Observed result |
| --- | --- |
| Focused API/lifecycle/Resume/migration | 4 suites, 47 passed, 0 failed/skipped |
| Dependent services/importers/stores/guards and Agent/Legacy/Phase7 migration compatibility | 14 suites, 264 passed, 0 failed/skipped |
| Root/requests/namespace/publication/boot/visual-source/MySQL/persistent security | 65 passed, 0 failed/skipped; deterministic tests only |
| Original fault scenario, updated harness adapter | 1 explicit Resume, 1 modeled Start after mailbox reconstruction |
| Backend typecheck / changed backend source lint / formatting / patch whitespace | Passed |
| Physical crash, fresh native workload/UAT/boot, fixed immutable images and hosted CI | Not performed under this source-only permission |

Initial test attempts are not hidden: sandbox loopback EACCES was resolved using
approved unit-test execution; a new SQL assertion incorrectly matched the DDL
guard's BEFORE UPDATE and was corrected to reject data-rewrite statements;
old Internal service mocks incorrectly reported Custom's external state and now
provide actual Active/Stopped states. Original behavioral assertions remain.
One dependent-test invocation named a nonexistent target-test file; the final
run uses the actual importer/store/authority suites. No failed check is called PASS.

**RC-01 source/regression correction is ready for review, not release approval.**
No existing BLOCKED row above is promoted. Human Persistent Restore evidence,
the strict Docker cold-boot checkpoint, hosted CI, independent reviewer approval,
final artifacts and production readiness remain unresolved. Production has only
a reported4 GiB physical capacity; it was not measured here. No real TTL hour,
reboot, physical crash or full physical regression was repeated.

## Complete changed-file inventory

73 intended files after RC-01; private rehearsal tools, archives, evidence and generated
state are excluded. Existing migration 0015, Agent files, package manifests,
lockfile, worker Dockerfile and MariaDB/PostgreSQL boot units are unchanged.

```text
.dockerignore
.github/workflows/container.yml
backend/__tests__/db/AutomaticRecoveryResumeMigration.test.ts
backend/__tests__/integration/automaticRecoveryApi.seed.mjs
backend/__tests__/integration/mysqlAutomaticRecovery.observe.mjs
backend/__tests__/integration/mysqlAutomaticRecovery.prepare.mjs
backend/__tests__/integration/mysqlAutomaticRecovery.smoke.mjs
backend/__tests__/integration/persistentRestore.smoke.ts
backend/__tests__/routes/databaseRestores.test.ts
backend/__tests__/routes/recoveryTests.test.ts
backend/__tests__/services/DatabaseRestoreService.test.ts
backend/__tests__/services/RecoveryTestService.test.ts
backend/__tests__/utils/automaticRecoveryLifecycle.test.ts
backend/__tests__/utils/automaticRecoveryResume.test.ts
backend/__tests__/utils/internalRecoveryTargets.test.ts
backend/__tests__/utils/mysqlInternalRecovery.test.ts
backend/__tests__/utils/mysqlRecoveryWorker.test.ts
backend/__tests__/utils/recoveryPreparation.test.ts
backend/__tests__/utils/recoveryProcess.test.ts
backend/__tests__/utils/recoveryResourceGuard.test.ts
backend/drizzle/0016_automatic_recovery_resume_intent.sql
backend/drizzle/meta/_journal.json
backend/src/mysql-worker/index.ts
backend/src/mysql-worker/internal.ts
backend/src/mysql-worker/persistent.ts
backend/src/mysql-worker/protocol.ts
backend/src/mysql-worker/server.ts
backend/src/services/DatabaseRestoreService.ts
backend/src/services/RecoveryTestService.ts
backend/src/types/recoveryTests.ts
backend/src/utils/automaticRecoveryLifecycle.ts
backend/src/utils/internalRecoveryImporter.ts
backend/src/utils/internalRecoveryTargets.ts
backend/src/utils/mysqlPersistentDatabaseImporter.ts
backend/src/utils/mysqlRecoveryWorkerClient.ts
backend/src/utils/persistentRestorePolicy.ts
backend/src/utils/persistentRestoreTargets.ts
backend/src/utils/recoveryPreparation.ts
backend/src/utils/recoveryProcess.ts
backend/src/utils/recoveryResourceGuard.ts
backend/src/utils/recoveryTestPolicy.ts
deploy/automatic-recovery/operator.cjs
deploy/compose-tools.py
deploy/compose.mysql-internal-recovery.yml
deploy/persistent-restore/bootstrap.sh
deploy/persistent-restore/mysql-lock.py
deploy/persistent-restore/operator.cjs
frontend/__tests__/databaseRestores.test.ts
frontend/__tests__/internalResourceSafety.test.ts
frontend/__tests__/recoveryConfirmation.test.ts
frontend/__tests__/recoveryProgress.test.ts
frontend/__tests__/recoveryTargetModes.test.ts
frontend/src/@types/recoveryTests.ts
frontend/src/components/common/InternalResourceWarning.module.scss
frontend/src/components/common/InternalResourceWarning.tsx
frontend/src/components/common/OperationProgress/OperationProgress.module.scss
frontend/src/components/common/OperationProgress/OperationProgress.tsx
frontend/src/components/Plan/RecoveryTesting/RecoveryConfirmation.tsx
frontend/src/components/Plan/RecoveryTesting/RecoverySettings.tsx
frontend/src/components/Restore/DatabaseRestore/DatabaseRestoreWizard.tsx
frontend/src/utils/databaseRestores.ts
frontend/src/utils/internalResourceSafety.ts
frontend/src/utils/recoveryConfirmation.ts
frontend/src/utils/recoveryTargetModes.ts
frontend/src/routes/DatabaseRestores/DatabaseRestores.tsx
scripts/__tests__/automaticRecoveryLifecycle.test.cjs
scripts/__tests__/deployment_policy_test.py
scripts/__tests__/mysqlAutomaticRecovery.test.cjs
scripts/automatic-recovery-vm-api.cjs
scripts/automatic-recovery-vm-acceptance.cjs
scripts/validate-mysql-automatic-recovery.ps1
docs/MYSQL_INTERNAL_AUTOMATIC_RECOVERY.md
docs/AUTOMATIC_RECOVERY_CONTAINER_LIFECYCLE.md
```
