# Verified application fixes and ingress investigation

Baseline `c69dfd8`; branch `codex/verified-production-fixes`. This patch reduces
progress traffic, distinguishes intentional retention from failed cleanup, and
preserves encrypted access to retained managed Agent repositories. It does not
establish or fix the production issuer of HTTPS 429 or HTML 405.

## Confirmed causes and changes

| Area | Before | After |
| --- | --- | --- |
| Backup and filesystem restore progress | One GET per second; status/HTML errors could keep polling | Shared policy starts at 3 seconds, slows identical observations to 6 then 12 seconds, and resets on change. Hidden tabs do not fetch; returning focus resumes eligible checks. |
| Polling failures | No explicit Retry-After handling | Delta/date Retry-After is a minimum deadline; transient failures back off 5/10/20 seconds. Four consecutive failures pause checks; permanent 4xx errors pause immediately. Focus/invalidation cannot bypass the deadline. Requests have a 15-second abort deadline. |
| Completion | Only the finished event stopped polling | Completed, failed and cancelled status also stop polling. Error feedback distinguishes monitoring failure from the underlying operation. |
| Plan removal UI | Retention and failed purge shared an ambiguous warning | Additive typed `storageDisposition` reports `retained_intentionally`, `cleanup_failed`, `retained_by_request`, or `removed`. Old response fields remain for older clients; new clients do not infer disposition from message strings. |
| Agent repository access | Live repository record and unique encrypted password were deleted while bytes remained | Migration 0017 adds encrypted escrow. PlanStore archives the original ciphertext and repository binding in the same transaction as metadata removal. An archive conflict/write failure rolls back metadata removal. |
| Later purge | Deleted-plan repository path was no longer a retained reference | Archived storage ID/path participates in existing overlap guards. No new purge, Restic mutation, agent command, or Legacy registration is introduced. |

The global limiter remains 1,000 requests/IP/15 minutes. Login, setup, restore
and notification limits are unchanged. Normal changed progress uses about 300
interval GETs per 15 minutes rather than 900, excluding initial/focus requests.
This is not a total-request guarantee for multiple tabs, jobs or shared proxy IPs.

The bounded policy applies to backup and filesystem restore progress GETs, not
database lifecycle mutations or the separate five-second database-management
polls. The explicit Retry progress checks action restarts monitoring only after
the cooldown; it never restarts the backup or restore. Observers and remounts
share the query budget, released when the query is garbage-collected. A page
reload is not a substitute for waiting
out an ingress rate limit.

## Credential preservation and limits

`retained_managed_repositories` contains the repository ID, former plan ID,
agent ID, storage ID/path, original encrypted password and timestamps. It has no
cascading dependency on the deleted plan. The key remains the existing control
plane `SECRET`; this patch never decrypts or regenerates the repository password
while deleting. `ENCRYPTION_KEY`, identity and source DB credentials are not
rotated. Source DB credentials still follow the existing plan-removal policy.

There is no plaintext export, archive API, archive GC or automatic re-adoption.
Recovery using an archived repository requires a separately reviewed operator
workflow and the original application key, database and suitable storage access.
Protect the whole application database and existing secrets with the existing
secure backup procedure. Do not query ciphertext or keys into tickets or logs.
Removal of a separate storage connection can still require restoring/recreating
its access configuration; escrow preserves the Restic password, not external
infrastructure availability.

Migration 0017 cannot recover credentials already deleted before this patch.
An existing secure application-state backup may be needed in such a case; do
not overwrite current state or re-key a repository as an attempted repair.

Archive conflicts fail closed rather than overwriting a previous credential.
Archives conservatively keep their path protected indefinitely, even if an
operator later removes repository bytes outside Pluton. No archive-delete UI is
introduced in this patch.

Persistent database dependencies still return HTTP 409 before plan removal.
Managed Agent repositories are never purged for either removeData value.
For standard managed storage, removeData=true still permits the existing guarded
whole-path Rclone purge, not snapshot-level deletion. Storage aliases and
unregistered external data are not proven exclusive by string/path guards.
Physical purge and schedule changes cannot be rolled back by SQLite; a failed
metadata transaction preserves credentials/history but may leave a removed
schedule requiring normal reconciliation. Do not repeat destructive operations
on an uncertain HTTP result.

