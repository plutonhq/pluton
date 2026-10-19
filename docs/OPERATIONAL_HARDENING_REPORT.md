# Operational hardening: Phase 4 / 5 / 6

Scope: independently implemented community code at baseline `0cb9635`, on
`codex/operational-hardening`. This is not Phase 7. No commit, push, merge,
deployment, production access, credential rotation, ACL change, repository
mutation against Legacy, or production snapshot change was performed.

Infrastructure identifiers are deliberately omitted. “Pilot A” below means the
existing filesystem workload; “Pilot B” means the existing filesystem plus database
workload described privately in the request. Examples and tests are synthetic.

## Findings and disposition

| Priority / issue                                                              | Disposition                      | Verified root cause and before / after                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P0 master credentials                                                         | Fixed                            | Invalid/unreadable `keys.json` was treated as `{}`, allowing replacement master secrets. Environment values could silently override persisted ones; failed writes could leave startup using unpersisted secrets. Now corruption, missing keys on an initialized control volume, and conflicts fail closed with fixed messages. Same healthy keys are reused. Key-file updates use private same-directory atomic replacement. Invalid/conflicting persisted `ENCRYPTION_KEY` also fails startup rather than being bypassed or overwritten through keyring fallback. |
| P0 agent errors and frontend diagnostics                                      | Fixed                            | Non-lifecycle command errors could retain arbitrary agent/provider text, and plan update/notification debug logging could include submitted configuration. Completion errors now use closed stage/code messages for filesystem and DB failures; affected form/request debug logs were removed. No password, SQL, config contents, HMAC, or lease is used to generate a diagnostic.                                                                                                                                                                                 |
| P0 database credential boundary                                               | Already correct                  | Database passwords are write-only form inputs, encrypted separately from plan settings, bound to server-generated database IDs, and materialized only into an authenticated ephemeral command. Native dump credentials are private files, not argv or connection URLs. Existing redaction, credential preservation, 0..8 DB and independent-password tests remain active.                                                                                                                                                                                          |
| P0 transport / old-script credential rotation                                 | Documented                       | Explicit trusted-LAN HTTP remains available, but HMAC does not encrypt commands or credentials. HTTPS migration and manual old-script credential rotation are described below; neither was performed.                                                                                                                                                                                                                                                                                                                                                              |
| P1 source access                                                              | Fixed                            | Installer checked root readability before locating inaccessible canonical parents. Backup root containment alone did not establish service-account read/traverse access. Now installer reports the first blocked parent, and per-backup preflight verifies canonical containment, parent traversal, root readability/type and root stability. A local read-only scan diagnoses inaccessible entries without following nested links. Source access loss does not silence heartbeat; backup fails with safe actionable codes.                                        |
| P1 database classification                                                    | Fixed                            | The `Access denied` catch-all classified MariaDB/MySQL 1044 as authentication. Now 1045 is authentication; 1044/1142/1227 are insufficient privileges. Native TLS/2026, connection, timeout, missing/incompatible client, invalid configuration/1049 and generic failures stay distinct. A nonzero dump exit remains failure even with partial SQL. No automatic change to routines/events/defaults.                                                                                                                                                               |
| P1 remote progress                                                            | Fixed                            | Agent parsed summary-style names instead of Restic status `bytes_done/files_done/total_bytes/total_files`; ordinary execution stages only reached the journal; remote API returned raw stats while UI expected `events`. Progress writes used a stale pre-await row and could revive completion. Now actual counters/stages reach a transactional latest-state JSON projection, guarded by command/attempt/sequence and terminal state. UI shows stages plus real counters with an indeterminate bar while running, not an invented percentage/ETA.                |
| P1 restore counts and selection                                               | Fixed                            | Confirmation divided regular-file preview count by total snapshot entries. Selection shallow-mutated Sets and excluded parents could mask newly selected children. Now files/directories/entries/bytes are separate; subtree toggles are immutable, search affects only the view, and empty directories survive granular selection. Empty leaf selection is never encoded as empty-include/Select-All. Partial parents never become recursive include filters.                                                                                                     |
| P2 static plan diagram label                                                  | Fixed                            | `Backing Up` / `Syncing` was a static workflow heading, not live status. It now says `Backup source` / `Sync source`, with explicitly scheduled wording. No extra polling was added.                                                                                                                                                                                                                                                                                                                                                                               |
| P2 recovery result wording                                                    | Fixed / already correct boundary | Exact snapshot binding and independent Backup/Recovery status were already enforced. UI now explains operational outcomes and says artifact integrity PASSED but SQL import NOT TESTED (Disabled). Catalog verification is shown only after a passed disposable import. No semantic/application recovery guarantee is claimed.                                                                                                                                                                                                                                     |
| P2 installer idempotency                                                      | Fixed                            | Every install downloaded runtime/tools and rebuilt the app, with no trusted reuse evidence. A prior pinned verified installation now records root-protected SHA-256 content/mode/link/source provenance. Reuse requires protected ownership/ancestors, no writable/special/external-link entries, unchanged content, expected pins and executable version checks. Matching build inputs allow config-only reuse; changed inputs rebuild the app. Unattested or invalid old trees take the original verified download/build path.                                   |
| Related canonical recovery binding                                            | Fixed                            | A synthetic alias-source backup archives the canonical path, while recovery used the configured alias and rejected the source tree. New completions optionally record canonical `sourcePaths`; recovery still verifies those against the exact snapshot paths/listing. Existing source configuration is not rewritten and historical aliases are not guessed or backfilled.                                                                                                                                                                                        |
| Manual infrastructure permissions, HTTPS rollout, production pilot acceptance | Deferred to operator             | These require actual infrastructure authority and validation. The task did not contact either pilot, modify ACLs, import into production, cut over, or disable the older backup job.                                                                                                                                                                                                                                                                                                                                                                               |

