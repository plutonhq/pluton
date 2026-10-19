# Persistent Database Restore — implementation and acceptance report

This patch delivers the prioritized MariaDB/PostgreSQL retained workflow, not a
new development phase. It is **not full closure of the requested engine matrix**:
Oracle MySQL persistent restore is still unavailable, and the actual Linux-host
Docker operator lifecycle needs an operator rehearsal before production use.
Native imports and kernel-enforced persistent-storage tests are distinguished
from that remaining infrastructure acceptance below.

No commit, push, merge, release, deployment, production connection, secret
rotation, repository maintenance, agent re-enrollment, or backup cutover was
performed. Infrastructure names in this document are synthetic.

## 1. Baseline and branch

- Baseline: `b2b135c6a4d8a1d149fca874b7ba2b66b7b02a9a`, reviewed `origin/main`,
  including merged PR #29 and its CI readiness fixes.
- Working branch: `codex/persistent-database-restore`. HEAD remains the baseline;
  changes are uncommitted.
- Existing migration `0011_internal_recovery_sessions.sql` is unchanged.

Audit finding: the previous Restore Database action intentionally rendered an
unavailable confirmation. Disposable Phase 6 targets use tmpfs, a recovery-only
guard, test leases and mandatory immediate cleanup. Omitting that cleanup would
not establish safe retained ownership, storage, expiry or inspection.

## 2. Implemented versus unavailable engines

| Engine       | Internal retained restore              | Custom retained restore                              | Evidence / limitation                                              |
| ------------ | -------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------ |
| MariaDB      | Implemented, manual operator lifecycle | Implemented, independently approved dedicated target | Native 11.8.8 imports and retained ownership/storage tests         |
| PostgreSQL   | Implemented, manual operator lifecycle | Implemented, independently approved dedicated target | Native 18.6 plain-SQL imports and retained ownership/storage tests |
| Oracle MySQL | Unavailable                            | Not implemented in this patch                        | Existing worker v1 is disposable-test-specific; see section 8      |

Plain SQL only. No `pg_dump` archive/`pg_restore` workflow, engine conversion,
application semantic-recovery guarantee, arbitrary SQL console, or direct
source-database restore is introduced.

## 3. Persistent ownership model

Additive migration `0012_persistent_database_restores.sql` creates:

- `persistent_database_restores`: administrator owner, distinct purpose, immutable
  plan/repository/backup/full-snapshot/stable-database binding, recorded artifact
  identity/engine/name/bytes/SHA-256, metadata fingerprint, target registration,
  restore owner token, encrypted immutable approval, actual database name,
  timestamps, retention, status, cleanup, safe error and inspection metadata.
- `persistent_restore_import_leases`: intended/created/validated ownership
  journal committed before native CREATE. Its token is distinct from Phase 6.

Container/storage identity and activation are durably retained inside the
encrypted approval and the root operator's independent metadata. Approvals use
the existing persisted SECRET; no keys are generated or rotated by this feature.
Tokens and credentials never enter the public DTO.

Approval fingerprints use recursive code-point key ordering, so root/server JSON
property order cannot break an otherwise identical activation.
Binding updates and premature history deletion are blocked by SQLite triggers.
There is no plan/backup cascade that could erase retained ownership. One target
has one non-deleted restore reservation; at most eight retained operations are
admitted. Listing prioritizes these operations before the last 200 history rows.

Persistent and disposable executors check each other in the same SQLite claim
transaction. The partial unique executor index also prevents two retained
imports/deletions. Interrupted imports are reconciled for cleanup, not replayed
as new SQL imports. Active restores remain active across application restart.

## 4. Persistent storage quota

Internal storage is a dedicated **fully preallocated, fixed-size ext4 image**,
normally 2 GiB, never the Phase 6 tmpfs and never an unbounded DB named volume.

- Root-only image directory: `/var/lib/pluton-persistent-restores/images`, 0700.
- Read-only application observation tree: `/var/lib/pluton-persistent-restores/view`.
- Each image is exclusive-created 0600, physically allocated with `fallocate`,
  formatted only when new, and mounted `nodev,nosuid,noexec`.
- Formatting uses `nodiscard` and eager metadata initialization, preserving the
  preallocation rather than silently punching holes.
