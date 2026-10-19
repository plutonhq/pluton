# Delete/remove reliability and operational list UX

Review candidate, 18 October 2026. Baseline local and remote fork `main`:
`56dd2520c3b262a383004b059cba0dd3354f414f`. Working branch:
`codex/delete-reliability-table-ux`. No commit, publication or deployment performed.

## Production incident versus source defects

The operator supplied a browser record showing **DELETE**
`/api/plans/<selected-id>?removeData=true` returning **405 Method Not Allowed**,
followed by an HTML-as-JSON parsing error. A separate 520 was reported, without
enough information to associate it with this request. Production identifiers are
intentionally omitted from this report.

The immediate parsing failure is confirmed. The producer of the 405 is still
unknown: old application routing, a reverse proxy/method policy or another upstream
layer require sanitized response headers and redirect information to distinguish.
The current source already registers authenticated `DELETE /api/plans/:id` and
returns JSON 200/error responses. It still blindly parsed deletion responses as
JSON, so the MySQL Internal merge did **not** already fix the parsing defect.

Execution path: PlanRemoveModal -> services/plans.deletePlan -> same-origin DELETE
with credentials and JSON headers -> existing web origin/CSRF check -> authenticated
plan router -> PlanController -> PlanService -> selected backup strategy -> native
storage cleanup -> transactional metadata removal -> JSON response -> query/UI
update. Remote managed plans intentionally retain their repository and report it.

The fix preserves that method and route. It does not retry through another verb,
follow mutation redirects or bypass a proxy. Deploying this candidate alone cannot
be claimed to correct a proxy-generated 405. An HTML/transport error does not prove
that the mutation failed; check selected-resource state before considering a retry.

## Confirmed fixes

- Bind replica purge to its stored identity and path; mismatched selection or
  missing identity for data deletion fails with 409. Metadata-only removal does
  not purge storage.
- Refuse whole-directory purge of roots/traversal or paths overlapping another
  retained plan, snapshot/mirror reference or registered local Legacy repository.
  Reject active backup/restore and concurrent same-service removal requests.
- Delete a plan's history, credentials and plan row in one SQLite transaction.
  A forced parent-delete failure demonstrates rollback. Filesystem purge is
  external and cannot be rolled back by SQLite.
- Retain snapshot metadata when lookup/forget fails; only verified snapshot absence
  is idempotent. Preserve `encryption:false`. Propagate backup 404/409/501 correctly.
- Centralize HTTP/envelope validation for affected clients: JSON failures, status
  failures, expected 204, asynchronous 202, redirects, HTML, malformed/empty bodies
  and transport uncertainty. Disable automatic destructive retries/redirect following.
  Asynchronous retained-restore results remain pending lifecycle results.
- Preserve confirmations, freeze toggles while pending, block duplicate submission
  and closing during pending actions, retain server/uncertainty feedback inline and
  in toasts. Correct the plan dialog's storage-retention wording and toggle label.
- Return JSON 404 for unmatched API routes instead of SPA/default HTML; redact
  uncaught API errors while preserving failure status. Existing auth/origin handling
  and documentation/static deep links remain intact.

## Actual destructive-action inventory

All routes below are under `/api`. Status describes local evidence, not physical
deletion acceptance for every feature.

| Action and route | Status and evidence |
| --- | --- |
| Remove plan: `DELETE /plans/:id?removeData=` | **FIXED**; real route/service/SQLite tests, both toggle values, unrelated rows survive, rollback, partial-purge warnings, auth 401/origin 403 and conflicts. Native storage commands mocked. |
| Remove replica: `POST /plans/:id/action/delete-replication-storage` | **FIXED**; stored binding, missing identity, own-primary/other retained overlaps, metadata-only no-purge and duplicate conflicts tested. |
| Remove snapshot: `DELETE /backups/:id` | **FIXED**; lookup/forget failures retain history, active operation/status regressions and actual frontend contract tested. No real Restic deletion. |
| Remove connection: `DELETE /storages/:id` | **CLIENT FIXED / existing backend regressions PASS**; dependency checks for primary, replica, source and self-backup; no arbitrary storage purge added. |
| Remove restore history: `DELETE /restores/:id` | **CLIENT FIXED / existing service regressions PASS**; history entry deletion, not proof of physical staging cleanup. |
| Unregister Legacy: `DELETE /legacy-repositories/:id` | **CLIENT FIXED / existing route regressions PASS**; registration only, repository retained. No Legacy mutation added. |
| Prune: `POST /plans/:id/action/prune` | **CLIENT FIXED**; request/response contract tested. Physical retention workload **NOT TESTED**, implementation unchanged. |
| Retained DB restore Delete: `POST /database-restores/:id/delete` | **CLIENT FIXED**; actual 202 lifecycle result preserved/tested. Root/native lifecycle unchanged; physical cleanup **NOT RETESTED**. |
| Recovery test cancel: `POST /recovery-testing/:planId/tests/:id/cancel` | **CLIENT CONTRACT TESTED**; durable backend cancellation/physical cleanup **NOT RETESTED**. |
| Notification channel: `DELETE /notifications/channels/:id` | **CLIENT FIXED**; frontend notification regressions pass; backend deletion not rerun. |
| Agent/device revoke: `POST /agent-admin/{devices,enrollments}/:id/revoke` | **CLIENT FIXED**; selected endpoint contracts tested; actual Agent revocation **NOT TESTED**. |
| Download cancellation: `DELETE /backups/:id/action/download`; restore cancel: `POST /restores/:id/action/cancel` | Actual download client/relevant backend regressions pass; not a physical proof of all cancellation paths. Restore cancellation implementation unchanged. |

