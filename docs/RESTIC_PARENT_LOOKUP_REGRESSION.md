# Restic parent lookup regression

## Scope and evidence boundary

Working branch: `codex/restic-parent-lookup-regression`, created from fetched,
reviewed `origin/main` at `8d572a6`. No commits, pushes, merges, releases,
deployment, production access, credential rotation, re-enrollment, repository
maintenance, or deletion of existing user snapshots were performed. Only
generated disposable fixture repositories were created and cleaned up.

The failure mechanism is reproduced against disposable **Restic 0.19.1 / Rclone
1.75.1 over SFTP**. It is not a production trace: the exact receipt IDs and
storage/network condition in the reported pilot were not inspected. In
particular, stale/foreign IDs explain the observed timing, but which IDs caused
the pilot's delay cannot be asserted without additional sanitized pilot evidence.

## Proven root cause and exact subprocess

The previous code gave an optional optimization mandatory failure semantics.
The stages were:

1. Initial `repository-check`: replay lookup of the current backup tag:
   `restic -r rclone:pluton:<managed-path> snapshots --json --tag pluton-backup-<backup-id>`.
2. DB lifecycle preparation, if enabled; managed target inspection/init safety.
3. Second `repository-check`: parent discovery:
   `restic -r rclone:pluton:<managed-path> --no-lock snapshots --json <receipt-id-1> ... <receipt-id-16>`.
4. Backup, only if discovery returned successfully.

`runtime.ts` supplies successful snapshot IDs from the agent's shared completion
receipts. Those receipts can refer to other plans/repositories or snapshots no
longer present. Previously they were passed directly to Restic **before** the
metadata compatibility checks.

