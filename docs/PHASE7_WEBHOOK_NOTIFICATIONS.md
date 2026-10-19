# Phase 7 — outgoing webhook and SMTP notifications

## Audit and implementation decisions

Baseline: local `main` at `600381e`, with Operational Hardening and its Linux CI
regression correction. Work is on `codex/phase7-webhook-notifications`. No production
access, commit, push, release or deployment is authorized by this task.

Existing community components reused: Nodemailer, Cryptr with the existing SECRET,
SQLite/Drizzle migration tooling, authenticated session middleware, shared settings
navigation and per-plan notification UI. The existing NotificationManager is an
in-memory fan-out, and BackupNotification awaits provider delivery in lifecycle
callbacks. Neither provides a durable outbox or recovery-test events. The old SMTP
transport disables certificate validation; settings read APIs return decrypted
integration credentials. These security gaps require narrow corrections.

Phase 7 adds durable event/subscription/delivery storage inside the existing
notification package, not a separate notification SaaS or an agent extension.
A bounded independent server worker reconciles actual persisted terminal backup
and recovery-test records. It never invokes Restic or changes job outcomes. Stable
logical event keys deduplicate replayed callbacks. A small additive source-sequence
journal identifies jobs created after subscription activation, so enabling a
channel never replays historical jobs (including jobs already running at activation).
Previously configured community notifications remain available; Phase 7 channels
are explicit opt-in and do not silently migrate credentials or subscriptions.

Channel credentials are encrypted and write-only. Destinations are revalidated
before every attempt, with DNS results pinned to the actual connection. Public
destinations require TLS. Trusted-LAN delivery requires explicit restricted private
CIDRs; loopback, link-local, metadata and special unsafe addresses remain forbidden.
Redirects are never followed. SMTP TLS modes require normal certificate validation
and STARTTLS cannot silently downgrade.

The outbox has leased claims, bounded attempts/backoff, crash recovery, a queue cap
and bounded history retention. External delivery is **at least once**, never exactly
once. Channel changes invalidate pending deliveries until an explicit eligible
manual retry; disabled/deleted channels cannot send. Test events have their own
event type and cannot create backup or recovery records.

## Persistence and API

Additive migration `0010_phase7_notification_outbox` creates six tables:

- `notification_channels`: configuration, subscriptions, revision and encrypted credential.
- `notification_subscriptions`: independent opt-in per-plan policy.
- `notification_sources`: monotonically increasing job-creation sequence and indexed terminal-ready flag.
- `notification_observed`: compact terminal-state deduplication markers retained while the source job exists.
- `notification_events`: stable event IDs and safe immutable payload projections.
- `notification_deliveries`: channel association, status, attempts, lease, retry time and closed error code.

Small SQLite triggers only journal creation, terminal readiness and removal of
managed backup/recovery records. They do not send notifications, change source
job fields, alter snapshots or touch Legacy tables. Source readiness is written
in the same transaction as job state, closing the crash-before-callback gap.
The worker reconciles at most 50 source records per five-second tick. Source
sequence floors prevent replay on enable/re-enable or subscription changes,
without timestamp rounding races or SQLite rowid reuse.

New authenticated routes under `/api/notifications`:

| Method       | Route                   | Behavior                                                   |
| ------------ | ----------------------- | ---------------------------------------------------------- |
| GET / POST   | `/channels`             | List safe views / create a channel                         |
| PUT / DELETE | `/channels/:id`         | Edit / soft-delete and remove plan associations            |
| POST         | `/channels/:id/test`    | Queue a distinct test event; HTTP 202 is **not** delivered |
| GET / PUT    | `/plans/:id`            | Read / save durable per-plan subscriptions                 |
| GET          | `/deliveries?page=0`    | 50-row paged history                                       |
| GET          | `/deliveries/:id`       | Read an actual delivery result                             |
| POST         | `/deliveries/:id/retry` | Queue an eligible explicit manual retry                    |

All routes require the existing authenticated administrator cookie; the limited
public API key does not authorize notification administration. Mutations also
require an approved Origin and application/json content type. Same-origin trusted
LAN access remains supported. Test/retry actions are additionally limited to ten
requests per minute per client IP; the existing global API limiter also applies.
Read responses are no-store, contain no credential or lease-owner token, and never
return raw provider response bodies or exceptions.