## Table/list UX inventory

| Surface | Result |
| --- | --- |
| Plans | **IMPROVED**: search/filter/sort compose; saved filters survive sorting and refetch; deterministic ties; 10/25/50 page size, counts, reset/clamp and empty/error states. |
| Sources | **IMPROVED**: fix shadowed tag accumulator; search/tag/sort compose and survive polling; pagination/counts; selected tag remains available after deletion. |
| Storages | **IMPROVED**: composed search/type/sort, pagination/counts and error/filtered-empty feedback. |
| Legacy registrations | **IMPROVED**: name/path search, validation-status filter, sort and pagination; read-only notice and existing links preserved. |
| Backup history, Legacy snapshots, notification deliveries | **ALREADY IMPLEMENTED**: existing server pagination/filtering retained. |
| Snapshot/restore file browsing, LogViewer | **ALREADY IMPLEMENTED**: existing search/filter/virtualization or paging retained. |
| Retained database restore history and plan restore history | **DEFERRED**: need server pagination API; client paging must not disguise an unbounded history request. |

The four changed lists use their existing configuration-list responses; no new
fetch, history hydration, dependency or API was introduced. Native named controls
remain keyboard-operable; jsdom verifies labels, disabled boundaries and focus
retention, not browser visual acceptance or physical Enter/Space behavior.

## Validation

Node 24.16.0 and project-local repository-pinned pnpm **10.20.0**; existing lockfile
and dependencies unchanged. Temporary test data and tool files remain in ignored
project `tmp/`; no global package/configuration modification.

| Check | Result |
| --- | --- |
| Backend targeted/dependent deletion tests, 13 suites | **426 PASS / 0 FAIL**; includes 27 new real SQLite/HTTP deletion tests. |
| Additional API fallback, dual-origin and authentication suites | **45 PASS / 0 FAIL**. Initial sandbox-only loopback EACCES resolved by authorized local test execution. |
| Frontend deletion, table interactions and dependent client/UI suites | **79 PASS / 0 FAIL / 0 skipped**; real bundled clients and ReactDOM/jsdom components. |
| Backend TypeScript, changed-source ESLint | **PASS**. |
| Frontend TypeScript build | **PASS**. |
| Backend package build; frontend Vite/PWA build | **PASS**; frontend reports existing chunk-size and stale Browserslist warnings. No docs/Phase6 physical workload rerun. |
| Frontend ESLint | **FAIL — pre-existing baseline**: string `eslint-config-prettier` in `tseslint.config()` extends rejected before linting. Config unchanged; no lint-clean claim. |
| Diff whitespace check | **PASS**. |

Total selected tests: **550 PASS**, not a full regression suite. Backend operations
that would call Restic/Rclone/native deletion are mocked; no real repository,
existing snapshot, production plan, VM, Docker or root operation was used.

Reproduction commands (from respective package directories; set TMP/TEMP to the
project-local test directory):

```text
backend: jest --runInBand (the 13 selected suites recorded in private test evidence)
backend: jest --runInBand __tests__/utils/spaFallback.test.ts __tests__/routes/dualOrigin.test.ts __tests__/middlewares/authMiddleware.test.ts
frontend: node --experimental-strip-types --test __tests__/delete*.test.ts __tests__/tableCollections.test.ts __tests__/databaseRestores.test.ts __tests__/recoveryTests.test.ts __tests__/notificationDelivery.test.ts __tests__/backupDownload.test.ts __tests__/remoteLifecycle.test.ts __tests__/remoteLifecycleCards.test.ts __tests__/rowActionMenu.test.ts
backend: pnpm exec tsc --noEmit -p tsconfig.json
backend: pnpm exec eslint <the seven changed backend source files>
backend: pnpm run package
frontend: pnpm exec tsc -b
frontend: pnpm exec vite build
frontend: pnpm lint
root: git diff --check
```