## Source access behavior and safe diagnostics

Per-backup validation is cheap (root/parent metadata and access checks), both before
preparation and again before invoking Restic. A changed root alias is refused.
Heartbeat does not walk or scan source trees. Restic's bounded JSON scan/archival
error records identify source permission/missing-entry failures; arbitrary SFTP
errors are not misclassified as source errors. Native nonzero exits are still fatal.

Codes distinguish `source-parent-not-traversable`, `source-root-not-readable`,
`source-entry-inaccessible`, `source-missing`, `source-symlink-escape`,
`source-unsupported-type`, and `source-policy-violation`. The server/UI receive
only fixed advice and stage/code, never raw provider text or local blocked paths.

For an operator-requested local diagnostic, run **as the service account**:

```sh
sudo -u pluton-agent /opt/pluton-agent/runtime/bin/node \
  /opt/pluton-agent/app/dist/index.js preflight \
  --source /srv/example-app --allowed-roots /srv/example-app

# Optional explicit read-only inventory diagnostic, not a heartbeat task:
sudo -u pluton-agent /opt/pluton-agent/runtime/bin/node \
  /opt/pluton-agent/app/dist/index.js preflight \
  --source /srv/example-app --allowed-roots /srv/example-app --scan
```

The local JSON includes safe requested/resolved/blocked paths. Nested symlinks are
counted but never traversed, matching the existing backup behavior. Scans have a
10,000-entry / five-second cooperative budget and explicitly report partial scans;
they are not an exhaustive guarantee and cannot forcibly interrupt a kernel/NFS
filesystem syscall. Preflight does not emulate Restic exclude patterns. It does not
change chmod, owner, group or ACL, and source access remains read-only. Administrators
must decide narrowly scoped traverse/read access; recursive broad ACL/chmod or root
execution is not a solution provided by this patch.

## Progress, selection and compatibility

- Durable progress lives in the existing `progress_stats` JSON column, not a new
  table or fabricated event history. The API retains original counter keys and
  adds a latest-state `events` envelope, `remote`, stage and attempt information.
- Stage delivery is bounded/coalesced and best-effort after the initial ACK/accepted
  checkpoint. An outage must not abort a native backup merely because progress
  delivery failed. RPC deadlines bound the final flush. Completion receipts remain
  persisted before the completion callback; reconnect replay does not redump.
- Within an attempt, counters and stages cannot regress; a new lease attempt resets
  its counters explicitly. Failed/cancelled/completed rows ignore late progress.
  UI percentages are not synthesized from a still-changing scan estimate. Short
  jobs may still finish between polls; stage granularity is best-effort.