Restic parses a full 64-character ID and attempts to load its snapshot directly;
it does not first require membership in the current repository's listing.
Explicit IDs are processed sequentially. A missing snapshot load is retried by
the backend. See the pinned upstream implementations of
[snapshot resolution](https://raw.githubusercontent.com/restic/restic/v0.19.1/internal/data/snapshot_find.go)
and [backend load retries](https://raw.githubusercontent.com/restic/restic/v0.19.1/internal/backend/retry/backend_retry.go).

The agent's 60,000 ms deadline terminated that process tree and rejected with
`Error("Backup process timed out.")`. `allowFailure: true` permitted exit-status
handling, **not timeout exceptions**. The parent block did not catch the
exception; the outer handler mapped it to
`repository-check / repository-check-failed`. Restic's `backup` subprocess was
never launched. Restic itself and its Rclone transport **were** launched for
metadata discovery. This matches the reported second-check-to-failure interval,
including an attempt where the DB dump had already completed.

### Real disposable timing evidence

| Operation against a healthy SFTP repository               | Observed result                                                    |
| --------------------------------------------------------- | ------------------------------------------------------------------ |
| Existing snapshot enumeration                             | Approximately 0.45–0.54 seconds                                    |
| One existing full snapshot ID                             | Approximately 0.46–0.53 seconds                                    |
| One absent full ID, exploratory run                       | 31.268 seconds before returning an empty result                    |
| Three absent full IDs, original 60-second deadline        | Timed out at 60.004 seconds; final repeat at 60.002 seconds        |
| Same absent-ID probe with shortened reproduction deadline | Timed out at about 8 seconds while config/existing reads succeeded |

These timings distinguish missing-ID retry delay from an unavailable repository.
They are fixture observations, not an SLA or a measurement of the pilot network.

## Fix and before/after behavior

Parent discovery now uses:

```text
restic -r rclone:pluton:<managed-path> --no-lock snapshots --json
  --tag pluton-plan-<plan-id> --latest 16
```

No receipt IDs become subprocess arguments. Returned IDs must still intersect
successful local receipts and satisfy the **unchanged** compatibility checks:
exact plan tag, backup tag, hostname, canonical source, artifact set, historical
private jobs root/layout, valid full snapshot/tree IDs and time. Another plan,
source, or repository cannot provide a parent.

`--latest` is per host/path combination, not an overall repository scan bound.
Restic reads metadata before applying filters, and changing DB workspaces can
produce multiple groups. The existing 60-second deadline and 1 MiB stdout cap
therefore remain necessary. A slow/large repository can still require fallback;
the fix does not hide this by increasing the timeout. See
[Restic 0.19.1 snapshots processing](https://raw.githubusercontent.com/restic/restic/v0.19.1/cmd/restic/cmd_snapshots.go).

| Condition                                                                           | New behavior                                                                                  |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Verified compatible, successfully receipted candidate                               | Use explicit `--parent`; optimization remains enabled                                         |
| No receipt or no compatible candidate                                               | Use existing isolated no-parent grouping                                                      |
| Optional discovery timeout, generic execution failure, malformed/oversized metadata | Reverify the exact repository; continue without explicit parent only if verification succeeds |
| Authentication, permission, transport, missing repository, known corruption         | Fail closed, even if an earlier check succeeded                                               |
| Repository reverification fails                                                     | Fail closed; do not start backup                                                              |
| Confirmed cancellation                                                              | Cancel, terminate descendants, clean temporary state; never fallback                          |

Verification uses `restic -r <same-repository> --no-lock cat config`, the same
Restic password, private Rclone config and environment. Its separate 30-second
deadline is bounded. Valid repository format 1/2 and repository ID are required.
This proves authenticated config access, **not a full repository integrity
scrub**. Recognized corrupt metadata remains fatal; normal backup and lifecycle
snapshot/artifact confirmation remain mandatory. No check/repair/maintenance
operation was introduced.

No-parent remains `--group-by host,paths,tags` with the unique current backup tag;
it cannot silently choose another plan's parent. Content deduplication still
works. Without a parent, Restic can legitimately report files as new; counters
are not fabricated. Source paths, SQL artifact paths and successful replay
statistics are unchanged.

The initial replay probe now has a 30-second deadline and preserves known
authentication/access/transport/corruption categories instead of silently treating
them as a missing backup. Existing managed initialization/non-empty-target guards
are unchanged.

## Diagnostics, subprocess cleanup, and security

The journal now distinguishes replay lookup, initial repository verification,
parent candidate discovery, metadata verification, selected/no-compatible parent,
timeout/invalid-metadata/execution fallback, reverification and real repository
failure. Reasons are closed categories, never raw stderr, stdout, credentials,
config contents, URLs, HMACs or lease tokens.

Repository subprocess stderr is bounded in memory solely for classification;
only its safe category is emitted. Oversized stdout is detected, not accepted as
complete metadata. Linux termination now also handles a leader that exits while
descendants retain stdio. SIGTERM/ bounded SIGKILL escalation is awaited before
reverification/cleanup, preventing concurrent orphaned readers. Tests cover this
and transient control-plane outages during fallback.

Parent checkpoints are local journal extensions. Progress maps to the existing
`preparing-repository` stage; failure/cancellation maps to established
`repository-check` and existing failure codes. No agent command/API schema change
is required. Existing backend accepted-completion logging already records
sanitized `command_failed` stage/code; the repository-check case is now regression
tested. Without production access, this task cannot establish why the reported
Docker log omitted a diagnostic or whether its completion reached that server.

Identity, encryption, permissions, root ownership, SFTP password obscuring, HTTP
pilot opt-in, private CA handling and allowed-root guards are unchanged. Legacy
read-only operations, recovery and notification runtime code are not modified.

## Changed files

- `agent/src/resticParent.ts`: existing-metadata discovery arguments/deadline constant.
- `agent/src/backupFilesystem.ts`: bounded verification, classified optional fallback,
  safe diagnostics, timeout/process-tree handling.
- `agent/src/runtime.ts`: journal-only safe repository reason.
- `agent/src/progressDelivery.ts`: backward-compatible stage aliases.
- `agent/src/resticParent.test.ts`: discovery and protocol compatibility guards.
- `agent/src/backupFilesystem.test.ts`: parent/fallback/error/cleanup regressions.
- `agent/test-fixtures/phase5/restic.mjs`: config-probe support in existing stub.
- `agent/test-fixtures/phase5/parent-restic.mjs`: root-owned disposable fault injector;
  non-injected operations delegate to real Restic.
- `agent/test-fixtures/restic-parent.Dockerfile`: local-only native fixture image.
- `backend/__tests__/agentManagedRepositoryTarget.test.ts`: mandatory config-probe mock/assertions.
- `backend/__tests__/services/AgentService.test.ts`: sanitized server failure logging.
- `backend/__tests__/integration/resticParentLookup.smoke.ts`: disposable real SFTP matrix.
- `backend/__tests__/integration/phase5Database.smoke.ts`: opt-in real DB timeout fallback.
- `scripts/validate-restic-parent-lookup.ps1`: isolated reproduction/acceptance runner.
- `docs/RESTIC_PARENT_LOOKUP_REGRESSION.md`: this report.

No dependency, lockfile, DB migration, installer, frontend or existing documentation
site/article changes. The agent application must be updated to obtain the fix;
server protocol changes and plan/storage recreation are unnecessary.

## Validation

Node.js 24 and pinned pnpm 10.20.0; Linux execution in disposable non-root
containers, read-only code mounts, private tmpfs, no production volumes or access.
SFTP tests use only container-local ephemeral endpoints and generated credentials.
Native DB fixtures are Alpine-based Linux containers, not an acceptance test on
the actual pilot host. Configuration bootstrap messages refer solely to their
disposable `/data` tmpfs; no persistent production keys were read or changed.

| Check                                              | Result                                                                                      |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Windows agent suite                                | 45 passed, 75 platform-skipped, 0 failed (120 total)                                        |
| Linux agent execution/permission suite             | 120 passed, 0 failed, 0 skipped                                                             |
| Agent typecheck/build                              | Passed                                                                                      |
| Full backend Jest suite                            | 153 suites passed; 2,969 passed, 4 skipped, 0 failed                                        |
| Backend lint/typecheck/production build            | Passed                                                                                      |
| Real SFTP parent regression runner                 | Passed: 13 cases plus first/second backups, exact restore and real MariaDB timeout fallback |
| Phase 5/6 native matrix                            | All 8 modes passed, including expected required-import failure                              |
| Phase 7 native notification matrix                 | All groups passed                                                                           |
| Existing native parent regression/installer guards | 7 native groups and 3 guards passed                                                         |
| Diff and sensitive-content/scope review            | Passed; unrelated paths unchanged                                                           |

Additional agent coverage includes authentication/access/transport/corruption
**after initial verification**, errors retained through timeout, missing receipts,
foreign repository/plan/source, malformed/oversized metadata, cancellation,
subprocess descendants and fallback after control-plane outages. Real wrong
repository/SFTP passwords and nonexistent/corrupt repositories refuse backup.

An intermediate backend run failed two existing target tests because their mocked
Restic runner did not implement the new config probe. The fixture was extended
with assertions; all 16 target tests and the full backend suite now pass. An early
native harness corrupted its baseline repository during fault injection; faults
now use a separate disposable repository, and before/after exact-snapshot restore
passes. These were resolved validation issues, not unexplained baseline failures.

### Reproduction commands (local disposable fixtures only)

```powershell
pnpm --filter @plutonhq/pluton-agent build
pnpm --filter @plutonhq/pluton-agent typecheck
pnpm --filter @plutonhq/pluton-agent test
pnpm --filter @plutonhq/core-backend test --runInBand --silent --verbose=false
pnpm --filter @plutonhq/core-backend lint
pnpm --filter @plutonhq/core-backend exec tsc --noEmit -p tsconfig.json
pnpm --filter @plutonhq/core-backend build
# Build the existing real-DB base fixture as documented in PHASE5_DATABASE_LIFECYCLE.md.
docker build -f agent/test-fixtures/phase5/RealDatabase.Dockerfile -t pluton-phase5-real-db:local .
docker build -f agent/test-fixtures/restic-parent.Dockerfile -t pluton-restic-parent-tests:local .
./scripts/validate-restic-parent-lookup.ps1 -BaselineOnly  # expected old-ID timeout, asserted by harness
./scripts/validate-restic-parent-lookup.ps1
./scripts/validate-phase6.ps1 -Modes @('single','two-mariadb','mixed','phase6-filesystem','phase6-mariadb','phase6-postgresql','phase6-mixed','phase6-mixed-failure')
./scripts/validate-phase7.ps1
./scripts/validate-product-hardening.ps1
git diff --check
```

The 500 ms/300 ms fault budgets are trusted in-process fixture arguments only,
capped at the production 60-second budget. Remote envelopes reject such fields.
Normal successful integration operations use the production deadline.

## Safe deployment procedure — operator action after review

1. Retain the previous reviewed agent artifact privately. Confirm there is no
   leased/running backup or DB lifecycle work before stopping/updating the agent.
2. Preserve the current agent configuration, identity/completion receipts, state
   directory, all allowed roots, hook/client paths and private CA settings. Do not
   paste their contents into logs/tickets or put backups of secrets in Git.
3. Install this reviewed agent build using the existing transactional installer
   and **the same configuration**. Supply every required allowed root; retain the
   deliberate LAN-HTTP opt-in if applicable. Do not provide `--re-enroll`, an
   enrollment token, purge, or new identity/credentials. Keep private pinned
   Restic/Rclone/runtime binaries and service account boundaries.
4. Verify tools execute as the existing non-root service user, root-owned code is
   not service-writable, temporary config remains 0600, and heartbeat still
   authenticates the same device. No global Node replacement or ACL changes.
5. Run one existing-plan backup, then an unchanged repeat. Inspect safe journal
   checkpoints and completion receipt. A matching parent should be selected on
   the repeat; a safe fallback should be clearly labeled, not a fake zero counter.
6. Browse/download and restore the **exact new snapshot** to validated private
   staging only. Run the existing opt-in Recovery Test against dedicated disposable
   import targets. Check cleanup and terminal Phase 7 notification behavior.
7. Keep server `SECRET`, `ENCRYPTION_KEY`, persistent volumes, stored credentials,
   repository password, existing snapshots and agent identity unchanged. No
   repository maintenance or plan/storage recreation is required.

## Rollback

If installation validation fails, the existing installer transaction restores the
previous application/configuration. If an operational regression appears later,
wait for work to finish safely, stop the service and restore the previous reviewed
application artifact using the existing install/rollback procedure, preserving
the **current** identity, receipts and state. Do not replace these with stale
identity copies or rotate keys. Verify service-user tool access and heartbeat.
Do not roll back repository data, delete snapshots, restore to the source, or run
unlock/prune/repair to compensate. Rolling back to the affected parent build can
reintroduce the lookup failure; retain that limitation when choosing the artifact.

Unit/integration success is not production end-to-end acceptance. The idle-agent
update and exact-snapshot validation above still require a separately authorized
operator rollout.