## HTTPS routing proposal pending operator evidence

Port 5173 is also the production Node server; it does not prove a Vite dev server.
The production browser client uses its current origin for /api. The existing
backend DELETE route returns JSON; auth and origin refusals remain enforced.
The client still refuses HTML 405, redirects and automatic destructive retries.

Inspect the actual matching virtual host and all ingress layers before applying
any change: location selection, proxy_pass URI replacement, rewrite/try_files,
method rules, proxy_method, error_page/proxy_intercept_errors, WAF events,
upstream address and exact deployed image revisions. Verify the exact hostname.

If evidence proves that /api is being routed to a static frontend or losing its
prefix, the minimal routing shape is the following illustrative location inside
the **existing reviewed server**, not a standalone deployable configuration:

```nginx
# pluton_private_upstream must identify the verified application backend.
location ^~ /api/ {
    proxy_pass http://pluton_private_upstream;
    # No URI suffix: preserve /api/... and query string.
    proxy_set_header Host $host;
    proxy_intercept_errors off;
    # Retain reviewed authentication, WAF, rate-limit and forwarding policies.
    # Do not replace the method, redirect mutations or use try_files here.
}
```

The snippet is conditional and was not applied or tested against live ingress.
Review inherited directives and nginx location precedence before using it;
duplicating an existing location is not safe. Keep TLS/session/CSRF validation
and method authorization. If another trusted proxy terminates HTTPS, its scheme
and client-IP propagation need their own validated policy: do not blindly copy
caller-supplied forwarding headers or use the private HTTP hop's scheme.

No TRUST_PROXY change is required just to deploy this patch. If logs establish
shared proxy-IP buckets, approve the precise last-hop peer addresses/CIDRs,
sanitize incoming forwarding metadata, and restrict upstream access while
preserving authorized direct LAN use. Do not set true or a blind hop count.
Only tune a WAF/nginx rate/burst/key when its rejection evidence identifies the
actual rule. Do not disable protection or raise all limits to hide the symptom.

## Safe verification and deployment

1. Review code, migration and CI. Back up application SQLite state consistently
   together with the existing secrets and storage configuration using the reviewed
   procedure. Keep the persistent volume unchanged.
2. Validate migration 0016 to 0017 and synthetic deletion on a disposable database.
   Check normal/terminal polling, 429 delta/date cooldown, hidden-tab behavior,
   interrupted requests, error cutoff, retention notices, archive failure and
   retained DB 409. No production DELETE reproduction is necessary.
3. Have an authorized operator compare selected non-secret image digest/build
   identifiers and read-only health responses across direct and HTTPS paths.
   Version headers alone do not prove identical builds.
4. Correlate existing failed requests using method, sanitized path, timestamp,
   Content-Type, Allow, Retry-After/RateLimit headers, request ID, response status,
   upstream status/address and WAF rule action. Never export raw HAR/cookies,
   authorization headers, keys, full container environments or credential files.
5. Release/deploy only after separate approval. Preserve SECRET, ENCRYPTION_KEY,
   /data, agent identity, storage credentials and repository bytes. No agent update
   is needed. Observe normal GET traffic without forcing bursts or destructive
   retries. Production 405/429 remain unverified until ingress evidence closes them.

For an ingress change, save the reviewed prior configuration, validate syntax,
then perform only the separately authorized reload and non-mutating checks. Restore
that exact configuration if routing/security checks fail; never disable the WAF
or CSRF as rollback.

For application rollback, keep the current volume, keys, migration ledger and
archive table intact. The additive table does not require dropping/reversing a
migration. Older code does not protect archived paths or escrow future removals:
freeze plan/storage deletion and purge operations during rollback. Prefer a
reviewed compatible image retaining these safeguards. Do not restore an old
database snapshot over newer escrow or assume an image rollback reverses purge.

## Validation results

Local Windows validation used Node 24.16.0 and pinned pnpm 10.20.0 with the existing
lockfile. No dependencies, authentication limits, Agent source/protocol, deployment
environment or production resources changed.

