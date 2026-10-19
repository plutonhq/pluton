# Existing community architecture

Baseline inspected for Phase 0: commit `5c74a48`, application version `0.20.0`.
This describes the checked-in public source, not proprietary editions. Phases 1-2
add a separate local, read-only legacy repository adapter; they do not modify the
managed backup lifecycle.

## Application structure

| Area           | Current implementation and entry points                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Workspace      | TypeScript monorepo with pnpm `10.20.0`, `backend/` and `frontend/` packages, and Turborepo build orchestration. Backend CI uses Node.js 24. See [package.json](../package.json), [pnpm-workspace.yaml](../pnpm-workspace.yaml), and [turbo.json](../turbo.json).                                                                                                                                                                                |
| Backend        | Node.js, Express 5, and TypeScript. [index.ts](../backend/src/index.ts) handles startup; [createApp.ts](../backend/src/createApp.ts) wires stores, managers, services, controllers, routes, middleware, and jobs. Routes/controllers call services, stores access the database, and managers/handlers run backup and restore operations.                                                                                                         |
| Frontend       | React 18, Vite 6, React Router 7, TanStack Query, and SCSS modules. [main.tsx](../frontend/src/main.tsx) installs providers; [router.tsx](../frontend/src/router.tsx) maps pages. `routes/`, `components/`, `services/`, and `hooks/` organize screens, UI, API access, and state. Snapshot browsing also uses Dexie/IndexedDB through [useSnapshotDatabase.ts](../frontend/src/components/common/SnapshotBrowser/hooks/useSnapshotDatabase.ts). |
| Database       | SQLite through `better-sqlite3` and Drizzle ORM, with WAL enabled in [db/index.ts](../backend/src/db/index.ts). Schemas live in `backend/src/db/schema/`, migrations in `backend/drizzle/`, and persistence helpers in `backend/src/stores/`. Tables cover plans, backups, restores, devices, storages, settings, separate read-only legacy registrations, and separate legacy staged-restore jobs.                                              |
| Local state    | [AppPaths.ts](../backend/src/utils/AppPaths.ts) locates the database, config, schedules, logs, temporary files, cache, downloads, and restores. Unpackaged development/test execution uses the current working directory's `data/`; production paths depend on installation mode and configuration.                                                                                                                                              |
| Backup storage | Restic repositories are accessed via Rclone storage definitions. [generateResticRepoPath](../backend/src/utils/restic/helpers.ts) produces `rclone:<storage-name>:<storage-path>`. The [storages schema](../backend/src/db/schema/storages.ts) includes settings and credential fields, and execution also uses local Rclone configuration. Database/runtime files and credentials must stay out of Git.                                         |

## Backup plan model

[db/schema/plans.ts](../backend/src/db/schema/plans.ts) defines the `plans` table.
A plan has an ID, title/description, active/in-progress state, source ID/type,
storage ID/path, method, timestamps, tags, and JSON fields for source configuration,
settings, verification, and statistics. It relates to a device, storage, backups,
and restores; [PlanStore.ts](../backend/src/stores/PlanStore.ts) loads those records.

[types/plans.ts](../backend/src/types/plans.ts) defines included/excluded source
paths and settings for intervals, retention, performance, integrity, encryption,
compression, retries, notifications, scripts, and replication. These are managed
workloads, not a neutral model of any pre-existing Restic repository.

## Restic execution and managed lifecycle

[runResticCommand](../backend/src/utils/restic/restic.ts) resolves the Restic/Rclone
binaries, constructs an argument array, and invokes `child_process.spawn` without
an explicit shell. It supplies per-call/global environment settings, Rclone
configuration, a local Restic cache, progress/error callbacks, and optional
timeouts. It is a general executor and does not enforce a legacy read-only policy.

Managed backup/restore code derives the encrypted repository password from the
application `ENCRYPTION_KEY`; an unencrypted plan uses the explicit empty-password
path. Managed snapshots use `plan-<id>` and `backup-<id>` tags to associate Restic
data with application records. Existing repository passwords and untagged snapshots
therefore need their own abstraction.

These existing paths remain outside the Phase 1-2 legacy adapter:

- [BaseBackupManager.createBackup](../backend/src/managers/BaseBackupManager.ts)
  invokes repository initialization, installs schedules, and can run a backup immediately.
- [BackupHandler](../backend/src/managers/handlers/BackupHandler.ts) can unlock stale
  locks before a managed backup and adds application tags.
- [PruneHandler](../backend/src/managers/handlers/PruneHandler.ts) builds `forget`
  with `--prune` using plan-specific retention settings.