- Regular-file progress is not a count of restored directory entries. Confirmation
  shows selected files + directories, selected entries and snapshot total entries.
  Full selection includes empty directories. Existing granular regular-file limits
  remain; partial non-empty-directory metadata-only requests fail closed instead of
  accidentally passing empty includes and restoring everything.
- **No schema migration, dependency change, payload version change, identity/HMAC
  change, repository-password change, credential rewrite, or plan recreation.**
  New optional `backupStage` event and `sourcePaths` completion fields, and new
  closed failure codes, are additive. The new server accepts existing v0.4.0 agents
  and their old lifecycle/counter messages. Agent inventory becomes v0.4.1.
- **Server first, agent second.** Old strict servers reject the newly added fields;
  do not pair the new agent with an old server. On rollback, restore/stop the new
  agent before restoring an old server. Old agents lack the new diagnostics and
  correct counter parsing, so an agent update is needed for the full improvement.
- A legacy historical snapshot with only an alias in backup metadata and no proven
  canonical binding is still safely refused by recovery. Do not edit its snapshot
  or invent a binding; validate the exact stored snapshot paths or create a new
  successful managed backup using the updated agent.

## Installer integrity and rollback

Pins remain private Node v22.18.0, Restic 0.19.1, Rclone 1.75.1. Original HTTPS
archive checksum verification is retained (Node published SHA index, pinned Restic
and Rclone digests). Global host Node is never installed/upgraded. These pins are
not a statement that all security advisories are resolved; maintaining vetted pins
remains a separate release/security responsibility.

`.verified-install` is installed under the protected application tree, not the
identity/state directory. It records the verified Node archive digest, pinned tool
digests, full installed file/mode/link digest and build-input fingerprint. It has no
credentials or source inventory. Missing metadata, tampering, writable permissions,
external symlinks or version mismatch prevent reuse. Metadata is never sourced or
evaluated as shell code. Root compromise is outside this local provenance model.
The first update from an older installation without this metadata downloads/builds
once; subsequent unchanged configuration-only updates can reuse safely.

Staging is still atomic and normalized before non-root validation. Previous app,
configuration and service unit are restored on failed activation/control validation.
Installer validation now uses authenticated **heartbeat-only `check`**, not
`run --once`, which could previously lease and execute queued backup work inside an
installation transaction. Existing identity is reused unless the operator explicitly
requests `--re-enroll`; that flag is not part of this rollout. Repeat **all** approved
allowed roots when reinstalling; the supplied list remains the explicit policy,
not an automatic permission expansion.

## HTTPS migration guidance (manual, no forced TLS)

1. Preserve a matching private backup of the persistent data volume, `keys.json`,
   `pluton.enc.env` or the configured encryption-key source, environment secrets,
   agent identity/receipts/config, and the prior immutable application/agent build.
   Never copy these into Git, screenshots, issue text or this report.
2. Provision a reverse proxy with a trusted certificate for a synthetic equivalent
   of `https://backup.example.internal`. Restrict the backend port to loopback or a
   dedicated proxy network; do not leave an internet-accessible alternate HTTP path.
3. Set the existing `APP_URL` to the HTTPS public origin and scope existing
   `TRUST_PROXY` to the actual trusted proxy/network. Do not blindly trust arbitrary
   forwarded headers. The proxy must replace forwarded host/protocol/client-address
   headers. The app already derives secure session cookies from HTTPS `APP_URL`
   and uses HttpOnly cookies. Browser reauthentication may be needed; do not rotate
   SECRET/ENCRYPTION_KEY to make cookies work.
4. Verify TLS hostname/chain, authenticated browser/API access, secure cookies,
   uploads/downloads and source-agent outbound HTTPS. Use the existing private-CA
   option if appropriate; never disable certificate verification.
5. Reconfigure the same enrolled agent to the HTTPS origin, preserving identity and
   approved roots. Test heartbeat, one managed backup, exact-snapshot browse/download
   and staged restore. Ensure all agents can use HTTPS before explicitly turning off
   the server's `ALLOW_INSECURE_AGENT_HTTP` exception and removing the agent's HTTP
   opt-in. Keep transitional trusted-LAN HTTP strictly firewall-limited if needed.