| Check | Result |
| --- | --- |
| `pnpm --filter @plutonhq/core-backend test --runInBand` | PASS: 177 suites, 3,519 passed, 4 skipped, 0 failed |
| `node --experimental-strip-types --test frontend/__tests__/*.test.ts` | PASS: 191 passed, 0 failed |
| Backend security and store follow-up | PASS: 54 tests, including sanitized archive conflicts and real SQLite rollback |
| Backend `exec tsc --noEmit -p tsconfig.json`, frontend `exec tsc -b` | PASS |
| Backend lint | PASS |
| Frontend lint | FAIL before source checking: existing typescript-eslint configuration rejects the `eslint-config-prettier` string in extends; no suppression or lint configuration changes |
| `pnpm build` | PASS: frontend, documentation, backend and Agent build tasks; no image publication |
| `git diff --check` | PASS |
| Production ingress/browser acceptance and physical SFTP/S3 deletion | NOT RUN |

The four platform-dependent skips cover a staging symlink escape, Linux filesystem
analysis, executable/parent ownership checks and isolated native DB clients.
Linux CI remains required. Native storage deletion is mocked; these passes do not
certify real repository purge, production ingress or production recovery.

Initial full-suite failures were resolved without dropping checks: the historical
0016 test now checks that migration's exact positions rather than requiring it to
remain last forever, and the store mock implements the new Drizzle `.get()` read.
The actual migration, Resume guards, rollback, ciphertext preservation and FK-on
completed recovery-history removal are exercised against disposable SQLite.

Frontend coverage includes Retry-After delta/date, missing/invalid headers,
transient/permanent failures, failure-budget reset, hidden tabs, terminal events
and statuses, cancellation, real TanStack invalidation/focus behavior, shared
observer budgets, HTML 405 without mutation replay, 409 dependency guidance and
DOM rendering of typed retention/cleanup notices. The application route also
returns JSON for an approved HTTPS origin over a synthetic private HTTP hop.

## Changed files and release review

Backend implementation and migration:

```text
backend/drizzle/0017_retained_managed_repositories.sql
backend/drizzle/meta/_journal.json
backend/src/controllers/PlanController.ts
backend/src/db/index.ts
backend/src/db/schema/retainedManagedRepositories.ts
backend/src/services/PlanService.ts
backend/src/services/RemoteBackupService.ts
backend/src/stores/PlanStore.ts
backend/src/types/plans.ts
backend/src/utils/storageRemovalScope.ts
```

Frontend implementation:

```text
frontend/src/utils/progressPolling.ts
frontend/src/services/backups.ts
frontend/src/services/restores.ts
frontend/src/services/plans.ts
frontend/src/components/Plan/BackupProgress/BackupProgress.tsx
frontend/src/components/Plan/PlanRemoveModal/PlanRemoveModal.tsx
frontend/src/components/Plan/PlanRemoveModal/UnremovedPathsNotice.tsx
```

Tests and documentation:

```text
backend/__tests__/db/AutomaticRecoveryResumeMigration.test.ts
backend/__tests__/db/RetainedRepositoryMigration.test.ts
backend/__tests__/services/DeleteReliability.test.ts
backend/__tests__/services/PlanService.test.ts
backend/__tests__/services/RemoteBackupService.test.ts
backend/__tests__/stores/PlanStore.test.ts
frontend/__tests__/progressPolling.test.ts
frontend/__tests__/deleteClients.test.ts
frontend/__tests__/deleteDialogs.test.ts
docs/VERIFIED_PRODUCTION_FIXES.md
```

Exclude generated build/test output and local `.pnpm-store/v11/.tmp` bootstrap
cache from release review/staging. Existing cache entries were not recursively
removed because their ownership could not be established. No credentials or
production inventories belong in the patch or its evidence.

| Outcome | Classification |
| --- | --- |
| Bounded polling, typed retention notice and encrypted escrow | FIXED AND TESTED locally |
| Runtime UI behavior and migration in the operator deployment | FIXED LOCALLY, NEEDS DEPLOYMENT VALIDATION |
| Actual HTTPS 429 and HTML 405 issuers | BLOCKED / NEEDS MORE EVIDENCE |
| Proven incorrect ingress rules or shared-IP configuration | REQUIRES PRODUCTION CONFIGURATION only after operator evidence identifies the rule |

No commit, push, PR, merge, release or deployment was performed.