Private machine-readable test results, build logs, exact changed-file hashes and
candidate manifest remain in ignored `tmp/delete-ux-sprint/`, excluded from Git.

## Review/deployment limits

No migration, API method/schema change, resource-policy adjustment or MySQL root
lifecycle change. Existing clients remain compatible; new guards can intentionally
return 409 rather than permit ambiguous storage deletion. Deploy matching reviewed
frontend/backend artifacts after separate approval; current production is still old.
The existing Phase6/production acceptance decisions are not changed by this sprint.

Overlap checking uses recorded storage IDs and normalized paths. Cross-connection
aliases, symlinks and races with scheduling/other processes are not proven safe by
these tests; the in-memory removal guard is not a durable cross-process lease.
Partially completed external purges cannot be undone by a database rollback.
Do not treat this as certification of arbitrary shared storage layouts or all
physical cleanup paths. Review those limits before approving data-purge use.

Next step: review the complete source diff and the production 405 routing evidence.
No commit, push, redeploy or production operation is authorized by this report.

## Focused retained database dependency audit

The following applies to MySQL, MariaDB and PostgreSQL, Internal and Custom
persistent restores. A retained database is not the ordinary file-restore history
entry in `restores`.

1. **`removeData=false`, with no unresolved retained dependency:** the plan,
   ordinary backup/file-restore history and plan database credentials are removed;
   repository bytes and snapshots are retained. For managed remote plans, the
   repository registration and its encrypted repository password are removed too,
   even though the physical repository remains. Retained bytes alone do not
   guarantee future repository access after that credential is removed; recovery
   credentials/backup must be secured through an authorized operator process.
   Storage connection credentials
   are not deleted by plan removal. Persistent database history has no plan/backup
   cascade and must remain separate.
2. **`removeData=true`, with no unresolved retained dependency:** the same metadata
   removal occurs; supported local/older managed strategies additionally attempt
   exact recorded primary and replica directory purges. This can physically erase
   that repository's snapshots/objects, not just its database dump. Failures are
   reported as retained paths; external purge is not transactionally reversible.
   Remote managed repository bytes remain retained under their existing policy,
   regardless of this toggle. No persistent database Delete is invoked.
3. **Unresolved persistent restore:** both plan deletion options and affected backup
   deletion must return 409 before schedule/repository/native mutations. Retaining
   the row alone was insufficient: queued/provisioning/importing execution calls
   `RemoteRepositoryRecoveryService.context/testMetadata`, requiring the plan,
   backup completion receipt, full snapshot ID, repository identity/password and
   Agent binding. Removing these could strand a job or trigger its failure cleanup.
   Active/Stopped inspection and expiry cleanup normally use the retained approval,
   lease and ownership, but independent survival across arbitrary plan removal was
   not certified; refusal is the conservative contract.
4. **Shared backup/snapshot:** ordinary running restore checks and retained database
   dependencies must be checked before removing metadata or forgetting a snapshot.
   Retained dependency matching includes plan, backup and full snapshot identity;
   a differently named backup must not evade protection for the same snapshot.
   Whole-directory purge also retains the sprint's other-plan/history/Legacy
   overlap checks. This does not certify storage aliases or symlinks.
5. **Baseline was not fail-closed for these dependencies.** The focused fix refuses
   unresolved rows, residual import leases and unremoved root lifecycle records.
   It allows history whose Delete is verified complete, without cascading its
   audit record. UI 409 responses link to Database Restore Management and never
   automatically invoke its Delete endpoint.

Dependency responses carry HTTP 409 and code
`RETAINED_DATABASE_RESTORE_DEPENDENCY`. Checks run before external mutations and
again inside the final metadata transaction. A same-process removal marker blocks
new retained reservations during asynchronous source removal; reservation also
revalidates plan, backup, repository and full snapshot in its SQLite transaction,
so an old preview cannot create a reservation after source deletion. This is not
a durable cross-process deletion lease: concurrent application processes, external
repository mutations and storage alias races remain outside the proven boundary.