- A root-owned immutable anchor, filesystem UUID, image device/inode/size,
  allocated blocks, loop backing file and actual ext4 capacity are checked.
  UUID verification probes the device rather than assuming a udev cache exists.
- The mount root/anchor are readable for validation; the database data directory
  is 0700, owned by native UID/GID 999. The app cannot read database files.
- Resume mounts the existing exact image. It never formats, enlarges, adopts or
  replaces an existing image. Unknown resources are retained.

Application mount propagation is read-only `rslave` from the operator's explicitly
shared view subtree; the operator does not change propagation on host root.
The manual Linux rehearsal must verify the Docker host's actual propagation.

Native tests filled a real 512-MiB filesystem until **ENOSPC**, verified existing
data after remount, rejected foreign anchors/inodes, and exercised idempotent
removal after an interrupted unmount/rmdir boundary. Four retained database cases
use separately bounded 2-GiB storage.

Custom storage is an **external operator-attested quota contract**. Registration
does not create or enforce a remote filesystem quota. The operator must first
establish and verify a dedicated persistent filesystem/container/storage quota.
A numeric JSON field alone is not evidence that external storage is bounded.

## 5. Actual operator lifecycle

The fixed root tooling is `deploy/persistent-restore/operator.cjs` plus
`storage.cjs` and `bootstrap.sh`. It has no listener, generic RPC, shell command
field or arbitrary path/argv facility. Pluton and its workers receive no Docker
socket, privileged mode or mount capability.

Manual commands:

| Command                                              | Actual effect                                                                                                      |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `init`                                               | Prepare/check root installation, private request/public approval trees, shared view and private network            |
| `provision <restore-id>`                             | Review bounded application request; create exact quota, TLS target and root approval; await native guard readiness |
| `status <restore-id>`                                | Verify exact storage/container profile and record ready/stopped observation                                        |
| `stop <restore-id>`                                  | Stop only the exact owned container; do not delete data                                                            |
| `resume <restore-id>`                                | Revalidate resources/ownership and native TLS guard; preserve database/identity                                    |
| `resume-cleanup <restore-id>`                        | Resume an expired/stopped target only for a pending deletion request                                               |
| `delete <restore-id>`                                | Require verified database cleanup, then remove exact container/storage and publish physical receipt                |
| `prepare-custom <target-id>`                         | Write a fixed bootstrap contract to a private 0600 SQL file; no SQL/credential stdout                              |
| `approve-custom <target-id>`                         | Publish an explicitly reviewed independent Custom target/CA                                                        |
| `set-policy <max-sql-bytes> <max-retention-seconds>` | Explicit root approval for future requests; never mutate existing restores/credentials                             |

Root `flock` serializes lifecycle actions, including absence receipts and
provisioning. The container ID, fixed image, UID, capabilities, ports, network,
resources, entrypoint and four permitted mounts are checked before mutation.
A durable delete intent permits recovery after container removal or partial
filesystem removal. Exact obsolete credential files are erased only after
verified physical deletion; non-secret ownership audit is retained.

Cancellation before provisioning is not inferred from a missing approval. Only
an explicit root inventory check can publish a never-provisioned absence receipt.
Partial/ambiguous provisioning remains Cleanup Required for investigation.

The UI buttons only write requests. They do not start/stop Docker, and do not
claim that an operator action has completed.

## 6. Internal restore implementation

The server verifies completed backup identity and exact snapshot metadata, selects
one stable database ID, checks resources, and records Provisioning Required.
After operator approval, execution revalidates binding/admission, stages **only
the selected SQL**, verifies actual size/full SHA-256, rechecks workload/target,
and uses the native restricted client.

The target must report `pluton_restore_guard.contract` with the new purpose
`pluton-persistent-database-restore-v1`, exact activation and storage identity.
The target catalog must be dedicated. CREATE refuses an existing database.
A separate `__pluton_persistent_owner` marker binds restore ID, full snapshot,
artifact hash, purpose and durable random token.

MariaDB keeps the approved archived logical name. PostgreSQL uses
`pdr_<restore-id>`, never a source database name for destructive cleanup.
Successful import validates ownership/catalog and leaves the lease/database
intact. Workspace and client credential files are removed independently.

Pinned operator target images:

- `mariadb:11.8.8@sha256:24e76fcec8c003a0362d0dd53f4806e7e79458d7fdeaf47437760e19496f5a9c`
- `postgres:18.6-bookworm@sha256:afc7e2d441324c0388fa80c3d24f733b4194a4eb7f47dd8ee2b08eb1a24a647c`

The native fixture uses the same engine versions on Alpine, the real bootstrap,
real ext4 and capability-free native processes. It does **not** substitute for a
host rehearsal of Docker creation/profile validation using those pinned images.

## 7. Custom restore implementation

Custom approval is root-owned, immutable per activation, and separate from
disposable Recovery Test target settings. The web request selects a registration
ID, never supplies an endpoint, password, CA path, SQL or engine.

The strict approval requires verified TLS, an enabled dedicated non-admin
account, engine/name match, new purpose guard, activation/storage identity,
independently enforced quota, SQL budget and retention. Configured source
endpoints are rejected, including normalized case/trailing-dot/default-port
matches. Hostname comparison is not a complete DNS/source-inventory proof:
operators must review aliases, routing, source-agent-local names and production
inventory before registration. The independently provisioned guard and restricted
grants remain mandatory; DNS naming is not accepted as a replacement.

MariaDB grants are constrained to the exact escaped database and SELECT on the
guard. PostgreSQL rejects superuser/admin/replication/bypass-RLS privileges and
role memberships. Existing databases, foreign catalogs and mismatched owner
markers are preserved. Custom deletion removes only the proven owned logical
database, not the external server/filesystem.

## 8. MySQL worker changes and remaining implementation

**No MySQL worker protocol change is made.** Existing genuine Oracle MySQL 8.4.11
Recovery Testing remains intact and its 12-scenario matrix was rerun.

The audited v1 request/lease protocol (`mysql-worker/protocol.ts`,
`server.ts` and `mysqlRecoveryWorkerClient.ts`) binds disposable `testId` leases,
the Phase 6 guard and test cleanup. It has no retained-purpose operation,
snapshot/hash/activation-bound persistent ownership acknowledgement, metadata
inspection operation, or separately approved persistent target contract.
Merely suppressing cleanup would be unsafe.

Required remaining work: independently approved persistent worker targets/CA
bindings; typed retained import/inspection/owned-delete operations; durable
lease acknowledgements before CREATE; cancellation/restart compatibility;
real Oracle MySQL retained-import, ownership and retention tests. This is an
**unimplemented part of the requested scope**, not a claim that a MariaDB alias
provides MySQL support. Both MySQL persistent destinations are explicitly refused.

## 9. Restore Wizard

Completed remote-backup menu → Restore Database opens the real retained wizard.
The selected backup/full snapshot are immutable and reverified server-side.
Recorded database selection automatically displays the trusted engine, size/hash,
destination and approved Custom registrations, retention, measured resources,
limits and separate security/resource acknowledgements.

No plan policy, automation setting, saved credential or source is changed.
Unknown capacity, unsupported engine, excessive budget, active workloads or
unapproved retention cannot be overridden by a checkbox.
Submission navigates to the durable restore record, not a success toast.
Provisioning Required and Queued are explicitly not a completed import.

The deprecated disposable API remains closed with a pointer to the separate
retained endpoint. It is not an authorization/cleanup bypass.

## 10. Restore Management

Authenticated routes `/database-restores` and `/database-restores/:id` expose
retained states/history, exact binding, safe error categories, timestamps,
last validation, cleanup, operator requests, metadata refresh and owned deletion.
They use existing light/dark theme tokens and a bounded scrollable wizard.
Non-deleted records refresh every five seconds while visible; terminal deleted
history stops polling. No aggressive Docker/agent probe is added.

## 11. Retention and deletion

Retention is durably measured from confirmation: 1h, 6h, 24h default, plus longer
explicitly root-approved retention up to 30 days. Default Internal SQL budget is
128 MiB, and default maximum retention is 24h. Policy changes do not extend old
records. TLS certificate lifetime covers the approved retention plus margin.

Expiry immediately denies server-side inspection/import, aborts an executing
operation, and requests cleanup. A stopped target gets a non-ready delete request
so the operator can resume it for cleanup even after expiry.

