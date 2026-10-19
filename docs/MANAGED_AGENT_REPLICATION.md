# Managed Agent replication and S3-compatible storage

Implementation branch: `codex/managed-agent-replication-hcp`, based on
`f8379fc52e4b0a7afb7baeff73085afa7f12fc10` (includes PR #32 and PR #33).
This document describes source implementation, not approval to deploy or proof of
interoperability with a particular object-storage appliance.

## Supported scope

- Managed Agent filesystem backup to its existing managed SFTP primary repository.
  The SFTP primary may be hosted on the Pluton VM; a new Agent-local primary mode
  is not introduced.
- Zero, one or two optional server-side `s3`/`s3compatible` replicas. The backend
  and frontend validate the limit. Managed copies are serialized globally;
  standard-plan concurrent replication retains its existing behavior.
- Complete snapshots, including declared database SQL artifacts. This does not
  turn ordinary SQL files into native database-recovery metadata.
- Independent replica results and explicit retry of confirmed failed/cancelled
  work. Primary SUCCESS is independent of replica failure.
- Detach/retain only for managed replicas. Automatic managed-replica retention,
  prune, unlock and physical deletion are intentionally unavailable. The
  existing managed-primary no-prune/no-delete contract remains in force.
- Server-side mutation execution requires Linux. Windows mutation is refused
  because the executor cannot prove descendant termination with the available
  process primitives. Local deterministic tests do not establish Linux runtime
  or HCP acceptance.

## Durable lifecycle and identity

Migration `0018_managed_replication.sql` adds jobs and destination bindings. It
does not modify migration 0016, old identities, encrypted approval, Resume intent,
database leases, Agent identities or existing source repositories.

1. Authenticated Agent completion persists the primary result through the
   existing managed-backup path.
2. Server admission independently opens the primary repository and verifies its
   config ID, exact 64-character snapshot ID, plan/backup tags, tree and SQL
   artifact lengths/SHA-256. A stale report alone cannot authorize copy.
3. SQLite stores immutable source/Agent/repository/snapshot and canonical
   endpoint/bucket/prefix bindings. Job payloads contain identifiers, not secrets.
4. An atomic SQLite claim acquires one global execution slot across processes.
   Plan/backup deletion and binding changes are fenced by durable SQL triggers.
   Plan writes and destination reservations also check canonical primary/replica
   scopes within immediate transactions. A standard plan created later cannot
   adopt a reserved prefix through another storage ID. Storage edits cannot
   redirect a registered plan into that prefix. Ordinary plan creation records
   its scope before installing a schedule; failed scheduling retains paused
   metadata until ordinary authorized removal resolves any partial schedule.
5. An uninitialized destination is accepted only after an empty-prefix check.
   Initialization intent is committed before init; the actual destination
   repository config ID is committed before copy. Existing unknown repositories
   are refused even if their password happens to work.
6. Restic copies the exact source snapshot ID. Because copying can change the
   destination snapshot ID, verification requires exact ID/original linkage,
   matching tree, tags and paths, plus SQL byte count and SHA-256.
7. Only verified completion becomes replica SUCCESS. Process failure preserves a
   closed diagnostic category; arbitrary provider stderr is not returned.

The process environment bounds Go concurrency, transfer buffers and execution
time. These controls are not a cgroup memory guarantee or a production capacity
measurement. Existing MySQL Internal admission and root-operator limits are
unchanged.

### Restart, uncertain outcomes and recovery

Pending jobs survive restart. A bounded metadata-only scan reconciles primary
completion that was persisted before dispatch. Failed admission remains visible
and requires explicit retry rather than repeated automatic network attempts.

An interrupted running claim or uncertain initialization retains the execution
slot. No timestamp, polling, mailbox reconstruction or PID-age guess releases it.
Explicit retry of an uncertain job returns 409. A confirmed failed copy can be
retried idempotently after child-process termination has been proved.
An outer timeout never overrides uncertain child termination or releases its
durable slot. Detached and disabled replicas remain visible in backup history;
plan removal reports retained primary and replica paths rather than claiming
physical cleanup.

There is **no automatic uncertain-claim reset or privileged recovery endpoint**.
Before any separately approved operator repair, quiesce all executors, establish
that no old Restic/Rclone descendants remain, preserve SQLite and repository
receipts, inspect the exact repository identity and copied snapshot, and review
the required metadata reconciliation. Do not edit a claim, adopt a repository,
remove a lock or repeat init merely to make the queue progress. This operational
resolution path remains a release-review requirement.

### Ownership and deletion

Canonical identity includes HTTPS endpoint authority, bucket and case-sensitive
prefix; credentials and storage record IDs are not ownership. Supported
virtual-host/path-style aliases and AWS endpoint aliases are normalized.
Different DNS names that route to the same service cannot be inferred safely;
the operator must inventory aliases and reserve a dedicated prefix.

Reserved destination bindings survive detach and plan removal. Original managed
repository credentials remain in the PR #33 retained-repository escrow. Whole
bucket/root deletion, unknown repository adoption and overlapping registered
prefixes are refused. HCP physical deletion is not implemented by the managed
replica path. Existing PR #32 retained-database 409 safeguards remain active.

## HCP configuration and credential trust

Choose the existing S3-compatible provider and explicitly enable existing-bucket
HCP mode. Supply the operator-confirmed HTTPS **S3 API** endpoint, pre-provisioned
bucket/namespace, dedicated prefix, signing region and addressing style. No code
creates or deletes tenants, namespaces or buckets. Bucket existence checks do not
assume CreateBucket permission.

Do not substitute the Tenant Management Console URL, append `/hs3`, or assume a
namespace REST hostname is the S3 signing endpoint. No organization-specific
hostnames or production namespace names are included in this implementation.

HCP documentation describes
[tenant/bucket addressing](https://docs.hitachivantara.com/r/en-us/mk-95hcph002/latest/using-the-hitachi-api-for-amazon-s3/working-with-objects/creating-a-folder?contentId=Mi~9CFVdGJMuh~XfyWM7AQ)
and [signature-version configuration](https://docs.hitachivantara.com/r/en-us/mk-95hcph002/latest/using-the-hitachi-api-for-amazon-s3/using-cors-to-process-cross-domain-requests/cors-rules-configuration/example-put-bucket-request?contentId=YZjaYl3a4K5gqledfjCEfg).
These references are the vendor's current documentation, not version-specific
certification of an HCP 9.7.3 installation.

Storage access keys, secret keys, session tokens and SSE-C secret fields belong
to encrypted database credentials. Public S3 responses omit secret values; blank
secret edits retain the protected value. Legacy secret settings migrate to that
boundary on an explicit edit. Rclone obscuring is not strong encryption.
Protected HCP remote stanzas persist no credentials; only the named child process
receives decrypted options at execution time. Replica credentials are never
copied to the source Agent. Existing legacy non-HCP remote configuration is not
silently rewritten.

For a private CA, an operator may configure `PLUTON_STORAGE_CA_FILE` as an absolute
path to a PEM CA bundle. On production Linux it must be a root-owned regular file, not a
symlink, and not group/world writable. No UI-supplied CA path is accepted. The
executor forwards validated trust as `RCLONE_CA_CERT`/`SSL_CERT_FILE`; certificate
chain and hostname verification remain enabled. Actual endpoint TLS negotiation
still requires the separately approved interoperability test.

HCP [retention values](https://docs.hitachivantara.com/r/en-us/mk-95hcph002/latest/hcp-management-api-reference/data-types/specifying-retention-values?contentId=5p7Rzk~t9bpazLSDnnmBHg)
and [data-access permissions](https://docs.hitachivantara.com/r/en-us/mk-95hcph002/latest/using-the-hitachi-api-for-amazon-s3/introduction-to-hitachi-content-platform/data-access-permissions?contentId=AfJIv7aLMoK5NKQAo4nVzA)
are vendor policies. Do not equate them with AWS Object Lock or application-level
replication status. HCP infrastructure redundancy is a separate operator concern.
Denied lock deletion or uncertain copy must remain a visible failed/uncertain
result; successful upload alone is not a verified replica.

## Recovery boundary and follow-up

Existing native Recovery Testing, Persistent Restore, MySQL Internal/Custom,
MariaDB and PostgreSQL recovery continue to use the trusted original managed
primary repository. No mirror selector is added to these operations.

Managed file restore directly from a mirror is **BLOCKED** in this sprint.
Existing managed restore context binds SFTP primary, source Agent, exact snapshot
and server staging. Reusing the standard-plan mirror toggle would bypass those
assumptions.

A separate follow-up needs an authenticated read-only mirror resolver that:

1. Requires a completed durable replica receipt, current authorized plan/Agent
   context and the reserved destination repository config identity.
2. Reads the recorded destination snapshot ID and verifies its original/tree
   linkage; it never falls back to latest or a caller-selected storage/path.
3. Uses server-only S3 credentials, cancellation and bounded private staging,
   preserving destination/path/download ownership checks.
4. Keeps database testBinding/testMetadata and native import on the primary until
   a distinct trusted reconstruction/import design is reviewed.

## One future interoperability test, separate approval required

Use a newly approved non-production bucket/namespace or exact isolated prefix.
Existing application namespaces, existing test data and production repositories
are excluded. Credentials must arrive through an approved private channel.

Propose a 30–45 minute bounded run: verify DNS/route/HTTPS/S3 signing; record exact
prefix ownership; create one small synthetic managed backup containing files and
synthetic SQL artifacts; copy to one HCP destination; verify repository/snapshot
identity and SHA-256; introduce one bounded connectivity failure and explicit
retry; inspect retention/lock/multipart behavior. Primary-loss mirror file restore
is a follow-up gate, not a capability promised by this implementation. Physical
cleanup requires separate exact-scope approval and verified ownership.

Required operator details: actual S3 API endpoint and DNS, namespace/bucket,
signing region/version, path versus virtual-host addressing, CA chain, prefix
allocation, least-privilege permissions, retention/expiration policy, quota and
network route. Available capacity is an operator measurement, not inferred from
an old console screenshot.

## Release and rollback

This is an uncommitted source candidate. Hosted Linux CI, real Restic/Rclone/HCP
execution and production capacity are separate gates. No deployment, production
access, sudo, Docker service or VM reboot is part of this sprint.

Before rollout, back up SQLite, encrypted credential state and matching immutable
application artifacts; review migration 0018 and root/worker compatibility.
Before rollback, quiesce replication and preserve destination bindings/receipts.
Do not drop additive tables, erase uncertain claims or run init on retained
repositories. The old application cannot execute the new queue; SQL fences
continue to reject unsafe source deletion. MySQL Internal activation and the
existing 4 GiB host capacity/admission decision remain separate and unchanged.
An old application does not implement the new canonical-scope write guards.
Keep scheduling quiescent during rollback, preserve reservations and escrow,
and prohibit legacy schedules or storage edits from using retained replica
prefixes. Additive schema compatibility is not approval to run an old executor
against new replica destinations.

## Validation and review status

Local evidence uses synthetic credentials and disposable SQLite/Node processes,
with generated state confined to ignored project `tmp/`. No Restic/Rclone storage
operation, Docker service, HCP connection or production operation was executed.

| Check | Result |
| --- | --- |
| Final core, stores, process boundaries and migrations | 202 PASS / 12 suites |
| Final delete, managed backup and native database recovery dependents | 123 PASS / 4 suites |
| Other affected storage, executor and existing replication regressions | PASS; combined distinct backend coverage is 672 tests / 26 suites across focused runs, not a full-suite run |
| Managed UI, mutation clients, table/filter and download checks | 34 PASS |
| Backend/frontend TypeScript, backend compilation, existing production CJS bundle build and frontend production build | PASS |
| Backend ESLint and diff whitespace check | PASS |
| Frontend ESLint | BLOCKED by unchanged baseline flat-config error: string `eslint-config-prettier` in `extends` |
| Hosted Linux CI and real Restic/Rclone copy | NOT TESTED for this uncommitted branch |
| Supplemental direct unbundled ESM helper probe | FAIL: extensionless `providers` resolution under the local `tsx` loader; this is not the production CJS entrypoint. Runtime artifact verification remains NOT TESTED |
| HCP 9.7.3 signing, TLS, locks, multipart and retention interoperability | NOT TESTED |
| Managed mirror file restore / primary-loss database reconstruction | BLOCKED; follow-up design above |
| Automatic managed-replica retention/prune and physical cleanup | BLOCKED; detach/retain only |
| Production readiness, capacity and cutover | BLOCKED; no production access authorized |

No old migrations, protected root operator, Resume sequence or MySQL resource
guards are changed. Builds retain existing large-chunk/Browserslist warnings.
The pinned pnpm launcher attempted a download in this environment and could not
complete; checks used the already-installed tool versions from the existing
lockfile, without dependency or global configuration changes.

Before real HCP testing, obtain approval for exactly one isolated prefix and a
fixed window. Suggested policy: at most 45 minutes of testing, independent cleanup
starting by minute 45 and a hard deadline at minute 60, recorded in both UTC and
Asia/Jakarta when the operator approves the actual start. No previous fixture
deadline or privilege approval is reused. Retention-denied cleanup remains
BLOCKED and is never reported as successful deletion.

## Exact candidate file inventory

58 intended files: 39 modified and 19 new. Generated outputs, SQL fixture data,
private test configuration and runtime evidence remain outside this allowlist.

- `backend/__tests__/db/ManagedReplicationMigration.test.ts`
- `backend/__tests__/integration/ManagedReplication.test.ts`
- `backend/__tests__/managers/HcpStorageManager.test.ts`
- `backend/__tests__/services/ManagedReplicationDeletion.test.ts`
- `backend/__tests__/services/ManagedReplicationService.test.ts`
- `backend/__tests__/services/PlanService.test.ts`
- `backend/__tests__/services/RemoteBackupService.test.ts`
- `backend/__tests__/services/StorageService.test.ts`
- `backend/__tests__/stores/ManagedReplicationStorageGuard.test.ts`
- `backend/__tests__/stores/ManagedReplicationStore.test.ts`
- `backend/__tests__/stores/PlanStore.test.ts`
- `backend/__tests__/stores/StorageStore.test.ts`
- `backend/__tests__/utils/ManagedReplicationExecutor.test.ts`
- `backend/__tests__/utils/ManagedReplicationProcess.test.ts`
- `backend/__tests__/utils/rclone/rclone.test.ts`
- `backend/__tests__/utils/restic/restic.test.ts`
- `backend/__tests__/utils/storageSecurity.test.ts`
- `backend/drizzle/0018_managed_replication.sql`
- `backend/drizzle/meta/_journal.json`
- `backend/src/createApp.ts`
- `backend/src/managers/BaseStorageManager.ts`
- `backend/src/services/BackupServices.ts`
- `backend/src/services/ManagedReplicationService.ts`
- `backend/src/services/PlanService.ts`
- `backend/src/services/RemoteBackupService.ts`
- `backend/src/services/StorageService.ts`
- `backend/src/stores/ManagedReplicationStore.ts`
- `backend/src/stores/PlanStore.ts`
- `backend/src/stores/StorageStore.ts`
- `backend/src/types/backups.ts`
- `backend/src/utils/managedReplicationPolicy.ts`
- `backend/src/utils/providers/_s3Options.ts`
- `backend/src/utils/providers/s3compatible.ts`
- `backend/src/utils/rclone/rclone.ts`
- `backend/src/utils/restic/ManagedReplicationExecutor.ts`
- `backend/src/utils/restic/restic.ts`
- `backend/src/utils/storageSecurity.ts`
- `docs/MANAGED_AGENT_REPLICATION.md`
- `frontend/__tests__/deleteClients.test.ts`
- `frontend/__tests__/managedReplication.test.ts`
- `frontend/src/@types/backups.ts`
- `frontend/src/@types/storages.ts`
- `frontend/src/components/Plan/Backups/Backups.tsx`
- `frontend/src/components/Plan/Mirrors/MirrorDetails.module.scss`
- `frontend/src/components/Plan/Mirrors/MirrorDetails.tsx`
- `frontend/src/components/Plan/Mirrors/MirrorStatusBadge.tsx`
- `frontend/src/components/Plan/PlanForm/PlanForm.tsx`
- `frontend/src/components/Plan/PlanSettings/PlanReplicationSettings.tsx`
- `frontend/src/components/Plan/PlanSettings/PlanSourceSettings.tsx`
- `frontend/src/components/Storage/AddStorage/AddStorage.tsx`
- `frontend/src/components/Storage/EditStorage/EditStorage.tsx`
- `frontend/src/components/Storage/StorageAuthSettings/StorageAuthSettings.tsx`
- `frontend/src/components/Storage/StorageSettings/StorageSettings.tsx`
- `frontend/src/services/backups.ts`
- `frontend/src/services/plans.ts`
- `frontend/src/services/storage.ts`
- `frontend/src/utils/plans.ts`
- `frontend/src/utils/replication.ts`