6. HSTS/redirect policy is an operator/proxy decision after HTTPS is verified, not a
   forced pilot change. Do not send DB/SFTP credentials across untrusted HTTP.

Proxy trust must match the network path, as described by
[Express's proxy guidance](https://expressjs.com/en/guide/behind-proxies/).
The exact native progress field mapping was checked against
[Restic v0.19.1's JSON implementation](https://github.com/restic/restic/blob/v0.19.1/internal/ui/backup/json.go).

## Old hardcoded-script credentials (manual security work)

Treat formerly hardcoded credentials as potentially exposed. Privately inventory
every dependent old script/job and its DB/SFTP/other account grants. Provision a
least-privilege replacement, install it through private credential handling, test
the new consumer and still-active old job, coordinate the change, then revoke the
old credential. Password reuse in unrelated systems must be reviewed separately.
Keep values out of argv, URLs, shell history and logs. Review access/audit history
and historic log exposure without dumping credentials publicly.

This does **not** mean rotating Pluton SECRET, ENCRYPTION_KEY, repository passwords,
or enrolled identity. Those protect existing encrypted state and snapshots and need
a separate explicit supported procedure. The still-active older job is not modified
or cut over by this task, and its legacy repository remains read-only to this adapter.

## Validation evidence

All fixtures use synthetic data. Linux runs are non-root, network-isolated,
read-only-container tests with private disposable tmpfs state. Only repository code
and synthetic fixture data were used; installer tests have a read-only repository
bind and copy source/build-input files into tmpfs. No production data volume, pilot
source directory, live DB, production SSH session or Docker socket was mounted.

| Check                                                                                                                                                                                    | Result                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Baseline backend, before edits                                                                                                                                                           | 141 suites passed; 2,830 passed, 4 skipped, 0 failed                                                                                                                                                                                         |
| Baseline frontend, before edits                                                                                                                                                          | 44 passed, 0 failed                                                                                                                                                                                                                          |
| Full backend `pnpm --filter @plutonhq/core-backend test --maxWorkers=2 --silent --verbose=false`                                                                                         | 143 suites passed; 2,851 passed, 4 skipped, 0 failed                                                                                                                                                                                         |
| Linux agent `node --test /app/agent/dist/*.test.js` in synthetic tool fixture                                                                                                            | 80 passed, 0 failed, 0 skipped                                                                                                                                                                                                               |
| Portable agent `pnpm --filter @plutonhq/pluton-agent test`                                                                                                                               | 27 passed, 53 Linux-only execution checks skipped, 0 failed (Windows); Linux suite above is acceptance evidence                                                                                                                              |
| Frontend `node --experimental-strip-types --test frontend/__tests__/*.test.ts`                                                                                                           | 52 passed, 0 failed                                                                                                                                                                                                                          |
| Linux focused recovery backend `scripts/validate-phase6.ps1 -BackendTests -Image pluton-phase6-tests:local`                                                                              | 9 suites passed; 231 passed, 1 skipped, 0 failed                                                                                                                                                                                             |
| Installer Bash regression script                                                                                                                                                         | 16 top-level scenarios passed (cache-rejection covers six variants); simulated pinned executables, not a real systemd deployment                                                                                                             |
| Native integration `scripts/validate-phase6.ps1 -Modes @('single','two-mariadb','mixed','phase6-filesystem','phase6-mariadb','phase6-postgresql','phase6-mixed','phase6-mixed-failure')` | 8/8 expected outcomes passed. Real isolated SFTP/Restic/Rclone, MariaDB 11.8.8 and PostgreSQL 18.6; source DBs stopped before recovery, repository unchanged, cleanup/replay checked. Failure scenario correctly records Failed, not Passed. |
| Agent/backend/frontend typecheck                                                                                                                                                         | Passed, including final rerun                                                                                                                                                                                                                |
| Backend lint                                                                                                                                                                             | Passed                                                                                                                                                                                                                                       |
| Frontend lint                                                                                                                                                                            | Blocked by pre-existing ESLint 10 / typescript-eslint config: string `eslint-config-prettier` in `extends`. This task did not broaden into lint configuration repair.                                                                        |
| `pnpm build`                                                                                                                                                                             | 3/3 packages passed (agent/backend/frontend); existing chunk-size and outdated Browserslist warnings remain                                                                                                                                  |
| `git diff --check`                                                                                                                                                                       | Passed                                                                                                                                                                                                                                       |

The existing full-backend Pino/listener and teardown warnings were observed in the
baseline too. Initial hardening test failures (HTTP oversize termination, UI render
fixture, old broad fs mocks, and updated include semantics) were corrected, not
marked as baseline failures or suppressed by relaxing production checks. Automatic
fs mocks in Config/init/notification service tests now model/isolate private key IO;
credential corruption/conflict tests separately exercise actual fail-closed behavior.

Regression coverage includes source alias/escape, blocked parents/root/files/dirs,
special type, bounded/no-follow scan, 1044/1142/1227 vs 1045, partial SQL after a
successful login check, TLS/1049/transport errors, safe callback persistence, real
status fields, progress outages/retry/terminal guards, transaction persistence,
immutable selection/empty directories/last-leaf safety, exact snapshot alias binding,
recovery artifact/import/cleanup semantics, verified reuse and rollback.

### Follow-up: Linux CI middleware test isolation

The reported `TypeError: isBinaryMode is not a function` was reproduced with the
unchanged `versionMiddleware.test.ts` on Linux. Its `installHelpers` mock exports
only `getInstallType`, while importing the real `ConfigService` initializes
credential validation and calls `envFileHelpers.isLinuxInstalledRuntime`. On Linux
that calls the missing mock export; on Windows the platform condition short-circuits.
The real helper exports are present. This is a unit-test isolation regression, not
a missing production export or a workflow configuration error.

The middleware test now mocks the configuration service's `isSetupPending` method
instead of initializing persisted credentials with a middleware-only helper mock.
Both setup-header states are covered, with the mock reset between cases; the
existing version, platform, install-type and `next()` checks remain unchanged.
Config/credential tests separately exercise real fail-closed key validation.
Only this test and this report changed in the follow-up: no runtime, workflow,
schema, protocol, dependency, credential or repository behavior changed.

The original full-backend result above was on Windows; the earlier Linux recovery
subset and agent tests did not cover this middleware. Full Linux backend validation
is therefore required for this correction, not just the focused suites.

Correction verification:

- Focused middleware, ConfigService, CredentialManager, installHelpers and
  envFileHelpers suites: 5 suites / 119 tests passed on both Linux and Windows.
- Full Linux `jest --config jest.config.ts --runInBand --silent --verbose=false`:
  143 suites passed; 2,851 passed, 6 skipped, 0 failed.
- Full Linux `jest --config jest.config.ts --maxWorkers=2 --silent --verbose=false`:
  the same 143 suites passed; 2,851 passed, 6 skipped, 0 failed. Both CI execution
  modes are covered. The disposable native-fixture flag is enabled in these runs;
  the existing skipped tests were not changed.
- Backend `pnpm --filter @plutonhq/core-backend exec tsc --noEmit -p tsconfig.json`,
  `pnpm --filter @plutonhq/core-backend lint` and
  `pnpm --filter @plutonhq/core-backend build`: passed. Prettier checks for the
  two changed files and `git diff --check` also passed.

Linux validation used Node.js 24.16.0 in the existing local fixture image, non-root
with no network, a read-only filesystem/code bind and disposable private tmpfs state.
An initial full-suite fixture attempt could not import agent source in two suites
because that read-only mount was missing. Completing the mount fixed the fixture;
both full reruns above include those integration tests and pass. No test assertion
or production check was weakened. The existing listener-limit warning remains.

## Operator pilot validation and rollback checklist

After a separately authorized deployment, keep the older job active and use the
existing Pilot A and Pilot B plans/storage/identity; do not recreate them:

1. Privately compare key/identity file fingerprints, encrypted credential bindings,
   configured roots, repository location and snapshot inventory before/after. Never
   paste the files or secrets. Confirm startup reused matching keys without rotation.
2. Deploy server first, then agent v0.4.1. Confirm online identity matches the same
   device; use local read-only preflight for both sources and their aliases. No ACL
   change is performed by the application.
3. Pilot A: one filesystem backup, real stages/counters, exact snapshot association,
   Select All counts, subset/empty-directory preview, private staged restore and
   download. Confirm live source and repository configuration are unchanged.
4. Pilot B: preserve DB IDs, credentials and explicit routines/events options. Verify
   all configured dumps plus live files occupy one snapshot; check artifacts/hashes
   and cleanup. Privilege failure must be labeled privileges, not wrong password.
5. Test one controlled retry/reconnect/failure against a disposable copy or approved
   test workload, not by changing production DB grants or stopping production services.
   Completion must not be overwritten by a late progress event or duplicate callback.
6. Run recovery on the exact completed snapshot. With import Disabled, expect Passed
   with warning and SQL import NOT TESTED. Only an independently provisioned disposable
   recovery target may enable Required import. No restore to source/production import.
7. If validation fails, wait/cancel and drain managed work before rollback. Restore
   the previous agent/application/config in compatible order while preserving identity,
   receipt history, private keys, persistent volume, encrypted DB credentials and all
   newly created snapshots. Do not purge/re-enroll, delete the volume, regenerate keys,
   reset repositories, restore an old control DB over newer completed backups, or run
   forget/prune/unlock/migrate/repair on Legacy. Verify the old service is healthy.

No production end-to-end success is claimed. Production permissions, certificate
rollout, credential revocation, security-advisory review, semantic application/SQL
acceptance and the decision to cut over remain manual infrastructure/security work.

## Changed files

54 task files (including regressions and this report). No migration, lockfile,
Legacy adapter, production config or notification feature was changed.

```text
agent/src/backupFilesystem.ts
agent/src/backupLifecycle.test.ts
agent/src/backupLifecycle.ts
agent/src/config.ts
agent/src/filesystemPolicy.ts
agent/src/index.ts
agent/src/inventory.ts
agent/src/lifecyclePolicy.ts
agent/src/lifecycleProcess.ts
agent/src/operationalHardening.test.ts
agent/src/progressDelivery.ts
agent/src/runtime.ts
agent/src/transport.ts
agent/test-fixtures/phase5/database-client.mjs
backend/__tests__/services/AgentService.test.ts
backend/__tests__/services/BackupEventService.test.ts
backend/__tests__/services/ConfigService.test.ts
backend/__tests__/services/CredentialManager.test.ts
backend/__tests__/services/RemoteRepositoryRecoveryService.test.ts
backend/__tests__/services/RestoreEventService.test.ts
backend/__tests__/stores/RemoteProgress.test.ts
backend/__tests__/utils/initSetup.test.ts
backend/__tests__/utils/operationalHardening.test.ts
backend/src/services/AgentService.ts
backend/src/services/ConfigService.ts
backend/src/services/CredentialManager.ts
backend/src/services/RemoteBackupService.ts
backend/src/services/RemoteRepositoryRecoveryService.ts
backend/src/stores/BackupStore.ts
backend/src/types/backups.ts
backend/src/utils/remoteBackupDiagnostics.ts
backend/src/utils/remoteBackupProgress.ts
docs/OPERATIONAL_HARDENING_REPORT.md
frontend/__tests__/operationalHardening.test.ts
frontend/__tests__/recoveryTests.test.ts
frontend/src/@types/backups.ts
frontend/src/components/Plan/AddPlan/AddPlan.tsx
frontend/src/components/Plan/BackupProgress/BackupProgress.module.scss
frontend/src/components/Plan/BackupProgress/BackupProgress.tsx
frontend/src/components/Plan/EditPlan/EditPlan.tsx
frontend/src/components/Plan/PlanProgress/PlanProgress.tsx
frontend/src/components/Plan/PlanStats/PlanStats.tsx
frontend/src/components/Plan/RecoveryTesting/RecoveryResult.tsx
frontend/src/components/Restore/RestoreFileSelector/RestoreFileSelector.tsx
frontend/src/components/Restore/RestoreWizard/RestoreConfirmStep.tsx
frontend/src/components/Restore/RestoreWizard/RestoreWizard.tsx
frontend/src/services/backups.ts
frontend/src/services/plans.ts
frontend/src/utils/progressHelpers.ts
frontend/src/utils/recoveryTests.ts
frontend/src/utils/remoteProgress.ts
frontend/src/utils/restoreSelection.ts
installers/install-agent.sh
installers/tests/install-agent.test.sh
```