Deletion requires the exact restore ID. Native cleanup rechecks guard/catalog
and the durable owner marker, verifies DROP/absence, and only then removes the
lease. Interrupted/ambiguous CREATE or missing markers are not treated as owned.
Custom reaches Deleted after verified logical-database removal. Internal reaches
Cleanup Required/infrastructure_pending until exact root physical receipt.

Repeated delete requests preserve database-cleanup proof and keep the executor
lock while a native deletion is still running. Missing approval, lost connection,
TLS failure or absent credentials never becomes a fabricated deletion receipt.
Snapshots/repositories are never modified by this lifecycle.

## 12. Inspection

Metadata only: engine/version, actual database, complete table/view counts,
bounded schema/table/type catalog (200 entries plus truncation indication),
measured database size where available, validation and expiry times.
No rows, unrestricted SQL, public DB port, new query service or arbitrary query
parameter is offered. Active/unexpired ownership is checked again before reply.
Cached inspection is withheld from expired/cancelled/non-active API records.

## 13. Security review

- Every new endpoint requires the authenticated configured administrator, not an
  arbitrary signed user claim or ordinary API-key route.
- Mutations require same-origin JSON. Bodies are limited to 8 KiB, requests and
  operations rate-limited; inputs/identifiers are strict.
- Responses are no-store; DTOs positively allowlist safe metadata.
- Logs contain restore/plan/backup IDs, stage and closed categories, not native
  output, SQL, passwords, tokens, HMACs, leases or keys.
- Native clients use private 0600 credential files and isolated client homes,
  no password arguments/environment, no shell execution, verified TLS and bounded
  time/output/cancellation. PostgreSQL restricted-input behavior is preserved.
- Root approvals/CA digests, source checks, exact SQL/hash/snapshot binding,
  native grants, catalogs and markers are independent gates.
- Only new dedicated restore resources are writable. Application UID/GID 10001,
  Phase 6, Legacy read-only operations, agents, source ACLs and source DBs are
  unchanged. No Legacy maintenance command is added.
- The local mount/loop fixture was explicitly authorized. Only its temporary
  operator has mount authority; DB/app children prove zero effective capabilities.
  It receives no Docker socket, production data or network.

## 14. Resource implications

Admission uses actual Linux host RAM/headroom, swap, PSI, cgroup memory/swap,
workloads, SQL size, expansion estimate, staging free space, quota/remaining
capacity and fixed target resources. Unknown data fails closed.

Current conservative gates: host total ≥3800 MiB, available ≥2560 MiB, host swap
used ≤128 MiB, no cgroup swap, memory pressure avg10 ≤1%, bounded server cgroup
≥768 MiB and ≤85% used. Expansion is `SQL * 4 + 256 MiB` within the 2-GiB data
budget, and staging retains an additional 2-GiB free margin.

Targets have 2-GiB memory/no additional swap, 1 CPU, 128 PIDs, a separately bounded
128-MiB temporary area, no public ports, read-only root and no capabilities.
The shared engine lock prevents two local Internal engine stacks; a retained
active target may need to be manually stopped before disposable Internal tests.

These are conservative gates, not a proof that every SQL/index workload fits.
Do not raise the 128-MiB default for an approximately 272-MiB dump on the small
pilot merely to bypass admission.

## 15. Schema, API and compatibility changes

- New additive migration 0012; no destructive downgrade or 0011 alteration.
- New `/api/database-restores` endpoints: preparation/create/list/details,
  metadata inspection, confirmed deletion and bounded operator requests.
- New root file/request contract, version 1, purpose-specific.
- No Agent protocol change or Agent update required.
- No MySQL worker protocol change or worker update required for existing tests.
- No package dependency, lockfile or global Node change.
- Existing server and worker images still contain clients only, not DB servers.

## 16. Validation evidence

