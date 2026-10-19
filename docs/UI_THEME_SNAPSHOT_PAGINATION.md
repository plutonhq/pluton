# UI theme and backup-history pagination review

## Scope and execution

Implemented on `codex/ui-theme-snapshot-pagination`, starting from reviewed
`main` / `origin/main` commit `385c92c`. HEAD is unchanged: no commit, push,
merge, release, deployment or production access was performed. All fixture
infrastructure and record identifiers are synthetic. No dependency was added
or upgraded.

This is a presentation and read-query change, not a new backup/recovery phase.
Agent source/protocol, repository commands, scheduling, retention, database
import/provisioning, persistent restore leases, notification delivery, mount
isolation, origin/CSRF validation and deployment/rollback tooling are unchanged.

## Findings and disposition

| Area                          | Verified previous behavior                                                                                                                                                 | Result                                                                                                                                            |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plan backup history           | `getPlan` requested up to 999 complete backup records and the UI rendered finished records without effective paging.                                                       | Fixed: separate indexed SQLite count/page query; 10/20/50 rows, default 10.                                                                       |
| History date                  | Date was ended time, falling back to started time, rendered relatively. There was no calendar-range query.                                                                 | Fixed: absolute zoned dates and inclusive calendar filters on the same timestamp; created time is a final fallback for old incomplete timestamps. |
| Theme startup                 | HTML bootstrap read `theme`; the provider read `themeSetting` and initially applied Light. App settings could overwrite an explicit local choice after a response/refocus. | Fixed: consistent preference validation/bootstrap/provider, legacy-key fallback and explicit-local-choice priority.                               |
| Existing theme primitives     | Shared palettes, tooltips, status labels, wizard controls and chart theming already existed; the existing contrast tests passed.                                           | Retained; no invented claim that every current button had white-on-white text. Shared surface, typography, spacing and progress tokens improved.  |
| Source resources              | Important values used small text and ellipsis; the full Health strip used tall mobile blocks.                                                                              | Fixed: readable wrapping resource values, compact cards and a 30-column Health grid retaining all 90 outcomes and non-color status summaries.     |
| Chart coverage                | The old chart could use up to 999 points, independently of the displayed health strip.                                                                                     | Preserved: compact 999-point counter-only DTO, separate from 90-outcome header details and paginated history.                                     |
| True Restic snapshot listings | The Legacy adapter pages a full bounded inspector result on the server, with a fresh scan on each request.                                                                 | Audited, unchanged; shared date-filter/cache improvement deferred as described below.                                                             |

## Backup-history API

New additive, authenticated read endpoint:

```text
GET /api/plans/{planId}/backups?page=1&pageSize=10&startDate=2026-10-01&endDate=2026-10-15&timeZone=Asia%2FJakarta
```

The normal response envelope is retained:

```json
{
  "success": true,
  "result": {
    "items": [],
    "total": 0,
    "page": 1,
    "pageSize": 10,
    "totalPages": 1,
    "hasPrevious": false,
    "hasNext": false,
    "timeZone": "Asia/Jakarta"
  }
}
```

- Only `page`, `pageSize`, `startDate`, `endDate`, and `timeZone` are accepted.
  Repeated/structured/unknown arguments, impossible dates, reversed ranges,
  invalid zones, invalid pages and page sizes other than 10/20/50 return 400.
  Values are bounded strings; page is at most nine digits and then clamped to
  the actual last page. Empty optional dates are omitted by the UI.
- The query binds `plan_id` and preserves the old table's finished-record
  eligibility (`coalesce(in_progress, 0) = 0`). Live tasks remain in the separate
  plan summary. An empty result has page 1 of 1 with both arrows disabled.
- Ordering is `coalesce(ended_at, started_at, created_at) DESC, id DESC`.
  The secondary ID order removes ambiguity for equal timestamps. Count and page
  are read in one synchronous SQLite transaction; offset/limit are applied in
  SQLite, not by slicing downloaded browser history.
- The explicit row projection excludes source configuration, storage
  configuration and credentials. Existing authorized completion/mirror metadata
  and full snapshot associations are retained for row actions. Results use
  `Cache-Control: private, no-store`; unexpected exceptions return a generic
  message, not raw database errors.