Schema evidence: migration 0012 deliberately has no plan/backup FK on
`persistent_database_restores`; binding is immutable and history deletion is
guarded while undeleted or leased. Migration 0015 separately guards history while
the automatic lifecycle is not Removed. These guards prevent deleting retained
history; they did not prevent deletion of its source plan/backup. Retained
`encrypted_approval`, owner token, artifact digest, target fingerprint and lease
are separate from plan/source credentials. `finishDeleted` clears the retained
approval only after its own cleanup path; plan deletion must not clear it.

TTL evidence: `pending()`/`dispatch()` use retained `expires_at` and cancellation
intent; cleanup invokes `removeOwned` with stored approval and exact lease, then
waits for complete authenticated root Removed receipts for automatic Internal
targets. Neither a plan removal conflict nor a missing source snapshot authorizes
an early physical removal. No root operator, sequence, 0016 or resource policy
change is part of this fix. Physical TTL/cleanup across real engines is not run.

Focused validation: **282 backend tests across 9 suites** (280-case run plus two
additional HTTP contracts, with the two route suites rerun at 52/52; counts are
deduplicated), including 37 dependency cases and three simulated engine TTL cases.
**16 frontend tests PASS**, including actual 409 client/dialog behavior and the
management link. Backend/frontend TypeScript and changed backend source ESLint
PASS. No physical TTL wait or infrastructure cleanup was run. The earlier
550-test run is historical evidence for the base sprint, not a claim that all
550 were rerun for this addition. Frontend ESLint baseline remains unresolved.

## Exact changed-file inventory

- `backend/__tests__/managers/BaseSnapshotManager.test.ts`
- `backend/__tests__/routes/backups.test.ts`
- `backend/__tests__/routes/plans.test.ts`
- `backend/__tests__/services/BackupServices.test.ts`
- `backend/__tests__/services/DatabaseRestoreService.test.ts`
- `backend/__tests__/services/DeleteReliability.test.ts`
- `backend/__tests__/services/PlanService.test.ts`
- `backend/__tests__/stores/PlanStore.test.ts`
- `backend/__tests__/stores/RetainedRestoreDependencies.test.ts`
- `backend/__tests__/utils/spaFallback.test.ts`
- `backend/src/controllers/BackupController.ts`
- `backend/src/controllers/PlanController.ts`
- `backend/src/managers/BaseSnapshotManager.ts`
- `backend/src/services/BackupServices.ts`
- `backend/src/services/PlanService.ts`
- `backend/src/stores/DatabaseRestoreStore.ts`
- `backend/src/stores/PlanStore.ts`
- `backend/src/utils/retainedRestoreDependency.ts`
- `backend/src/utils/spaFallback.ts`
- `backend/src/utils/storageRemovalScope.ts`
- `docs/DELETE_REMOVE_TABLE_UX_REPORT.md`
- `frontend/__tests__/deleteClients.test.ts`
- `frontend/__tests__/deleteDialogs.test.ts`
- `frontend/__tests__/deleteResponse.test.ts`
- `frontend/__tests__/notificationDelivery.test.ts`
- `frontend/__tests__/tableCollections.test.ts`
- `frontend/src/components/Plan/Backups/Backups.tsx`
- `frontend/src/components/Plan/PlanRemoveModal/PlanRemoveModal.tsx`
- `frontend/src/components/Plan/PlanSettings/PlanReplicationSettings.tsx`
- `frontend/src/components/Plan/Restores/Restores.tsx`
- `frontend/src/components/Storage/StorageItem/StorageItem.tsx`
- `frontend/src/components/common/ActionModal/ActionModal.tsx`
- `frontend/src/components/common/ActionModal/DeleteDependencyNotice.tsx`
- `frontend/src/components/common/Table/CollectionControls.module.scss`
- `frontend/src/components/common/Table/CollectionControls.tsx`
- `frontend/src/components/common/Table/collection.ts`
- `frontend/src/components/common/Table/useCollectionPage.ts`
- `frontend/src/components/common/form/Toggle/Toggle.tsx`
- `frontend/src/routes/LegacyRepositories/LegacyRepositories.tsx`
- `frontend/src/routes/Plans/Plans.tsx`
- `frontend/src/routes/Sources/Sources.tsx`
- `frontend/src/routes/Storages/Storages.tsx`
- `frontend/src/services/backups.ts`
- `frontend/src/services/databaseRestores.ts`
- `frontend/src/services/devices.ts`
- `frontend/src/services/legacyRepositories.ts`
- `frontend/src/services/notifications.ts`
- `frontend/src/services/plans.ts`
- `frontend/src/services/recoveryTests.ts`
- `frontend/src/services/restores.ts`
- `frontend/src/services/storage.ts`
- `frontend/src/utils/httpResponse.ts`