| Check                                             | Result                                                                                                                                                                                                                |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Full backend                                      | 161 suites passed; 3126 tests passed, 4 existing skips, 0 failures                                                                                                                                                    |
| Focused Linux backend / Phase 6 / retained suites | 12 suites passed; 307 passed, 1 skip, 0 failures                                                                                                                                                                      |
| Frontend utility/render + script contracts        | 138 passed, 0 failed                                                                                                                                                                                                  |
| Linux Agent suite                                 | 120 passed, 0 failed                                                                                                                                                                                                  |
| Phase 5/6 native SFTP/Restic matrix               | Eight modes passed, including expected mixed-import failure/cleanup                                                                                                                                                   |
| SQL-only snapshot staging                         | Real SFTP/Restic selected-artifact/hash assertion passed; filesystem source not staged                                                                                                                                |
| Existing Internal Recovery matrix                 | All 10 scenarios passed, including restart readiness/lease reconciliation                                                                                                                                             |
| Existing genuine MySQL worker                     | All 12 scenarios passed                                                                                                                                                                                               |
| Phase 7                                           | Isolated webhook/HMAC/SMTP/restart/TLS fixture passed                                                                                                                                                                 |
| Retained native matrix                            | MariaDB/PostgreSQL × Internal/Custom: native imports, retained lease, SQL catalog/content, auth/TLS/hash refusal, cancellation, existing/foreign database protection, container/application restart and owned cleanup |
| Real storage quota                                | ENOSPC, non-root writes, remount persistence, foreign identity refusal and interrupted-delete recovery passed                                                                                                         |
| Typecheck                                         | Backend, frontend and Agent passed                                                                                                                                                                                    |
| Backend lint                                      | Passed                                                                                                                                                                                                                |
| Production build                                  | Frontend/docs/backend/Agent build passed; existing documentation CSS/bundle warnings remain                                                                                                                           |
| Docker                                            | Source application and optional worker built locally; non-root client verification passed                                                                                                                             |
| Compose                                           | Base + Internal Recovery + persistent restore + worker overlays validated with placeholders only                                                                                                                      |
| Frontend lint                                     | Existing ESLint 10 / typescript-eslint string-extends loader failure; not a source lint pass                                                                                                                          |

The retained native fixture uses approximately 8-MiB SQL, real 11.8.8/18.6 servers,
native clients and fixed ext4. Actual root Custom prepare/approve commands were
also exercised for both engines, including private bootstrap files and approval
permissions. Separate fixture containers reuse the same storage image
and SQLite ownership, proving storage/application restart behavior. It does not
publish a fake physical-container removal receipt from inside itself.
Receipt state transitions are contract-tested; a real host operator rehearsal
must prove Docker identity/removal and mount propagation. No browser-interaction
or production end-to-end acceptance is claimed from SSR/unit/native fixtures.

Reproduce from the repository root, using pinned pnpm 10.20.0:

```powershell
pnpm --filter @plutonhq/core-backend test --runInBand --silent --verbose=false
pnpm --filter @plutonhq/core-backend exec tsc --noEmit -p tsconfig.json
pnpm --filter @plutonhq/core-backend lint
pnpm --filter @plutonhq/core-frontend exec tsc -b
pnpm --filter @plutonhq/pluton-agent typecheck
pnpm build
node --experimental-strip-types --test frontend/__tests__/*.test.ts scripts/__tests__/*.test.cjs
docker build --load -f Dockerfile.source -t pluton-persistent-ci:local .
./scripts/validate-persistent-restore.ps1 -AllowLocalMountFixture -BuildFixture
./scripts/validate-phase6.ps1
./scripts/validate-phase6.ps1 -Modes single,two-mariadb,mixed
./scripts/validate-phase6.ps1 -BackendTests -Image pluton-phase6-tests:local
./scripts/validate-internal-recovery.ps1 -RuntimeImage pluton-persistent-ci:local
./scripts/validate-mysql-recovery-worker.ps1 -RuntimeImage pluton-persistent-ci:local
./scripts/validate-phase7.ps1
git diff --check
```

The mount fixture is opt-in, local-Docker-only and intentionally requires the
operator authority shown by its script. Never give those flags to Pluton/worker.
Existing Linux regression scripts' fixture-image prerequisites remain documented
in their respective reports. Native tests must not target a real repository.

## 17. Linux operator rehearsal

Before a pilot, on an isolated Linux VM:

1. Provide a reviewed private Node ≥20 for the operator, Docker CLI, OpenSSL,
   util-linux (mount/findmnt/losetup/flock/fallocate), ext4 tools and kernel loop
   support. Do not replace a global production Node installation.