- The existing session middleware is mandatory. This community schema has
  globally authorized administrative sessions, not per-user plan-owner/tenant
  columns. The change preserves that authorization model rather than inventing
  a new one. Tests prove requests without a session are refused and a selected plan cannot acquire
  another plan's rows/counts through query parameters. Nonexistent plans are 404.
- Neither this endpoint nor its header summary invokes Restic/Rclone or scans
  repository metadata. Snapshot registration, restore eligibility and actions
  still use the actual returned backup ID and full associated snapshot ID.

### Date and timezone semantics

The row Date is the completed/ended timestamp, then started timestamp, then
created timestamp if both were absent. The exact same SQL expression is filtered
and indexed. Started/ended tooltips and the absolute Date column use the selected
timezone. Invalid old display timestamps render `Not recorded`, never today's
date or a rendering exception.

The UI defaults to the browser's IANA timezone and offers Local/UTC; a valid
named zone in the URL is also retained. Non-browser callers default to UTC.
Start/end are optional ISO calendar dates, years 0001 through 9998. Both selected
days are inclusive: the server derives `[start of first day, start of day after
last day)` in that zone. It does not add an elapsed 24 hours to form the end.
DST 23/25-hour days, half-hour transitions, midnight gaps and skipped dates have
regression vectors. The formatter uses Gregorian calendar/Latin digits with an
explicit era; this also handles year 0001 on the inspected Node/ICU runtimes.

Today, Last 7 days and Last 30 days count calendar dates including today in the
chosen zone. Apply validates the draft, Clear removes date bounds, and changing
size or applied dates resets page 1. A size change cannot be overwritten by stale
form-draft state.

### Browser and header state

URL state is namespaced as `historyPage`, `historyPageSize`, `historyStart`,
`historyEnd` and `historyTimeZone`. No secrets enter these URLs. Browser refresh,
back/forward, paging and dialogs retain these values and unrelated plan parameters.
The Backup Now navigation preserves the filter instead of replacing its query.

Queries are keyed under the existing plan invalidation prefix, carry an abort
signal, hide placeholder rows during page changes and have explicit loading,
error/retry and empty states. Removed last-page rows cause server clamping and a
replace-URL update. Old row action-menu state is not carried to a different page.
Snapshot totals remain explicitly separate from “matching backups.”

The UI opts into the additive `GET /api/plans/{id}?backupHistory=summary` mode.
Default API callers retain their previous response behavior. Summary mode loads
90 recent details, current active tasks and the latest completed measurement
when outside that window. It separately returns up to 999 compact chart points,
preserving the prior chart budget/ranges. Those points expose only status,
started time and the two numeric file/byte counters; no backup/snapshot IDs,
artifact manifests or source settings. Invalid/non-numeric counters are not
copied through. Other summary consumers and the chart retain a legacy-response
fallback. The small Health strip's existing display slicing is not history paging.

Offset pagination is not an immutable cursor: concurrent inserts/removals can
shift later pages across separate requests. Each individual response has
consistent counts/rows and deterministic ordering. No cross-request frozen
history snapshot is claimed.

## Actual snapshot-list audit and limitation

| Surface                          | Actual data and boundary                                                                                                                                                            | Disposition                                                                                 |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Plan Backups                     | Database backup attempts, including failures without snapshots.                                                                                                                     | New DB paging/filtering implemented; IDs/counts not replaced by Restic IDs/counts.          |
| Shared `SnapshotBrowser`         | Files/directories inside one already selected exact snapshot, including IndexedDB browsing.                                                                                         | Not a snapshot enumeration page; selection, download and staged restore behavior unchanged. |
| Legacy repository snapshot list  | `LegacyRepositoryService.listSnapshots` filters/sorts and server-slices inspector JSON; exact snapshot timestamp/ID, repository, host, path, tag, workload and dataset constraints. | Existing paging remains (10/30/60/100/all). New date UX and scan/cache redesign deferred.   |
| Managed snapshot manager/helpers | Snapshot inspection used by repository statistics/lifecycle and exact-snapshot browsing.                                                                                            | Not routed through the new history table; commands and mutation boundaries unchanged.       |
| Application self-backup modal    | Application database/config backup blobs, not Restic snapshot enumeration.                                                                                                          | Unchanged.                                                                                  |