The existing settings read/update responses now keep secret fields blank and add
`passwordConfigured` / equivalent configured markers. Blank/omitted legacy form
fields retain the saved value. Private 2FA state is not replaced by the redacted
public settings form. Existing internal SettingsStore consumers still obtain the
private values they need; no credential is rotated. For new channels, omitted
`secret` preserves it, a nonempty value explicitly replaces it, and `secret: ""`
explicitly clears it. Changing channel kind requires a new channel.

## Events and payloads

Supported events: `backup.completed`, `backup.completed_with_warning`,
`backup.failed`, `backup.cancelled`, `recovery.passed`,
`recovery.passed_with_warning`, `recovery.failed`, `recovery.cancelled`.
`notification.test` is separate and never creates a backup or recovery result.

Only persisted terminal states are projected. Running/retrying/queued jobs do not
generate Phase 7 success events. Actual remote completion still passes the existing
snapshot and database lifecycle validation before becoming Completed; a failed
required dump does not become successful merely because snapshot metadata exists.
Lifecycle warnings come from persisted completion metadata. Recovery payloads use
the exact persisted test ID, backup ID and snapshot binding, independently of
Backup Complete. A genuine correction between distinct terminal states has its
own logical event; replay of the same terminal outcome has none.

Example (synthetic):

```json
{
  "version": 1,
  "event_id": "ne_example_event",
  "event_type": "backup.completed",
  "timestamp": "2026-10-13T00:00:00.000Z",
  "plan": { "id": "plan-01", "name": "Example Application" },
  "backup": {
    "id": "backup-01",
    "status": "completed",
    "snapshot_id": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  },
  "duration_seconds": 30,
  "summary": { "files": 12, "bytes": 2048 }
}
```

Recovery adds `recovery: { id, backup_id, status, snapshot_id }`. Its summary may
include filesystem counts, each database ID/engine/artifact bytes, artifact
integrity, actual SQL import outcome and cleanup flags. Disabled/not-configured
imports become `sql_import: "not_tested"`, not Passed. Backup artifact metadata
means archived in the snapshot, not recovery-tested. Failure/warning categories
come from closed classifications, never raw errors. No source path, database name,
SQL, credential, agent inventory, stack trace or private configuration is spread
into a payload. Plain-text email subjects/bodies use the same safe projection and
explicitly avoid a semantic application-recovery guarantee.

## Webhook authentication and transport

POST JSON with `X-Pluton-Payload-Version: 1`, `X-Pluton-Event-Id` and
`X-Pluton-Timestamp` (Unix seconds at delivery). With an optional saved signing
secret, `X-Pluton-Signature` is `sha256=<hex HMAC-SHA256>` over:

```text
<timestamp>.<event_id>.<exact UTF-8 JSON body>
```

Retries retain the event ID and body but use a fresh signed delivery timestamp.
Receivers should verify before parsing/processing, enforce a freshness window,
and atomically deduplicate event IDs before acknowledging delivery. Example:

```js
import { createHmac, timingSafeEqual } from "node:crypto";
export function verify(rawBody, headers, secret) {
  const timestamp = headers["x-pluton-timestamp"];
  const eventId = headers["x-pluton-event-id"];
  const signature = headers["x-pluton-signature"];
  if (
    !/^\d{1,12}$/.test(timestamp || "") ||
    !/^[A-Za-z0-9_-]{1,100}$/.test(eventId || "") ||
    !/^sha256=[a-f0-9]{64}$/.test(signature || "") ||
    Math.abs(Date.now() / 1000 - Number(timestamp)) > 300
  )
    return false;
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${eventId}.`)
    .update(rawBody)
    .digest();
  const supplied = Buffer.from(signature.slice(7), "hex");
  return (
    supplied.length === expected.length && timingSafeEqual(supplied, expected)
  );
}
```

The receiver must also check the parsed body's `event_id` equals the header. Get
the receiver secret from private configuration; do not place it in a URL, command
argument, log or public example. This is a receiver-side example, not an inbound
Pluton webhook server.

Public endpoints require HTTPS. Private RFC1918 / IPv6 ULA endpoints need explicit
trusted-LAN approval and narrow CIDRs (prefer /32 or /24; minimum IPv4 /16 and IPv6
/48). HTTP is permitted only within that policy. Loopback, unspecified, link-local,
multicast, metadata and unsafe IPv4/IPv6 transition targets are always rejected.
Every DNS answer is validated each attempt, and the approved address is pinned
directly to the socket with the original Host/TLS identity retained. Mixed safe/
unsafe DNS responses fail closed. URL credentials, query strings, fragments,
unsupported schemes and redirects are refused; no arbitrary headers or scripts.
TLS certificate verification remains enabled. Responses are classified by status,
never logged/returned by body. Normal request deadlines are 1–30 seconds and cover
DNS plus transport. This follows [OWASP's SSRF defense guidance](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html).

## SMTP and existing integration compatibility

Configure host, port, security, optional username/password, sender email/display
name and up to twenty recipients. Authentication is omitted for internal relays
when no username is configured. Plain SMTP requires explicit trusted-LAN/CIDR
approval; STARTTLS is mandatory when selected; implicit TLS is mandatory when
selected. Both TLS modes validate the chain and hostname and require TLS 1.2+.
Sender/recipient/header formats are validated. File/URL access, debug logging and
arbitrary transport options are disabled. Partial recipient rejection is failure.
Succeeded means **SMTP acceptance**, not guaranteed inbox delivery.

The shared transport options are reused by the old SMTPChannel. Its previous
`rejectUnauthorized: false` / opportunistic TLS behavior is corrected: port 465
defaults to verified implicit TLS; other old SMTP configurations default to required
verified STARTTLS. Relays with an untrusted certificate or no STARTTLS must be
provisioned correctly or configured explicitly as a trusted plain Phase 7 channel;
do not disable verification. A private CA can be installed via normal Node/OS trust
configuration before starting the server. No global system Node upgrade occurs.
See [Nodemailer's SMTP TLS options](https://nodemailer.com/smtp).

Older community SMTP/Slack/Discord/Ntfy plan settings remain a separate compatibility
delivery path and are not silently moved into the outbox. Disable the old matching
notification when opting into a Phase 7 channel if duplicate notifications from
two independently configured paths are unwanted. New Phase 7 email/webhook delivery
never waits in backup callbacks. The old completion notifier also no longer selects
the success template for a failed completion.

## Retry, history and failure isolation

- Maximum two leased/in-flight deliveries globally in the control database.
- Five automatic attempts per cycle; exponential delays 30/60/120/240 seconds,
  with a one-hour cap including valid Retry-After. Retry HTTP 408/429/500/502/503/504
  and temporary SMTP/connection/timeouts; most other 4xx and SMTP auth/rejections
  are permanent. No tight loops, redirects or infinite unauthorized retries.
- A sending lease expires after sixty seconds. Recovery keeps the event ID and
  retries after at least thirty seconds; old lease owners cannot record an outcome.
- Eligible failed deliveries permit at most three explicit manual retry cycles,
  at least thirty seconds later, with a twenty-attempt lifetime cap. Recheck current
  channel, subscription, plan existence and queue capacity. Manual retry intentionally
  uses the reviewed current channel revision, without changing the immutable event.
- Disable/delete/change a pending channel, remove its plan association or disable
  the plan policy: delivery is refused. An already in-flight network transmission
  cannot be recalled. Deleted channels retain only necessary history references.
- Pending/sending queue cap: 10,000. Backpressure leaves terminal readiness durable
  for later reconciliation, without altering a job result. Terminal delivery history
  is bounded to 20,000 records / thirty days. Dedup markers survive history pruning.
- A notification worker/network/credential failure never updates a backup/recovery
  status, invokes an agent or Restic, deletes a snapshot, or imports any database.
  Worker log messages are fixed; detailed history contains only safe classification/code/status.

External delivery is at least once. A receiver may accept before a worker crashes
or an acknowledgement is lost, producing a retry with the same event ID. SMTP can
similarly be accepted before result persistence; a stable Message-ID helps but
cannot promise exactly-once mailbox delivery.

## UI workflow and acceptance (disposable infrastructure only)

1. In Settings → Webhooks & Email, add a dedicated local receiver channel with a
   reachable private address, explicit trusted-LAN policy and a narrow approved CIDR.
   Configure event subscriptions, enable it and save. URLs cannot contain secrets.
2. Send Test Webhook. Observe Queued/Sending, then HTTP 2xx Succeeded in Delivery
   History. Validate its JSON/HMAC on the receiver; verify no fake backup exists.
3. Add a dedicated SMTP relay channel; choose verified STARTTLS/implicit TLS, or
   explicitly approved restricted LAN plain delivery. Set sender/recipients and
   authentication only when needed. Save; Send Test Email; distinguish queued from
   relay acceptance and verify the actual disposable inbox independently.
4. Edit an existing **disposable** managed plan → Advanced → Notification. Choose
   channels and events; enable and Save notification policy separately. Both the
   global channel and per-plan event selections must match.
5. Start a new successful disposable filesystem or filesystem+DB backup. Confirm
   no success event during Running and one stable logical event after persisted
   completion. Check exact backup/snapshot, counts, dates and safe database summary.
6. Fail a disposable job in a controlled way (e.g. a deliberately refused test
   credential). Expect Backup Failed; inspect only safe classification, not secret
   strings. Retry/replay a callback and verify no duplicate logical event.
7. Run a successful Recovery Test against that exact disposable snapshot with a
   dedicated recovery-only DB target when Required import is selected. Check recovery
   ID/snapshot and actual filesystem/artifact/import/cleanup results separately.
8. Run artifact-only recovery with DB import Disabled. Expect Passed with Warning
   and SQL import NOT TESTED; do not interpret this as semantic application recovery.
9. Have the receiver return 429/503, then 2xx. Verify attempt count/next retry and
   eventual acceptance. Test a 401 permanent failure, deliberate endpoint correction
   and explicit eligible retry. Restart a disposable server during Sending and
   verify leased recovery without changing Backup Complete or Recovery status.
10. Verify credential inputs remain empty on edit, cancelled edits do not claim a
    save, channel deletion asks for confirmation, disabled channels do not send,
    and loading/errors/history behave in both themes and on narrow screens.

Do not run this procedure against a live source, production database, production
receiver or Legacy repository. No production acceptance is claimed here.

## Automated validation

The automated fixtures use only synthetic records and private disposable state.
Phase 7 receiver tests run non-root on a Docker **internal** network with no external
route, published ports, host data volumes or Docker socket mount. The test runner
generates an ephemeral synthetic certificate/key, never adds it to host trust, and
cleans it afterwards; trusted CA configuration is restricted to fixture child
processes. Process-restart validation opens the same disposable SQLite file in a
new process. Native Phase 5/6 and agent fixtures are network-isolated non-root tests.

Commands:

```sh
pnpm --filter @plutonhq/core-backend test --maxWorkers=2 --silent --verbose=false
pnpm --filter @plutonhq/pluton-agent test
node --experimental-strip-types --test frontend/__tests__/*.test.ts
pnpm --filter @plutonhq/core-backend exec tsc --noEmit -p tsconfig.json
pnpm --filter @plutonhq/core-frontend exec tsc -b
pnpm --filter @plutonhq/pluton-agent typecheck
pnpm --filter @plutonhq/core-backend lint
pnpm build
git diff --check
```

PowerShell integration runners:

```powershell
& ./scripts/validate-phase7.ps1
& ./scripts/validate-phase6.ps1 -Modes @('single','two-mariadb','mixed','phase6-filesystem','phase6-mariadb','phase6-postgresql','phase6-mixed','phase6-mixed-failure')
```

The existing local fixture images are prerequisites, not application dependencies:
`pluton-phase6-tests:local`, `pluton-phase5-real-db:local`, and the agent's synthetic
tools image. The Phase 7 runner uses .NET certificate generation, so no additional
OpenSSL application dependency or Node package is required. Its standalone Linux
smoke script can alternatively use a fixture-provided OpenSSL executable.

Final verified results:

| Check                                           | Suites passed | Tests / outcomes passed | Failed |             Skipped |
| ----------------------------------------------- | ------------: | ----------------------: | -----: | ------------------: |
| Full backend Windows, two workers               |           151 |                   2,954 |      0 |                   4 |
| Full backend Linux Node 24, two workers (final) |           151 |                   2,952 |      0 |                   6 |
| Full backend Linux Node 24, serial CI mode      |           151 |                   2,952 |      0 |                   6 |
| Agent Linux with synthetic native tools         |             — |                      80 |      0 |                   0 |
| Agent portable Windows run                      |             — |                      27 |      0 | 53 Linux-only cases |
| Frontend utilities/render/API/theme contracts   |             — |                      64 |      0 |                   0 |
| Native Phase 5/6 fixture runs                   |             — |   8/8 expected outcomes |      0 |                   0 |
| Phase 7 isolated receiver/restart runner        |             — |                    PASS |      0 |                   0 |

The Phase 7 runner verifies actual HTTP POST/HMAC, HTTP 429/503 retry and 401/redirect
refusal, request timeout, SMTP relay without auth, authenticated SMTP, rejected auth/
recipients, required STARTTLS/implicit TLS, trusted certificate acceptance, untrusted
certificate and hostname-mismatch refusal, safe lifecycle payloads/deduplication and
restart into the same disposable outbox file. These are fixture assertions, not a
production end-to-end certification or an invented Jest test count.

Backend/frontend/agent typechecks, backend lint, full `pnpm build` (3/3 packages),
Prettier checks and `git diff --check` passed. Existing backend listener/worker teardown
warnings and Vite chunk-size/Browserslist warnings remain. Frontend lint alone remains
blocked by the pre-existing ESLint 10 / typescript-eslint `eslint-config-prettier`
string-extends error, also documented before Phase 7; it was not suppressed. Early
new-test failures (IPv4-mapped BlockList interaction, MIME fixture decoding, missing
fixture OpenSSL and old unsafe TLS/error expectations) were corrected and rerun,
not marked as unrelated baseline failures.

## Feature disposition and changed files

| Feature                      | Status                                | Evidence / boundary                                                                                             |
| ---------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Webhooks                     | Implemented                           | Multiple named opt-in endpoints, JSON, HMAC, pinned DNS, bounded verified transport                             |
| SMTP                         | Implemented; existing provider reused | Auth optional, plain trusted LAN, mandatory STARTTLS/implicit TLS, plain-text safe messages                     |
| Event subscriptions          | Implemented                           | Global channel and per-plan event intersection; future-job activation floors                                    |
| Backup lifecycle integration | Implemented                           | Actual durable terminal states, required lifecycle gating, replay deduplication                                 |
| Recovery Test integration    | Implemented                           | Exact test/backup/snapshot, passed/warning/failed/cancelled, explicit import-not-tested semantics               |
| Durable queue                | Implemented                           | Additive SQLite outbox, ready journal, leased claims, crash recovery and caps                                   |
| Retry                        | Implemented                           | Bounded backoff/Retry-After, permanent failures, global concurrency and eligible manual retries                 |
| Delivery history             | Implemented                           | Authenticated paged safe results, attempts/times/codes and bounded retention                                    |
| Test notifications           | Implemented                           | Separate queued event/history; actual result, never fake job records                                            |
| Security                     | Implemented                           | Write-only encrypted credentials, auth/origin guard, SSRF/TLS/header controls, sanitized parser/provider errors |

52 changed/new task files. No agent source, dependency/lockfile, release workflow,
Legacy adapter or production configuration changed:

```text
backend/__tests__/db/NotificationMigration.test.ts
backend/__tests__/fixtures/notifications.ts
backend/__tests__/integration/phase7Notifications.smoke.ts
backend/__tests__/notifications/NotificationDeliveryManager.test.ts
backend/__tests__/notifications/SMTPChannel.test.ts
backend/__tests__/routes/notifications.test.ts
backend/__tests__/services/NotificationLifecycle.test.ts
backend/__tests__/services/NotificationSettingsSecurity.test.ts
backend/__tests__/services/SettingsService.test.ts
backend/__tests__/stores/NotificationDeliveryStore.test.ts
backend/__tests__/utils/notificationDeliveryPolicy.test.ts
backend/__tests__/utils/outboundDelivery.test.ts
backend/drizzle/0010_phase7_notification_outbox.sql
backend/drizzle/meta/_journal.json
backend/drizzle/meta/0010_snapshot.json
backend/src/controllers/SettingsController.ts
backend/src/createApp.ts
backend/src/db/index.ts
backend/src/db/schema/notificationDelivery.ts
backend/src/notifications/channels/NotificationChannelResolver.ts
backend/src/notifications/channels/secureSmtp.ts
backend/src/notifications/channels/SMTPChannel.ts
backend/src/notifications/deliveryPolicy.ts
backend/src/notifications/NotificationDeliveryManager.ts
backend/src/notifications/outboundDelivery.ts
backend/src/notifications/terminalPayload.ts
backend/src/routes/notifications.ts
backend/src/services/events/BackupEventService.ts
backend/src/services/SettingsService.ts
backend/src/stores/NotificationDeliveryStore.ts
backend/src/stores/SettingsStore.ts
backend/src/types/notificationDelivery.ts
backend/src/types/settings.ts
docs/ARCHITECTURE.md
docs/PHASE7_WEBHOOK_NOTIFICATIONS.md
docs/ROADMAP.md
frontend/__tests__/notificationDelivery.test.ts
frontend/src/@types/settings.ts
frontend/src/components/Plan/PlanSettings/ManagedPlanNotifications.tsx
frontend/src/components/Plan/PlanSettings/PlanAdvancedSettings.tsx
frontend/src/components/Settings/IntegrationSettings/IntegrationSettings.tsx
frontend/src/components/Settings/IntegrationSettings/NtfySettings.tsx
frontend/src/components/Settings/IntegrationSettings/SMTPSettings.tsx
frontend/src/components/Settings/NotificationSettings/ChannelEditor.tsx
frontend/src/components/Settings/NotificationSettings/EventSelector.tsx
frontend/src/components/Settings/NotificationSettings/NotificationSettings.module.scss
frontend/src/components/Settings/NotificationSettings/NotificationSettings.tsx
frontend/src/routes/Settings/Settings.tsx
frontend/src/services/notifications.ts
frontend/src/services/settings.ts
frontend/src/utils/notificationDelivery.ts
scripts/validate-phase7.ps1
```

## Safe deployment and rollback (separate operator authorization)

1. Review the diff and testing evidence. Take a consistent private control-DB and
   configuration backup using SQLite's backup API or a stopped/quiesced server;
   preserve the exact persistent volume, SECRET, ENCRYPTION_KEY and private key files.
   Do not dump credentials into public logs or create a fresh data volume.
2. Deploy only the reviewed server/frontend artifact with the same environment and
   persistent volume. Apply additive migration 0010 through normal startup migration.
   No existing plan, storage, password, agent identity, repository or snapshot changes.
   Agent v0.4.1 remains compatible; no agent update or re-enrollment is required.
3. Leave notifications opt-in off initially. Provision dedicated receivers/relays,
   narrow egress/firewall rules and trusted CA chains. Keep browser trusted-LAN HTTP
   unchanged during the pilot; prefer HTTPS/reverse proxy for production. Never use
   TLS-verification bypasses. Validate only the disposable procedure above first.
4. Verify settings credentials remain privately configured, actual job state remains
   authoritative, and delivery history/retry works before separately enabling real
   plan subscriptions. Keep the older backup workflow active; there is no cutover.
5. Before rollback, disable Phase 7 channels and stop/drain the worker/server cleanly.
   Restore the previous application artifact while keeping the current persistent
   DB/volume and all matching keys. Additive tables/bookkeeping triggers are safe for
   the previous server to ignore; do not drop them, restore an old DB over new jobs,
   purge identity, regenerate keys, delete snapshots or mutate a Legacy repository.
   Re-enable deliberately after revalidation; enabling never replays old jobs.

Existing encrypted SMTP/DB/repository credentials and agent identities remain intact.
The stricter old SMTP TLS behavior and redacted settings views are intentional
security corrections: privately review relay trust and any unsupported client that
previously relied on reading plaintext credentials. No deployment was performed.

## Known limitations and readiness

- This is a single self-hosted control-server implementation, not HA notification
  infrastructure. SQLite disk/locking failures can delay reconciliation; the durable
  terminal-ready markers and leases allow recovery. Persistent-volume health remains
  an operator responsibility.
- Activating/changing a subscription or re-enabling a channel applies only to jobs
  created afterwards. Already-running jobs are intentionally not retroactively opted in.
- No arbitrary custom headers, bearer tokens in URLs, response-body inspection,
  insecure public HTTP, TLS bypass, inbound webhooks, SaaS channel, or command execution.
- Public HTTP/local loopback-only receivers are not supported. Use a dedicated reachable
  approved private address or HTTPS; do not approve broad networks casually.
- SMTP acceptance does not guarantee inbox delivery, and structural/artifact checks do
  not prove semantic recovery. Receiver deduplication and operational acceptance are manual.
- Browser tests cover utilities, authenticated request handling, rendered forms/history/
  errors and theme-token contracts; actual browser/operator visual acceptance remains manual.
- Frontend lint retains its pre-existing ESLint 10 / typescript-eslint string-extends
  configuration failure. It is not suppressed or reclassified as a Phase 7 code success.
- No commits, pushes, merges, releases, deployments, production access or external
  notification SaaS were used. The final checks above passed; Phase 7 is ready for
  code review and separately authorized acceptance, not declared deployed or
  production-certified. Release/deployment requires separate authorization.