2. Install the three reviewed operator files under
   `/opt/pluton-persistent-operator` as root-owned, non-group/world-writable files,
   with root-owned non-writable parents. Do not install from an unreviewed branch.
3. Run `operator.cjs init` explicitly as root using that private Node. Inspect its
   private network and shared view subtree. Preserve any existing Phase 6 lock.
4. Compose-validate and apply `compose.persistent-restore.yml` alongside **all**
   existing overlays in this isolated VM; preserve the existing /data volume and
   environment. The application remains 10001 and socketless.
5. From a disposable completed backup choose one recorded MariaDB/PostgreSQL SQL.
   Confirm 1h retention. UI must show Provisioning Required, not success.
6. Root reviews the 0600 request under
   `/var/lib/pluton-persistent-restore-requests/<restore-id>.json`, then runs
   `provision <restore-id>`. Verify container's pinned image/ID/limits/mounts,
   no ports, TLS guard and storage inode/UUID/quota.
7. Verify the app observes the ext4 child mount read-only through rslave
   propagation; it must not read/write the 0700 DB data directory.
8. Observe Importing → Active Restore only after actual native import/metadata
   validation. Inspect catalog; verify snapshot/hash and no rows exposed.
9. Root stop → status, then resume → status. Repeat after application and Docker
   daemon/host restart: explicitly resume the same recorded image/container;
   no formatting, identity replacement, credential change or re-import.
10. Test TTL/explicit Delete. For a stopped expired target use
    `resume-cleanup <restore-id>`; wait for native database cleanup and
    `cleanupReady:true`. Root runs `delete <restore-id>` and verifies the exact
    container, loop mount and image are gone before the app displays Deleted.
11. Interrupt each delete boundary, repeat deletion, and test stale request,
    foreign label/image/anchor/owner token. Unknown resources must remain
    Cleanup Required. Do not issue a receipt merely to clear the UI.

No operator command is executed against production by this task.

## 18. Small 4-GB pilot acceptance

Start with synthetic 5–20-MiB SQL and one engine only. Leave existing backup jobs
unchanged. Confirm measured headroom, no swap pressure, bounded staging/storage,
TLS, exact owner, no public ports and unchanged source/repository inventories.
If refused, preserve state and address capacity rather than disabling a guard.
Capture only sanitized IDs/stages/categories, not config dumps or SQL/row data.

Custom provisioning is independent: prepare a **new empty dedicated** endpoint
and hard persistent quota; use a fresh restricted restore account, not a source
account. Create a root-private candidate JSON matching
`persistentApprovalSchema`, with placeholder-free private values, a matching
root-private CA PEM, new activation/storage IDs and reviewed budgets.
Neither belongs in Git, logs, screenshots or API input.

Use `prepare-custom <target-id>` to write the fixed private bootstrap SQL.
Apply it only to that separately approved empty endpoint, using the operator's
private native administrative credential mechanism (not password argv/env).
Review actual grants, guard, TLS and quota before `approve-custom <target-id>`.
The helper requires a lowercase non-admin username and privately generated
64-hex password; it does not rotate an existing account.
After native import, the application retains the database until owned deletion.
External physical-server/storage cleanup remains the Custom operator's duty.

## 19. Later larger-pilot acceptance

An approximately 272-MiB archived SQL artifact exceeds the current 128-MiB
default. Do not describe it as a tiny fixture or silently raise limits.
First complete the small pilot and host-operator rehearsal, review a larger
memory/storage budget on the intended 6–8-GB host, measure database/index
expansion, then explicitly approve a future policy if safe.
The hard 2-GiB storage bound and all TLS/ownership/admission gates remain.
Success here means accepted SQL/catalog, not application/business semantic
correctness. Perform separately authorized application-level checks if needed;
no automatic import or cutover to a live database.

## 20. Deployment and rollback

This document is a runbook, not authorization to deploy.

Before an approved deployment, preserve a consistent control-database backup,
the entire persistent /data volume, existing keys.json/SECRET/ENCRYPTION_KEY,
plan/repository credentials, notification outbox, Compose overrides and image
digests. Do not create a fresh data volume, regenerate secrets, re-enroll an
agent or reinitialize a repository. Build/review the server image, stage it on
the isolated VM, apply additive migration 0012, then opt into the operator
overlay. Existing plans and snapshots do not require recreation.