The Legacy inspector has an 8 MiB output limit, 30-second timeout and a read-only
operation allowlist with `--no-lock --no-cache`. It does not provide native
Restic paging. Its existing per-page fresh enumeration can still be expensive;
`all` is still available within that inspector output bound. This task does not
claim to have fixed that separate limitation. A safe shared cache/index would
need explicit repository/freshness/filter invalidation and exact-snapshot action
binding tests; implementing one here would expand the architecture/safety scope.
No browser-side fake snapshot pagination, Legacy command change or write fallback
was introduced. Legacy service/inspector/restore regression suites passed.

## UI and visual verification

Reuses the purple accent, icon/sidebar navigation and compact dashboard design.
Shared semantic surfaces/borders/shadows, focus treatment and progress colors
work in both palettes. Light/Dark/System remain the same stored values
(`light`/`dark`/`auto`), using `themeSetting` with validated legacy `theme` fallback.
System subscribes to OS color-scheme changes; explicit local choices override
OS/server settings. Bootstrap and provider agree before paint for saved local
preferences. Blocked browser storage is tolerated. A first visit with no local
preference can still receive its saved server setting asynchronously.

Content can expand to 1560px rather than leaving an unnecessarily narrow desktop
column. Tables use aligned columns and confined horizontal scrolling on narrow
screens. Source values wrap instead of being incorrectly truncated. Recovery
summaries wrap without changing status meanings. Shared form/modal surfaces and
icon-only action names were checked; dialogs get a named native close button.
This is not a certification that every legacy control meets all WCAG criteria.

Local synthetic browser checks used 1366, 1440 and 1920 desktop widths and a
390px mobile viewport. The preview starts no backend and intercepts synthetic
API calls; unknown/live requests fail closed. No actual Backup Now, restore,
download, database import or configuration-update action was submitted.
After-state screenshots are stored outside Git in the local visualization
directory. Before-state findings above come from source inspection, not a
production screenshot capture.

| Required view / screenshot                                                           | Verified appearance/behavior                                                                                                              |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Plan detail Light / `plan-light.jpg`                                                 | Neutral light canvas, white cards, compact top cards, aligned toolbar/table and purple filter action; ten rows by default.                |
| Plan detail Dark / `plan-dark.jpg`                                                   | Charcoal canvas/cards, readable secondary text, restrained purple chart; green/red outcomes also have labels/tooltips/accessible summary. |
| Source detail Light / `source-light.jpg`                                             | System/CPU/Memory/Drive/Network values readable on light cards without lost important text.                                               |
| Source detail Dark / `source-dark.jpg`                                               | Same resource layout, themed progress bars and readable foregrounds; no dark-only shared field surface.                                   |
| Storages Light / `storages-light.jpg`                                                | Three compact synthetic storage rows, clear names/types/counts and consistent action alignment.                                           |
| Storages Dark / `storages-dark.jpg`                                                  | Same density and hierarchy using dark surfaces/borders and visible actions.                                                               |
| Date-filtered history / `history-day-light.jpg`, `history-day-dark.jpg`              | Same-day filter shows 3 matching rows, selected IANA zone and page 1 of 1; 237 global snapshots stay distinct.                            |
| Size 50 / `history-50-light.jpg`, `history-50-dark.jpg`                              | Exactly 50 row-action buttons; footer shows 1–50 of 237 matching backups, page 1 of 5, size 50.                                           |
| Desktop boundaries / `plan-1366-dark.jpg`, `plan-1920-dark.jpg`                      | No document-wide horizontal overflow; existing cards and header/actions retained.                                                         |
| Mobile / `plan-mobile-light.jpg`, `plan-mobile-dark.jpg`, `history-mobile-light.jpg` | Cards/filters stack, all 90 Health indicators fit compactly, table scroll is confined to its own region.                                  |
| Edit drawer / `modal-light.jpg`, `modal-dark.jpg`                                    | Themed fields, strategy cards and readable labels; closed without submitting edits.                                                       |