- [BaseSnapshotManager](../backend/src/managers/BaseSnapshotManager.ts) and
  [RestoreService](../backend/src/services/RestoreService.ts) work with managed
  backup records; their interfaces are not an imported-repository safety boundary.

They remain unchanged. The adapter has its own schema, stores, service, controller,
routes, [allowlisted inspector](../backend/src/utils/restic/LegacyRepositoryInspector.ts),
and [staged restore executor](../backend/src/utils/restic/LegacyRepositoryRestoreExecutor.ts).
Its inspection operations are JSON `snapshots`, `stats --mode raw-data`, and
`ls`; the only write-capable local operation is a fixed `restore` that reads the
repository and writes only a private app staging workspace. Every operation uses
`--no-lock` and `--no-cache`; it does not reuse the managed executor.

## Phase 1-2 legacy repository boundary

The `legacy_repositories` table stores only local registration metadata, an
encrypted external repository password, mandatory `isReadOnly`, and local
validation status. [LegacyRepositoryService.ts](../backend/src/services/LegacyRepositoryService.ts)
rejects non-local or non-read-only records before any inspection. It validates
registration through snapshots, maps process errors to safe messages, applies exact
metadata filters locally, and deletes only the registration.

Routes mounted at `/api/legacy-repositories` require the authenticated UI session.
The frontend route `/legacy-repositories` exposes registration, status, statistics,
structured snapshot browsing, selected staged recovery, and individual file
download from a completed job. It has no arbitrary destination, retention action,
repository-mutation command, or lifecycle handoff. See
[LEGACY_REPOSITORY_DESIGN.md](LEGACY_REPOSITORY_DESIGN.md) for the exact Phase 1-2
contract and known compatibility boundary.

## Scheduling and job execution

[CronManager.ts](../backend/src/managers/CronManager.ts) uses Croner and persists
dynamic schedules to JSON. [ScheduleReconciler.ts](../backend/src/services/ScheduleReconciler.ts)
reconciles stored plans with schedules.
[SystemTaskManager.ts](../backend/src/jobs/SystemTaskManager.ts) schedules maintenance
jobs using the same cron library.

[JobQueue.ts](../backend/src/jobs/JobQueue.ts) is an in-memory queue with deduplication,
priority jobs, and retry state.
[JobProcessor.ts](../backend/src/jobs/JobProcessor.ts) polls it (every five seconds by
default), dispatches registered tasks, limits active backups, retries failures, and
emits failure events. Managers and event listeners update progress and database
records. [StartupRecovery.ts](../backend/src/services/StartupRecovery.ts) handles
interrupted managed work after restart; the job queue itself is not durable.

## Existing features versus later work

The public source already includes managed snapshot browsing, a restore wizard,
script hooks, and email/Slack/Discord/NTFY notification code. Remote strategy
interfaces also exist. Their presence does not establish that an imported legacy
repository can browse contents, restore, act as a standalone agent, or take over a
database lifecycle. Later roadmap phases must identify the additional behavior and
reuse only public code that meets the new boundaries. References to PRO/Business in
upstream package READMEs are attribution/context, not permission to inspect
proprietary implementations.

## Validation commands

Run from the repository root with Node.js 24 and the pinned pnpm version:

```sh
pnpm install --frozen-lockfile
pnpm --filter @plutonhq/core-backend test --runInBand
pnpm --filter @plutonhq/core-backend lint
pnpm --filter @plutonhq/core-frontend lint
pnpm --filter @plutonhq/core-backend exec tsc --noEmit -p tsconfig.json
pnpm --filter @plutonhq/core-frontend exec tsc -b
pnpm build
git diff --check
```

The backend's Jest/ts-jest suites in `backend/__tests__/` cover routes, controllers,
services, stores, managers, jobs, utilities, and notifications. Restic/process unit
tests mock command execution; do not point validation at a real repository.
The frontend has no `test` script. Focused Phase 4 backup-menu and native-download
regressions use Node.js 24's built-in test runner without additional dependencies:

```sh
node --experimental-strip-types --test frontend/__tests__/backupDownload.test.ts
```

Phase 5 remote database lifecycle is documented separately in
[PHASE5_DATABASE_LIFECYCLE.md](PHASE5_DATABASE_LIFECYCLE.md), including secure
workspace/credential handling, constrained hooks, compatibility and the required
disposable pilot. Its optional settings do not extend local or Legacy behavior.
Additional checks:

```sh
pnpm --filter @plutonhq/pluton-agent typecheck
pnpm --filter @plutonhq/pluton-agent test
node --experimental-strip-types --test frontend/__tests__/remoteLifecycle.test.ts
```

Run the agent execution/permission tests on Linux as described in that document;
Windows-only runs skip those cases and are not sufficient acceptance evidence.