Do not roll back SQLite independently of retained resources: losing owner leases
would make later cleanup unverifiable. Prefer settling/deleting all owned
restores with the new server/operator first. Alternatively stop exact retained
targets and preserve the new tables, encrypted approvals, root metadata and
images while older server behavior is assessed. An older server will not run
retained TTL reconciliation; operator-enforced expiry/cleanup remains necessary.
Never drop 0012 tables, erase /data, format an existing image, remove unknown
resources, or invent a physical receipt as a rollback shortcut.

For server-only operation without this feature, do not apply the optional
overlay/provision targets. Existing native MariaDB/PostgreSQL and optional
MySQL Recovery Testing keep their current configuration.

## 21. Remaining gaps and changed files

Remaining acceptance/implementation:

- Oracle MySQL Custom retained protocol/target approval/import/inspection/delete
  is not implemented. MySQL Internal is also unavailable.
- Host-level Linux Docker operator rehearsal, pinned target-image lifecycle and
  actual physical-container removal receipts are not proven by the in-container
  native fixture. Treat production deployment as gated on that rehearsal.
- Browser-interaction acceptance and large application-level semantic validation
  remain manual. Frontend lint remains the unrelated configuration baseline.
- Partial provisioning before a durable exact metadata record is deliberately
  retained for operator investigation; there is no automatic adoption/repair.
- Custom infrastructure quotas, DNS/source inventory, firewall/egress policy,
  root operator installation and protected private backups require manual work.

Changed/new implementation and validation files:

```text
.github/workflows/container.yml
backend/drizzle/0012_persistent_database_restores.sql
backend/drizzle/meta/_journal.json
backend/src/createApp.ts
backend/src/db/index.ts
backend/src/db/schema/databaseRestores.ts
backend/src/types/databaseRestores.ts
backend/src/routes/databaseRestores.ts
backend/src/services/DatabaseRestoreService.ts
backend/src/services/RecoveryTestService.ts
backend/src/services/RemoteRepositoryRecoveryService.ts
backend/src/stores/DatabaseRestoreStore.ts
backend/src/stores/RecoveryTestStore.ts
backend/src/utils/persistentDatabaseImporter.ts
backend/src/utils/persistentRestorePolicy.ts
backend/src/utils/persistentRestoreTargets.ts
backend/src/utils/recoveryDatabaseImport.ts
deploy/compose.persistent-restore.yml
deploy/persistent-restore/bootstrap.sh
deploy/persistent-restore/operator.cjs
deploy/persistent-restore/storage.cjs
frontend/src/@types/databaseRestores.ts
frontend/src/services/databaseRestores.ts
frontend/src/utils/databaseRestores.ts
frontend/src/components/Restore/DatabaseRestore/DatabaseRestore.module.scss
frontend/src/components/Restore/DatabaseRestore/DatabaseRestoreWizard.tsx
frontend/src/routes/DatabaseRestores/DatabaseRestores.tsx
frontend/src/components/Plan/Backups/Backups.tsx
frontend/src/components/App/SideNav/SideNav.tsx
frontend/src/router.tsx
frontend/__tests__/databaseRestores.test.ts
backend/__tests__/fixtures/persistent-restore/Dockerfile
backend/__tests__/fixtures/persistent-restore/Dockerfile.dockerignore
backend/__tests__/integration/persistentNative.app.mjs
backend/__tests__/integration/persistentNative.smoke.cjs
backend/__tests__/integration/persistentRestore.fixture.ts
backend/__tests__/integration/persistentRestore.smoke.ts
backend/__tests__/integration/persistentStorage.smoke.cjs
backend/__tests__/integration/phase5Database.smoke.ts
backend/__tests__/routes/databaseRestores.test.ts
backend/__tests__/stores/DatabaseRestoreStore.test.ts
backend/__tests__/utils/persistentDatabaseImporter.test.ts
backend/__tests__/services/RemoteRepositoryRecoveryService.test.ts
scripts/__tests__/persistentRestore.test.cjs
scripts/validate-persistent-restore.ps1
scripts/validate-phase6.ps1
docs/PERSISTENT_DATABASE_RESTORE_REPORT.md
```