Also exercised Next to rows 11–20; a keyboard-opened row menu used that page's
real ID. Presets after size 50 retained size 50. Native keyboard date edits
selected another exact day (4 matching rows); a reversed draft showed a safe
inline error without replacing results. Clear restored all 237 results.
Theme persisted across a fresh tab; clean preview diagnostics reported zero
browser exceptions and no captured warn/error logs. Native date-picker popup
appearance remains platform-specific; the input's palette/color-scheme and
calendar behavior were checked, not every OS popup implementation.

Reproduce the isolated preview from `frontend/` with
`node __tests__/theme-preview/server.mjs`, then open
`http://127.0.0.1:5188/__tests__/theme-preview/app.html`. Synthetic controls select
theme/pages; they are test-fixture code, not shipped runtime controls.

## Validation results

Node.js 24 and pinned pnpm 10.20.0 were used. No real repositories or external
DB endpoints were used. Results are local regression evidence, not production
end-to-end acceptance.

| Check                                                                            | Result                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm --filter @plutonhq/core-backend test --runInBand --silent --verbose=false` | **166 suites passed; 3,257 tests passed, 4 skipped, 0 failed** (3,261 total). Includes new API/calendar/index tests and existing backup, remote control plane, Phase 5/6/7, restore, Legacy and dual-origin regressions.                                                                                                                              |
| New backend coverage (included above)                                            | 56 tests in `backupHistoryQuery.test.ts` and `backupHistory.test.ts`: empty/1/10/11/50/51/237 rows, size bounds, stable ties/all-page coverage, counts/clamping/removal, optional/exact/cross-year dates, zones/DST, projections, actual identifiers, plan/session/origin boundaries, summary/chart preservation and real migrated SQLite index plan. |
| `node --experimental-strip-types --test frontend/__tests__/*.test.ts`            | **113 passed, 0 failed, 0 skipped**. Includes real filter/pager SSR and event handlers, theme bootstrap/persistence, contrast/token contracts, chart, Phase 5/6/7 and restore wizard regressions.                                                                                                                                                     |
| Agent suite in existing disposable Linux image                                   | **120 passed, 0 failed, 0 skipped**; mounted compiled `agent/dist` read-only, network disabled, root filesystem read-only, all capabilities dropped, no new privileges and private temporary `/tmp`. No Docker socket/mount privilege/DB service. Existing process/permission fixtures, not a new real SFTP acceptance run.                           |
| Calendar helper in existing Alpine server-runtime image                          | **8 boundary vectors passed, 0 failed**, Node v24.16.0 / UID 10001, no network, no application start. Checks UTC/year 0001, ordinary zoned dates and DST/gap/skipped-day behavior across the Windows/Linux ICU boundary.                                                                                                                              |
| Backend, frontend and Agent typechecks                                           | Passed. Commands: `pnpm --filter @plutonhq/core-backend exec tsc --noEmit -p tsconfig.json`, `pnpm --filter @plutonhq/core-frontend exec tsc -b`, `pnpm --filter @plutonhq/pluton-agent typecheck`.                                                                                                                                                   |
| `pnpm --filter @plutonhq/core-backend lint`                                      | Passed.                                                                                                                                                                                                                                                                                                                                               |
| `pnpm --filter @plutonhq/core-frontend lint`                                     | Pre-existing configuration failure before file lint: ESLint 10 / typescript-eslint rejects string `"eslint-config-prettier"` in `extends` at index 5. Config/dependencies/lockfile unchanged; not hidden with an upgrade or weakened rule.                                                                                                            |
| `pnpm build`                                                                     | **3 build tasks passed**, including frontend/backend/Agent outputs and documentation build. Documentation checks: 12 passed plus 8 Fumadocs tests passed. Existing warnings remain for CSS `::highlight`, large chunks, stale Browserslist data and documentation `node:fs/promises` externalization; no build error.                                 |
| `git diff --check`                                                               | Passed after final formatting.                                                                                                                                                                                                                                                                                                                        |

The four backend skips are existing platform/fixture gates: two native recovery
client checks, one POSIX symlink recovery check and one Linux system-manager
check. They are not new pagination test failures. No native database import or
privileged retained-restore filesystem integration was rerun for this UI task.

## Changed-file inventory

Database and authenticated read API:

- `backend/drizzle/0013_backup_history_index.sql`
- `backend/drizzle/meta/_journal.json`
- `backend/src/db/schema/backups.ts`
- `backend/src/utils/backupHistoryQuery.ts`
- `backend/src/stores/BackupStore.ts`
- `backend/src/stores/PlanStore.ts`
- `backend/src/services/PlanService.ts`
- `backend/src/controllers/PlanController.ts`
- `backend/src/routes/plans.ts`
- `backend/src/types/plans.ts`

History UI, URL state and chart contracts:

- `frontend/src/utils/backupHistory.ts`
- `frontend/src/services/plans.ts`
- `frontend/src/@types/backups.ts`
- `frontend/src/@types/plans.ts`
- `frontend/src/components/Plan/Backups/BackupHistoryFilters.tsx`
- `frontend/src/components/Plan/Backups/BackupHistory.module.scss`
- `frontend/src/components/Plan/Backups/Backups.tsx`
- `frontend/src/components/Plan/Backups/Backups.module.scss`
- `frontend/src/components/Plan/PlanBackups/PlanBackups.tsx`
- `frontend/src/components/Plan/PlanBackups/PlanBackups.module.scss`
- `frontend/src/components/common/Pagination/Pagination.tsx`
- `frontend/src/components/common/Pagination/Pagination.module.scss`
- `frontend/src/components/Plan/PlanSizeChart/PlanSizeChart.tsx`
- `frontend/src/components/Plan/PlanStats/PlanStats.tsx`
- `frontend/src/hooks/usePlanSingleActions.tsx`

Theme, shared layout and accessible controls:

- `frontend/index.html`
- `frontend/src/utils/theme.ts`
- `frontend/src/context/ThemeContext.tsx`
- `frontend/src/styles/global.scss`
- `frontend/src/components/App/App/App.tsx`
- `frontend/src/components/App/App/App.module.scss`
- `frontend/src/components/App/AppContent/AppContent.module.scss`
- `frontend/src/components/App/SideNav/SideNav.tsx`
- `frontend/src/components/App/SideNav/SideNav.module.scss`
- `frontend/src/components/Settings/GeneralSettings/GeneralSettings.tsx`
- `frontend/src/components/common/PageHeader/PageHeader.module.scss`
- `frontend/src/components/common/Modal/Modal.tsx`
- `frontend/src/components/common/Modal/Modal.module.scss`
- `frontend/src/components/common/form/Input/Input.module.scss`
- `frontend/src/components/Device/DeviceInfo/DeviceInfo.module.scss`
- `frontend/src/components/Device/DeviceItem/DeviceItem.tsx`
- `frontend/src/components/Device/DeviceItem/DeviceItem.module.scss`
- `frontend/src/routes/DeviceSingle/DeviceSingle.module.scss`
- `frontend/src/components/Storage/StorageItem/StorageItem.tsx`
- `frontend/src/components/Storage/StorageItem/StorageItem.module.scss`
- `frontend/src/components/Plan/PlanItems/PlanItem.tsx`
- `frontend/src/components/Plan/PlanItems/PlanItem.module.scss`
- `frontend/src/components/Plan/PlanStats/PlanStats.module.scss`
- `frontend/src/components/Plan/PlanHistory/PlanHistory.tsx`
- `frontend/src/components/Plan/PlanHistory/PlanHistory.module.scss`
- `frontend/src/components/Plan/RecoveryTesting/RecoveryTesting.module.scss`
- `frontend/src/routes/PlanSingle/PlanSingle.tsx`
- `frontend/src/routes/PlanSingle/PlanSingle.module.scss`

Regression evidence and this review:

- `backend/__tests__/routes/backupHistory.test.ts`
- `backend/__tests__/utils/backupHistoryQuery.test.ts`
- `frontend/__tests__/backupHistory.test.ts`
- `frontend/__tests__/themePreference.test.ts`
- `frontend/__tests__/themeStyles.test.ts`
- `frontend/__tests__/theme-preview/app.tsx`
- `frontend/__tests__/theme-preview/index.html`
- `docs/UI_THEME_SNAPSHOT_PAGINATION.md`

## Migration, deployment review and rollback

Only migration **0013** is added. It creates
`backups_plan_history_date_idx(plan_id, coalesce(ended_at, started_at, created_at)
DESC, id DESC)` and changes no historical records/columns/credentials. Real
SQLite tests verify its use without a temporary ORDER BY tree and preserved
record counts. Initial index creation scans existing rows and can briefly hold
a write lock; review DB size, free space and the maintenance window before
deploying. No manual SQL cleanup or down migration is needed to roll back.

For later operator deployment (not executed here):

1. Review this branch/diff and run normal CI. Preserve a verified consistent
   SQLite/persistent-data backup and the prior immutable image reference.
2. Build/release through the existing reviewed workflow; ship frontend/backend
   together because the new UI expects the paginated endpoint. Use the existing
   deployment/readiness/rollback tools unchanged and keep approved overrides.
3. Preserve the same `/data` volume, SQLite/config, `SECRET`, `ENCRYPTION_KEY`,
   repository credentials, existing plans and Agent identity. No Agent update,
   re-enrollment, secret rotation or `TRUST_PROXY` change is required.
4. On authorized pilot acceptance, inspect history counts, exact-day filters,
   pages 1/2/last and size 50; compare row IDs/snapshot association before using
   existing Browse/Restore/Download controls. Check both configured web origins
   with the existing auth/session policy and theme persistence after reload.
   Any real backup/recovery acceptance remains a separate authorized operation.
5. If necessary, use the existing rollback tooling to the previous immutable
   server/UI image while preserving the same data/config/overlays. The additive
   index and migration journal entry may remain; older code does not depend on
   them. Do not delete/reinitialize the DB or replace keys to roll back UI code.

No production success, deployment, repository mutation or native database
recovery acceptance is claimed from these local checks.

## Separate previous privileged-fixture cleanup conclusion

**Previous fixture cleanup not independently verified.**

The existing persistent-restore report describes fixture ownership/cleanup
assertions and operator removal steps. Current read-only inventory checks found
no containers/volumes with the owned persistent-restore fixture label, no
`pluton-retained-fixture-` containers and no matching temporary-directory names.
These negative checks do not establish that all earlier Linux host loop
devices, mounts or disk-image files are gone. The Docker Desktop host namespace
was not independently inspected through a privileged helper.

No privileged mount test, Docker socket mount, loop device, fixed filesystem,
`CAP_SYS_ADMIN`, detach/unmount or unidentified-resource deletion was performed
for this task. The old permission was not reused or broadened.

## Responsive Compact Date Filter Toolbar

This follow-up continues the same uncommitted branch. Only four existing
working-tree files were refined: `BackupHistoryFilters.tsx`, its
`BackupHistory.module.scss`, `frontend/__tests__/backupHistory.test.ts`, and this
report. Before-change hashes were recorded; no earlier work was discarded.
Backend/API/query utilities, migration 0013, pagination footer, row actions,
Agent, restore/recovery, origin security and deployment tooling are unchanged.
No new dependency or migration was introduced or executed.

### Before / after

The previous filter had separate preset, labeled-field and helper-text rows.
At a rendered 1366px desktop viewport its panel measured **166px** tall. The
refinement puts the ten primary controls on one horizontal row, all **36px**
high. The panel is now **79.4px** tall, including the compact applied-range
summary: **86.6px / approximately 52% less panel height**. These measurements
were taken from actual rendered DOM, not inferred from CSS.

Presets display Today / 7 Days / 30 Days / Custom while retaining descriptive
accessible names and `aria-pressed` for the applied range. Native date fields
retain visible Start/End labels. The applied calendar range and full timezone
remain visible in a short status line; unsubmitted edits say “Unapplied changes.”
Apply remains purple and Clear secondary. No filtering occurs merely from a
date/zone edit; a preset applies once and Apply/Clear keep the existing page-size,
timezone and page-reset rules.

The explanation is an info disclosure next to the timezone, rather than a large
permanent paragraph. Its native summary can be opened with Enter/Space and
closed with Escape or focus leaving. It retains inclusive-day, timestamp and
old-record fallback information. The popup uses theme tokens and stays within
the mobile toolbar width. Validation errors remain visible inline, outside it.
DOM/tab order follows presets, dates, timezone, help, Apply, Clear; no positive
tab indices or CSS reordering were added.

Container queries use available filter width, not a forced desktop-wide minimum.
The following were checked in **both Light and Dark** with a synthetic applied
same-day filter; every page's document width stayed within the viewport:

| Viewport width | Primary-control rows                   | Panel height | Control height | Screenshot files                              |
| -------------- | -------------------------------------- | ------------ | -------------- | --------------------------------------------- |
| 1366px         | 1                                      | 79.4px       | 36px           | `after-1366-light.jpg`, `after-1366-dark.jpg` |
| 1440px         | 1                                      | 79.4px       | 36px           | `after-1440-light.jpg`, `after-1440-dark.jpg` |
| 1920px         | 1                                      | 79.4px       | 36px           | `after-1920-light.jpg`, `after-1920-dark.jpg` |
| 1024px         | 2, logically grouped                   | 127.4px      | 36px           | `after-1024-light.jpg`, `after-1024-dark.jpg` |
| 768px          | 3, dates paired                        | 216.9px      | 42px           | `after-768-light.jpg`, `after-768-dark.jpg`   |
| 390px          | 4, paired dates and full-width actions | 270.9px      | 42px           | `after-390-light.jpg`, `after-390-dark.jpg`   |

Screenshots live outside Git in the local visualization directory's
`ui-theme-pagination/compact-date-toolbar/` subdirectory. It also contains
`before-1366-light.jpg`, `before-1366-dark.jpg`, and matching after views with all
dates for a like-for-like layout comparison. The required desktop after views
show the selected Today preset and unchanged pagination footer below the table.
Very narrow containers use two preset columns and stack date fields; unusual native date-picker locales,
long timezone names, text zoom or inline errors can require additional height.
Native picker popup appearance remains browser/platform-dependent.

### Follow-up verification

- **15/15** focused backup-history tests passed, retaining all original cases
  and adding applied-preset, custom/draft/zone, info keyboard/blur, single-apply,
  natural tab-order and responsive/theme-contract coverage.
- **116/116 frontend tests passed**, 0 failed/skipped; this supersedes the earlier
  113-test frontend count above. Existing Phase 5/6/7 and restore-action UI
  regressions remain included. No existing assertion was removed to obtain a pass.
- Frontend `tsc -b` passed. `pnpm --filter @plutonhq/core-frontend build` passed,
  including **12/12** documentation checks and **8/8** Fumadocs checks. The same
  documented build warnings remain non-fatal.
- Frontend lint still fails before file lint on the existing ESLint 10 /
  typescript-eslint string `extends` configuration. No lint/dependency change.
- In the actual synthetic browser, size 50 + Next showed rows 51–100; Last 7 days
  reset to page 1 without reverting size; Back restored page 2. Native keyboard
  date edits selected another exact day, Custom became pressed after Apply,
  changing zone remained draft-only, a reversed range showed the original inline
  error, and Clear retained size 50 and the applied UTC zone. Keyboard Custom
  focused Start, Tab moved through presets, and Enter/Escape operated the info
  popup without submitting. No captured warn/error logs were reported.
- `git diff --check` passed. Backend and Agent tests were not rerun for this
  layout-only follow-up: their files/contracts and migration are hash-unchanged;
  the preceding regression results remain historical evidence, not a new run.

No production access, backup/restore execution, repository write, database
service, socket exposure, privileged fixture, commit, push, release or deployment
was performed. Existing Agent/theme/API/security behavior remains unchanged.

## Final Full-Width Filter Toolbar Alignment

Final frontend-only refinement on the same uncommitted branch. The verified gap
was caused by `.actions { margin-left: auto }` combined with fixed 134px date
inputs and a fixed 152px timezone field. Extra width became an empty spacer.
Those rules are replaced with content-aware Grid tracks: compact presets,
two flexible date fields, a flexible timezone field, natural-width state/help,
and natural-width actions. Gaps are 10px. Date inputs have a 300px maximum and
timezone a 280px maximum; the existing bounded application container is retained.

The desktop summary row is now visually hidden but remains an accessible live
status. A short Applied / Pending / All dates indicator occupies the main row.
Info exposes the full **applied** dates/timezone and explains pending edits, so
draft values cannot masquerade as applied results. Errors still appear inline.
The responsive summary remains visible at tablet/mobile container widths.
No filter handlers, query helpers, URL contracts, pagination or row actions change.

### Measured before / after

Actual rendered bounding boxes at 1366px, Today selected, in both themes:

| Measurement                          | Before                | After                        |
| ------------------------------------ | --------------------- | ---------------------------- |
| Available inner toolbar width        | 1,125.2px             | 1,125.2px                    |
| Panel width including padding/border | 1,150.8px             | 1,150.8px                    |
| Preset group width                   | 265.7px               | 265.7px                      |
| Start date input width               | 134px                 | 175.2px                      |
| End date input width                 | 134px                 | 180.9px                      |
| Timezone selector width              | 152px                 | 189.1px                      |
| Info control edge to Apply edge      | 191.5px               | **10px**                     |
| Total panel height                   | 79.4px                | **57.6px**                   |
| Primary control rows                 | 1, plus a summary row | **1, no visual summary row** |

At 1440px the old 265.1px gap also becomes 10px; the date fields measure
200.6/206.3px and timezone 211.9px. At 1920px the old 449.1px gap becomes 10px;
date fields measure 264.0/269.8px and timezone 269px, below their caps. All three
desktop widths retain 36px controls and 57.6px panel height without document
overflow, clipped date values or detached actions.

1024px uses two primary-control rows (125.4px panel); 390px uses four grouped
rows (270.9px panel) with every input/button/help control **42px** high. Visual
testing caught and fixed a column-Flex interaction shrinking mobile date inputs;
the final rendered heights were remeasured, not inferred from the CSS height.

The existing synthetic preview captured **before and after**, Light and Dark,
at 1366, 1440, 1920, 1024 and 390px. Files are outside Git under the local
visualization directory's `ui-theme-pagination/full-width-filter/`, named
`before-{width}-{light|dark}.jpg` and `after-{width}-{light|dark}.jpg`.
`pending-1366-dark.jpg` shows the info popover retaining the applied range while
dates are edited. The screenshots show a continuous row, not just technically
fitting controls; on mobile the fields, state, help and actions remain readable.

**Zoom limitation:** actual 125% browser zoom could not be confirmed in the
in-app preview (the supported browser surfaces expose no zoom control and a
standard zoom shortcut did not change width/DPR). A separate approximately
1093px effective-width check (rendered 1094px with browser rounding) verified
two-row reflow without overflow. `effective-1093-dark.jpg` is that narrow-width
check, not proof of actual browser zoom. Genuine 125% zoom remains manual
acceptance in the operator's browser; native date-picker rendering also varies.

### Final follow-up checks and scope

- **117 frontend tests passed, 0 failed/skipped**, including **16** focused
  history tests. All prior assertions remain. Added coverage checks proportional
  grid tracks/caps, no auto action spacer, full applied state in Info and a
  Pending indicator that does not replace the applied range with draft values.
  These latest counts supersede the earlier frontend counts in this report.
- Frontend typecheck and production build passed; build documentation checks
  passed **12/12**, Fumadocs **8/8**. Existing non-fatal build warnings remain.
- Frontend lint still stops on the unchanged ESLint 10/typescript-eslint string
  `extends` baseline; it was not concealed by dependency/configuration changes.
- Browser keyboard editing, Custom/Apply, info Enter/Escape and pending/applied
  transitions worked without captured warn/error logs. Existing full frontend
  URL, date, pagination, theme and restore-action regressions passed.
- `git diff --check` passed. Only the filter component, its SCSS, the existing
  history test and this report changed in this follow-up. The other 57 original
  working-tree files were preserved byte-for-byte; backend/migration 0013,
  Agent, secrets, origin security and deployment tooling were not modified.
  Backend/Agent tests were not rerun for this frontend-only refinement.

No commit, push, merge, release, deployment, production access, backup/restore
execution, database change, repository write, Docker privilege or mount operation
was performed.