## Phase 6 managed recovery testing

Remote managed SFTP backups have a separate durable recovery-test model, opt-in
after-backup reconciliation and manual execution. The service reuses the Phase 4
exact-snapshot session/restore boundary, writes only to its own private workspace,
validates Phase 5 artifacts, and optionally imports into explicitly dedicated
disposable DB targets. No source-agent recovery call, Legacy lifecycle handoff or
repository mutation is added. Backup and recovery status remain independent.

See [PHASE6_RECOVERY_TESTING.md](PHASE6_RECOVERY_TESTING.md) for migration 0009,
encrypted target credentials, resource/cleanup/cancellation controls, native-client
requirements, validation evidence and the future one-dataset shadow pilot gates.
Its Linux runner is `scripts/validate-phase6.ps1`; automation defaults to off and
requires an explicitly provisioned recovery-only DB target for Required imports.

## Phase 7 durable outgoing notifications

Managed backup/recovery terminal state is journaled by additive migration 0010
into indexed notification-source readiness. An independent bounded worker in the
existing notification package creates safe versioned events and leased delivery
outbox entries. Central webhook/SMTP channels and separate per-plan subscriptions
are opt-in, with activation floors excluding historical/already-running jobs.
Delivery does not invoke agents, Restic, Legacy operations or production imports.

New authenticated `/api/notifications` routes provide write-only channel credentials,
test events, subscriptions, paged sanitized history and eligible explicit retries.
Webhook addresses are DNS-validated/pinned; private LAN targets require restricted
CIDR approval. SMTP reuses Nodemailer and shared verified TLS options. The old
community channel UI remains a separate compatibility path, not a silent migration.

See [PHASE7_WEBHOOK_NOTIFICATIONS.md](PHASE7_WEBHOOK_NOTIFICATIONS.md) for payloads,
signatures, queue/retry bounds, security/compatibility details and operator acceptance.
Additional isolated checks are `scripts/validate-phase7.ps1` and
`node --experimental-strip-types --test frontend/__tests__/notificationDelivery.test.ts`.

## Build validation

`frontend/src/docs` supplies 77 original Bahasa Indonesia Markdown articles in
15 manifest-ordered categories. `documentation/` compiles these unchanged sources
into an isolated official Fumadocs React Router document at `/docs/*`. The main
React 18/Vite 6 application remains separate from the React 19/Vite 7 docs build.
Both bundles are served by the same backend, without another production service.
Authenticated APIs remain ahead of the static fallbacks. Plain Markdown is
compiled at build time with escaped HTML and restricted URLs. Search uses a
local static Fumadocs index, without a hosted service.

`pnpm test:docs` checks articles/routes/anchors/evidence/security/rendering. The
frontend production build runs it automatically before bundling the articles.
`pnpm test:fumadocs` checks the real compiler, all 77 TOCs, React isolation,
official layout rendering, static search and Markdown/clipboard security paths.
The docs build runs these tests automatically. See
[FUMADOCS_MIGRATION_REPORT.md](FUMADOCS_MIGRATION_REPORT.md) for dependency choices,
browser evidence, deployment instructions and known limitations.
Run `node --experimental-strip-types --test frontend/__tests__/*.test.ts` for the
complete frontend utility/component suite.

Remote parent optimization uses successful local receipts and verified metadata,
preserving source and SQL tree paths. No schema/wire protocol change is introduced.
Footer uses local APP_VERSION/VCS_REF, without upstream commercial update checks or
downloaded-script updaters. See
[SELFHOSTED_PRODUCT_HARDENING_REPORT.md](SELFHOSTED_PRODUCT_HARDENING_REPORT.md).

Backend CI runs installation, backend lint, tests, and backend build; the pre-push
hook for `main` also builds the frontend. The root build orders the frontend build
(`tsc -b` and Vite) before the backend build (TypeScript, template copying/minification,
and copying frontend assets). Backend build cleans `backend/dist/` and
`backend/public/`; keep local data out of those generated directories.

## Configuration and remaining questions

The root [.env.template](../.env.template) already provides generic placeholders;
preserve it instead of adding a second configuration format. The tracked
`frontend/.env.dev` contains only app name/port settings. Ignoring future `.env.*`
files does not remove or sanitize tracked files.

Phases 1-2 deliberately support only local filesystem registrations and retain no
supported-Restic-version or repository-format matrix. Password storage uses local
encryption under `SECRET`; JSON parsing, logical-path validation, output limits,
and app-controlled staging are implemented; and `--no-lock` is required. No
production inventory or repository was inspected. See the
[legacy adapter design](LEGACY_REPOSITORY_DESIGN.md) for the implemented boundary
and remaining compatibility work.
